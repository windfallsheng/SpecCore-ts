/**
 * current — 查看当前 Git 分支关联的任务
 */

import { logger } from '../utils/logger';
import { getCurrentTaskMapping, generateCommitMessage, generatePRDescription } from '../core/git-integration';

export interface CurrentOptions {
  commit?: boolean;
  pr?: boolean;
}

export function currentCommand(options: CurrentOptions): void {
  const mapping = getCurrentTaskMapping();

  if (!mapping) {
    logger.info('🔗 No task associated with current branch.');
    logger.info('   Use "speccore execute --task=Task-001" to create an associated branch.');
    return;
  }

  logger.info('');
  logger.info(`🔗 Current branch: ${require('child_process').execSync('git branch --show-current', { encoding: 'utf-8', stdio: 'pipe' }).trim()}`);
  logger.info(`📋 Task: ${mapping.taskId} ${mapping.taskName}`);
  logger.info('');

  if (options.commit) {
    logger.info('📝 Generated Commit Message:');
    logger.info('---');
    console.log(generateCommitMessage(mapping.taskId, mapping.taskName));
    logger.info('---');
  }

  if (options.pr) {
    logger.info('📝 Generated PR Description:');
    logger.info('---');
    console.log(generatePRDescription(mapping.taskId, mapping.taskName));
    logger.info('---');
  }
}
