/**
 * analyze 模式：--doc 局部刷新单个类型文档（bugs/refactors/research）
 * v8.3.341+: 从 analyzeCommand 抽出的模式早退块
 * v8.3.359+: 从 analyze.ts 拆分（渐进重构批次 B，逻辑不搬家、行为不变）
 */
import { logger, Spinner } from '../../utils/logger';
import { getDefaultIteration, getIterationDir } from '../../core/context';
import type { AnalyzeOptions } from './shared';

export async function analyzeDocMode(options: AnalyzeOptions, projectRoot: string): Promise<void> {
  const iter = options.iteration || await getDefaultIteration();
  if (!iter) { logger.error('请指定迭代: -I <iteration>'); return; }
  const iterDir = await getIterationDir(iter);
  // 调用点已保证 options.doc 非空，此处断言恢复 narrowing
  const docPath = options.doc as string; // e.g. "bugs/login-timeout" or "refactors/db-pool"

  const spinner = new Spinner(`局部分析: ${docPath}`);
  spinner.start();

  const { analyzeSingleTypedDoc } = await import('../../core/analyze-engine');
  const result = await analyzeSingleTypedDoc(iterDir, docPath);
  if (!result) {
    spinner.fail(`未找到类型文档: 010-requirements/${docPath}.md`);
    logger.info('   支持的格式: bugs/<slug>, refactors/<slug>, research/<slug>');
    return;
  }

  const typeDir = docPath.split('/')[0];
  spinner.stop(`✅ 局部分析完成: 020-specs/${docPath}.md`);
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
