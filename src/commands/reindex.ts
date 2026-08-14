/**
 * reindex — 全量索引重建与一致性检查命令
 *
 * 用法:
 *   speccore reindex              # 全量重建所有层级索引
 *   speccore reindex --check      # 只检查一致性，不修复
 *   speccore reindex --iteration Q2  # 指定迭代
 */

import { logger, Spinner } from '../utils/logger';
import { runReindex, ReindexResult } from '../core/reindex-engine';

export interface ReindexOptions {
  check?: boolean;
  iteration?: string;
}

export async function reindexCommand(options: ReindexOptions): Promise<void> {
  const mode = options.check ? '一致性检查' : '全量索引重建';
  const spinner = new Spinner(`${mode}...`);
  spinner.start();

  try {
    const result = await runReindex(process.cwd(), {
      check: options.check,
      iteration: options.iteration,
    });

    spinner.stop(`${mode}完成`);
    printReport(result, options.check || false);
  } catch (err: any) {
    spinner.fail(`${mode}失败: ${err.message}`);
  }
}

function printReport(result: ReindexResult, checkOnly: boolean): void {
  logger.info('');

  // ── 全局层 ──
  logger.info(`📂 ${result.global.name}`);
  printLayerResult(result.global, checkOnly);

  // ── 迭代层 ──
  if (result.iteration) {
    logger.info('');
    logger.info(`📂 ${result.iteration.name}`);
    printLayerResult(result.iteration, checkOnly);
  }

  // ── 汇总 ──
  logger.info('');
  logger.info('── 汇总 ──');
  const { totalFiles, valid, stale, added, fixed } = result.summary;
  logger.info(`   总文件数: ${totalFiles}`);
  logger.info(`   ✅ 有效: ${valid}`);
  if (stale > 0) logger.info(`   ❌ 死链/过期: ${stale}`);
  if (added > 0) logger.info(`   ⚠️  新增未索引: ${added}`);
  if (fixed > 0 && !checkOnly) logger.info(`   🔧 已修复: ${fixed}`);

  // ── 知识图谱 ──
  if (result.knowledgeGraph) {
    logger.info('');
    logger.info('── 知识图谱 ──');
    logger.info(`   📊 实体: ${result.knowledgeGraph.entities} 个`);
    logger.info(`   🔗 关系: ${result.knowledgeGraph.relations} 条`);
    logger.info(`   💾 图谱文件: ${result.knowledgeGraph.graphFile}`);
    logger.info(`   📄 上下文: ${result.knowledgeGraph.contextFile}`);
  }

  // ── 衰减检测 ──
  if (result.decayReport) {
    const { decayed, healthy } = result.decayReport.summary;
    if (decayed > 0) {
      logger.info('');
      logger.info('── 知识衰减 ──');
      const critical = result.decayReport.decayedFiles.filter(d => d.severity === 'critical');
      const warning = result.decayReport.decayedFiles.filter(d => d.severity === 'warning');
      if (critical.length > 0) logger.info(`   ❌ 严重（上下游不一致）: ${critical.length} 个`);
      if (warning.length > 0) logger.info(`   ⚠️  内容已变更: ${warning.length} 个`);
      logger.info(`   ✅ 健康: ${healthy} 个`);
    }
  }

  if (stale === 0 && added === 0) {
    logger.info('');
    logger.success('✅ 所有索引一致，无死链，无遗漏');
  } else if (checkOnly && (stale > 0 || added > 0)) {
    logger.info('');
    logger.info('💡 使用 `speccore reindex`（不加 --check）自动修复以上问题');
  }
}

function printLayerResult(layer: ReindexResult['global'], checkOnly: boolean): void {
  // 文件统计
  const fileCount = layer.files.length;
  if (fileCount > 0) {
    logger.info(`   📄 扫描到 ${fileCount} 个文档`);
  }

  // 死链
  if (layer.staleLinks.length > 0) {
    logger.info(`   ❌ 发现 ${layer.staleLinks.length} 个死链/不一致:`);
    for (const link of layer.staleLinks.slice(0, 10)) {
      logger.info(`      ${link.file}: ${link.reference}`);
    }
    if (layer.staleLinks.length > 10) {
      logger.info(`      ... 还有 ${layer.staleLinks.length - 10} 个`);
    }
  }

  // 新增未索引
  if (layer.newFiles.length > 0) {
    logger.info(`   ⚠️  发现 ${layer.newFiles.length} 个新增未索引:`);
    for (const f of layer.newFiles.slice(0, 10)) {
      logger.info(`      + ${f}`);
    }
    if (layer.newFiles.length > 10) {
      logger.info(`      ... 还有 ${layer.newFiles.length - 10} 个`);
    }
  }

  // 重建的索引
  if (layer.rebuiltIndexes.length > 0) {
    logger.info(`   🔧 已重建索引:`);
    for (const idx of layer.rebuiltIndexes) {
      logger.info(`      ✅ ${idx}`);
    }
  }

  // 无问题
  if (layer.staleLinks.length === 0 && layer.newFiles.length === 0) {
    logger.info(`   ✅ 索引一致，无死链，无遗漏`);
  }
}
