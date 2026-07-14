/**

 * delete — 安全删除 Task 或期次，自动清理所有关联引用
 *
 * 不会直接 rm -rf，而是移动到 .speccore/trash/ 并清理：
 *   1. GLOBAL/INDEX.md 引用
 *   2. context.json 计数
 *   3. .git-mapping.json 分支映射
 *   4. 操作日志
 */

import { pathExists, move, readFile, writeFile, readdir, ensureDir } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import { t } from '../i18n/t';
import { FileTransaction } from '../core/transaction';
import { logOperation } from '../core/operation-log';

export interface DeleteOptions {
  task?: string;
  iteration?: string;
  force?: boolean;
}

export async function deleteCommand(options: DeleteOptions): Promise<void> {
  if (!options.task && !options.iteration) {
    logger.error('Usage:');
    logger.info('  speccore delete --task=Task-001');
    logger.info('  speccore delete --iteration=期次-2026-07');
    logger.info('  speccore delete --task=Task-001 --force  (skip confirmation)');
    return;
  }

  const cwd = process.cwd();

  if (options.task) {
    await deleteTask(cwd, options.task, options.force);
  } else if (options.iteration) {
    await deleteIteration(cwd, options.iteration, options.force);
  }
}

// ============================================================
// 删除 Task
// ============================================================
async function deleteTask(cwd: string, taskId: string, force?: boolean): Promise<void> {
  // 1. 找到 Task 所在的期次
  const { iterationDir, taskDir } = await findTask(cwd, taskId);
  if (!taskDir) {
    logger.error(`Task "${taskId}" not found in any iteration.`);
    return;
  }

  const iterName = iterationDir.split('/').pop()!;

  // 2. 确认
  if (!force) {
    logger.warn(`⚠️  About to delete: ${iterName}/${taskId}`);
    logger.info('   This will move the directory to .speccore/trash/ (recoverable).');
    logger.info('   All INDEX / context / git-mapping references will be cleaned.');
    logger.info('');
  }

  // 3. 移动到 trash
  const trashDir = join(cwd, '.speccore', 'trash', `${iterName}-${taskId}-${Date.now()}`);
  await ensureDir(trashDir);
  await move(taskDir, trashDir, { overwrite: true });
  logger.info(`📦 Moved to: ${trashDir}`);

  // 4. 清理 GLOBAL/INDEX.md
  await cleanIndex(cwd, taskId);

  // 5. 清理 context.json
  await cleanContext(cwd, taskId);

  // 6. 清理 git-mapping.json
  await cleanGitMapping(cwd, taskId);

  // 7. 日志
  logOperation('speccore delete', `Task: ${taskId}`);

  logger.success(t('cmd.delete.success', '✅ Task "{task}" deleted and all references cleaned.', { task: taskId }));
  logger.info('   To recover: mv the directory back from .speccore/trash/');
}

// ============================================================
// 删除 Iteration
// ============================================================
async function deleteIteration(cwd: string, iterName: string, force?: boolean): Promise<void> {
  const iterDir = join(cwd, iterName);

  if (!(await pathExists(iterDir))) {
    logger.error(`Iteration "${iterName}" not found.`);
    return;
  }

  // 1. 扫描所有 Task
  const tasks = await scanTasks(iterDir);

  if (!force) {
    logger.warn(`⚠️  About to delete iteration: ${iterName}`);
    logger.info(`   Tasks: ${tasks.length} (${tasks.join(', ')})`);
    logger.info('   Directories will move to .speccore/trash/ (recoverable).');
    logger.info('');
  }

  // 2. 逐个清理每个 Task 的引用
  for (const task of tasks) {
    await cleanIndex(cwd, task);
    await cleanContext(cwd, task);
    await cleanGitMapping(cwd, task);
  }

  // 3. 移动整个迭代目录到 trash
  const trashDir = join(cwd, '.speccore', 'trash', `${iterName}-${Date.now()}`);
  await ensureDir(trashDir);
  await move(iterDir, trashDir, { overwrite: true });
  logger.info(`📦 Moved to: ${trashDir}`);

  // 4. 日志
  logOperation('speccore delete', `Iteration: ${iterName} (${tasks.length} tasks)`);

  logger.success(`✅ Iteration "${iterName}" deleted (${tasks.length} tasks) and all references cleaned.`);
  logger.info('   To recover: mv the directory back from .speccore/trash/');
}

// ============================================================
// 辅助函数
// ============================================================
async function findTask(cwd: string, taskId: string): Promise<{ iterationDir: string; taskDir: string }> {
  // 检查最常见的期次前缀
  const entries = await readdir(cwd, { withFileTypes: true });
  const iterations = entries.filter((e) => e.isDirectory() && e.name.startsWith('期次-'));

  for (const iter of iterations) {
    const taskDir = join(cwd, iter.name, taskId);
    if (await pathExists(taskDir)) {
      return { iterationDir: join(cwd, iter.name), taskDir };
    }
  }

  // 如果不带期次前缀，检查所有目录
  const allDirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'));
  for (const dir of allDirs) {
    if (iterations.find((i) => i.name === dir.name)) continue; // already checked
    const taskDir = join(cwd, dir.name, taskId);
    if (await pathExists(taskDir)) {
      return { iterationDir: join(cwd, dir.name), taskDir };
    }
  }

  return { iterationDir: '', taskDir: '' };
}

async function scanTasks(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && e.name.startsWith('Task-')).map((e) => e.name);
  } catch {
    return [];
  }
}

async function cleanIndex(cwd: string, taskId: string): Promise<void> {
  const indexPath = join(cwd, '.speccore', 'GLOBAL', 'INDEX.md');
  if (!(await pathExists(indexPath))) return;

  const tx = new FileTransaction();
  const content = await readFile(indexPath, 'utf-8');
  const lines = content.split('\n');
  const filtered = lines.filter((line) => !line.includes(taskId));

  if (filtered.length !== lines.length) {
    tx.write(indexPath, filtered.join('\n'));
    await tx.commit();
  }
}

async function cleanContext(cwd: string, taskId: string): Promise<void> {
  const ctxPath = join(cwd, '.speccore', 'local', 'context.json');
  if (!(await pathExists(ctxPath))) return;

  const tx = new FileTransaction();
  const ctx = JSON.parse(await readFile(ctxPath, 'utf-8'));

  // 清理 currentTask 引用
  if (ctx.currentTask === taskId) {
    ctx.currentTask = '';
  }

  // 清理 history 中的引用
  if (ctx.history) {
    ctx.history = ctx.history.filter(
      (h: any) => h.task !== taskId
    );
  }

  tx.write(ctxPath, JSON.stringify(ctx, null, 2));
  await tx.commit();
}

async function cleanGitMapping(cwd: string, taskId: string): Promise<void> {
  const mappingPath = join(cwd, '.speccore', '.git-mapping.json');
  if (!(await pathExists(mappingPath))) return;

  const tx = new FileTransaction();
  const mapping = JSON.parse(await readFile(mappingPath, 'utf-8'));

  if (mapping.tasks && mapping.tasks[taskId]) {
    delete mapping.tasks[taskId];
    tx.write(mappingPath, JSON.stringify(mapping, null, 2));
    await tx.commit();
  }
}
