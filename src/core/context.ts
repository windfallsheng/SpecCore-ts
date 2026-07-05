import { ensureDir, readJson, writeJson, pathExists } from 'fs-extra';
import { join } from 'path';

export interface Context {
  currentIteration: string;
  currentTask: string;
  currentAssignee: string;
  lastUpdated: string;
  history: ContextHistoryEntry[];
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
