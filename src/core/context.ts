import { ensureDir, readJson, writeJson, pathExists } from 'fs-extra';
import { join } from "path";
import { findProjectRoot } from '../utils/task-utils';

export interface Context {
  currentIteration: string;
  currentTask: string;
  currentAssignee: string;
  lastUpdated: string;
  lastAction: string;
  lastIntent: string;
  interruptedAt: string;
  iterationStatus: string;
  pendingTasks: number;
  inProgressTasks: number;
  completedTasks: number;
  blockedTasks: number;
  customAliases: Record<string, string>;
  history: ContextHistoryEntry[];
  hotfix?: HotfixEntry;
}

export interface HotfixEntry {
  taskId: string;
  startedAt: string;      // ISO timestamp
  graceEndsAt: string;    // 30min: can skip reverse sync
  mustSyncBy: string;     // 24h: mandatory deadline
}

export interface ContextHistoryEntry {
  command: string;
  timestamp: string;
  iteration?: string;
  task?: string;
}

const CONTEXT_PATH = '.speccore/local/context.json';

export async function loadContext(): Promise<Context> {
  if (await pathExists(CONTEXT_PATH)) {
    return await readJson(CONTEXT_PATH) as Context;
  }
  return {
    currentIteration: '',
    currentTask: '',
    currentAssignee: '',
    lastUpdated: '',
    lastAction: '',
    lastIntent: '',
    interruptedAt: '',
    iterationStatus: '',
    pendingTasks: 0,
    inProgressTasks: 0,
    completedTasks: 0,
    blockedTasks: 0,
    customAliases: {},
    history: []
  };
}

export async function saveContext(context: Context): Promise<void> {
  await ensureDir('.speccore/local');
  context.lastUpdated = new Date().toISOString();
  await writeJson(CONTEXT_PATH, context, { spaces: 2 });
}

export async function updateContext(partial: Partial<Context>): Promise<void> {
  const context = await loadContext();
  Object.assign(context, partial);
  await saveContext(context);
}

export async function recordHistory(command: string, iteration?: string, task?: string): Promise<void> {
  const context = await loadContext();
  context.history.push({
    command,
    timestamp: new Date().toISOString(),
    iteration,
    task
  });
  // Keep only last 100 entries
  if (context.history.length > 100) {
    context.history = context.history.slice(-100);
  }
  await saveContext(context);
}

export async function detectActiveIteration(): Promise<string> {
  const { pathExists, readFile } = await import('fs-extra');
  const { join } = await import('path');
  
  // First check context
  const context = await loadContext();
  if (context.currentIteration) {
    return context.currentIteration;
  }
  
  // Read ITERATIONS/README.md
  const iterationsPath = join('.speccore', 'ITERATIONS', 'README.md');
  if (!(await pathExists(iterationsPath))) {
    return '';
  }
  
  const content = await readFile(iterationsPath, 'utf-8');
  
  // Find iteration with 🔄 进行中 status
  const activeMatch = content.match(/\|\s*([^|]+)\s*\|[^|]*🔄/);
  if (activeMatch) {
    return activeMatch[1].trim();
  }
  
  // Find latest iteration
  const matches = content.matchAll(/\|\s*([^|]+)\s*\|/g);
  const iterations: string[] = [];
  for (const match of matches) {
    const name = match[1].trim();
    if (name && name !== '迭代名称' && !name.startsWith('---')) {
      iterations.push(name);
    }
  }
  
  return iterations[iterations.length - 1] || '';
}

export async function detectCurrentAssignee(): Promise<string> {
  const context = await loadContext();
  if (context.currentAssignee) {
    return context.currentAssignee;
  }
  
  // Try git config
  try {
    const { execSync } = await import('child_process');
    return execSync('git config user.name', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

export async function getDefaultIteration(iteration?: string): Promise<string> {
  if (iteration) return iteration;
  return await detectActiveIteration();
}

export async function getDefaultAssignee(assignee?: string): Promise<string> {
  if (assignee) return assignee;
  return await detectCurrentAssignee();
}

// ============================================
// Hotfix 例外流程
// ============================================

/** 标记任务为 hotfix，宽限期 30 分钟 */
export async function startHotfix(taskId: string): Promise<void> {
  const now = new Date();
  const graceEnds = new Date(now.getTime() + 30 * 60 * 1000);    // +30min
  const mustSync = new Date(now.getTime() + 24 * 60 * 60 * 1000); // +24h
  await updateContext({
    hotfix: {
      taskId,
      startedAt: now.toISOString(),
      graceEndsAt: graceEnds.toISOString(),
      mustSyncBy: mustSync.toISOString(),
    }
  });
}

/** 清除 hotfix 标记 */
export async function clearHotfix(): Promise<void> {
  await updateContext({ hotfix: undefined });
}

/** 获取当前 hotfix 状态（给 validate/progress 用） */
export async function getHotfixStatus(): Promise<{
  inHotfix: boolean;
  graceExpired: boolean;
  mandatoryExpired: boolean;
  taskId: string;
} | null> {
  const ctx = await loadContext();
  if (!ctx.hotfix) return null;

  const now = new Date();
  return {
    inHotfix: true,
    taskId: ctx.hotfix.taskId,
    graceExpired: now > new Date(ctx.hotfix.graceEndsAt),
    mandatoryExpired: now > new Date(ctx.hotfix.mustSyncBy),
  };
}

/**
 * 根据简短迭代名（如 Q1）查找完整迭代路径
 * 返回项目根目录下的 Iteration-NNN-q1
 * v8.3.32 修复：优先精确匹配，避免 endsWith 多匹配时返回错误迭代
 */
export async function getIterationDir(name: string): Promise<string> {
  const { readdir } = await import('fs-extra');
  const { logger } = await import('../utils/logger');
  // v8.3.101+: 向上查找项目根目录（支持在子目录执行）
  const root = findProjectRoot() || process.cwd();
  // 去掉可能的 Iteration- 前缀（AI 可能传完整名如 Iteration-009-xxx）
  const shortName = name.replace(/^Iteration-/, '');
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const iterEntries = entries.filter(e => e.isDirectory() && e.name.startsWith('Iteration-'));

    // 1. 精确匹配（完整名或短名完全一致）
    const exact = iterEntries.find(e =>
      e.name === `Iteration-${shortName}` ||
      e.name.toLowerCase() === shortName.toLowerCase()
    );
    if (exact) return join(root, exact.name);

    // 2. 后缀匹配（如 "meeting-system" 匹配 "Iteration-xxx-meeting-system"）
    // 要求唯一匹配，否则发出警告
    const lowerShort = shortName.toLowerCase();
    const suffixMatches = iterEntries.filter(e =>
      e.name.toLowerCase().endsWith(`-${lowerShort}`)
    );
    if (suffixMatches.length === 1) {
      return join(root, suffixMatches[0].name);
    }
    if (suffixMatches.length > 1) {
      logger.warn(`⚠️ 迭代名 "${name}" 匹配到多个目录：${suffixMatches.map(e => e.name).join(', ')}`);
      logger.warn(`   请使用完整迭代名（如 Iteration-NNN-name）避免歧义`);
      // 回退：返回第一个（字母序），但警告用户
      return join(root, suffixMatches[0].name);
    }
  } catch {}
  return join(root, `Iteration-${shortName}`);
}
