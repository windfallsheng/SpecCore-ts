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
        // Hotfix check: warn if hotfix is active
        await checkHotfix();
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
async function checkHotfix() {
    const hotfix = await (0, context_1.getHotfixStatus)();
    if (!hotfix)
        return;
    if (hotfix.mandatoryExpired) {
        logger_1.logger.error(`🚨 热修复 "${hotfix.taskId}" 补录超时（超过 24 小时）！`);
        logger_1.logger.error('  请立即运行: speccore sync --reverse');
        throw new Error('Hotfix sync deadline exceeded. Run speccore sync --reverse first.');
    }
    if (hotfix.graceExpired) {
        logger_1.logger.warn(`⚠️  热修复宽限期已过 "${hotfix.taskId}"，请在 24 小时内完成反向同步`);
        logger_1.logger.warn('  运行: speccore sync --reverse');
    }
    else {
        logger_1.logger.info(`⚠️  检测到热修复模式: ${hotfix.taskId}`);
        logger_1.logger.info('  宽限期内（剩余 < 30 min），允许跳过反向同步');
    }
}
//# sourceMappingURL=validate.js.map