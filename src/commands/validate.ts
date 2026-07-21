import { validateProject, formatValidationResult, autoFix } from '../core/validator';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, getHotfixStatus } from '../core/context';

export interface ValidateOptions {
  iteration?: string;
  task?: string;
  type?: string;
  fix?: boolean;
  strict?: boolean;
  format?: string;
}

export async function validateCommand(options: ValidateOptions): Promise<void> {
  const spinner = new Spinner('Validating Spec compliance');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);

    // Hotfix check: warn if hotfix is active
    await checkHotfix();

    const result = await validateProject(
      iteration || undefined,
      options.task || undefined,
      {
        fix: options.fix,
        strict: options.strict
      }
    );

    spinner.stop('Validation complete');

    // Auto-fix if requested
    if (options.fix) {
      const fixedCount = await autoFix(result);
      if (fixedCount > 0) {
        logger.info(`Auto-fixed ${fixedCount} issues`);
      }
    }

    // Output results
    const output = formatValidationResult(
      result,
      (options.format || 'text') as 'text' | 'json'
    );
    console.log(output);

    // Exit with error code if validation failed
    if (result.errors.length > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    spinner.fail(`Validation failed: ${error}`);
    throw error;
  }
}

async function checkHotfix(): Promise<void> {
  const hotfix = await getHotfixStatus();
  if (!hotfix) return;

  if (hotfix.mandatoryExpired) {
    logger.error(`🚨 热修复 "${hotfix.taskId}" 补录超时（超过 24 小时）！`);
    logger.error('  请立即运行: speccore sync --reverse');
    throw new Error('Hotfix sync deadline exceeded. Run speccore sync --reverse first.');
  }

  if (hotfix.graceExpired) {
    logger.warn(`⚠️  热修复宽限期已过 "${hotfix.taskId}"，请在 24 小时内完成反向同步`);
    logger.warn('  运行: speccore sync --reverse');
  } else {
    logger.info(`⚠️  检测到热修复模式: ${hotfix.taskId}`);
    logger.info('  宽限期内（剩余 < 30 min），允许跳过反向同步');
  }
}
