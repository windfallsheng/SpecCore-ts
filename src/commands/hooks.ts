/**
 * hooks — Git Hook 安装
 */

import { logger } from '../utils/logger';
import { installGitHooks } from '../core/git-integration';

export function hooksCommand(): void {
  try {
    const result = installGitHooks();
    logger.success('Git hooks installed:');
    if (result.preCommit) logger.info('  ✅ .git/hooks/pre-commit  (check @spec annotations)');
    if (result.prePush) logger.info('  ✅ .git/hooks/pre-push    (run speccore validate)');
  } catch (error) {
    logger.error(`Failed to install Git hooks: ${error}`);
  }
}
