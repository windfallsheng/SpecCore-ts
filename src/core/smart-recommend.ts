/**
 * Smart Recommend — 智能推荐
 * v6.96.0: 基于项目状态和使用模式，给出操作建议
 */
import { join } from 'path';
import { pathExists, stat } from 'fs-extra';
import { logger } from '../utils/logger';
import { loadCodeGraph } from './code-graph';
import { getNotifications } from './notification';
import { checkLock } from './lock-manager';
import { generateUsageReport } from './usage-analytics';

export interface Recommendation {
  priority: 'high' | 'medium' | 'low';
  icon: string;
  title: string;
  description: string;
  action: string;
}

/**
 * 基于项目状态生成智能推荐
 */
export async function generateRecommendations(cwd: string): Promise<Recommendation[]> {
  const recommendations: Recommendation[] = [];

  // 1. 检查代码图谱时效性
  try {
    const graph = await loadCodeGraph(cwd);
    if (!graph) {
      recommendations.push({
        priority: 'high',
        icon: '🗺️',
        title: '构建代码知识图谱',
        description: '代码知识图谱缺失，analyze/execute 无法利用图谱上下文',
        action: 'speccore code-index --graph',
      });
    } else {
      const generatedAt = new Date(graph.metadata.generatedAt).getTime();
      const daysOld = (Date.now() - generatedAt) / (24 * 60 * 60 * 1000);
      if (daysOld > 7) {
        recommendations.push({
          priority: 'medium',
          icon: '🗺️',
          title: '更新代码知识图谱',
          description: `图谱已 ${Math.round(daysOld)} 天未更新，可能遗漏最新代码变更`,
          action: 'speccore code-index --graph --incremental',
        });
      }
    }
  } catch { /* 忽略 */ }

  // 2. 检查未读通知
  try {
    const unread = await getNotifications(cwd, { unreadOnly: true });
    if (unread.length > 5) {
      recommendations.push({
        priority: 'medium',
        icon: '🔔',
        title: '处理未读通知',
        description: `有 ${unread.length} 条未读变更通知，可能包含重要信息`,
        action: 'speccore notify',
      });
    }
  } catch { /* 忽略 */ }

  // 3. 检查活跃锁
  try {
    const lock = await checkLock(cwd, 'iteration');
    if (lock) {
      recommendations.push({
        priority: 'high',
        icon: '🔒',
        title: '迭代被锁定',
        description: `迭代被 ${lock.holder} 锁定（任务: ${lock.task || 'unknown'}），可能阻塞其他操作`,
        action: 'speccore status 查看详情，或联系锁持有者',
      });
    }
  } catch { /* 忽略 */ }

  // 4. 检查需求↔代码关联
  try {
    const linkPath = join(cwd, '.speccore', 'code-graph', 'REQ_CODE_LINK.json');
    if (!(await pathExists(linkPath))) {
      recommendations.push({
        priority: 'low',
        icon: '🔗',
        title: '建立需求↔代码关联',
        description: '需求与代码的关联映射尚未生成',
        action: '在代码图谱构建后，调用 linkRequirementsToCode()',
      });
    }
  } catch { /* 忽略 */ }

  // 5. 检查 CONSTITUTION.md 更新
  try {
    const constPath = join(cwd, '.speccore', 'CONSTITUTION.md');
    if (await pathExists(constPath)) {
      const s = await stat(constPath);
      const daysOld = (Date.now() - s.mtime.getTime()) / (24 * 60 * 60 * 1000);
      if (daysOld > 30) {
        recommendations.push({
          priority: 'low',
          icon: '📜',
          title: '更新项目宪法',
          description: `CONSTITUTION.md 已 ${Math.round(daysOld)} 天未更新，建议 review 技术栈和端列表`,
          action: 'review .speccore/CONSTITUTION.md',
        });
      }
    }
  } catch { /* 忽略 */ }

  // 6. 使用模式推荐
  try {
    const report = await generateUsageReport(cwd, 7);
    for (const rec of report.recommendations.slice(0, 2)) {
      if (rec.includes('code-index')) {
        // 已在上面的图谱检查中覆盖
        continue;
      }
      recommendations.push({
        priority: 'medium',
        icon: '📊',
        title: '使用模式建议',
        description: rec,
        action: 'speccore recommend --analytics 查看详细报告',
      });
    }
  } catch { /* 忽略 */ }

  // 按优先级排序
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}

/**
 * 打印推荐列表
 */
export function printRecommendations(recommendations: Recommendation[]): void {
  if (recommendations.length === 0) {
    logger.info('✅ 暂无待处理建议，项目状态良好');
    return;
  }

  logger.info('');
  logger.info(`💡 智能推荐 (${recommendations.length} 条)`);
  logger.info('');

  for (const rec of recommendations) {
    const priorityLabel = rec.priority === 'high' ? '【高】' : rec.priority === 'medium' ? '【中】' : '【低】';
    logger.info(`${rec.icon} ${priorityLabel} ${rec.title}`);
    logger.info(`   ${rec.description}`);
    logger.info(`   👉 ${rec.action}`);
    logger.info('');
  }
}
