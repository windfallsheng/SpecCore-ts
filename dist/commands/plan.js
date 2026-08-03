"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planCommand = planCommand;
const path_1 = require("path");
const logger_1 = require("../utils/logger");
const context_1 = require("../core/context");
const state_1 = require("../core/state");
const transaction_1 = require("../core/transaction");
const plan_store_1 = require("../core/plan-store");
const readline_1 = require("readline");
function promptUser(question) {
    const rl = (0, readline_1.createInterface)({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(`${question} `, answer => { rl.close(); resolve(answer.trim()); });
    });
}
async function planCommand(options) {
    if (options.list) {
        await showPlanHistory();
        return;
    }
    if (options.show) {
        await showPlanDetail(options.show);
        return;
    }
    if (options.delete) {
        await removePlan(options.delete);
        return;
    }
    if (options.cancel) {
        await doCancelPlan(options.cancel);
        return;
    }
    const spinner = new logger_1.Spinner('Generating execution plan');
    spinner.start();
    try {
        const iteration = await (0, context_1.getDefaultIteration)(options.iteration);
        if (!iteration) {
            spinner.fail('No active iteration found.');
            return;
        }
        const graph = await (0, state_1.readProjectGraph)(iteration);
        const tasks = graph.tasks.length > 0 ? graph.tasks : await (0, state_1.scanTasks)(iteration);
        if (tasks.length === 0) {
            spinner.fail('No tasks found');
            return;
        }
        let filteredTasks = tasks;
        if (options.type)
            filteredTasks = filteredTasks.filter(t => t.type === options.type);
        if (options.priority)
            filteredTasks = filteredTasks.filter(t => t.priority === options.priority);
        const sortedTasks = (0, state_1.topologicalSort)(filteredTasks);
        const plan = generatePlan(sortedTasks, parseInt(options.team || '1', 10), options.mode || 'auto');
        const taskIds = sortedTasks.map(t => t.id);
        if (options.dryRun) {
            spinner.stop('Dry run');
            printPlan(plan, iteration);
            return;
        }
        if (options.interactive) {
            spinner.stop('执行计划预览');
            logger_1.logger.info('');
            printPlan(plan, iteration);
            logger_1.logger.info(`共 ${taskIds.length} 个任务，${plan.length} 个阶段`);
            const answer = await promptUser('\n[y] 确认保存  [q] 取消: ');
            if (answer !== 'y') {
                logger_1.logger.info('已取消');
                return;
            }
        }
        const saved = await saveToStore(iteration, taskIds, 3, options, 'manual');
        const planPath = (0, path_1.join)(`期次-${iteration}`, '00-期次总览', 'PLAN.md');
        const tx = new transaction_1.FileTransaction();
        tx.write(planPath, formatPlanMarkdown(plan, iteration));
        await tx.commit();
        spinner.stop(`Saved: ${saved.id.slice(0, 12)} | ${taskIds.length} tasks, ${plan.length} phases`);
        printPlan(plan, iteration);
    }
    catch (error) {
        spinner.fail(`Failed: ${error}`);
        throw error;
    }
}
async function saveToStore(iteration, taskIds, batchSize, options, source) {
    return (0, plan_store_1.savePlan)({
        name: `Plan-${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        iteration, tasks: taskIds, batchSize, source,
        filters: { assignee: options.assign, type: options.type, priority: options.priority },
    });
}
async function showPlanHistory() {
    const plans = await (0, plan_store_1.listPlans)(undefined, 20);
    if (plans.length === 0) {
        logger_1.logger.info('No plans yet.');
        return;
    }
    logger_1.logger.info(`\nPlans (${plans.length}):\n`);
    for (const p of plans) {
        const src = { manual: 'manual', auto: 'auto', schedule: 'sched' }[p.source];
        const icon = p.status === 'completed' ? '✅' : p.status === 'cancelled' ? '🚫' : '⏳';
        logger_1.logger.info(`  ${icon} ${p.id.slice(0, 12)}  ${p.name}  [${src}]`);
        logger_1.logger.info(`     iter: ${p.iteration}  tasks: ${p.tasks.length}  batch: ${p.batchSize}  status: ${p.status}`);
        logger_1.logger.info(`     created: ${new Date(p.createdAt).toLocaleString()}`);
        if (p.executedAt)
            logger_1.logger.info(`     done: ${new Date(p.executedAt).toLocaleString()}`);
        logger_1.logger.info('');
    }
    logger_1.logger.info('speccore plan --show <id>  |  --cancel <id>  |  --delete <id>');
}
async function showPlanDetail(id) {
    const p = await (0, plan_store_1.getPlan)(id);
    if (!p) {
        logger_1.logger.error('Not found');
        return;
    }
    logger_1.logger.info(`\n${p.name}`);
    logger_1.logger.info(`  ID:       ${p.id}`);
    logger_1.logger.info(`  Source:   ${p.source}  |  Status: ${p.status}`);
    logger_1.logger.info(`  Iter:     ${p.iteration}  |  Batch: ${p.batchSize}`);
    logger_1.logger.info(`  Created:  ${new Date(p.createdAt).toLocaleString()}`);
    if (p.executedAt)
        logger_1.logger.info(`  Done:     ${new Date(p.executedAt).toLocaleString()}`);
    logger_1.logger.info(`\n  Tasks (${p.tasks.length}):`);
    for (let i = 0; i < p.tasks.length; i += p.batchSize) {
        logger_1.logger.info(`    batch ${Math.floor(i / p.batchSize) + 1}: ${p.tasks.slice(i, i + p.batchSize).join(', ')}`);
    }
    logger_1.logger.info('');
}
async function removePlan(id) {
    const ok = await (0, plan_store_1.deletePlan)(id);
    logger_1.logger.info(ok ? 'Deleted.' : 'Not found.');
}
async function doCancelPlan(id) {
    const ok = await (0, plan_store_1.cancelPlan)(id);
    logger_1.logger.info(ok ? 'Cancelled (status retained).' : 'Not found.');
}
function generatePlan(tasks, teamSize, mode) {
    if (mode === 'claim')
        return [{ phase: 1, tasks: tasks.map(t => t.id), assignees: [], estimatedDuration: tasks.length * 2 }];
    const phases = [];
    const pc = Math.min(teamSize, tasks.length);
    for (let i = 0; i < tasks.length; i += pc) {
        phases.push({ phase: phases.length + 1, tasks: tasks.slice(i, i + pc).map(t => t.id), assignees: tasks.slice(i, i + pc).map(t => t.assignee || 'TBD'), estimatedDuration: 2 });
    }
    return phases;
}
function printPlan(plan, iteration) {
    logger_1.logger.info(`\nPlan: ${iteration}\n`);
    for (const phase of plan) {
        logger_1.logger.info(`Phase ${phase.phase}:`);
        for (let i = 0; i < phase.tasks.length; i++)
            logger_1.logger.info(`  ${phase.tasks[i]} -> ${phase.assignees[i] || 'TBD'}`);
        logger_1.logger.info('');
    }
}
function formatPlanMarkdown(plan, iteration) {
    const lines = [`# Plan - ${iteration}`, '', `> ${new Date().toISOString()}`, ''];
    for (const phase of plan) {
        lines.push(`## Phase ${phase.phase}`, '', '| Task | Assignee | Est. |', '| :--- | :--- | :--- |');
        for (let i = 0; i < phase.tasks.length; i++)
            lines.push(`| ${phase.tasks[i]} | ${phase.assignees[i] || 'TBD'} | 2h |`);
        lines.push('');
    }
    return lines.join('\n');
}
//# sourceMappingURL=plan.js.map