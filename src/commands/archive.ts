import { pathExists, ensureDir, move, readdir } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, updateContext } from '../core/context';

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
      // Archive all completed tasks
      const { readdir } = await import('fs-extra');
      const entries = await readdir(iterationDir, { withFileTypes: true });
      const tasks = entries
        .filter(e => e.isDirectory() && e.name.startsWith('Task-'))
        .map(e => e.name);

      for (const task of tasks) {
        await archiveTask(iterationDir, task, archiveDir);
      }

      spinner.stop(`Archived ${tasks.length} tasks`);
    } else if (options.task) {
      await archiveTask(iterationDir, options.task, archiveDir);
      spinner.stop(`Archived: ${options.task}`);
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

  await move(archivedPath, targetPath);
  logger.info(`Restored: ${taskId}`);
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
