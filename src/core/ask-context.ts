/**
 * ask-context — Rich Context 构建器
 *
 * 为宿主AI / LLM 提供决策所需的完整上下文：
 *   1. 本地引擎候选意图（让AI做选择题而非填空题）
 *   2. 项目阶段与生命周期状态
 *   3. 当前迭代/任务上下文
 *   4. 最近命令历史（时间序列行为模式）
 */

import { pathExists } from 'fs-extra';
import { join } from 'path';
import { loadContext, detectActiveIteration } from './context';
import type { IntentResult } from './intent-recognition';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface AskContext {
  /** 用户原始输入 */
  userInput: string;
  /** 本地引擎的置信度 */
  localConfidence: number;
  /** 本地引擎的候选意图（按置信度排序） */
  localCandidates: LocalCandidate[];
  /** 项目上下文 */
  projectContext: ProjectContext;
  /** 可用命令知识库摘要 */
  availableCommands: string[];
}

export interface LocalCandidate {
  intent: string;
  command: string;
  confidence: number;
  matchedTriggers: string[];
  extractedParams: Record<string, string>;
}

export interface ProjectContext {
  /** 项目当前阶段 */
  phase: 'init' | 'analyze' | 'split' | 'plan' | 'execute' | 'done' | 'unknown';
  /** 当前活跃迭代 */
  currentIteration: string;
  /** 当前任务 */
  currentTask: string;
  /** 最近执行的命令（最近5条） */
  recentCommands: RecentCommand[];
  /** 迭代统计 */
  iterationStats: {
    pending: number;
    inProgress: number;
    completed: number;
    blocked: number;
  };
}

export interface RecentCommand {
  command: string;
  timestamp: string;
  iteration?: string;
  task?: string;
}

// ═══════════════════════════════════════════════════════════
// Rich Context 构建入口
// ═══════════════════════════════════════════════════════════

/**
 * 构建完整的 AskContext，供宿主AI / LLM 做语义判断
 */
export async function buildAskContext(
  input: string,
  localResults: IntentResult[]
): Promise<AskContext> {
  const candidates = localResults.slice(0, 4).map(r => ({
    intent: r.intent,
    command: r.command,
    confidence: r.confidence,
    matchedTriggers: r.matchedTriggers.slice(0, 3),
    extractedParams: r.extractedParams,
  }));

  const projectContext = await buildProjectContext();

  return {
    userInput: input,
    localConfidence: localResults[0]?.confidence || 0,
    localCandidates: candidates,
    projectContext,
    availableCommands: getAvailableCommandsForPhase(projectContext.phase),
  };
}

// ═══════════════════════════════════════════════════════════
// 项目上下文构建
// ═══════════════════════════════════════════════════════════

async function buildProjectContext(): Promise<ProjectContext> {
  const ctx = await loadContext();
  const iteration = ctx.currentIteration || (await detectActiveIteration());

  return {
    phase: detectProjectPhase(),
    currentIteration: iteration,
    currentTask: ctx.currentTask || '',
    recentCommands: (ctx.history || []).slice(-5).map(h => ({
      command: h.command,
      timestamp: h.timestamp,
      iteration: h.iteration,
      task: h.task,
    })),
    iterationStats: {
      pending: ctx.pendingTasks || 0,
      inProgress: ctx.inProgressTasks || 0,
      completed: ctx.completedTasks || 0,
      blocked: ctx.blockedTasks || 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════
// 项目阶段检测
// ═══════════════════════════════════════════════════════════

/**
 * 根据当前目录结构和上下文推断项目阶段
 */
function detectProjectPhase(): ProjectContext['phase'] {
  // 基于文件存在性推断阶段
  const cwd = process.cwd();

  // 检查是否有迭代目录
  try {
    const { readdirSync } = require('fs');
    const dirs = readdirSync(cwd, { withFileTypes: true })
      .filter((d: any) => d.isDirectory())
      .map((d: any) => d.name);

    const hasIterations = dirs.some((d: string) => d.startsWith('Iteration-'));
    const hasSpeccore = dirs.includes('.speccore');

    if (!hasSpeccore) return 'init';
    if (!hasIterations) return 'analyze';

    // 检查最新迭代的内容
    const iterDirs = dirs.filter((d: string) => d.startsWith('Iteration-')).sort();
    const latestIter = iterDirs[iterDirs.length - 1];
    if (!latestIter) return 'analyze';

    const iterPath = join(cwd, latestIter);
    const { existsSync } = require('fs');

    const hasTasks = existsSync(join(iterPath, '030-tasks'));
    const hasSpecs = existsSync(join(iterPath, '020-specs'));
    const hasRequirements = existsSync(join(iterPath, '010-requirements'));

    if (!hasRequirements) return 'init';
    if (!hasSpecs) return 'analyze';
    if (!hasTasks) return 'split';

    // 检查是否有执行中的任务
    if (hasTasks) {
      try {
        const taskDirs = readdirSync(join(iterPath, '030-tasks'), { withFileTypes: true })
          .filter((d: any) => d.isDirectory() && d.name.startsWith('Task-'));
        if (taskDirs.length === 0) return 'plan';
      } catch {}
    }

    return 'execute';
  } catch (e: any) {
    logger.debug(`阶段检测失败: ${e.message}`);
    return 'unknown';
  }
}

// ═══════════════════════════════════════════════════════════
// 阶段化命令推荐
// ═══════════════════════════════════════════════════════════

/**
 * 根据项目阶段返回当前最相关的命令列表
 * 用于缩小宿主AI的决策范围
 */
function getAvailableCommandsForPhase(phase: ProjectContext['phase']): string[] {
  const base = ['help', 'dashboard', 'context'];

  switch (phase) {
    case 'init':
      return [...base, 'init', 'iteration create', 'doc2spec'];
    case 'analyze':
      return [...base, 'analyze', 'doc2spec', 'split', 'validate'];
    case 'split':
      return [...base, 'split', 'task new', 'plan', 'analyze'];
    case 'plan':
      return [...base, 'plan', 'execute', 'task new', 'validate'];
    case 'execute':
      return [...base, 'execute', 'plan', 'pr', 'done', 'change', 'sync'];
    case 'done':
      return [...base, 'done', 'pr', 'sync', 'spec2doc'];
    default:
      return base;
  }
}

// ═══════════════════════════════════════════════════════════
// Context 序列化（用于文件协议 / stdout 标记）
// ═══════════════════════════════════════════════════════════

/**
 * 将 AskContext 序列化为宿主AI可读的结构化文本
 */
export function formatContextForHostAi(context: AskContext): string {
  const lines: string[] = [];

  lines.push('## 用户输入');
  lines.push(`"${context.userInput}"`);
  lines.push('');

  lines.push('## 本地引擎候选（按置信度排序）');
  if (context.localCandidates.length === 0) {
    lines.push('本地引擎未识别到匹配意图。');
  } else {
    for (const c of context.localCandidates) {
      const params = Object.entries(c.extractedParams)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      lines.push(`- ${c.command} (${c.confidence}%) — 触发: ${c.matchedTriggers.join(', ')}${params ? ` | 参数: ${params}` : ''}`);
    }
  }
  lines.push('');

  lines.push('## 项目上下文');
  const pc = context.projectContext;
  lines.push(`- 当前阶段: ${pc.phase}`);
  lines.push(`- 活跃迭代: ${pc.currentIteration || '无'}`);
  lines.push(`- 当前任务: ${pc.currentTask || '无'}`);
  lines.push(`- 任务统计: 待处理${pc.iterationStats.pending} / 进行中${pc.iterationStats.inProgress} / 已完成${pc.iterationStats.completed} / 阻塞${pc.iterationStats.blocked}`);
  if (pc.recentCommands.length > 0) {
    lines.push(`- 最近命令: ${pc.recentCommands.map(c => c.command).join(' → ')}`);
  }
  lines.push('');

  lines.push('## 当前阶段推荐命令');
  lines.push(context.availableCommands.join(', '));
  lines.push('');

  lines.push('## 你的任务');
  lines.push('根据用户输入、本地引擎候选和项目上下文，判断最佳意图。');
  lines.push('如果本地候选已足够明确，直接选择；如果模糊，结合项目阶段推断。');
  lines.push('返回格式: {"intent": "...", "command": "...", "confidence": 95, "reasoning": "..."}');

  return lines.join('\n');
}
