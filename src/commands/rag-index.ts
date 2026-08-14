/**
 * rag-index — RAG 索引管理命令
 *
 * 用法:
 *   speccore rag-index              # 显示当前 RAG 索引状态
 *   speccore rag-index --refresh    # 增量刷新（只重建变更文件）
 *   speccore rag-index --full       # 全量重建（删除旧索引，重新扫描）
 *   speccore rag-index --task Task-001  # 指定任务目录
 */

import { Command } from 'commander';
import { join } from 'path';
import { pathExists, remove, readdir } from 'fs-extra';
import { logger, Spinner } from '../utils/logger';
import {
  loadRagIndex, checkRagIndexFreshness, refreshRagIndex,
  indexTaskDocuments, indexDirectoryDocuments, RagIndex,
} from '../core/rag-engine';
import { getDefaultIteration } from '../core/context';

export interface RagIndexOptions {
  refresh?: boolean;
  full?: boolean;
  task?: string;
  iteration?: string;
}

export async function ragIndexCommand(options: RagIndexOptions): Promise<void> {
  const cwd = process.cwd();

  // 模式判断
  const isRefresh = options.refresh;
  const isFull = options.full;

  // 确定任务目录
  let taskDir = '';
  let iteration = options.iteration;

  if (options.task) {
    // 用户指定了任务
    if (!iteration) {
      iteration = await getDefaultIteration(cwd);
    }
    taskDir = join(`Iteration-${iteration}`, '030-tasks', options.task);
    if (!(await pathExists(taskDir))) {
      logger.error(`❌ 任务目录不存在: ${taskDir}`);
      logger.info('   💡 可用任务列表: speccore task list');
      return;
    }
  } else {
    // 尝试自动推断当前任务
    const currentIndex = await loadRagIndex(cwd);
    if (currentIndex) {
      // 从 scope 解析 iteration 和 taskDir
      const scopeParts = currentIndex.scope.split('_');
      if (scopeParts.length >= 2) {
        iteration = scopeParts[0];
        taskDir = scopeParts[1].replace(/_/g, '/');
      }
    }
  }

  // ── 显示模式（无 --refresh/--full）──
  if (!isRefresh && !isFull) {
    await showAllRagStatus(cwd);
    return;
  }

  // ── 刷新/重建模式 ──
  const mode = isFull ? '全量重建' : '增量刷新';
  const spinner = new Spinner(`${mode} RAG 索引...`);
  spinner.start();

  try {
    let result: RagIndex | null = null;
    const refreshedFiles: string[] = [];

    // 1. task 级索引
    if (taskDir && iteration) {
      if (isFull) {
        const indexPath = join(cwd, '.speccore', 'cache', 'rag-index.json');
        if (await pathExists(indexPath)) await remove(indexPath);
        result = await indexTaskDocuments(cwd, taskDir, iteration);
      } else {
        result = await refreshRagIndex(cwd, taskDir, iteration);
      }
      refreshedFiles.push('task');
    }

    // 2. iteration 级索引
    if (iteration) {
      const iterFileName = `rag-index-${iteration}.json`;
      const iterSpecsDir = join(`Iteration-${iteration}`, '020-specs');
      if (await pathExists(iterSpecsDir)) {
        if (isFull) {
          const indexPath = join(cwd, '.speccore', 'cache', iterFileName);
          if (await pathExists(indexPath)) await remove(indexPath);
          await indexDirectoryDocuments(cwd, iterSpecsDir, `${iteration}_020-specs_iteration_all`, iterFileName);
        }
        refreshedFiles.push(`iteration-${iteration}`);
      }
    }

    // 3. 全局索引
    const globalFileName = 'rag-index-global.json';
    const globalSpecsDir = join(cwd, '.speccore', 'GLOBAL', '020-specs');
    const fallbackDir = join(cwd, '.speccore');
    const targetDir = await pathExists(globalSpecsDir) ? globalSpecsDir : fallbackDir;
    if (await pathExists(targetDir)) {
      if (isFull) {
        const indexPath = join(cwd, '.speccore', 'cache', globalFileName);
        if (await pathExists(indexPath)) await remove(indexPath);
        await indexDirectoryDocuments(cwd, targetDir, 'GLOBAL_all_all_aggregated', globalFileName);
      }
      refreshedFiles.push('global');
    }

    spinner.stop(`${mode}完成`);

    if (refreshedFiles.length === 0) {
      logger.warn('   ⚠️ 未找到可刷新的索引');
      return;
    }

    // 输出摘要
    logger.info('');
    logger.info(`═══ RAG 索引${mode}结果 ═══`);
    logger.info(`  已刷新: ${refreshedFiles.join(', ')}`);

    if (result) {
      logger.info(`  作用域: ${result.scope}`);
      logger.info(`  文档块: ${result.chunks.length} 个`);
      logger.info(`  源文件: ${Object.keys(result.fileSummaries).length} 个`);

      // 显示文件级摘要
      if (Object.keys(result.fileSummaries).length > 0) {
        logger.info('');
        logger.info('  已索引文件:');
        for (const [fp, summary] of Object.entries(result.fileSummaries)) {
          const fileName = fp.split('/').pop() || fp;
          const chunkCount = result.chunks.filter(c => c.filePath === fp).length;
          logger.info(`    📄 ${fileName} (${chunkCount} 块)`);
        }
      }

      // 显示 top-level 块标题
      const topChunks = result.chunks
        .filter(c => c.level <= 3)
        .slice(0, 10);
      if (topChunks.length > 0) {
        logger.info('');
        logger.info('  主要章节:');
        for (const chunk of topChunks) {
          logger.info(`    ${'#'.repeat(chunk.level)} ${chunk.title}`);
        }
        if (result.chunks.length > 10) {
          logger.info(`    ... 及其他 ${result.chunks.length - 10} 个块`);
        }
      }
    }

    logger.info('');
    logger.success(`✅ RAG 索引已${isFull ? '重建' : '刷新'}: ${refreshedFiles.join(', ')}`);

  } catch (err: any) {
    spinner.fail(`${mode}失败`);
    logger.error(err.message);
  }
}

/**
 * 显示所有 RAG 索引文件状态
 */
async function showAllRagStatus(cwd: string): Promise<void> {
  const cacheDir = join(cwd, '.speccore', 'cache');
  if (!(await pathExists(cacheDir))) {
    logger.info('═══ RAG 索引状态 ═══');
    logger.info('  ❌ 暂无 RAG 索引');
    return;
  }

  const files = await readdir(cacheDir);
  const indexFiles = files.filter(f => f.startsWith('rag-index') && f.endsWith('.json'));

  if (indexFiles.length === 0) {
    logger.info('═══ RAG 索引状态 ═══');
    logger.info('  ❌ 暂无 RAG 索引');
    logger.info('');
    logger.info('  💡 生成方式:');
    logger.info('     speccore analyze --task <task>     # 分析时自动生成');
    logger.info('     speccore rag-index --refresh --task <task>  # 手动刷新');
    logger.info('     speccore rag-index --full --task <task>     # 全量重建');
    return;
  }

  logger.info('═══ RAG 索引状态 ═══');
  logger.info(`  发现 ${indexFiles.length} 个索引文件:`);
  logger.info('');

  for (const fileName of indexFiles.sort()) {
    const index = await loadRagIndex(cwd, fileName);
    if (!index) continue;

    const label = fileName === 'rag-index.json' ? 'task' :
      fileName === 'rag-index-global.json' ? 'global' :
        fileName.replace('rag-index-', '').replace('.json', '');

    const { fresh, staleFiles } = await checkRagIndexFreshness(cwd, fileName);
    const status = fresh ? '✅' : '⚠️';

    logger.info(`  ${status} [${label}] ${fileName}`);
    logger.info(`     作用域: ${index.scope}`);
    logger.info(`     块数: ${index.chunks.length} | 源文件: ${Object.keys(index.fileSummaries).length}`);
    logger.info(`     更新: ${new Date(index.updatedAt).toLocaleString('zh-CN')}`);
    if (!fresh && staleFiles.length > 0) {
      logger.info(`     过期文件: ${staleFiles.length} 个`);
    }
    logger.info('');
  }
}

/**
 * 显示当前 RAG 索引状态
 */
async function showRagStatus(cwd: string, taskDir: string, iteration?: string): Promise<void> {
  const index = await loadRagIndex(cwd);

  if (!index) {
    logger.info('═══ RAG 索引状态 ═══');
    logger.info('  ❌ 暂无 RAG 索引');
    logger.info('');
    logger.info('  💡 生成方式:');
    logger.info('     speccore analyze --task <task>     # 分析时自动生成');
    logger.info('     speccore rag-index --refresh --task <task>  # 手动刷新');
    logger.info('     speccore rag-index --full --task <task>     # 全量重建');
    return;
  }

  // 检查新鲜度
  const { fresh, staleFiles } = await checkRagIndexFreshness(cwd);

  logger.info('═══ RAG 索引状态 ═══');
  logger.info(`  作用域: ${index.scope}`);
  logger.info(`  版本: ${index.version}`);
  logger.info(`  更新时间: ${new Date(index.updatedAt).toLocaleString('zh-CN')}`);
  logger.info(`  文档块: ${index.chunks.length} 个`);
  logger.info(`  源文件: ${Object.keys(index.fileSummaries).length} 个`);

  if (fresh) {
    logger.info('  状态: ✅ 新鲜（所有源文件未变更）');
  } else {
    logger.info(`  状态: ⚠️  过期（${staleFiles.length} 个文件已变更）`);
    logger.info('');
    logger.info('  变更文件:');
    for (const fp of staleFiles.slice(0, 5)) {
      logger.info(`    📝 ${fp.split('/').pop() || fp}`);
    }
    if (staleFiles.length > 5) {
      logger.info(`    ... 及其他 ${staleFiles.length - 5} 个`);
    }
    logger.info('');
    logger.info('  💡 刷新命令:');
    logger.info('     speccore rag-index --refresh');
  }

  // 显示源文件列表
  logger.info('');
  logger.info('  已索引文件:');
  for (const [fp, summary] of Object.entries(index.fileSummaries)) {
    const fileName = fp.split('/').pop() || fp;
    const chunkCount = index.chunks.filter(c => c.filePath === fp).length;
    const isStale = staleFiles.includes(fp);
    const status = isStale ? '⚠️' : '✅';
    logger.info(`    ${status} ${fileName} (${chunkCount} 块)`);
  }
}

export function registerRagIndexCommand(program: Command): void {
  program
    .command('rag-index')
    .alias('ri')
    .description('RAG 索引管理（文档分块 + 摘要 + 关键词索引）')
    .option('--refresh', '增量刷新（只重建变更文件）')
    .option('--full', '全量重建（删除旧索引，重新扫描）')
    .option('-t, --task <task>', '指定任务目录（如 Task-001）')
    .option('-i, --iteration <iteration>', '指定迭代（默认当前迭代）')
    .addHelpText('after', `
\x1b[36m使用场景:\x1b[0m
  \x1b[33m查看状态\x1b[0m        speccore rag-index
  \x1b[33m增量刷新\x1b[0m        speccore rag-index --refresh --task Task-001
  \x1b[33m全量重建\x1b[0m        speccore rag-index --full --task Task-001
  \x1b[33m分析时自动\x1b[0m      speccore analyze --task Task-001（自动建索引）

\x1b[36m何时需要手动刷新:\x1b[0m
  • 你手动修改了 TECH.md / REQ.md / SCHEMA.md 等参考文档
  • analyze 后文档又更新了，但还没到下次 analyze
  • 统一检索层提示 "📄 传统模式"（说明 RAG 索引缺失或过期）

\x1b[36m索引内容:\x1b[0m
  • 按 Markdown 标题分块（## / ### / ####）
  • 每块提取摘要、关键词标签
  • 缓存位置: .speccore/cache/rag-index.json`)
    .action(ragIndexCommand);
}
