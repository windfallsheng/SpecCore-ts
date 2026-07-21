/**
 * rename - 重命名期次或任务，自动更新所有关联引用
 * 支持单个重命名和批量重命名
 */

import { logger, Spinner } from '../utils/logger';
import { pathExists, move, readdir, readFile, writeFile } from 'fs-extra';
import { join } from 'path';
import { readGlobalIndex, updateReqInIndex, updateIndexVersion, bumpGlobalVersion } from '../core/global-layer';

export interface RenameOptions {
  target?: string;
  newName?: string;
  batch?: boolean;
  pattern?: string;
  replacement?: string;
  force?: boolean;
}

interface RenamePreview {
  type: 'iteration' | 'task';
  oldName: string;
  newName: string;
  dirRename: string;
  indexUpdates: number;
  specRefs: number;
  files: string[];
}

export async function renameCommand(options: RenameOptions): Promise<void> {
  try {
    if (options.batch) {
      await batchRename(options);
    } else if (options.target && options.newName) {
      await singleRename(options);
    } else {
      logger.error('用法:');
      logger.info('  单个重命名: speccore rename --target=<旧名> --new-name=<新名>');
      logger.info('  批量重命名: speccore rename --batch --pattern=<旧前缀> --replacement=<新前缀>');
    }
  } catch (error) {
    logger.error(`重命名失败: ${error}`);
    throw error;
  }
}

/**
 * 单个重命名
 */
async function singleRename(options: RenameOptions): Promise<void> {
  const oldName = options.target!;
  const newName = options.newName!;
  const cwd = process.cwd();

  // 1. 识别目标类型
  let targetType: 'iteration' | 'task';
  const isIteration = oldName.includes('期次-');
  const isTask = oldName.match(/Task-\d{3}/);

  if (isIteration) {
    targetType = 'iteration';
  } else if (isTask) {
    targetType = 'task';
  } else {
    logger.error(`无法识别目标类型: "${oldName}"。名称需包含"期次-"或"Task-NNN"。`);
    return;
  }

  // 2. 验证目标存在
  const spinner = new Spinner('验证目标...');
  spinner.start();

  let oldPath: string;
  if (targetType === 'iteration') {
    oldPath = join(cwd, oldName);
  } else {
    // Task 需要先找到归属期次
    const iterations = await findIterations(cwd);
    let found = false;
    oldPath = '';
    for (const iter of iterations) {
      const taskPath = join(cwd, iter, oldName);
      if (await pathExists(taskPath)) {
        oldPath = taskPath;
        found = true;
        break;
      }
    }
    if (!found) {
      spinner.fail(`未找到 Task: ${oldName}`);
      logger.info('请确认 Task 编号和名称正确。');
      return;
    }
  }

  if (!(await pathExists(oldPath))) {
    spinner.fail(`目标不存在: ${oldName}`);
    return;
  }

  // 3. 计算影响范围
  spinner.stop('计算影响范围...');

  const preview = await calculatePreview(targetType, oldName, newName, oldPath);
  await showPreview(preview);

  if (!options.force) {
    logger.info('');
    logger.info('使用 --force 跳过预览并直接执行。');
    return;
  }

  // 4. 执行重命名
  await executeRename(preview);

  // 5. 更新全量索引
  await updateGlobalReferences(oldName, newName, targetType);
}

/**
 * 批量重命名
 */
async function batchRename(options: RenameOptions): Promise<void> {
  const pattern = options.pattern;
  const replacement = options.replacement;

  if (!pattern || !replacement) {
    logger.error('批量重命名需要 --pattern 和 --replacement 参数。');
    return;
  }

  const cwd = process.cwd();
  const iterations = await findIterations(cwd);

  let totalCount = 0;
  const previews: RenamePreview[] = [];

  for (const iter of iterations) {
    const iterPath = join(cwd, iter);
    if (!(await pathExists(iterPath))) continue;

    const entries = await readdir(iterPath, { withFileTypes: true });
    for (const entry of entries.filter((e) => e.isDirectory())) {
      if (entry.name.match(/Task-\d{3}.*/)) {
        const newTaskName = entry.name.replace(pattern, replacement);
        if (newTaskName !== entry.name) {
          const preview = await calculatePreview(
            'task',
            entry.name,
            newTaskName,
            join(iterPath, entry.name)
          );
          previews.push(preview);
          totalCount++;
        }
      }
    }
  }

  if (totalCount === 0) {
    logger.info('没有找到匹配的目标。');
    return;
  }

  logger.info('');
  logger.info('📋 批量重命名预览');
  logger.info('');
  logger.info(`操作: 将 "${pattern}" 替换为 "${replacement}"`);
  logger.info(`影响任务数: ${totalCount}`);
  logger.info('');

  for (const p of previews.slice(0, 10)) {
    logger.info(`   ${p.oldName} → ${p.newName}`);
  }
  if (previews.length > 10) {
    logger.info(`   ...（共 ${previews.length} 个）`);
  }

  if (!options.force) {
    logger.info('');
    logger.info('⚠️ 批量重命名是高风险操作。使用 --force 执行。');
    return;
  }

  // 执行批量重命名
  for (const p of previews) {
    try {
      await executeRename(p);
      logger.info(`   ✅ ${p.oldName} → ${p.newName}`);
    } catch (e) {
      logger.error(`   ❌ ${p.oldName}: ${e}`);
    }
  }

  logger.info('');
  logger.success(`✅ 批量重命名完成！共 ${totalCount} 个任务`);
}

/**
 * 计算影响范围预览
 */
async function calculatePreview(
  type: 'iteration' | 'task',
  oldName: string,
  newName: string,
  oldPath: string
): Promise<RenamePreview> {
  let newPath = oldPath.replace(oldName, newName);
  let indexUpdates = 0;
  let specRefs = 0;
  const files: string[] = [];

  // 全局索引更新
  const index = await readGlobalIndex();
  if (type === 'iteration') {
    indexUpdates += index.reqs.filter((r) => r.iteration === oldName).length;
    indexUpdates += index.iterations.filter((i) => i.name === oldName).length;
  } else {
    indexUpdates += index.reqs.filter((r) => r.task === oldName).length;
  }

  // Spec 文件引用数量估算
  const iterations = await (async () => {
    try { return await findIterations(process.cwd()); }
    catch { return []; }
  })();
  for (const iter of iterations) {
    const graphPath = join(process.cwd(), iter, '00-期次总览', 'PROJECT_GRAPH.md');
    if (await pathExists(graphPath)) {
      const gContent = await readFile(graphPath, 'utf-8');
      const matches = gContent.split(oldName).length - 1;
      specRefs += matches;
      if (matches > 0) files.push(graphPath);
    }
  }

  // 索引文件
  const indexPath = join(process.cwd(), '.speccore', 'GLOBAL', 'INDEX.md');
  if (await pathExists(indexPath)) {
    files.push(indexPath);
  }
  const iterIndexPath = join(process.cwd(), '.speccore', 'ITERATIONS', 'README.md');
  if (await pathExists(iterIndexPath)) {
    files.push(iterIndexPath);
  }

  return {
    type,
    oldName,
    newName,
    dirRename: `${oldPath} → ${newPath}`,
    indexUpdates,
    specRefs,
    files: [...new Set(files)],
  };
}

/**
 * 显示预览
 */
async function showPreview(preview: RenamePreview): Promise<void> {
  logger.info('');
  logger.info('📋 重命名预览');
  logger.info('');
  logger.info(`目标类型: ${preview.type === 'iteration' ? '期次' : '任务'}`);
  logger.info(`旧名称: ${preview.oldName}`);
  logger.info(`新名称: ${preview.newName}`);
  logger.info('');
  logger.info('影响范围:');
  logger.info(`   目录重命名: 1 处`);
  logger.info(`   索引更新: ${preview.indexUpdates} 处`);
  logger.info(`   Spec 引用更新: ~${preview.specRefs} 处`);
  logger.info(`   涉及文件: ${preview.files.length} 个`);
}

/**
 * 执行重命名
 */
async function executeRename(preview: RenamePreview): Promise<void> {
  const cwd = process.cwd();

  // 1. 目录重命名
  let oldPath: string;
  if (preview.type === 'iteration') {
    oldPath = join(cwd, preview.oldName);
  } else {
    const iterations = await findIterations(cwd);
    oldPath = '';
    for (const iter of iterations) {
      const p = join(cwd, iter, preview.oldName);
      if (await pathExists(p)) { oldPath = p; break; }
    }
  }

  if (oldPath && await pathExists(oldPath)) {
    const newPath = oldPath.replace(preview.oldName, preview.newName);
    await move(oldPath, newPath, { overwrite: true });
  }

  // 2. 更新所有引用文件
  for (const file of preview.files) {
    if (await pathExists(file)) {
      let content = await readFile(file, 'utf-8');
      if (content.includes(preview.oldName)) {
        content = content.split(preview.oldName).join(preview.newName);
        await writeFile(file, content);
      }
    }
  }
}

/**
 * 更新全量索引引用
 */
async function updateGlobalReferences(oldName: string, newName: string, type: 'iteration' | 'task'): Promise<void> {
  const index = await readGlobalIndex();

  for (const req of index.reqs) {
    if (type === 'iteration' && req.iteration === oldName) {
      await updateReqInIndex(req.id, { iteration: newName });
    } else if (type === 'task' && req.task === oldName) {
      await updateReqInIndex(req.id, { task: newName });
    }
  }

  const newVersion = bumpGlobalVersion(index.version);
  await updateIndexVersion(newVersion);

  logger.info('');
  logger.success('✅ 重命名完成！');
  logger.info('');
  logger.info(`   ${oldName} → ${newName}`);
  logger.info('   全量层版本: ' + newVersion);
}

/**
 * 查找所有期次目录
 */
async function findIterations(cwd: string): Promise<string[]> {
  const entries = await readdir(cwd, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && e.name.startsWith('期次-'))
    .map((e) => e.name);
}
