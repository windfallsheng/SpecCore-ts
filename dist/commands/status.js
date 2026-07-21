"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.statusCommand = statusCommand;
const logger_1 = require("../utils/logger");
const context_1 = require("../core/context");
;
const state_1 = require("../core/state");
async function statusCommand(options) {
    const spinner = new logger_1.Spinner('Checking status');
    spinner.start();
    try {
        const iteration = await (0, context_1.getDefaultIteration)(options.iteration);
        if (!iteration) {
            spinner.fail('No active iteration found. Please specify --iteration or create one first.');
            return;
        }
        const graph = await (0, state_1.readProjectGraph)(iteration);
        const tasks = graph.tasks.length > 0 ? graph.tasks : await (0, state_1.scanTasks)(iteration);
        spinner.stop('Status loaded');
        printStatus(iteration, tasks, options);
    }
    catch (error) {
        spinner.fail(`Status check failed: ${error}`);
        throw error;
    }
}
function printStatus(iteration, tasks, options) {
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const pending = tasks.filter(t => t.status === 'pending').length;
    logger_1.logger.info('');
    logger_1.logger.info(`📊 Status: ${iteration}`);
    logger_1.logger.info('');
    logger_1.logger.info(`Total Tasks: ${total}`);
    logger_1.logger.info(`✅ Completed: ${completed}`);
    logger_1.logger.info(`🔄 In Progress: ${inProgress}`);
    logger_1.logger.info(`🔲 Pending: ${pending}`);
    logger_1.logger.info('');
    if (options.assignee) {
        const filtered = tasks.filter(t => t.assignee === options.assignee);
        logger_1.logger.info(`Tasks assigned to ${options.assignee}: ${filtered.length}`);
    }
    if (options.type) {
        const filtered = tasks.filter(t => t.type === options.type);
        logger_1.logger.info(`${options.type} tasks: ${filtered.length}`);
    }
}
//# sourceMappingURL=status.js.map