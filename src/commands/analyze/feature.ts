/**
 * analyze 模式：--feature 局部刷新单个功能模块
 * v8.3.341+: 从 analyzeCommand 抽出的模式早退块
 * v8.3.359+: 从 analyze.ts 拆分（渐进重构批次 B，逻辑不搬家、行为不变）
 */
import { logger, Spinner } from '../../utils/logger';
import { getDefaultIteration, getIterationDir } from '../../core/context';
import { analyzeSingleFeature } from '../../core/analyze-engine';
import type { AnalyzeOptions } from './shared';

export async function analyzeFeatureMode(options: AnalyzeOptions, projectRoot: string): Promise<void> {
  const iter = options.iteration || await getDefaultIteration();
  if (!iter) { logger.error('请指定迭代: -I <iteration>'); return; }
  const iterDir = await getIterationDir(iter);
  // 调用点已保证 options.feature 非空，此处断言恢复 narrowing
  const featureName = options.feature as string;

  const spinner = new Spinner(`局部分析: ${featureName}`);
  spinner.start();

  const result = await analyzeSingleFeature(iterDir, featureName);
  if (!result) {
    spinner.fail(`未找到功能模块: 010-requirements/features/${featureName}/SOURCE.md（旧项目为 README.md）`);
    return;
  }

  spinner.stop(`✅ 局部分析完成: 020-specs/features/${featureName}.md`);
  logger.info('');

  // 自动刷新知识图谱
  try {
    const { refreshKnowledgeGraph } = await import('../../core/knowledge-graph');
    await refreshKnowledgeGraph(projectRoot, iter);
    logger.info('🧠 知识图谱已刷新');
  } catch {}

  logger.info('');
  logger.info('📋 下一步:');
  logger.info(`   speccore iteration taskify -i ${iter}          # 重新拆分任务`);
  logger.info(`   speccore reindex                    # 完整重建索引`);
}
