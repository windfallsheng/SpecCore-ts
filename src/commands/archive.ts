import { pathExists, ensureDir, move, readdir } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, updateContext } from '../core/context';
import { FileTransaction } from '../core/transaction';

export interface ArchiveOptions {
  task?: string;
  all?: boolean;
  iteration?: string;
  list?: boolean;
  restore?: string;
  force?: boolean;
}

export async function archiveCommand(options: ArchiveOptions): Promise<void> {
  const spinner = new Spinner('Archiving tasks');
  spinner.start();

  try {
    if (options.list) {
      await listArchived();
      spinner.stop('Archived tasks listed');
      return;
    }

    if (options.restore) {
      await restoreTask(options.restore, options.iteration);
      spinner.stop(`Task restored: ${options.restore}`);
      return;
    }

    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('No active iteration found. Please specify --iteration or create one first.');
      return;
    }

    const iterationDir = `期次-${iteration}`;
    const archiveDir = join(iterationDir, 'archived');
    await ensureDir(archiveDir);

    if (options.all) {
      // Archive all completed tasks with transaction
      const { readdir } = await import('fs-extra');
      const entries = await readdir(iterationDir, { withFileTypes: true });
      const tasks = entries
        .filter(e => e.isDirectory() && e.name.startsWith('Task-'))
        .map(e => e.name);

      // 事务归档：全部移动或全部回滚
      const tx = new FileTransaction();
      for (const task of tasks) {
        const taskPath = join(iterationDir, task);
        const targetPath = join(archiveDir, task);
        if (await pathExists(taskPath) && !(await pathExists(targetPath))) {
          tx.move(taskPath, targetPath);
        }
      }
      await tx.commit();

      spinner.stop(`Archived ${tasks.length} tasks (事务保护)`);
    } else if (options.task) {
      const taskPath = join(iterationDir, options.task);
      const targetPath = join(archiveDir, options.task);

      if (await pathExists(taskPath) && !(await pathExists(targetPath))) {
        const tx = new FileTransaction();
        tx.move(taskPath, targetPath);
        await tx.commit();
      }
      spinner.stop(`Archived: ${options.task} (事务保护)`);
    } else {
      spinner.fail('Please specify --task or --all');
    }

    // Update context
    await updateContext({ lastUpdated: new Date().toISOString() });
  } catch (error) {
    spinner.fail(`Archive failed: ${error}`);
    throw error;
  }
}

async function archiveTask(iterationDir: string, taskId: string, archiveDir: string): Promise<void> {
  const taskPath = join(iterationDir, taskId);
  const targetPath = join(archiveDir, taskId);

  if (!(await pathExists(taskPath))) {
    logger.warn(`Task not found: ${taskId}`);
    return;
  }

  if (await pathExists(targetPath)) {
    logger.warn(`Task already archived: ${taskId}`);
    return;
  }

  await move(taskPath, targetPath);
  logger.info(`  Archived: ${taskId}`);
}

async function restoreTask(taskId: string, iteration?: string): Promise<void> {
  const iter = await getDefaultIteration(iteration);
  if (!iter) {
    throw new Error('No iteration specified');
  }

  const iterationDir = `期次-${iter}`;
  const archiveDir = join(iterationDir, 'archived');
  const archivedPath = join(archiveDir, taskId);
  const targetPath = join(iterationDir, taskId);

  if (!(await pathExists(archivedPath))) {
    throw new Error(`Archived task not found: ${taskId}`);
  }

  const tx = new FileTransaction();
  tx.move(archivedPath, targetPath);
  await tx.commit();
  logger.info(`Restored: ${taskId} (事务保护)`);
}

async function listArchived(): Promise<void> {
  const { readdir } = await import('fs-extra');
  
  const entries = await readdir('.', { withFileTypes: true });
  const iterations = entries
    .filter(e => e.isDirectory() && e.name.startsWith('期次-'))
    .map(e => e.name);

  for (const iteration of iterations) {
    const archiveDir = join(iteration, 'archived');
    if (await pathExists(archiveDir)) {
      const tasks = await readdir(archiveDir);
      if (tasks.length > 0) {
        logger.info(`${iteration}:`);
        for (const task of tasks) {
          logger.info(`  ${task}`);
        }
      }
    }
  }
}
