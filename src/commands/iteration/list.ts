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
    const tasksRoot = join(root, it.name, '030-tasks');
    let tasks = 0;
    if (await pathExists(tasksRoot)) {
      const entries = await readdir(tasksRoot, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && e.name.startsWith('Task-')) tasks++;
        else if (e.isDirectory() && !e.name.startsWith('.')) {
          // 递归扫描类型子目录
          try {
            const sub = await readdir(join(tasksRoot, e.name), { withFileTypes: true });
            tasks += sub.filter((s: any) => s.isDirectory() && s.name.startsWith('Task-')).length;
          } catch {}
        }
      }
    }
    logger.info(`  • ${it.name}  (任务: ${tasks})`);
  }
}