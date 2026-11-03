/**
 * analyze 模式：--module 功能模块级全局分析
 * v8.3.341+: 从 analyzeCommand 抽出的模式早退块
 * v8.3.359+: 从 analyze.ts 拆分（渐进重构批次 B，逻辑不搬家、行为不变）
 */
import { logger } from '../../utils/logger';
import { getDefaultIteration, getIterationDir } from '../../core/context';
import { emitAiPrompt } from './shared';
import type { AnalyzeOptions } from './shared';

export async function analyzeModuleMode(options: AnalyzeOptions): Promise<void> {
  const iter = options.iteration || await getDefaultIteration();
  if (!iter) { logger.error('请指定迭代: -I <iteration>'); return; }
  const iterDir = await getIterationDir(iter);
  // 调用点已保证 options.module 非空（if (options.module)），此处断言恢复 narrowing
  const moduleName = options.module as string;

  const { analyzeModule, buildModuleAnalysisPrompt, listAnalyzedModules, listRequirementModules } = await import('../../core/module-analyzer');
  const result = await analyzeModule(iterDir, moduleName);

  logger.info('');
  if (result.exists) {
    logger.info(`🔄 功能模块重新分析: ${moduleName}`);
    logger.info(`   状态: 已存在于全局文档`);
  } else {
    logger.info(`🆕 功能模块新增分析: ${moduleName}`);
    logger.info(`   状态: 尚未在全局文档中分析`);

    // 检查需求文档中是否存在该模块
    const reqModules = await listRequirementModules(iterDir);
    if (!reqModules.includes(moduleName)) {
      logger.warn(`⚠️ 需求文档中未找到功能模块 "${moduleName}"`);
      logger.info(`   需求中已有的模块: ${reqModules.slice(0, 10).join(', ')}${reqModules.length > 10 ? '...' : ''}`);
      logger.info(`   建议: 先确认模块名称是否正确，或在 010-requirements/features/ 中创建 ${moduleName}/SOURCE.md`);
    }
  }

  logger.info(`   涉及端: ${result.involvedPlatforms.join(', ') || '待确定'}`);
  logger.info(`   全局更新: ${result.globalUpdates.length} 项`);
  logger.info(`   各端更新: ${result.platformUpdates.length} 个端`);
  logger.info('');

  if (options.prompt) {
    const prompt = buildModuleAnalysisPrompt(iterDir, result, iter);
    await emitAiPrompt(iter, prompt, { mode: 'module-analysis' });
    process.exitCode = 10;
    return;
  }

  logger.info('📋 全局文档更新:');
  for (const up of result.globalUpdates) {
    logger.info(`   • ${up.action}: ${up.file}`);
  }
  logger.info('');
  logger.info('📋 各端文档更新:');
  for (const pu of result.platformUpdates) {
    logger.info(`   • ${pu.platform}: ${pu.files.join(', ')}`);
  }
  logger.info('');
  logger.info('📋 下一步:');
  logger.info(`   speccore analyze --prompt -I ${iter} --module ${moduleName}`);
}
