import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from "../core/context";
import { TaskState } from "../core/state";
import { readProjectGraph, scanTasks } from '../core/state';
import { checkLock } from '../core/lock-manager';
import { getNotifications, formatNotification } from '../core/notification';
import { generateRecommendations, printRecommendations } from '../core/smart-recommend';

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
    await printLockAndNotifications();

    // v6.96.0+: 智能推荐
    const recommendations = await generateRecommendations(process.cwd());
    if (recommendations.length > 0) {
      printRecommendations(recommendations);
    }
  } catch (error) {
    spinner.fail(`Status check failed: ${error}`);
    throw error;
  }
}

function printStatus(iteration: string, tasks: TaskState[], options: StatusOptions): void {
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

async function printLockAndNotifications(): Promise<void> {
  // 锁状态
  const lock = await checkLock(process.cwd(), 'iteration');
  if (lock) {
    logger.info('🔒 并发锁状态');
    logger.info(`   持有者: ${lock.holder}`);
    logger.info(`   任务: ${lock.task || 'unknown'}`);
    logger.info(`   获取时间: ${new Date(lock.acquiredAt).toLocaleString('zh-CN')}`);
    logger.info('');
  }

  // 未读通知
  const unread = await getNotifications(process.cwd(), { unreadOnly: true });
  if (unread.length > 0) {
    logger.info(`🔔 未读通知 (${unread.length})`);
    for (const n of unread.slice(0, 5)) {
      logger.info(`   ${formatNotification(n)}`);
    }
    if (unread.length > 5) {
      logger.info(`   ... 及其他 ${unread.length - 5} 条`);
    }
    logger.info('   💡 运行 speccore notify 查看全部通知');
    logger.info('');
  }
}
