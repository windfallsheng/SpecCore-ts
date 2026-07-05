import { validateProject, formatValidationResult, autoFix } from '../core/validator';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';

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
