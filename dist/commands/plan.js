"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planCommand = planCommand;
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
const logger_1 = require("../utils/logger");
const context_1 = require("../core/context");
const state_1 = require("../core/state");
async function planCommand(options) {
    const spinner = new logger_1.Spinner('Generating execution plan');
    spinner.start();
    try {
        const iteration = await (0, context_1.getDefaultIteration)(options.iteration);
        if (!iteration) {
            spinner.fail('No active iteration found. Please specify --iteration or create one first.');
            return;
        }
        // Read project graph
        const graph = await (0, state_1.readProjectGraph)(iteration);
        const tasks = graph.tasks.length > 0 ? graph.tasks : await (0, state_1.scanTasks)(iteration);
        if (tasks.length === 0) {
            spinner.fail('No tasks found in iteration');
            return;
        }
        // Apply filters
        let filteredTasks = tasks;
        if (options.type) {
            filteredTasks = filteredTasks.filter(t => t.type === options.type);
        }
        if (options.priority) {
            filteredTasks = filteredTasks.filter(t => t.priority === options.priority);
        }
        if (options.task) {
            filteredTasks = filteredTasks.filter(t => t.id === options.task);
        }
        // Sort by dependencies
        const sortedTasks = (0, state_1.topologicalSort)(filteredTasks);
        // Calculate team assignments
        const teamSize = parseInt(options.team || '3', 10);
        const assignees = options.assign ? options.assign.split(',') : [];
        if (assignees.length > 0) {
            // Assign tasks to specified members
            let index = 0;
            for (const task of sortedTasks) {
                task.assignee = assignees[index % assignees.length].trim();
                index++;
            }
        }
        // Generate plan
        const plan = generatePlan(sortedTasks, teamSize, options.mode || 'auto');
        if (options.dryRun) {
            spinner.stop('Dry run complete');
            printPlan(plan, iteration);
            return;
        }
        // Save plan to file
        const planPath = (0, path_1.join)(`期次-${iteration}`, '00-期次总览', 'PLAN.md');
        await (0, fs_extra_1.writeFile)(planPath, formatPlanMarkdown(plan, iteration));
        spinner.stop(`Execution plan generated: ${planPath}`);
        printPlan(plan, iteration);
    }
    catch (error) {
        spinner.fail(`Plan generation failed: ${error}`);
        throw error;
    }
}
function generatePlan(tasks, teamSize, mode) {
    const phases = [];
    if (mode === 'claim') {
        // Generate claimable list
        return [{
                phase: 1,
                tasks: tasks.map(t => t.id),
                assignees: [],
                estimatedDuration: tasks.length * 2
            }];
    }
    // Simple parallel scheduling
    const parallelCount = Math.min(teamSize, tasks.length);
    let currentPhase = 1;
    let index = 0;
    while (index < tasks.length) {
        const phaseTasks = tasks.slice(index, index + parallelCount);
        phases.push({
            phase: currentPhase,
            tasks: phaseTasks.map(t => t.id),
            assignees: phaseTasks.map(t => t.assignee || 'TBD'),
            estimatedDuration: 2
        });
        index += parallelCount;
        currentPhase++;
    }
    return phases;
}
function printPlan(plan, iteration) {
    logger_1.logger.info('');
    logger_1.logger.info(`Execution Plan for: ${iteration}`);
    logger_1.logger.info('');
    for (const phase of plan) {
        logger_1.logger.info(`Phase ${phase.phase}:`);
        for (let i = 0; i < phase.tasks.length; i++) {
            logger_1.logger.info(`  ${phase.tasks[i]} -> ${phase.assignees[i] || 'TBD'}`);
        }
        logger_1.logger.info(`  Estimated: ${phase.estimatedDuration}h`);
        logger_1.logger.info('');
    }
}
function formatPlanMarkdown(plan, iteration) {
    const lines = [];
    lines.push(`# 执行计划 - ${iteration}`);
    lines.push('');
    lines.push(`> 生成时间: ${new Date().toISOString()}`);
    lines.push('');
    for (const phase of plan) {
        lines.push(`## 阶段 ${phase.phase}`);
        lines.push('');
        lines.push('| 任务 | 负责人 | 预计耗时 |');
        lines.push('| :--- | :--- | :--- |');
        for (let i = 0; i < phase.tasks.length; i++) {
            lines.push(`| ${phase.tasks[i]} | ${phase.assignees[i] || 'TBD'} | 2h |`);
        }
        lines.push('');
    }
    return lines.join('\n');
}
//# sourceMappingURL=plan.js.map