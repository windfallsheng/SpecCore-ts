/**
 * tracker — 查看全量需求追踪报告
 */
import { writeFile } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import { loadTracker, generateTrackerReport } from '../core/requirement-tracker';

export async function trackerCommand(): Promise<void> {
  const entries = await loadTracker();
  
  if (entries.length === 0) {
    logger.info('\n  📭 尚无需求追踪记录');
    logger.info('  💡 运行 speccore analyze 后自动记录');
    return;
  }

  const report = await generateTrackerReport();
  
  // Write to global layer
  await writeFile('.speccore/GLOBAL/REQUIREMENTS/TRACKER.md', report);
  
  logger.info(`\n📊 全量需求追踪 (${entries.length} 项):\n`);
  
  for (const e of entries) {
    const icon = e.status === 'active' ? '🟢' : e.status === 'modified' ? '🟡' : '⚫';
    const modified = e.lastModifiedIteration ? ` → ${e.lastModifiedIteration}` : '';
    logger.info(`  ${icon} ${e.id} | ${e.title} | ${e.originIteration}${modified} | ${e.changeHistory.length} 次变更`);
  }

  logger.info(`\n  📄 完整报告: .speccore/GLOBAL/REQUIREMENTS/TRACKER.md`);
}
