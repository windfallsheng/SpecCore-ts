import { logger } from '../../utils/logger';

export async function iterationListCommand(): Promise<void> {
  const { readdir, pathExists } = await import('fs-extra');
  const { join } = await import('path');
  const root = process.cwd();
  const entries = await readdir(root, { withFileTypes: true });
  const iterDirs = entries.filter(e => e.isDirectory() && e.name.startsWith('Iteration-'));
  if (iterDirs.length === 0) {
    logger.info('📋 当前无迭代，请运行: speccore iteration create');
    return;
  }
  logger.info(`📋 迭代列表 (${iterDirs.length}):`);
  for (const it of iterDirs) {
    const tasks = (await readdir(join(root, it.name, '030-tasks'), { withFileTypes: true })).filter(e => e.isDirectory() && e.name.startsWith('Task-')).length;
    logger.info(`  • ${it.name}  (任务: ${tasks})`);
  }
}