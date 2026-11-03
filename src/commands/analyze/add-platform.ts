/**
 * analyze 模式：--add-platform 新增端分析
 * v6.75.0+: 从 analyzeCommand 抽出的模式早退块
 * v8.3.359+: 从 analyze.ts 拆分（渐进重构批次 E，逻辑不搬家、行为不变）
 */
import { logger } from '../../utils/logger';
import { getDefaultIteration, getIterationDir } from '../../core/context';
import { emitAiPrompt } from './shared';
import type { AnalyzeOptions } from './shared';

export async function analyzeAddPlatformMode(options: AnalyzeOptions): Promise<void> {
  const iter = options.iteration || await getDefaultIteration();
  if (!iter) { logger.error('请指定迭代: -I <iteration>'); return; }
  const iterDir = await getIterationDir(iter);
  // 调用点已保证 options.addPlatform 非空（if (options.addPlatform)），此处断言恢复 narrowing
  const newPlatform = options.addPlatform as string;

  const { analyzeNewPlatform, buildNewPlatformPrompt } = await import('../../core/platform-addition');
  const analysis = await analyzeNewPlatform(iterDir, newPlatform);

  logger.info('');
  logger.info(`🆕 新增端分析: ${newPlatform} (${analysis.platformType})`);
  logger.info(`   后端端: ${analysis.isBackend ? '是' : '否'}`);
  logger.info(`   已有端: ${analysis.existingPlatforms.join(', ')}`);
  logger.info(`   跨端关系: ${analysis.crossPlatformRelations.length} 个`);
  logger.info(`   全局更新: ${analysis.globalUpdates.length} 项`);
  logger.info('');

  if (options.prompt) {
    const prompt = buildNewPlatformPrompt(iterDir, analysis, iter);
    await emitAiPrompt(iter, prompt, { mode: 'new-platform' });
    process.exitCode = 10;
    return;
  }

  logger.info('📋 新端产出:');
  for (const out of analysis.newPlatformOutputs) {
    logger.info(`   • ${out}`);
  }
  logger.info('');
  logger.info('📋 全局文档更新:');
  for (const up of analysis.globalUpdates) {
    logger.info(`   • ${up.action}: ${up.file}`);
  }
  logger.info('');
  logger.info('📋 下一步:');
  logger.info(`   speccore analyze --prompt -I ${iter} --add-platform ${newPlatform}`);
}
