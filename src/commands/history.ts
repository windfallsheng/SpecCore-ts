/**
 * history - 查看需求变更历史命令
 * 输出指定需求（REQ-XXX）的完整变更历史，包括来源、版本演进、关联期次
 */

import { logger, Spinner } from '../utils/logger';
import { readGlobalIndex, readRequirementDetail } from '../core/global-layer';

export interface HistoryOptions {
  req?: string;
}

export async function historyCommand(options: HistoryOptions): Promise<void> {
  if (!options.req) {
    logger.error('请提供需求 ID。用法: speccore history --req=<REQ-XXX>');
    logger.info('提示: 使用 speccore global-status 查看可用需求列表');
    return;
  }

  const spinner = new Spinner('查询需求历史...');
  spinner.start();

  try {
    // 1. 定位需求
    const index = await readGlobalIndex();
    const reqEntry = index.reqs.find((r) => r.id === options.req);

    if (!reqEntry) {
      spinner.fail(`需求 ${options.req} 不存在`);
      logger.info('');
      logger.info('在 GLOBAL/INDEX.md 中未找到该需求 ID。');
      logger.info('请运行 speccore global-status 查看可用需求列表。');
      return;
    }

    // 2. 读取需求详情（含变更历史）
    const detail = await readRequirementDetail(reqEntry.project, options.req!);
    spinner.stop();

    // 3. 输出报告
    logger.info('');
    logger.info(`📜 需求历史: ${options.req} ${reqEntry.name}`);
    logger.info('');

    // 来源信息
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('📋 当前状态');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info(`   当前版本: ${reqEntry.version}`);
    logger.info(`   状态: ${reqEntry.status}`);
    logger.info(`   来源项目: ${reqEntry.project}`);
    logger.info(`   关联期次: ${reqEntry.iteration || '-'}`);
    logger.info(`   关联 Task: ${reqEntry.task || '-'}`);
    logger.info(`   文件位置: ${reqEntry.filePath}`);

    // 变更历史（从详情中提取）
    if (detail) {
      logger.info('');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('📝 变更历史');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      const changelogMatch = detail.match(/📝 变更历史[^]*$/m);
      if (changelogMatch) {
        const lines = changelogMatch[0].split('\n');
        for (const line of lines) {
          if (line.trim()) {
            logger.info(`   ${line.trim()}`);
          }
        }
      } else {
        logger.info('   （无变更历史）');
      }
    }

    // 元数据
    if (detail) {
      logger.info('');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('📦 元数据');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      const metaLines = detail.split('\n').filter((l) => l.includes('|') && l.includes(':---'));
      for (let i = 0; i < detail.split('\n').length; i++) {
        const line = detail.split('\n')[i];
        if (line.includes('来源') || line.includes('当前版本') || line.includes('状态') || line.includes('最后修改')) {
          logger.info(`   ${line.trim()}`);
        }
      }
    }

    logger.info('');
    logger.info('💡 提示: 要查看完整的代码级变更记录，请使用 git log 查看对应文件。');

  } catch (error) {
    spinner.fail(`查询历史失败: ${error}`);
    throw error;
  }
}
