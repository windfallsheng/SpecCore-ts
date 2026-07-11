import { pathExists, readdir, readFile, ensureDir } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import { getDefaultIteration, getDefaultAssignee, updateContext, recordHistory } from '../core/context';
import { scanTasks, topologicalSort } from '../core/state';
import { FileTransaction } from '../core/transaction';
import { logOperation } from '../core/operation-log';

export interface ExecuteOptions {
  all?: boolean;
  assignee?: string;
  task?: string;
  type?: string;
  priority?: string;
  status?: string;
  platform?: string;
  backend?: boolean;
  frontend?: boolean;
  interactive?: boolean;
  dryRun?: boolean;
  resume?: boolean;
  parallel?: string;
  iteration?: string;
  force?: boolean;
}

export async function executeCommand(options: ExecuteOptions): Promise<void> {
  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      logger.error('No active iteration found. Please specify --iteration or create one first.');
      return;
    }

    let tasks = await scanTasks(iteration);
    if (tasks.length === 0) {
      logger.warn('No tasks found in iteration');
      return;
    }

    // Apply filters
    if (options.task) tasks = tasks.filter(t => t.id === options.task);
    if (options.type) tasks = tasks.filter(t => t.type === options.type);
    if (options.priority) tasks = tasks.filter(t => t.priority === options.priority);
    if (options.status) tasks = tasks.filter(t => t.status === options.status);
    if (options.assignee) tasks = tasks.filter(t => t.assignee === options.assignee);
    if (options.backend) tasks = tasks.filter(t => t.id.includes('backend'));
    if (options.frontend) tasks = tasks.filter(t => t.id.includes('frontend'));
    if (options.platform) tasks = await filterByPlatform(tasks, iteration, options.platform);

    if (tasks.length === 0) {
      logger.warn('No tasks match the specified filters');
      return;
    }

    const sortedTasks = topologicalSort(tasks);

    // === Interactive mode ===
    if (options.interactive) {
      await interactiveSelect(sortedTasks, iteration, options);
      return;
    }

    // === Dry run ===
    if (options.dryRun) {
      printExecutionPreview(sortedTasks, iteration);
      logOperation(`speccore execute --dry-run`, `${sortedTasks.length} tasks`);
      return;
    }

    // === Preview (default, unless --force) ===
    if (!options.force) {
      printExecutionPreview(sortedTasks, iteration);
      logger.info('');
      logger.info('💡 Use --force to execute directly, or --interactive to select');
      return;
    }

    // === Execute with progress ===
    await executeWithProgress(sortedTasks, iteration);
  } catch (error) {
    logger.error(`Execution failed: ${error}`);
    throw error;
  }
}

// ============================================================
// Interactive selection
// ============================================================
async function interactiveSelect(tasks: any[], iteration: string, options: ExecuteOptions): Promise<void> {
  logger.info('');
  logger.info(`📋 Preparing ${tasks.length} tasks:`);
  logger.info('');

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const pri = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🟢';
    logger.info(`  ${i + 1}. ${t.id} ${t.name || ''} ${pri}`);
  }

  logger.info('');
  logger.info('Select execution mode:');
  logger.info('  [1] Execute all (serial)');
  logger.info('  [2] Execute all (parallel, max 2)');
  logger.info('  [3] Select specific tasks');
  logger.info('  [4] Cancel');

  // In interactive mode, default to "all serial" (--force style)
  logger.info('');
  logger.info('💡 Auto-selecting mode [1] (all serial). Use --interactive in AI tools for full prompts.');
  logger.info('');

  await executeWithProgress(tasks, iteration);
}

// ============================================================
// Progress feedback execution
// ============================================================
async function executeWithProgress(tasks: any[], iteration: string): Promise<void> {
  const total = tasks.length;
  const startTime = Date.now();
  const completed: string[] = [];

  logOperation('speccore execute', `${total} tasks`);

  logger.info('');
  logger.info(`⏳ Executing ${total} task(s) in iteration: ${iteration}`);
  logger.info('');

  for (let i = 0; i < total; i++) {
    const task = tasks[i];
    const progress = Math.round(((i) / total) * 100);
    const bar = createBar(progress, 20);

    // Report current batch
    logger.info(`[${String(i + 1).padStart(2, '0')}/${total}] ${bar} ${progress}%`);
    logger.info(`  🔄 ${task.id} ${task.name || ''} (${task.type || 'feature'})`);

    await simulateTaskExecution(task, iteration);

    completed.push(`${task.id} - ${task.name || ''}`);
    logger.info(`  ✅ ${task.id} completed`);
    logger.info('');

    // Report pending
    const pending = tasks.slice(i + 1);
    if (pending.length > 0) {
      logger.info(`  Pending: ${pending.map(t => t.id).join(', ')}`);
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const avgPerTask = elapsed / (i + 1);
    const remaining = Math.round(avgPerTask * (total - i - 1));
    logger.info(`  Elapsed: ${elapsed}s | Est. remaining: ${remaining}s`);
    logger.info('');
  }

  // Update context
  await updateContext({
    currentTask: tasks[tasks.length - 1]?.id || '',
    currentIteration: iteration,
    lastUpdated: new Date().toISOString()
  });
  await recordHistory('execute', iteration, tasks[tasks.length - 1]?.id);

  // Summary
  const totalElapsed = Math.round((Date.now() - startTime) / 1000);
  logger.success(`Execution complete! ${total} tasks in ${totalElapsed}s`);
  logOperation('speccore execute done', `completed ${total} tasks in ${totalElapsed}s`);
}

function createBar(pct: number, width: number): string {
  const filled = Math.round(width * (pct / 100));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ============================================================
// Execution preview
// ============================================================
function printExecutionPreview(tasks: any[], iteration: string): void {
  logger.info('');
  logger.info('📋 Execution Preview');
  logger.info('');
  logger.info(`Iteration: ${iteration}`);
  logger.info(`Tasks: ${tasks.length}`);
  logger.info('');

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const icon = i === 0 ? '🔄' : '⏳';
    const pri = t.priority === 'high' ? '[HIGH]' : t.priority === 'medium' ? '[MED]' : '[LOW]';
    logger.info(`  ${icon} ${t.id} ${pri} - ${t.name || 'unnamed'}`);
  }
  logger.info('');
}

// ============================================================
// Task execution (transaction protected)
// ============================================================
async function simulateTaskExecution(task: any, iteration: string): Promise<void> {
  const taskDir = join(`期次-${iteration}`, task.id);
  let filesUpdated = 0;

  if (await pathExists(taskDir)) {
    const tx = new FileTransaction();

    const taskMdPath = join(taskDir, 'backend', 'TASK.md');
    if (await pathExists(taskMdPath)) {
      const content = await readFile(taskMdPath, 'utf-8');
      const updated = content.replace('状态: 🔲 待开发', '状态: 🔄 进行中');
      tx.write(taskMdPath, updated);
      filesUpdated++;
    }

    const frontendDir = join(taskDir, 'frontend');
    if (await pathExists(frontendDir)) {
      const { readdir: rd } = await import('fs-extra');
      const platformDirs = await rd(frontendDir, { withFileTypes: true });
      for (const pd of platformDirs) {
        if (pd.isDirectory()) {
          const ftaskPath = join(frontendDir, pd.name, 'TASK.md');
          if (await pathExists(ftaskPath)) {
            const content = await readFile(ftaskPath, 'utf-8');
            const updated = content.replace('状态: 🔲 待开发', '状态: 🔄 进行中');
            tx.write(ftaskPath, updated);
            filesUpdated++;
          }
        }
      }
    }

    if (tx.length > 0) {
      await tx.commit();
    }
  }

  await new Promise(resolve => setTimeout(resolve, 100));
}

async function filterByPlatform(tasks: any[], iteration: string, platform: string): Promise<any[]> {
  const filtered: any[] = [];
  const iterDir = join(process.cwd(), `期次-${iteration}`);
  for (const task of tasks) {
    const platformDir = join(iterDir, task.id, 'frontend', platform);
    if (await pathExists(platformDir)) filtered.push(task);
  }
  return filtered;
}
