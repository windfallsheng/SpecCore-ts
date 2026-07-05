"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCommand = validateCommand;
const validator_1 = require("../core/validator");
const logger_1 = require("../utils/logger");
const context_1 = require("../core/context");
async function validateCommand(options) {
    const spinner = new logger_1.Spinner('Validating Spec compliance');
    spinner.start();
    try {
        const iteration = await (0, context_1.getDefaultIteration)(options.iteration);
        const result = await (0, validator_1.validateProject)(iteration || undefined, options.task || undefined, {
            fix: options.fix,
            strict: options.strict
        });
        spinner.stop('Validation complete');
        // Auto-fix if requested
        if (options.fix) {
            const fixedCount = await (0, validator_1.autoFix)(result);
            if (fixedCount > 0) {
                logger_1.logger.info(`Auto-fixed ${fixedCount} issues`);
            }
        }
        // Output results
        const output = (0, validator_1.formatValidationResult)(result, (options.format || 'text'));
        console.log(output);
        // Exit with error code if validation failed
        if (result.errors.length > 0) {
            process.exitCode = 1;
        }
    }
    catch (error) {
        spinner.fail(`Validation failed: ${error}`);
        throw error;
    }
}
//# sourceMappingURL=validate.js.map