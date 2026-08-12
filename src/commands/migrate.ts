/**
 * migrate — 项目内容迁移命令
 * 支持：任务目录迁移、规格文件迁移等
 */
import { readdir, pathExists, copy, remove, ensureDir, readFile, writeFile } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../utils/logger';

export interface MigrateOptions {
  type?: string;        // 迁移类型：tasks | specs | all
  iteration?: string;   // 指定迭代（默认所有）
  dryRun?: boolean;     // 预览模式
  force?: boolean;      // 强制覆盖
}

/**
 * 迁移任务目录到 030-tasks/<type>/ 结构
 */
export async function migrateTasks(projectRoot: string, iterationName: string, options: MigrateOptions): Promise<void> {
  const iterDir = join(projectRoot, iterationName);
  if (!(await pathExists(iterDir))) {
    logger.warn(`⚠️  迭代目录不存在: ${iterationName}`);
    return;
  }

  const tasksDir = join(iterDir, '030-tasks');
  await ensureDir(tasksDir);

  // 扫描根目录下的 Task-* 目录
  const entries = await readdir(iterDir, { withFileTypes: true });
  const taskDirs: string[] = [];
  
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.match(/^Task-\d+$/)) {
      taskDirs.push(entry.name);
    }
  }

  if (taskDirs.length === 0) {
    logger.info('✅ 没有需要迁移的任务目录');
    return;
  }

  logger.info(`📋 发现 ${taskDirs.length} 个任务待迁移:`);
  for (const task of taskDirs.slice(0, 5)) {
    logger.info(`   • ${task}`);
  }
  if (taskDirs.length > 5) {
    logger.info(`   ... 共 ${taskDirs.length} 个`);
  }
  logger.info('');

  if (options.dryRun) {
    logger.info('💡 预览模式，未执行实际迁移');
    logger.info(`   目标路径: ${tasksDir}/<type>/<Task-NNN>/`);
    logger.info('');
    return;
  }

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const taskName of taskDirs) {
    const srcPath = join(iterDir, taskName);
    
    // 读取任务类型：优先 .task-type 文件，其次 TASK.md
    let taskType = 'feature'; // 默认类型
    
    // 1. 检查 .task-type 文件
    const taskTypeFile = join(srcPath, '.task-type');
    if (await pathExists(taskTypeFile)) {
      try {
        const rawType = (await readFile(taskTypeFile, 'utf-8')).trim();
        if (rawType.includes('bug') || rawType.includes('修复')) {
          taskType = 'bugfix';
        } else if (rawType.includes('重构') || rawType.includes('refactor')) {
          taskType = 'refactor';
        } else if (rawType.includes('研究') || rawType.includes('research')) {
          taskType = 'research';
        } else {
          taskType = 'feature';
        }
      } catch {}
    } else {
      // 2. 检查 TASK.md 中的 类型: 字段
      const taskMdPath = join(srcPath, '00-specs', 'TASK.md');
      if (await pathExists(taskMdPath)) {
        try {
          const content = await readFile(taskMdPath, 'utf-8');
          const typeMatch = content.match(/类型:\s*(\S+)/);
          if (typeMatch) {
            const rawType = typeMatch[1];
            if (rawType.includes('bug') || rawType.includes('修复')) {
              taskType = 'bugfix';
            } else if (rawType.includes('重构') || rawType.includes('refactor')) {
              taskType = 'refactor';
            } else if (rawType.includes('研究') || rawType.includes('research')) {
              taskType = 'research';
            } else {
              taskType = 'feature';
            }
          }
        } catch {}
      }
    }

    const destPath = join(tasksDir, taskType, taskName);
    
    // 检查是否已存在
    if (await pathExists(destPath)) {
      if (!options.force) {
        logger.info(`⏭  跳过 ${taskName}（已存在于 ${taskType}/）`);
        skipped++;
        continue;
      }
      // 强制覆盖：先删除旧目录
      await remove(destPath);
    }

    try {
      await ensureDir(join(tasksDir, taskType));
      await copy(srcPath, destPath);
      
      // 删除原目录
      await remove(srcPath);
      
      migrated++;
      logger.info(`✅ ${taskName} → ${taskType}/${taskName}`);
    } catch (err) {
      errors++;
      logger.error(`❌ ${taskName} 迁移失败: ${err}`);
    }
  }

  logger.info('');
  logger.info(`📊 迁移完成: ${migrated} 成功, ${skipped} 跳过, ${errors} 失败`);
  
  // 清理 030-tasks/ 根目录下的旧版 Task-* 目录（迁移后残留）
  if (migrated > 0) {
    const tasksEntries = await readdir(tasksDir, { withFileTypes: true });
    for (const entry of tasksEntries) {
      if (entry.isDirectory() && entry.name.match(/^Task-\d+$/)) {
        const oldPath = join(tasksDir, entry.name);
        await remove(oldPath);
        logger.info(`🧹 清理旧版残留: 030-tasks/${entry.name}/`);
      }
    }
  }
  
  logger.info('');
}

/**
 * 主入口
 */
export async function migrateCommand(options: MigrateOptions): Promise<void> {
  const projectRoot = process.cwd();
  const spinner = new Spinner('检测迁移需求...');
  spinner.start();

  const migrateType = options.type || 'all';
  
  // 如果没有指定迭代，扫描所有 Iteration-* 目录
  let iterations: string[] = [];
  if (options.iteration) {
    iterations = [options.iteration.startsWith('Iteration-') ? options.iteration : `Iteration-${options.iteration}`];
  } else {
    const entries = await readdir(projectRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('Iteration-')) {
        iterations.push(entry.name);
      }
    }
  }

  if (iterations.length === 0) {
    spinner.stop('⚠️  未检测到任何迭代目录');
    return;
  }

  spinner.stop(`发现 ${iterations.length} 个迭代`);
  logger.info('');

  for (const iterName of iterations) {
    logger.info(`━━━ ${iterName} ━━━`);
    logger.info('');
    
    if (migrateType === 'tasks' || migrateType === 'all') {
      await migrateTasks(projectRoot, iterName, options);
    }
    
    logger.info('');
  }

  logger.info('💡 如需回滚，从备份目录恢复（如果有的话）');
  logger.info('');
}
