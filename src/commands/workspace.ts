/**
 * workspace — 临时工作区管理命令
 *
 * v8.3.0+: 查看、管理临时工作区中的独立内容处理产出
 *
 * 用法:
 *   speccore workspace list              # 列出所有条目
 *   speccore workspace list --type clarify
 *   speccore workspace show <entryId>    # 查看条目详情
 *   speccore workspace clean --days 30   # 清理 30 天前的条目
 */

import { logger } from '../utils/logger';
import {
  listWorkspaceEntries,
  getWorkspacePaths,
  loadIndex,
  type WorkspaceEntry,
} from '../core/workspace-manager';
import { readFile, writeFile, pathExists, readdir, remove } from 'fs-extra';
import { join } from 'path';

export interface WorkspaceOptions {
  list?: boolean;
  show?: string;
  clean?: boolean;
  days?: number;
  type?: string;
}

export async function workspaceCommand(options: WorkspaceOptions): Promise<void> {
  const cwd = process.cwd();

  // ── list 模式 ──
  if (options.list || (!options.show && !options.clean)) {
    const entries = await listWorkspaceEntries(cwd, {
      type: options.type as any,
    });

    if (entries.length === 0) {
      logger.info('📭 临时工作区为空');
      logger.info('   使用 speccore clarify --local 或 speccore research 创建条目');
      return;
    }

    logger.info('');
    logger.info(`📦 临时工作区 (${entries.length} 个条目):`);
    logger.info('');

    for (const e of entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      const typeIcon = e.type === 'clarify' ? '📝' : '🔬';
      const statusIcon = e.status === 'done' ? '✅' : e.status === 'promoted' ? '⬆️' : '⏳';
      const date = e.createdAt.slice(0, 10);
      const source = e.sourcePath ? e.sourcePath.split('/').pop() : '直接输入';
      logger.info(`  ${typeIcon} ${e.id} ${statusIcon}`);
      logger.info(`     类型: ${e.type} | 日期: ${date} | 来源: ${source}`);
      if (e.promotedTo) {
        logger.info(`     已提升到: ${e.promotedTo}`);
      }
      logger.info('');
    }

    logger.info('操作:');
    logger.info('  speccore workspace show <entryId>    查看详情');
    logger.info('  speccore workspace clean --days 30   清理旧条目');
    return;
  }

  // ── show 模式 ──
  if (options.show) {
    const index = await loadIndex(cwd);
    const entry = index.entries.find(e => e.id === options.show || e.id.startsWith(options.show!));
    if (!entry) {
      logger.error(`未找到条目: ${options.show}`);
      return;
    }

    logger.info('');
    logger.info(`📋 条目详情: ${entry.id}`);
    logger.info('');
    logger.info(`  类型: ${entry.type}`);
    logger.info(`  来源: ${entry.source}${entry.sourcePath ? ` (${entry.sourcePath})` : ''}`);
    logger.info(`  创建时间: ${entry.createdAt}`);
    logger.info(`  字数: ${entry.wordCount}`);
    logger.info(`  状态: ${entry.status}`);
    if (entry.promotedTo) {
      logger.info(`  已提升到迭代: ${entry.promotedTo}`);
    }
    logger.info('');

    // 显示产出文件
    const paths = getWorkspacePaths(cwd);
    const outDir = join(paths[entry.type], entry.id);
    if (await pathExists(outDir)) {
      const files = await readdir(outDir);
      if (files.length > 0) {
        logger.info('  产出文件:');
        for (const f of files) {
          const fpath = join(outDir, f);
          const content = await readFile(fpath, 'utf-8');
          const lines = content.split('\n').length;
          logger.info(`    📄 ${f} (${lines} 行)`);
        }
      }
    }

    // 显示原始输入
    const inboxDir = join(paths.inbox, entry.id);
    if (await pathExists(inboxDir)) {
      const sourcePath = join(inboxDir, 'source.md');
      if (await pathExists(sourcePath)) {
        logger.info('');
        logger.info('  原始输入摘要:');
        const source = await readFile(sourcePath, 'utf-8');
        const preview = source.slice(0, 200).replace(/\n/g, ' ');
        logger.info(`    ${preview}${source.length > 200 ? '...' : ''}`);
      }
    }

    logger.info('');
    logger.info('操作:');
    logger.info(`  speccore clarify --promote ${entry.id} --to <iteration>  提升到迭代层`);
    return;
  }

  // ── clean 模式 ──
  if (options.clean) {
    const days = options.days || 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const index = await loadIndex(cwd);
    const toRemove: WorkspaceEntry[] = [];
    const toKeep: WorkspaceEntry[] = [];

    for (const e of index.entries) {
      const created = new Date(e.createdAt);
      if (created < cutoff && e.status !== 'promoted') {
        toRemove.push(e);
      } else {
        toKeep.push(e);
      }
    }

    if (toRemove.length === 0) {
      logger.info(`✅ ${days} 天前没有可清理的条目`);
      return;
    }

    const paths = getWorkspacePaths(cwd);
    for (const e of toRemove) {
      // 删除 inbox
      const inboxDir = join(paths.inbox, e.id);
      if (await pathExists(inboxDir)) await remove(inboxDir);
      // 删除产出
      const outDir = join(paths[e.type], e.id);
      if (await pathExists(outDir)) await remove(outDir);
    }

    // 更新索引
    await writeFile(paths.index, JSON.stringify({ entries: toKeep }, null, 2));

    logger.success(`🗑️ 已清理 ${toRemove.length} 个条目（${days} 天前的未提升条目）`);
    logger.info(`   保留 ${toKeep.length} 个条目`);
    return;
  }
}
