"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.progressCommand = progressCommand;
const logger_1 = require("../utils/logger");
const context_1 = require("../core/context");
;
const state_1 = require("../core/state");
async function progressCommand(options) {
    const spinner = new logger_1.Spinner('Loading progress');
    spinner.start();
    try {
        const iteration = await (0, context_1.getDefaultIteration)(options.iteration);
        if (!iteration) {
            spinner.fail('No active iteration found. Please specify --iteration or create one first.');
            return;
        }
        const graph = await (0, state_1.readProjectGraph)(iteration);
        const tasks = graph.tasks.length > 0 ? graph.tasks : await (0, state_1.scanTasks)(iteration);
        if (options.task) {
            const task = tasks.find(t => t.id === options.task);
            if (!task) {
                spinner.fail(`Task not found: ${options.task}`);
                return;
            }
            printTaskProgress(task);
            return;
        }
        spinner.stop('Progress loaded');
        printProgress(iteration, tasks, options);
        await printHotfixStatus();
    }
    catch (error) {
        spinner.fail(`Progress loading failed: ${error}`);
        throw error;
    }
}
function printProgress(iteration, tasks, options) {
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const pending = tasks.filter(t => t.status === 'pending').length;
    const archived = tasks.filter(t => t.status === 'archived').length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    if (options.format === 'json') {
        console.log(JSON.stringify({
            iteration,
            total,
            completed,
            inProgress,
            pending,
            archived,
            completionRate,
            platform: options.platform || null,
        }, null, 2));
        return;
    }
    logger_1.logger.info('');
    logger_1.logger.info(`📊 Progress Report: ${iteration}${options.platform ? ` (${options.platform})` : ''}`);
    logger_1.logger.info('');
    logger_1.logger.info(`Total: ${total} | Completed: ${completed} | In Progress: ${inProgress} | Pending: ${pending} | Archived: ${archived}`);
    logger_1.logger.info(`Completion Rate: ${completionRate}%`);
    logger_1.logger.info('');
    // Progress bar
    const width = 40;
    const filled = Math.round(width * (completionRate / 100));
    const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
    logger_1.logger.info(`[${bar}] ${completionRate}%`);
    logger_1.logger.info('');
    if (options.detail) {
        const headers = ['Task', 'Type', 'Status', 'Progress', 'Assignee'];
        const rows = tasks.map(t => [
            t.id,
            t.type,
            t.status,
            `${t.progress}%`,
            t.assignee || 'Unassigned'
        ]);
        console.log((0, logger_1.formatTable)(headers, rows));
    }
}
function printTaskProgress(task) {
    logger_1.logger.info('');
    logger_1.logger.info(`📋 Task: ${task.id} - ${task.name}`);
    logger_1.logger.info(`  Type: ${task.type}`);
    logger_1.logger.info(`  Status: ${task.status}`);
    logger_1.logger.info(`  Progress: ${task.progress}%`);
    logger_1.logger.info(`  Assignee: ${task.assignee || 'Unassigned'}`);
    if (task.dependencies.length > 0) {
        logger_1.logger.info(`  Dependencies: ${task.dependencies.join(', ')}`);
    }
}
async function printHotfixStatus() {
    const hotfix = await (0, context_1.getHotfixStatus)();
    if (!hotfix)
        return;
    logger_1.logger.warn('⚠️  Hotfix: ' + hotfix.taskId);
    if (hotfix.mandatoryExpired) {
        logger_1.logger.error('🚨 已超 24h！立即运行: speccore sync --reverse');
    }
    else if (hotfix.graceExpired) {
        logger_1.logger.warn('   宽限期已过，运行: speccore sync --reverse');
    }
    else {
        logger_1.logger.info('   宽限期内，可跳过反向同步');
    }
}
//# sourceMappingURL=progress.js.map