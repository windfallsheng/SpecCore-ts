import { logger, Spinner, formatTable } from '../utils/logger';
import { getDefaultIteration, getHotfixStatus } from "../core/context";
import { TaskState } from "../core/state";;
import { readProjectGraph, scanTasks } from '../core/state';

export interface ProgressOptions {
  iteration?: string;
  assignee?: string;
  type?: string;
  task?: string;
  platform?: string;
  detail?: boolean;
  format?: string;
}

export async function progressCommand(options: ProgressOptions): Promise<void> {
  const spinner = new Spinner('Loading progress');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('No active iteration found. Please specify --iteration or create one first.');
      return;
    }

    const graph = await readProjectGraph(iteration);
    const tasks = graph.tasks.length > 0 ? graph.tasks : await scanTasks(iteration);

    if (options.task) {
      const task = tasks.find(t => t.id === options.task);
      if (!task) {
        spinner.fail(`Task not found: ${options.task}`);
        return;
      }
      printTaskProgress(task);
      return;
    }

    spinner.stop('Progress loaded');
    printProgress(iteration, tasks, options);
    await printHotfixStatus();
  } catch (error) {
    spinner.fail(`Progress loading failed: ${error}`);
    throw error;
  }
}

function printProgress(iteration: string, 
tasks: TaskState[], options: ProgressOptions): void {
  const total = tasks.length;
  const completed = tasks.filter(t => t.status === 'completed').length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length;
  const pending = tasks.filter(t => t.status === 'pending').length;
  const archived = tasks.filter(t => t.status === 'archived').length;
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  if (options.format === 'json') {
    console.log(JSON.stringify({
      iteration,
      total,
      completed,
      inProgress,
      pending,
      archived,
      completionRate,
      platform: options.platform || null,
    }, null, 2));
    return;
  }

  logger.info('');
  logger.info(`📊 Progress Report: ${iteration}${options.platform ? ` (${options.platform})` : ''}`);
  logger.info('');
  logger.info(`Total: ${total} | Completed: ${completed} | In Progress: ${inProgress} | Pending: ${pending} | Archived: ${archived}`);
  logger.info(`Completion Rate: ${completionRate}%`);
  logger.info('');

  // Progress bar
  const width = 40;
  const filled = Math.round(width * (completionRate / 100));
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  logger.info(`[${bar}] ${completionRate}%`);
  logger.info('');

  if (options.detail) {
    const headers = ['Task', 'Type', 'Status', 'Progress', 'Assignee'];
    const rows = tasks.map(t => [
      t.id,
      t.type,
      t.status,
      `${t.progress}%`,
      t.assignee || 'Unassigned'
    ]);
    console.log(formatTable(headers, rows));
  }
}

function printTaskProgress(task: TaskState): void {
  logger.info('');
  logger.info(`📋 Task: ${task.id} - ${task.name}`);
  logger.info(`  Type: ${task.type}`);
  logger.info(`  Status: ${task.status}`);
  logger.info(`  Progress: ${task.progress}%`);
  logger.info(`  Assignee: ${task.assignee || 'Unassigned'}`);
  if (task.dependencies.length > 0) {
    logger.info(`  Dependencies: ${task.dependencies.join(', ')}`);
  }
}

async function printHotfixStatus(): Promise<void> {
  const hotfix = await getHotfixStatus();
  if (!hotfix) return;

  logger.warn('⚠️  Hotfix: ' + hotfix.taskId);
  if (hotfix.mandatoryExpired) {
    logger.error('🚨 已超 24h！立即运行: speccore sync --reverse');
  } else if (hotfix.graceExpired) {
    logger.warn('   宽限期已过，运行: speccore sync --reverse');
  } else {
    logger.info('   宽限期内，可跳过反向同步');
  }
}
