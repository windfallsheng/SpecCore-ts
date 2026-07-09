"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeCommand = executeCommand;
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
const logger_1 = require("../utils/logger");
const context_1 = require("../core/context");
const state_1 = require("../core/state");
async function executeCommand(options) {
    const spinner = new logger_1.Spinner('Preparing execution');
    spinner.start();
    try {
        const iteration = await (0, context_1.getDefaultIteration)(options.iteration);
        if (!iteration) {
            spinner.fail('No active iteration found. Please specify --iteration or create one first.');
            return;
        }
        const assignee = await (0, context_1.getDefaultAssignee)(options.assignee);
        // Scan tasks
        let tasks = await (0, state_1.scanTasks)(iteration);
        if (tasks.length === 0) {
            spinner.fail('No tasks found in iteration');
            return;
        }
        // Apply filters
        if (options.task) {
            tasks = tasks.filter(t => t.id === options.task);
        }
        if (options.type) {
            tasks = tasks.filter(t => t.type === options.type);
        }
        if (options.priority) {
            tasks = tasks.filter(t => t.priority === options.priority);
        }
        if (options.status) {
            tasks = tasks.filter(t => t.status === options.status);
        }
        if (options.assignee) {
            tasks = tasks.filter(t => t.assignee === options.assignee);
        }
        if (options.backend) {
            tasks = tasks.filter(t => t.id.includes('backend'));
        }
        if (options.frontend) {
            tasks = tasks.filter(t => t.id.includes('frontend'));
        }
        if (options.platform) {
            tasks = await filterByPlatform(tasks, iteration, options.platform);
        }
        if (tasks.length === 0) {
            spinner.fail('No tasks match the specified filters');
            return;
        }
        // Sort by dependencies
        const sortedTasks = (0, state_1.topologicalSort)(tasks);
        // Preview execution plan
        if (!options.force && !options.dryRun) {
            spinner.stop('Execution preview');
            printExecutionPreview(sortedTasks, iteration);
            // In real implementation, this would prompt for confirmation
            logger_1.logger.info('Use --force to skip preview');
            return;
        }
        if (options.dryRun) {
            spinner.stop('Dry run complete');
            printExecutionPreview(sortedTasks, iteration);
            return;
        }
        // Execute tasks
        spinner.stop('Starting execution');
        const progressBar = new logger_1.ProgressBar(sortedTasks.length);
        for (let i = 0; i < sortedTasks.length; i++) {
            const task = sortedTasks[i];
            logger_1.logger.info(`Executing ${task.id}...`);
            // In real implementation, this would call AI or generate code
            // For now, just simulate execution
            await simulateTaskExecution(task, iteration);
            progressBar.update(i + 1);
        }
        // Update context
        await (0, context_1.updateContext)({
            currentTask: sortedTasks[sortedTasks.length - 1]?.id || '',
            currentIteration: iteration,
            lastUpdated: new Date().toISOString()
        });
        await (0, context_1.recordHistory)('execute', iteration, sortedTasks[sortedTasks.length - 1]?.id);
        logger_1.logger.success('Execution complete!');
    }
    catch (error) {
        spinner.fail(`Execution failed: ${error}`);
        throw error;
    }
}
function printExecutionPreview(tasks, iteration) {
    logger_1.logger.info('');
    logger_1.logger.info('📋 Execution Preview');
    logger_1.logger.info('');
    logger_1.logger.info(`Iteration: ${iteration}`);
    logger_1.logger.info(`Tasks to execute: ${tasks.length}`);
    logger_1.logger.info('');
    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        const status = i === 0 ? '🔄' : '⏳';
        logger_1.logger.info(`${status} ${task.id} - ${task.name}`);
    }
    logger_1.logger.info('');
    logger_1.logger.info('Estimated total duration: 3-5 minutes');
}
async function simulateTaskExecution(task, iteration) {
    // Simulate task execution
    // In real implementation, this would:
    // 1. Read task spec files
    // 2. Call AI to generate code
    // 3. Write generated code to files
    // 4. Update task status
    const taskDir = (0, path_1.join)(`期次-${iteration}`, task.id);
    // Check if task directory exists
    if (await (0, fs_extra_1.pathExists)(taskDir)) {
        // Update task status in TASK.md
        const taskMdPath = (0, path_1.join)(taskDir, 'backend', 'TASK.md');
        if (await (0, fs_extra_1.pathExists)(taskMdPath)) {
            const content = await (0, fs_extra_1.readFile)(taskMdPath, 'utf-8');
            const updated = content.replace('状态: 🔲 待开发', '状态: 🔄 进行中');
            await require('fs-extra').writeFile(taskMdPath, updated);
        }
    }
    // Simulate work time
    await new Promise(resolve => setTimeout(resolve, 100));
}
/**
 * 按前端平台过滤任务：检查是否存在 frontend/{platform}/ 目录
 */
async function filterByPlatform(tasks, iteration, platform) {
    const filtered = [];
    const iterDir = (0, path_1.join)(process.cwd(), `期次-${iteration}`);
    for (const task of tasks) {
        const taskPath = (0, path_1.join)(iterDir, task.id);
        const platformDir = (0, path_1.join)(taskPath, 'frontend', platform);
        if (await (0, fs_extra_1.pathExists)(platformDir)) {
            filtered.push(task);
        }
    }
    return filtered;
}
//# sourceMappingURL=execute.js.map