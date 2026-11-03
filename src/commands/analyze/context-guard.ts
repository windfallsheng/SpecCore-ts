/**
 * analyze 模式：--context-guard / --estimate-only 上下文爆炸防护
 * 返回 true 表示已处理完毕（调用点应直接 return）。
 * v8.3.341+: 从 analyzeCommand 抽出的模式早退块
 * v8.3.359+: 从 analyze.ts 拆分（渐进重构批次 B，逻辑不搬家、行为不变）
 */
import { logger } from '../../utils/logger';
import { getDefaultIteration, getIterationDir } from '../../core/context';
import { emitAiPrompt } from './shared';
import type { AnalyzeOptions } from './shared';

export async function analyzeContextGuard(options: AnalyzeOptions): Promise<boolean> {
  const iter = options.iteration || await getDefaultIteration();
  if (!iter) { logger.error('请指定迭代: -I <iteration>'); return true; }
  const iterDir = await getIterationDir(iter);

  const { estimateContextSize, buildSegmentationPlan, buildContextGuardPrompt } = await import('../../core/analyze-context-guard');
  const estimate = await estimateContextSize(iterDir, { withCode: options.withCode });
  const plan = await buildSegmentationPlan(estimate, iterDir, { withCode: options.withCode });

  logger.info('');
  logger.info('📊 上下文大小预估报告');
  logger.info(`预估 Tokens: ~${estimate.estimatedTokens.toLocaleString()} (${estimate.level})`);
  logger.info(`推荐策略: ${estimate.recommendedStrategy}`);
  logger.info(`分段数: ${plan.segments.length}`);

  if (options.estimateOnly) {
    // 只输出预估报告到 prompt
    const prompt = buildContextGuardPrompt(estimate, plan);
    await emitAiPrompt(iter, prompt, { mode: 'context-guard' });
    process.exitCode = 10;
    return true;
  }

  // context-guard 模式下，将预估信息注入后续 prompt
  // 通过全局变量或 options 传递（简化处理：直接输出报告后继续）
  logger.info('');
  logger.info('💡 继续执行分析，建议按上述分段策略进行');
  logger.info('');
  return false;
}
