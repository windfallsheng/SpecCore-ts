/**
 * chain — TaskChain 无人值守任务链（v8.3.307+）
 *
 * 场景：用户在迭代中提前写好一组异质任务 spec（编码 / 写文档 / 写脚本 /
 * 数据处理等），任务间可能有关联（依赖）也可能毫不相关。chain 命令按拓扑
 * 顺序逐个推进，每轮输出一个自包含执行 prompt（含重新加载的约束集），
 * 宿主 AI 执行后再次调用 chain 校验并推进下一任务——无人值守、断点续跑。
 *
 * 闭环方式（与 dispatch-loop「方式 Y」一致）：
 *
 *   speccore chain run → 推进状态机 → 输出下一任务的 prompt（exitCode 10）
 *   → 宿主 AI 执行该任务并落盘 → 再次 speccore chain run → 校验任务状态
 *   → 通过则标记 done 并推进下一任务 → …… → 全部完成 → 汇总报告（exitCode 0）
 *
 * 状态文件：<projectRoot>/.speccore/local/chain-state.json（按迭代分节）
 *  - 任务完成后校验其 .meta/status，手动修复过的任务可恢复为完成
 *  - 每任务开始/完成/失败均发送通知（notification.ts）
 *
 * 约束集注入：每个任务执行前，chain 重新加载该任务声明的约束集 +
 * 类型默认约束（constraint-set.ts），保证「同类任务每次执行都读一遍
 * 共同前提约束」，记忆不随会话漂移。
 */

import { join, dirname } from 'path';
import { pathExists, readFile, writeFile, ensureDir } from 'fs-extra';
import { logger } from '../utils/logger';
import { getDefaultIteration, getIterationDir } from '../core/context';
import { scanTasks, topologicalSort, TaskState } from '../core/state';
import { sendNotification } from '../core/notification';
import { getTaskTypeDefinition, ALL_TASK_TYPES } from '../core/task-type-registry';
import {
  loadConstraintSet, parseDeclaredConstraints, formatConstraints, listConstraintSets,
} from '../core/constraint-set';
import { getProjectRoot } from '../utils/task-utils';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface ChainOptions {
  iteration?: string;
  /** 只执行指定类型的任务（逗号分隔，如 doc,script） */
  type?: string;
  /** 只执行指定数量的任务（无人值守分批控制） */
  limit?: number;
  /** 查看链状态 */
  status?: boolean;
  /** 重置链状态 */
  reset?: boolean;
  /** 列出可用约束集 */
  constraints?: boolean;
  /** 执行模式：prompt 接力（默认，宿主 AI 执行） */
  prompt?: boolean;
}

interface ChainTaskState {
  status?: 'done' | 'failed';
  attempt: number;
  lastError?: string;
  updatedAt: string;
}

interface ChainStateFile {
  version: 1;
  iterations: Record<string, Record<string, ChainTaskState>>;
}

/** 链任务执行结果（调用方判断是否全部完成） */
export interface ChainRoundResult {
  finished: boolean;
  done: string[];
  failed: string[];
  failedErrors: Record<string, string>;
  /** finished=false 时：下一任务的执行 prompt */
  nextTask?: TaskState;
  prompt?: string;
  attempt?: number;
}

// ═══════════════════════════════════════════════════════════
// 状态文件读写
// ═══════════════════════════════════════════════════════════

async function getStateFilePath(): Promise<string> {
  const fp = join(getProjectRoot(), '.speccore', 'local', 'chain-state.json');
  await ensureDir(dirname(fp));
  return fp;
}

async function loadStateFile(): Promise<ChainStateFile> {
  try {
    const fp = await getStateFilePath();
    if (!(await pathExists(fp))) return { version: 1, iterations: {} };
    const raw = await readFile(fp, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && typeof parsed.iterations === 'object' && parsed.iterations) {
      return parsed;
    }
  } catch (e: any) {
    logger.debug(`[chain] 状态文件读取失败，使用空状态: ${e.message}`);
  }
  return { version: 1, iterations: {} };
}

async function saveStateFile(state: ChainStateFile): Promise<void> {
  try {
    const fp = await getStateFilePath();
    await writeFile(fp, JSON.stringify(state, null, 2));
  } catch (e: any) {
    logger.warn(`[chain] 状态文件写入失败: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════
// 任务校验 + Prompt 构建
// ═══════════════════════════════════════════════════════════

/** 校验任务是否已完成（.meta/status = done/completed） */
async function isTaskCompleted(task: TaskState, iteration: string): Promise<boolean> {
  try {
    const iterDir = await getIterationDir(iteration);
    const statusPath = join(iterDir, '030-tasks', ...task.path
      ? [task.path.replace(join(iterDir, '030-tasks'), '').replace(/^\//, '')]
      : [task.type, task.id], '.meta', 'status');
    if (await pathExists(statusPath)) {
      const status = (await readFile(statusPath, 'utf-8')).trim();
      return ['done', 'completed'].includes(status);
    }
    // 无 status 文件时回退 scanTasks 的解析结果
    return task.status === 'completed';
  } catch {
    return task.status === 'completed';
  }
}

/** 读取任务 spec 中声明的约束集 */
async function readDeclaredConstraints(task: TaskState, iteration: string): Promise<string[]> {
  try {
    const iterDir = await getIterationDir(iteration);
    const taskDir = task.path
      ? join(iterDir, '030-tasks', task.path.replace(join(iterDir, '030-tasks'), '').replace(/^\//, ''))
      : join(iterDir, '030-tasks', task.type, task.id);
    const specFiles = ['00-specs/REQ.md', 'REQ.md', 'TASK.md'];
    for (const f of specFiles) {
      const p = join(taskDir, f);
      if (await pathExists(p)) {
        return parseDeclaredConstraints(await readFile(p, 'utf-8'));
      }
    }
  } catch { /* 忽略 */ }
  return [];
}

/** 构建任务执行 prompt（含约束集注入） */
async function buildTaskPrompt(task: TaskState, iteration: string, attempt: number, lastError?: string): Promise<string> {
  const def = getTaskTypeDefinition(task.type);
  const declared = await readDeclaredConstraints(task, iteration);
  const { items, missing } = await loadConstraintSet({ taskType: task.type, declared });
  const iterDir = await getIterationDir(iteration);
  const taskPathRel = task.path
    ? task.path.replace(join(iterDir, '030-tasks'), '030-tasks').replace(/^\//, '')
    : `030-tasks/${task.type}/${task.id}`;

  const lines: string[] = [
    `# TaskChain 任务: ${task.id} — ${task.name || task.id}`,
    '',
    `- 任务类型: ${def.label}（${task.type}）`,
    `- 产出目录: ${def.outputDir}`,
    `- 验收方式: ${def.acceptance}`,
    `- 任务目录: ${taskPathRel}`,
    '',
    '## 执行要求',
    '',
    '1. 先读取任务目录下的 spec 文档（REQ.md/TECH.md/TASK.md，存在即读）',
    '2. 按任务类型产出对应交付物到产出目录',
    '3. 完成后将任务目录下 .meta/status 更新为 done',
    '',
  ];

  // 约束集注入（每次执行前重新加载）
  if (items.length > 0) {
    lines.push(formatConstraints(items), '');
  }
  if (missing.length > 0) {
    lines.push(`> ⚠️ 声明的约束集文件缺失: ${missing.map(m => `${m}.md`).join(', ')}（.speccore/GLOBAL/CONSTRAINTS/）`, '');
  }

  if (attempt > 1) {
    lines.push(`## ⚠️ 第 ${attempt} 次尝试`, '');
    lines.push(`上次未通过验收。失败原因: ${lastError || '未记录'}`, '');
    lines.push('请修复问题后重新交付。', '');
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════
// 核心命令
// ═══════════════════════════════════════════════════════════

export async function chainCommand(options: ChainOptions): Promise<void> {
  const iteration = await getDefaultIteration(options.iteration);
  if (!iteration) {
    logger.error('No active iteration found. Please specify --iteration.');
    return;
  }

  // ── --constraints: 列出可用约束集 ──
  if (options.constraints) {
    const names = await listConstraintSets();
    logger.info('');
    logger.info(`📐 已安装约束集（${names.length} 个，位于 .speccore/GLOBAL/CONSTRAINTS/）:`);
    for (const name of names) logger.info(`   - ${name}`);
    if (names.length === 0) {
      logger.info('   （无。运行 speccore init 生成内置约束集，或手动创建 {约束名}.md）');
    }
    return;
  }

  const stateFile = await loadStateFile();
  const iterState = stateFile.iterations[iteration] || (stateFile.iterations[iteration] = {});

  // ── --reset: 重置链状态 ──
  if (options.reset) {
    delete stateFile.iterations[iteration];
    await saveStateFile(stateFile);
    logger.success(`✅ 链状态已重置（${iteration}）`);
    return;
  }

  // ── 扫描任务 + 过滤 + 拓扑排序 ──
  let tasks = await scanTasks(iteration);
  if (tasks.length === 0) {
    logger.warn('No tasks found in iteration');
    return;
  }
  if (options.type) {
    const types = options.type.split(',').map(t => t.trim()).filter(Boolean);
    const before = tasks.length;
    tasks = tasks.filter(t => types.includes(t.type));
    if (tasks.length < before) logger.info(`🎯 类型筛选「${options.type}」: ${before} → ${tasks.length} 个任务`);
  }
  const sorted = topologicalSort(tasks);

  // ── --status: 查看链状态 ──
  if (options.status) {
    const doneCount = sorted.filter(t => iterState[t.id]?.status === 'done' || t.status === 'completed').length;
    const failedCount = sorted.filter(t => iterState[t.id]?.status === 'failed').length;
    const total = sorted.length;
    logger.info('');
    logger.info(`⛓️  TaskChain 状态 — ${iteration}（${doneCount}/${total} 完成，${failedCount} 失败）`);
    logger.info('');
    for (const t of sorted) {
      const st = iterState[t.id]?.status || t.status;
      const icon = st === 'done' || t.status === 'completed' ? '✅' : st === 'failed' ? '❌' : '⏳';
      const label = getTaskTypeDefinition(t.type).label;
      logger.info(`   ${icon} ${t.id} [${label}] ${t.name || ''}`);
    }
    return;
  }

  // ── 推进循环：逐个校验任务状态，找到第一个未完成的任务 ──
  const done: string[] = [];
  const failed: string[] = [];
  const failedErrors: Record<string, string> = {};
  const now = new Date().toISOString();
  const limit = options.limit && options.limit > 0 ? options.limit : 0;
  let advancedCount = 0;

  for (const task of sorted) {
    // 忽略不在注册表中的未知类型（保留给传统 execute 处理）
    if (!ALL_TASK_TYPES.includes(task.type)) continue;
    const st = iterState[task.id];

    // 已标记失败：校验是否已手动修复
    if (st?.status === 'failed') {
      const completed = await isTaskCompleted(task, iteration);
      if (completed) {
        iterState[task.id] = { status: 'done', attempt: st.attempt, updatedAt: now };
        done.push(task.id);
        logger.info(`[chain] 任务 ${task.id} 已修复，恢复为完成`);
      } else {
        failed.push(task.id);
        failedErrors[task.id] = st.lastError || '任务未完成';
      }
      continue;
    }

    // 校验任务完成状态
    const completed = await isTaskCompleted(task, iteration);
    if (completed) {
      iterState[task.id] = { status: 'done', attempt: st?.attempt ?? 1, updatedAt: now };
      done.push(task.id);
      continue;
    }

    // 尝试次数限制（最多 2 次尝试）
    const prevAttempt = st?.attempt ?? 0;
    if (prevAttempt >= 2) {
      iterState[task.id] = { status: 'failed', attempt: prevAttempt, lastError: '任务未完成（重试超限）', updatedAt: now };
      failed.push(task.id);
      failedErrors[task.id] = '任务未完成（重试超限）';
      continue;
    }

    // 产出下一个任务的 prompt
    const nextAttempt = prevAttempt + 1;
    iterState[task.id] = { attempt: nextAttempt, lastError: undefined, updatedAt: now };
    await saveStateFile(stateFile);

    const prompt = await buildTaskPrompt(task, iteration, nextAttempt, prevAttempt > 0 ? '上次执行未将 .meta/status 更新为 done' : undefined);

    // 开始执行通知
    await sendNotification(process.cwd(), {
      type: 'task_status_changed',
      title: `TaskChain 开始执行 ${task.id}`,
      message: `${getTaskTypeDefinition(task.type).label} — ${task.name || ''}（第 ${nextAttempt} 次尝试）`,
      iteration,
      task: task.id,
    }).catch(() => {});

    logger.info(`[chain] 下一任务: ${task.id}（第 ${nextAttempt}/2 次尝试）`);
    process.stdout.write(prompt);
    process.exitCode = 10;
    return;
  }

  await saveStateFile(stateFile);

  // ── 全部完成：汇总报告 + 通知 ──
  const summary = {
    iteration,
    done: done.length,
    failed: failed.length,
    total: done.length + failed.length,
  };
  logger.info('');
  logger.info('╔══════════════════════════════════════════════╗');
  logger.info('║   🎉 TaskChain 任务链完成                     ║');
  logger.info('╚══════════════════════════════════════════════╝');
  logger.info(`   迭代: ${iteration}`);
  logger.info(`   完成: ${summary.done} / ${summary.total}${summary.failed > 0 ? `（${summary.failed} 失败）` : ''}`);
  if (summary.failed > 0) {
    logger.info('');
    logger.warn('   失败任务:');
    for (const id of Object.keys(failedErrors)) {
      logger.warn(`     ❌ ${id}: ${failedErrors[id]}`);
    }
  }
  await sendNotification(process.cwd(), {
    type: 'task_status_changed',
    title: `TaskChain 执行完成（${iteration}）`,
    message: `完成 ${summary.done}/${summary.total}${summary.failed > 0 ? `，失败 ${summary.failed}` : ''}`,
    iteration,
  }).catch(() => {});
}

/**
 * chain 子命令注册（由 cli.ts 调用）
 */
export function registerChainCommand(program: import('commander').Command): void {
  const chainCmd = program
    .command('chain')
    .alias('ch')
    .description('TaskChain 无人值守任务链：拓扑调度 + 约束集注入 + 断点续跑');
  chainCmd
    .command('run')
    .description('推进任务链：输出下一任务 prompt（宿主 AI 执行后重复调用直至完成）')
    .option('-i, --iteration <iteration>', '目标迭代')
    .option('--type <types>', '只执行指定类型（逗号分隔: feature,bugfix,refactor,research,doc,script,data）')
    .option('--limit <n>', '本轮最多推进的任务数')
    .action((opts: any) => chainCommand({ ...opts }));
  chainCmd
    .command('status')
    .description('查看任务链状态')
    .option('-i, --iteration <iteration>', '目标迭代')
    .action((opts: any) => chainCommand({ ...opts, status: true }));
  chainCmd
    .command('reset')
    .description('重置任务链状态')
    .option('-i, --iteration <iteration>', '目标迭代')
    .action((opts: any) => chainCommand({ ...opts, reset: true }));
  chainCmd
    .command('constraints')
    .description('列出已安装的约束集')
    .action((opts: any) => chainCommand({ ...opts, constraints: true }));
}
