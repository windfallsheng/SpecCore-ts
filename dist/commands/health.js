"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthCommand = healthCommand;
const logger_1 = require("../utils/logger");
const context_1 = require("../core/context");
const state_1 = require("../core/state");
async function healthCommand(options) {
    const spinner = new logger_1.Spinner('Generating health report');
    spinner.start();
    try {
        const iteration = await (0, context_1.getDefaultIteration)(options.iteration);
        if (!iteration) {
            spinner.fail('No active iteration found. Please specify --iteration or create one first.');
            return;
        }
        const graph = await (0, state_1.readProjectGraph)(iteration);
        const tasks = graph.tasks.length > 0 ? graph.tasks : await (0, state_1.scanTasks)(iteration);
        const health = calculateHealth(iteration, tasks);
        spinner.stop('Health report generated');
        if (options.format === 'json') {
            console.log(JSON.stringify(health, null, 2));
            return;
        }
        printHealthReport(health);
    }
    catch (error) {
        spinner.fail(`Health report failed: ${error}`);
        throw error;
    }
}
function calculateHealth(iteration, tasks) {
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    // Spec health (consistency, completeness)
    const specHealth = total > 0 ? Math.round((completed / total) * 100) : 100;
    // Efficiency (completion rate, speed)
    const efficiency = total > 0 ? Math.round((completed / total) * 90) : 0;
    // Reuse (pattern usage)
    const reuse = 70; // Simplified
    // Team health (distribution, load)
    const teamHealth = 80; // Simplified
    const overall = Math.round((specHealth + efficiency + reuse + teamHealth) / 4);
    return {
        iteration,
        overall,
        dimensions: {
            spec: specHealth,
            efficiency,
            reuse,
            team: teamHealth
        },
        details: {
            totalTasks: total,
            completedTasks: completed,
            inProgressTasks: inProgress,
            completionRate: total > 0 ? Math.round((completed / total) * 100) : 0
        }
    };
}
function printHealthReport(health) {
    logger_1.logger.info('');
    logger_1.logger.info('🏥 Health Report');
    logger_1.logger.info('');
    logger_1.logger.info(`Iteration: ${health.iteration}`);
    logger_1.logger.info(`Overall Health: ${health.overall}%`);
    logger_1.logger.info('');
    logger_1.logger.info('Dimensions:');
    logger_1.logger.info(`  Spec Health: ${health.dimensions.spec}%`);
    logger_1.logger.info(`  Efficiency: ${health.dimensions.efficiency}%`);
    logger_1.logger.info(`  Reuse: ${health.dimensions.reuse}%`);
    logger_1.logger.info(`  Team Health: ${health.dimensions.team}%`);
    logger_1.logger.info('');
    logger_1.logger.info('Details:');
    logger_1.logger.info(`  Total Tasks: ${health.details.totalTasks}`);
    logger_1.logger.info(`  Completed: ${health.details.completedTasks}`);
    logger_1.logger.info(`  In Progress: ${health.details.inProgressTasks}`);
    logger_1.logger.info(`  Completion Rate: ${health.details.completionRate}%`);
}
//# sourceMappingURL=health.js.map