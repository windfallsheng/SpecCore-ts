import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { readProjectGraph, scanTasks } from '../core/state';

export interface StatusOptions {
  iteration?: string;
  assignee?: string;
  type?: string;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  const spinner = new Spinner('Checking status');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('No active iteration found. Please specify --iteration or create one first.');
      return;
    }

    const graph = await readProjectGraph(iteration);
    const tasks = graph.tasks.length > 0 ? graph.tasks : await scanTasks(iteration);

    spinner.stop('Status loaded');
    printStatus(iteration, tasks, options);
  } catch (error) {
    spinner.fail(`Status check failed: ${error}`);
    throw error;
  }
}

function printStatus(iteration: string, tasks: any[], options: StatusOptions): void {
  const total = tasks.length;
  const completed = tasks.filter(t => t.status === 'completed').length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length;
  const pending = tasks.filter(t => t.status === 'pending').length;

  logger.info('');
  logger.info(`📊 Status: ${iteration}`);
  logger.info('');
  logger.info(`Total Tasks: ${total}`);
  logger.info(`✅ Completed: ${completed}`);
  logger.info(`🔄 In Progress: ${inProgress}`);
  logger.info(`🔲 Pending: ${pending}`);
  logger.info('');

  if (options.assignee) {
    const filtered = tasks.filter(t => t.assignee === options.assignee);
    logger.info(`Tasks assigned to ${options.assignee}: ${filtered.length}`);
  }

  if (options.type) {
    const filtered = tasks.filter(t => t.type === options.type);
    logger.info(`${options.type} tasks: ${filtered.length}`);
  }
}
