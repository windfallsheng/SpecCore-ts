import { ensureDir, readJson, writeJson, pathExists } from 'fs-extra';
import { join } from "path";

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
    if (name && name !== '期次名称' && !name.startsWith('---')) {
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
