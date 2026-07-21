/**
 * rollback — 从 .bak 备份恢复 Spec 文件
 */
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { scanTasks } from '../core/state';
import { readFile, writeFile, pathExists, unlink, readdir } from 'fs-extra';
import { join } from 'path';

export interface RollbackOptions {
  task?: string;
  iteration?: string;
  list?: boolean;
  confirm?: boolean;
}

export async function rollbackCommand(options: RollbackOptions): Promise<void> {
  const spinner = new Spinner('正在查找备份...');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);

    // 全局模式：查找所有 .bak 文件
    if (!options.task) {
      spinner.stop();
      await listAllBackups(iteration);
      return;
    }

    // 查找指定 Task 下的备份文件
    const tasks = await scanTasks(iteration);
    const task = tasks.find(t => t.id === options.task || t.id.startsWith(options.task + '-'));
    if (!task) {
      spinner.fail(`未找到 Task: ${options.task}`);
      return;
    }

    const cwd = process.cwd();
    const iterDir = join(cwd, iteration ? `期次-${iteration}` : '');
    const taskDir = join(iterDir, task.id);
    const backups = await findBackupFiles(taskDir);

    if (backups.length === 0) {
      spinner.stop(`无备份文件 (Task: ${task.id})`);
      return;
    }

    spinner.stop(`找到 ${backups.length} 个备份文件`);

    // 列出备份
    logger.info('');
    for (const b of backups) {
      const relative = b.replace(cwd + '/', '');
      logger.info(`   ${relative}`);
    }

    // 只列出
    if (options.list) return;

    // 确认恢复
    if (!options.confirm) {
      logger.info('');
      logger.warn('如需恢复，请使用: speccore rollback --task=' + (options.task) + ' --confirm');
      return;
    }

    // 执行恢复
    const rollbackSpinner = new Spinner('正在恢复...');
    rollbackSpinner.start();
    let restored = 0;
    for (const bak of backups) {
      const original = bak.replace(/\.bak$/, '');
      await writeFile(original, await readFile(bak, 'utf-8'));
      await unlink(bak);
      restored++;
    }
    rollbackSpinner.stop(`已恢复 ${restored} 个文件 (备份已清理)`);
  } catch (error) {
    spinner.fail(`回滚失败: ${error}`);
    throw error;
  }
}

async function findBackupFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  if (!(await pathExists(dir))) return results;

  async function scan(d: string) {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) {
        await scan(join(d, e.name));
      } else if (e.name.endsWith('.bak')) {
        results.push(join(d, e.name));
      }
    }
  }
  await scan(dir);
  return results;
}

async function listAllBackups(iteration: string): Promise<void> {
  const cwd = process.cwd();
  const dirs = ['.speccore'];
  if (iteration) dirs.push(`期次-${iteration}`);

  let total = 0;
  for (const d of dirs) {
    const backups = await findBackupFiles(join(cwd, d));
    if (backups.length > 0) {
      logger.info(`\n${d}/`);
      for (const b of backups) {
        logger.info(`   ${b.replace(cwd + '/', '')}`);
      }
      total += backups.length;
    }
  }

  if (total === 0) {
    logger.info('无任何备份文件');
  } else {
    logger.info(`\n共 ${total} 个备份文件`);
    logger.info('恢复: speccore rollback --task=<Task编号> --confirm');
  }
}
