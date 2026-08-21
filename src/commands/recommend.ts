/**
 * recommend — 智能推荐命令
 * v6.96.0
 */
import { Command } from 'commander';
import { logger } from '../utils/logger';
import { generateRecommendations, printRecommendations } from '../core/smart-recommend';
import { generateUsageReport, formatUsageReport } from '../core/usage-analytics';
import { diagnoseAndPrint } from '../core/error-diagnosis';

export interface RecommendOptions {
  analytics?: boolean;
  diagnose?: string;
  period?: string;
}

export async function recommendCommand(options: RecommendOptions): Promise<void> {
  const cwd = process.cwd();

  // --diagnose: 诊断指定错误信息
  if (options.diagnose) {
    diagnoseAndPrint(options.diagnose);
    return;
  }

  // --analytics: 显示使用分析报告
  if (options.analytics) {
    const period = parseInt(options.period || '14', 10);
    const report = await generateUsageReport(cwd, period);
    logger.info(formatUsageReport(report));
    return;
  }

  // 默认：生成智能推荐
  const recommendations = await generateRecommendations(cwd);
  printRecommendations(recommendations);
}

export function registerRecommendCommand(program: Command): void {
  program
    .command('recommend')
    .alias('rec')
    .description('智能推荐：基于项目状态给出操作建议')
    .option('--analytics', '显示使用模式分析报告')
    .option('--period <days>', '报告时间范围（天）', '14')
    .option('--diagnose <error>', '诊断错误信息并给出修复建议')
    .action(recommendCommand);
}
