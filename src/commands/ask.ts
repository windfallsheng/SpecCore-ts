/**
 * /ask - 万能智能入口
 * 四种模式：命令解释 / 任务指引 / 意图匹配 / 复杂编排
 */

import { logger } from '../utils/logger';
import { askEngine } from '../core/ask-engine';

export async function askCommand(input: string, _options: any): Promise<void> {
  if (!input || !input.trim()) {
    logger.info('🔍 SpecCore 万能 AI 入口');
    logger.info('');
    logger.info('用法: speccore ask "<自然语言>"');
    logger.info('');
    logger.info('四种模式自动识别:');
    logger.info('  📖 命令解释: speccore ask "dashboard 怎么用"');
    logger.info('  🗺️ 任务指引: speccore ask "我想做一个登录功能"');
    logger.info('  🎯 意图匹配: speccore ask "查看项目进度"');
    logger.info('  ⚡ 复杂编排: speccore ask "计划所有任务，晚8点分批执行"');
    return;
  }

  logger.info(`🔍 正在分析: "${input}"`);
  logger.info('');

  try {
    const result = await askEngine(input);
    logger.info('');
    logger.info('━'.repeat(55));
    logger.info(result.detail);
    logger.info('━'.repeat(55));

    if (result.pipeline) {
      logger.info('');
      logger.info('💡 输入 y 确认执行，或输入新描述修改计划');
    }
  } catch (e: any) {
    logger.error(`分析失败: ${e.message || e}`);
    logger.info('💡 请使用 speccore help 查看可用命令');
  }
}
