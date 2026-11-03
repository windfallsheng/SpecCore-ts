/**
 * analyze 模式：--incremental / --reanalyze 增量分析
 * v6.75.0+: 从 analyzeCommand 抽出的模式早退块
 * v8.3.359+: 从 analyze.ts 拆分（渐进重构批次 E，逻辑不搬家、行为不变）
 */
import { logger } from '../../utils/logger';
import { getDefaultIteration, getIterationDir } from '../../core/context';
import { emitAiPrompt } from './shared';
import type { AnalyzeOptions } from './shared';

export async function analyzeIncrementalMode(options: AnalyzeOptions): Promise<void> {
  const iter = options.iteration || await getDefaultIteration();
  if (!iter) { logger.error('请指定迭代: -I <iteration>'); return; }
  const iterDir = await getIterationDir(iter);

  const { runIncrementalAnalysis, buildIncrementalPrompt } = await import('../../core/incremental-analyzer');
  const analysis = await runIncrementalAnalysis(iterDir, { withCode: options.withCode });

  if (!analysis.hasChanges && analysis.potentialGaps.length === 0) {
    logger.success('✅ 未检测到变更，所有分析产出均为最新');
    logger.info('   如需强制重新分析，去掉 --incremental 参数');
    return;
  }

  logger.info('');
  logger.info(`📊 增量分析结果: ${analysis.recommendation}`);
  logger.info('');

  if (options.prompt) {
    const prompt = buildIncrementalPrompt(iterDir, analysis, iter);
    await emitAiPrompt(iter, prompt, { mode: 'incremental' });
    process.exitCode = 10;
    return;
  }

  // 非 prompt 模式，输出摘要
  const changedReqs = analysis.requirementChanges.filter(c => c.changeType !== 'unchanged');
  if (changedReqs.length > 0) {
    logger.info(`✏️ 需求文档变更: ${changedReqs.length} 个`);
  }
  const changedCode = analysis.codeChanges.filter(c => c.changeType !== 'unchanged');
  if (changedCode.length > 0) {
    logger.info(`✏️ 源码文件变更: ${changedCode.length} 个`);
  }
  if (analysis.addedPlatforms.length > 0) {
    logger.info(`🆕 新增端: ${analysis.addedPlatforms.join(', ')}`);
  }
  if (analysis.potentialGaps.length > 0) {
    logger.info(`⚠️ 潜在遗漏: ${analysis.potentialGaps.length} 项`);
    for (const gap of analysis.potentialGaps) {
      logger.info(`   • ${gap}`);
    }
  }

  logger.info('');
  logger.info('📋 下一步:');
  logger.info(`   speccore analyze --prompt -I ${iter} --incremental`);
}
