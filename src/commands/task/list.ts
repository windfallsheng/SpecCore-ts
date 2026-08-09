import { logger } from '../../utils/logger';
import { getIterationDir } from '../../core/context';

export interface TaskListOptions {
  iteration?: string;
}

export async function taskListCommand(options: TaskListOptions): Promise<void> {
  const { readdir, pathExists } = await import('fs-extra');
  const iterDir = await getIterationDir(options.iteration || '');
  if (!iterDir || !(await pathExists(iterDir))) {
    logger.info('📋 当前无迭代，请先运行: speccore iteration create');
    return;
  }
  const tasksDir = `${iterDir}/030-tasks`;
  if (!await pathExists(tasksDir)) {
    logger.info('📋 当前迭代无任务');
    return;
  }
  const entries = await readdir(tasksDir, { withFileTypes: true });
  const taskDirs = entries.filter(e => e.isDirectory() && e.name.startsWith('Task-'));
  if (taskDirs.length === 0) {
    logger.info('📋 当前迭代无任务');
    return;
  }
  logger.info(`📋 任务列表 (${taskDirs.length}):`);
  for (const t of taskDirs) {
    logger.info(`  • ${t.name}`);
  }
}