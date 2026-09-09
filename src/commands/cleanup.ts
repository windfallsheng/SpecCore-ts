/**
 * cleanup — 本地临时缓存清理
 *
 * v8.3.12+: 清理 analyze/execute/split 等命令产生的临时文件和备份
 * 不影响用户数据（迭代目录、任务内容、活跃缓存），只清理"临时"内容
 *
 * 用法:
 *   speccore cleanup              # 默认清理：7天前的时间戳备份+归档+.bak+临时文件
 *   speccore cleanup --days 3     # 清理 3 天前的
 *   speccore cleanup --all        # 清理所有可清理的（不限制天数）
 *   speccore cleanup --dry-run    # 预览模式，只列出不删除
 */

import { readdir, pathExists, stat, unlink, remove } from 'fs-extra';
import { join, dirname, relative } from 'path';
import { logger, Spinner } from '../utils/logger';
import { isTimestampBackup } from '../utils/task-utils';

export interface CleanupOptions {
  days?: number;
  all?: boolean;
  dryRun?: boolean;
}

export type CleanupType =
  | 'timestampBackups'
  | 'bakFiles'
  | 'archiveFiles'
  | 'archiveDirs'
  | 'tempFiles'
  | 'staleCacheFiles';

export interface AutoCleanupOptions {
  cwd: string;
  types: CleanupType[];
  days?: number;
  silent?: boolean;
}

interface CleanupResult {
  timestampBackups: string[];
  bakFiles: string[];
  archiveFiles: string[];
  archiveDirs: string[];
  tempFiles: string[];
  staleCacheFiles: string[];
}

const ARCHIVE_PATTERNS = [
  /\.invalid-\d+$/,       // xxx.invalid-1234567890123
  /\.orphan-\d+$/,        // xxx.orphan-1234567890123
  /\.migrated-\d+$/,      // global.migrated-1234567890123
  /\.archived-\d+$/,      // global.archived-1234567890123
];

const TEMP_FILE_PATTERNS = [
  /^\.tmp_export\.md$/,
  /^\.tmp_.*$/,
];

const STALE_CACHE_PATTERNS = [
  /last-analysis-snapshot\.json$/,
  /semantic-tags\.json$/,
  /structured-data\.json$/,
  /code-structure\.json$/,
];

/** 判断文件名是否为归档文件 */
function isArchiveFile(name: string): boolean {
  return ARCHIVE_PATTERNS.some(p => p.test(name));
}

/** 判断文件名是否为临时文件 */
function isTempFile(name: string): boolean {
  return TEMP_FILE_PATTERNS.some(p => p.test(name));
}

/** 判断是否为可清理的过期缓存 */
function isStaleCacheFile(name: string): boolean {
  return STALE_CACHE_PATTERNS.some(p => p.test(name));
}

/** 递归扫描目录，收集可清理文件 */
async function scanForCleanup(
  rootDir: string,
  cutoffTime: number,
  results: CleanupResult,
  visited: Set<string> = new Set()
): Promise<void> {
  if (visited.has(rootDir)) return;
  visited.add(rootDir);

  if (!(await pathExists(rootDir))) return;

  const entries = await readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(rootDir, entry.name);

    // 跳过 .speccore/backups/ 和 .speccore/cache/ 中的活跃缓存
    if (fullPath.includes('.speccore/backups')) continue;
    if (fullPath.includes('.speccore/cache') && !isStaleCacheFile(entry.name)) continue;
    // 跳过 node_modules 和 .git
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    // 跳过 outputs/（产物而非缓存）
    if (entry.name === 'outputs') continue;

    // 判断当前是否在 .speccore/ 根目录（排除根目录下的配置文件备份）
    const isSpeccoreRoot = rootDir.endsWith('.speccore') || rootDir.endsWith('.speccore/');

    if (entry.isDirectory()) {
      // 检查是否为归档目录
      if (isArchiveFile(entry.name)) {
        try {
          const s = await stat(fullPath);
          if (s.mtimeMs < cutoffTime) {
            results.archiveDirs.push(fullPath);
          }
        } catch { /* ignore */ }
        continue;
      }
      // 递归扫描（但限制深度，避免扫进源码目录）
      const relativeDepth = fullPath.replace(rootDir, '').split('/').length;
      if (relativeDepth < 6) {
        await scanForCleanup(fullPath, cutoffTime, results, visited);
      }
    } else if (entry.isFile()) {
      try {
        const s = await stat(fullPath);
        const isOld = s.mtimeMs < cutoffTime;

        // 1. 时间戳备份文件（跳过 .speccore/ 根目录下的配置文件备份）
        if (isTimestampBackup(entry.name) && isOld && !isSpeccoreRoot) {
          results.timestampBackups.push(fullPath);
          continue;
        }

        // 2. .bak 文件（跳过 .speccore/ 根目录）
        if (entry.name.endsWith('.bak') && isOld && !isSpeccoreRoot) {
          results.bakFiles.push(fullPath);
          continue;
        }

        // 3. 归档文件
        if (isArchiveFile(entry.name) && isOld) {
          results.archiveFiles.push(fullPath);
          continue;
        }

        // 4. 临时文件（不限时间，随时可删）
        if (isTempFile(entry.name)) {
          results.tempFiles.push(fullPath);
          continue;
        }

        // 5. 过期缓存文件
        if (isStaleCacheFile(entry.name) && isOld) {
          results.staleCacheFiles.push(fullPath);
          continue;
        }
      } catch { /* ignore */ }
    }
  }
}

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** 计算总大小 */
async function calcTotalSize(paths: string[]): Promise<number> {
  let total = 0;
  for (const p of paths) {
    try {
      const s = await stat(p);
      total += s.size;
    } catch { /* ignore */ }
  }
  return total;
}

/** 执行清理 */
async function performCleanup(results: CleanupResult, dryRun: boolean): Promise<{ deleted: number; skipped: number; totalSize: number }> {
  let deleted = 0;
  let skipped = 0;
  let totalSize = 0;

  const allPaths = [
    ...results.timestampBackups,
    ...results.bakFiles,
    ...results.archiveFiles,
    ...results.tempFiles,
    ...results.staleCacheFiles,
  ];

  for (const p of allPaths) {
    try {
      const s = await stat(p);
      totalSize += s.size;
      if (!dryRun) {
        await unlink(p);
      }
      deleted++;
    } catch {
      skipped++;
    }
  }

  for (const d of results.archiveDirs) {
    try {
      const s = await stat(d);
      totalSize += s.size;
      if (!dryRun) {
        await remove(d);
      }
      deleted++;
    } catch {
      skipped++;
    }
  }

  return { deleted, skipped, totalSize };
}

/**
 * cleanup 命令入口
 */
export async function cleanupCommand(options: CleanupOptions): Promise<void> {
  const cwd = process.cwd();
  const days = options.all ? 0 : (options.days ?? 7);
  const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

  const spinner = new Spinner('扫描临时文件...');
  spinner.start();

  const results: CleanupResult = {
    timestampBackups: [],
    bakFiles: [],
    archiveFiles: [],
    archiveDirs: [],
    tempFiles: [],
    staleCacheFiles: [],
  };

  // 扫描项目根目录和 .speccore/ 目录
  await scanForCleanup(cwd, cutoffTime, results);
  await scanForCleanup(join(cwd, '.speccore'), cutoffTime, results);

  spinner.stop('扫描完成');

  const totalItems =
    results.timestampBackups.length +
    results.bakFiles.length +
    results.archiveFiles.length +
    results.archiveDirs.length +
    results.tempFiles.length +
    results.staleCacheFiles.length;

  if (totalItems === 0) {
    logger.info(`✅ 没有发现需要清理的临时文件（${days === 0 ? '全部' : days + ' 天前'}）`);
    return;
  }

  // 计算各类型大小
  const fileSize = await calcTotalSize([
    ...results.timestampBackups,
    ...results.bakFiles,
    ...results.archiveFiles,
    ...results.tempFiles,
    ...results.staleCacheFiles,
  ]);
  const dirSize = await calcTotalSize(results.archiveDirs);
  const totalSize = fileSize + dirSize;

  // 展示清单
  logger.info('');
  logger.info(options.dryRun ? '🔍 [预览模式] 以下文件将被清理：' : '🗑️ 发现以下可清理的临时文件：');
  logger.info('');

  if (results.timestampBackups.length > 0) {
    logger.info(`📦 时间戳备份文件: ${results.timestampBackups.length} 个`);
    for (const p of results.timestampBackups.slice(0, 5)) {
      logger.info(`   ${relative(cwd, p)}`);
    }
    if (results.timestampBackups.length > 5) {
      logger.info(`   ... 还有 ${results.timestampBackups.length - 5} 个`);
    }
  }

  if (results.bakFiles.length > 0) {
    logger.info(`📦 .bak 备份文件: ${results.bakFiles.length} 个`);
    for (const p of results.bakFiles.slice(0, 5)) {
      logger.info(`   ${relative(cwd, p)}`);
    }
    if (results.bakFiles.length > 5) {
      logger.info(`   ... 还有 ${results.bakFiles.length - 5} 个`);
    }
  }

  if (results.archiveFiles.length > 0) {
    logger.info(`📦 散落归档文件: ${results.archiveFiles.length} 个`);
    for (const p of results.archiveFiles.slice(0, 5)) {
      logger.info(`   ${relative(cwd, p)}`);
    }
    if (results.archiveFiles.length > 5) {
      logger.info(`   ... 还有 ${results.archiveFiles.length - 5} 个`);
    }
  }

  if (results.archiveDirs.length > 0) {
    logger.info(`📁 归档目录: ${results.archiveDirs.length} 个`);
    for (const p of results.archiveDirs.slice(0, 5)) {
      logger.info(`   ${relative(cwd, p)}/`);
    }
    if (results.archiveDirs.length > 5) {
      logger.info(`   ... 还有 ${results.archiveDirs.length - 5} 个`);
    }
  }

  if (results.tempFiles.length > 0) {
    logger.info(`📝 临时文件: ${results.tempFiles.length} 个`);
    for (const p of results.tempFiles.slice(0, 5)) {
      logger.info(`   ${relative(cwd, p)}`);
    }
    if (results.tempFiles.length > 5) {
      logger.info(`   ... 还有 ${results.tempFiles.length - 5} 个`);
    }
  }

  if (results.staleCacheFiles.length > 0) {
    logger.info(`💾 过期缓存: ${results.staleCacheFiles.length} 个`);
    for (const p of results.staleCacheFiles.slice(0, 5)) {
      logger.info(`   ${relative(cwd, p)}`);
    }
    if (results.staleCacheFiles.length > 5) {
      logger.info(`   ... 还有 ${results.staleCacheFiles.length - 5} 个`);
    }
  }

  logger.info('');
  logger.info(`总计: ${totalItems} 项，预估释放 ${formatSize(totalSize)}`);

  if (options.dryRun) {
    logger.info('');
    logger.info('💡 去掉 --dry-run 即可实际清理');
    return;
  }

  // 执行清理
  logger.info('');
  const actionSpinner = new Spinner('正在清理...');
  actionSpinner.start();

  const { deleted, skipped } = await performCleanup(results, false);

  actionSpinner.stop('清理完成');

  logger.success(`✅ 已清理 ${deleted} 个临时文件/目录`);
  if (skipped > 0) {
    logger.warn(`⚠️ ${skipped} 个文件删除失败（可能已被占用）`);
  }
  logger.info(`   预估释放空间: ${formatSize(totalSize)}`);

  // 提示
  logger.info('');
  logger.info('💡 提示:');
  logger.info('   • 被清理的是「临时」文件，不影响迭代/任务/Spec 内容');
  logger.info('   • 活跃缓存（knowledge-graph.json、rag-index.json）不会被清理');
  logger.info('   • 使用 --dry-run 可预览清理内容');
  logger.info('   • 使用 --all 可清理所有可清理的（不限天数）');
}

/**
 * v8.3.14+: 按类型自动清理（供 analyze/split/execute 等命令调用）
 * 只清理指定的类型，静默执行，不影响用户体验
 */
export async function cleanupByType(options: AutoCleanupOptions): Promise<void> {
  const { cwd, types, days = 7, silent = true } = options;
  const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

  const results: CleanupResult = {
    timestampBackups: [],
    bakFiles: [],
    archiveFiles: [],
    archiveDirs: [],
    tempFiles: [],
    staleCacheFiles: [],
  };

  // 扫描项目根目录和 .speccore/ 目录
  await scanForCleanup(cwd, cutoffTime, results);
  await scanForCleanup(join(cwd, '.speccore'), cutoffTime, results);

  // 过滤只保留指定类型
  const filteredResults: CleanupResult = {
    timestampBackups: types.includes('timestampBackups') ? results.timestampBackups : [],
    bakFiles: types.includes('bakFiles') ? results.bakFiles : [],
    archiveFiles: types.includes('archiveFiles') ? results.archiveFiles : [],
    archiveDirs: types.includes('archiveDirs') ? results.archiveDirs : [],
    tempFiles: types.includes('tempFiles') ? results.tempFiles : [],
    staleCacheFiles: types.includes('staleCacheFiles') ? results.staleCacheFiles : [],
  };

  const totalItems =
    filteredResults.timestampBackups.length +
    filteredResults.bakFiles.length +
    filteredResults.archiveFiles.length +
    filteredResults.archiveDirs.length +
    filteredResults.tempFiles.length +
    filteredResults.staleCacheFiles.length;

  if (totalItems === 0) return;

  const { deleted, skipped, totalSize } = await performCleanup(filteredResults, false);

  if (!silent) {
    logger.info(`🧹 自动清理: ${deleted} 个临时文件/目录已清理`);
    if (skipped > 0) {
      logger.warn(`   ⚠️ ${skipped} 个文件删除失败`);
    }
  } else {
    logger.debug(`🧹 自动清理完成: ${deleted} 个文件/目录，释放 ${formatSize(totalSize)}`);
  }
}
