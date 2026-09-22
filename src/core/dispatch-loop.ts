/**
 * dispatch-loop — 调度循环状态机（v8.3.225+）
 *
 * 方式 Y（宿主会话内闭环）：CLI 每轮处理一个步骤，宿主 AI 在同一会话内连续调用：
 *
 *   CLI 首次调用 → 推进状态机 → 找到第一个「未完成」步骤 → 输出自包含 prompt（exitCode 10）
 *   → 宿主 AI 落盘 → 宿主 AI 再次调用 CLI → CLI 校验产物 → 通过则标记 done 并推进下一步
 *   → …… → 全部完成 → 输出汇总报告（exitCode 0）
 *
 * 错误隔离：步骤间相互独立，某一步失败（重试超限）只标记该步 failed 并继续后续步骤，
 * 不影响其他步骤。状态文件支持 Ctrl-C 中断后恢复。
 *
 * 状态文件：<projectRoot>/.speccore/local/dispatch-loop.json（按 scope 分节，一个文件多租户）
 */

import { join, dirname } from 'path';
import { pathExists, readFile, writeFile, ensureDir } from 'fs-extra';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export type LoopStepStatus = 'done' | 'failed';

export interface LoopStepState {
  status?: LoopStepStatus;
  /** 已完成的尝试次数（1-based）。首试 attempt=1，一次重试 attempt=2 */
  attempt: number;
  lastError?: string;
  updatedAt: string;
}

export interface LoopStateFile {
  version: 1;
  scopes: Record<string, Record<string, LoopStepState>>;
}

export interface LoopStep {
  /** 步骤唯一 ID（建议带前缀，如 `unit:PRD-会议室管理`） */
  id: string;
  /** 步骤展示名 */
  name: string;
  /** 产出校验：返回 null = 通过；返回字符串 = 失败原因 */
  validate: () => Promise<string | null>;
  /** 生成该步骤的 prompt（attempt 为第几次尝试，lastError 为上次失败原因，仅重试时有值） */
  buildPrompt: (ctx: { attempt: number; lastError?: string }) => Promise<string>;
}

export interface LoopSummary {
  done: string[];
  failed: string[];
  failedErrors: Record<string, string>;
}

export interface LoopRoundResult {
  finished: boolean;
  /** finished=true 时的汇总 */
  summary?: LoopSummary;
  /** finished=false 时的当前步骤 */
  step?: LoopStep;
  /** 本次输出的尝试序号（1-based） */
  attempt?: number;
  /** 当前步骤的 prompt（finished=false 时必有） */
  prompt?: string;
}

export interface DispatchLoopOptions {
  projectRoot: string;
  /** 状态文件命名空间（如 `analyze-units:meeting-system`） */
  scope: string;
  /** 重试次数（默认 1，即最多 2 次尝试） */
  maxRetries?: number;
  /** 已完成步骤的产物被删除时是否重置为 pending（默认 true） */
  resetStaleDone?: boolean;
}

// ═══════════════════════════════════════════════════════════
// 状态文件读写
// ═══════════════════════════════════════════════════════════

async function getStateFilePath(projectRoot: string): Promise<string> {
  const fp = join(projectRoot, '.speccore', 'local', 'dispatch-loop.json');
  await ensureDir(dirname(fp));
  return fp;
}

async function loadStateFile(projectRoot: string): Promise<LoopStateFile> {
  try {
    const fp = await getStateFilePath(projectRoot);
    if (!(await pathExists(fp))) return { version: 1, scopes: {} };
    const raw = await readFile(fp, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && typeof parsed.scopes === 'object' && parsed.scopes) {
      return parsed;
    }
  } catch (e: any) {
    logger.debug(`[dispatch-loop] 状态文件读取失败，使用空状态: ${e.message}`);
  }
  return { version: 1, scopes: {} };
}

async function saveStateFile(projectRoot: string, state: LoopStateFile): Promise<void> {
  try {
    const fp = await getStateFilePath(projectRoot);
    await writeFile(fp, JSON.stringify(state, null, 2));
  } catch (e: any) {
    logger.warn(`[dispatch-loop] 状态文件写入失败: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════
// 核心循环
// ═══════════════════════════════════════════════════════════

/**
 * 推进一轮调度循环。
 *
 * 行为：
 * 1. 已标记 failed 的步骤直接跳过（错误隔离，不阻塞后续）
 * 2. 从前往后逐个校验步骤产出：通过 → 标记 done 并继续（宿主可能一次落盘多个步骤）
 * 3. 遇到「产出未就绪」的步骤：
 *    - 尝试次数已达上限（maxRetries+1）→ 标记 failed，继续后续步骤
 *    - 否则 → 记录本次尝试、生成 prompt 并返回（调用方输出 prompt 后以 exitCode 10 退出）
 * 4. 所有步骤均为 done/failed → 返回 finished=true + 汇总报告
 */
export async function runDispatchLoopRound(
  steps: LoopStep[],
  options: DispatchLoopOptions
): Promise<LoopRoundResult> {
  const maxRetries = options.maxRetries ?? 1;
  const resetStaleDone = options.resetStaleDone ?? true;

  const stateFile = await loadStateFile(options.projectRoot);
  const scopeState = stateFile.scopes[options.scope] || (stateFile.scopes[options.scope] = {});
  const now = new Date().toISOString();

  const done: string[] = [];
  const failed: string[] = [];
  const failedErrors: Record<string, string> = {};

  for (const step of steps) {
    const st = scopeState[step.id];

    // 已标记失败：先校验产物是否已被手动修复（通过则恢复为 done，否则保持跳过）
    if (st?.status === 'failed') {
      const error = await step.validate();
      if (error === null) {
        scopeState[step.id] = { status: 'done', attempt: st.attempt, updatedAt: now };
        done.push(step.id);
        logger.info(`[dispatch-loop] 步骤 ${step.id} 已手动修复，恢复为完成`);
      } else {
        failed.push(step.id);
        failedErrors[step.id] = st.lastError || error;
      }
      continue;
    }

    // 校验产出
    const error = await step.validate();
    if (error === null) {
      // 产出就绪 → 标记完成
      scopeState[step.id] = { status: 'done', attempt: st?.attempt ?? 1, updatedAt: now };
      done.push(step.id);
      continue;
    }

    // 产出未就绪。若之前标记过 done（产物被删），按需重置
    if (st?.status === 'done') {
      if (!resetStaleDone) {
        done.push(step.id);
        continue;
      }
      logger.warn(`[dispatch-loop] 步骤 ${step.id} 曾完成但产物已失效，重置为待处理`);
      delete scopeState[step.id];
    }

    // 尝试次数判断
    const prevAttempt = scopeState[step.id]?.attempt ?? 0;
    if (prevAttempt >= maxRetries + 1) {
      // 重试超限 → 标记失败，继续后续步骤
      scopeState[step.id] = { status: 'failed', attempt: prevAttempt, lastError: error, updatedAt: now };
      failed.push(step.id);
      failedErrors[step.id] = error;
      continue;
    }

    // 记录本次尝试并生成 prompt
    const nextAttempt = prevAttempt + 1;
    scopeState[step.id] = { attempt: nextAttempt, lastError: error, updatedAt: now };
    await saveStateFile(options.projectRoot, stateFile);

    const prompt = await step.buildPrompt({
      attempt: nextAttempt,
      lastError: prevAttempt > 0 ? error : undefined,
    });

    logger.info(`[dispatch-loop] 步骤 ${step.id} 待处理（第 ${nextAttempt}/${maxRetries + 1} 次尝试）`);
    return {
      finished: false,
      step,
      attempt: nextAttempt,
      prompt,
    };
  }

  await saveStateFile(options.projectRoot, stateFile);

  return {
    finished: true,
    summary: { done, failed, failedErrors },
  };
}

/**
 * 重置指定 scope 的状态（如用户手动删除产物后重跑）。
 */
export async function resetDispatchLoopState(projectRoot: string, scope: string): Promise<void> {
  const stateFile = await loadStateFile(projectRoot);
  if (stateFile.scopes[scope]) {
    delete stateFile.scopes[scope];
    await saveStateFile(projectRoot, stateFile);
  }
}
