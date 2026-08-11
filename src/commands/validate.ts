import { validateProject, formatValidationResult, autoFix } from '../core/validator';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, getHotfixStatus } from '../core/context';
import { resolveTask, formatResolveResult } from '../core/resolver';

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

    // 使用统一 resolver 解析任务名（支持短名、关键词、前缀匹配）
    let resolvedTaskId: string | undefined = options.task || undefined;
    if (options.task && iteration) {
      const taskResult = await resolveTask(options.task, iteration);
      if (taskResult.exact && taskResult.value) {
        if (taskResult.matchType !== 'exact') {
          const hint = formatResolveResult(taskResult, 'Task');
          if (hint) logger.info(hint);
        }
        resolvedTaskId = taskResult.value.id;
      } else if (taskResult.candidates.length > 1) {
        spinner.stop('验证取消');
        logger.warn(taskResult.hint || '找到多个匹配任务，请指定更精确的名称');
        return;
      } else {
        spinner.stop('验证取消');
        logger.warn(taskResult.hint || `Task 未找到: ${options.task}`);
        return;
      }
    }

    const result = await validateProject(
      iteration || undefined,
      resolvedTaskId,
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
