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
    // ── 历史模式 ──
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
    // ── 创建模式 ──
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
        if (options.task)
            filteredTasks = filteredTasks.filter(t => t.id === options.task);
        const sortedTasks = (0, state_1.topologicalSort)(filteredTasks);
        const plan = generatePlan(sortedTasks, parseInt(options.team || '1', 10), options.mode || 'auto');
        if (options.dryRun) {
            spinner.stop('Dry run');
            printPlan(plan, iteration);
            return;
        }
        const taskIds = sortedTasks.map(t => t.id);
        // ── Interactive mode ──
        if (options.interactive) {
            spinner.stop('执行计划预览');
            logger_1.logger.info('');
            printPlan(plan, iteration);
            logger_1.logger.info(`\n共 ${taskIds.length} 个任务，${plan.length} 个阶段`);
            logger_1.logger.info('💡 [y] 确认  [a] 调整后保存  [q] 取消');
            const answer = await promptUser('\n确认？');
            if (answer === 'q') {
                logger_1.logger.info('已取消');
                return;
            }
            if (answer === 'a') {
                const batchStr = await promptUser('每批数量 (默认3): ');
                logger_1.logger.info('已调整，重新运行 speccore plan --interactive 或直接确认');
                if (batchStr)
                    await saveToStore(iteration, taskIds, parseInt(batchStr, 10), options, 'manual');
            }
        }
        // 保存到 plan-store
        await saveToStore(iteration, taskIds, 3, options, 'manual');
        // 保存到文件
        const planPath = (0, path_1.join)(`期次-${iteration}`, '00-期次总览', 'PLAN.md');
        const tx = new transaction_1.FileTransaction();
        tx.write(planPath, formatPlanMarkdown(plan, iteration));
        await tx.commit();
        spinner.stop(`✅ 已保存: ${taskIds.length} 个任务, ${plan.length} 阶段`);
        printPlan(plan, iteration);
    }
    catch (error) {
        spinner.fail(`Failed: ${error}`);
        throw error;
    }
}
async function saveToStore(iteration, taskIds, batchSize, options, source) {
    return (0, plan_store_1.savePlan)({
        name: `Plan-${iteration}-${new Date().toISOString().slice(0, 10)}`,
        iteration,
        tasks: taskIds,
        batchSize,
        source,
        filters: {
            assignee: options.assign,
            type: options.type,
            priority: options.priority,
        },
    });
}
// ── 历史查看 ──
async function showPlanHistory() {
    const plans = await (0, plan_store_1.listPlans)(undefined, 20);
    if (plans.length === 0) {
        logger_1.logger.info('暂无计划');
        return;
    }
    logger_1.logger.info(`\n📋 共 ${plans.length} 个计划:\n`);
    for (const p of plans) {
        const src = { manual: '🙋 手动', auto: '🤖 自动', schedule: '⏰ 调度' }[p.source];
        const done = p.executedAt ? '✅' : '⏳';
        logger_1.logger.info(`  ${done} ${p.id.slice(0, 12)}  ${p.name}  [${src}]`);
        logger_1.logger.info(`     期次: ${p.iteration}  任务: ${p.tasks.length}  分批: ${p.batchSize}`);
        logger_1.logger.info(`     创建: ${new Date(p.createdAt).toLocaleString()}`);
        if (p.executedAt)
            logger_1.logger.info(`     执行: ${new Date(p.executedAt).toLocaleString()} → ${p.result || '完成'}`);
        logger_1.logger.info('');
    }
    logger_1.logger.info('���� speccore plan --show <id> 查看详情');
}
async function showPlanDetail(id) {
    const p = await (0, plan_store_1.getPlan)(id);
    if (!p) {
        logger_1.logger.error('未找到计划');
        return;
    }
    logger_1.logger.info(`\n📋 ${p.name}`);
    logger_1.logger.info(`   ID:      ${p.id}`);
    logger_1.logger.info(`   来源:    ${p.source === 'manual' ? '手动' : p.source === 'auto' ? '自动' : '调度'}`);
    logger_1.logger.info(`   期次:    ${p.iteration}`);
    logger_1.logger.info(`   分批:    ${p.batchSize} 个/批`);
    logger_1.logger.info(`   创建:    ${new Date(p.createdAt).toLocaleString()}`);
    if (p.executedAt)
        logger_1.logger.info(`   执行:    ${new Date(p.executedAt).toLocaleString()}`);
    logger_1.logger.info(`\n   任务列表 (${p.tasks.length}):`);
    for (let i = 0; i < p.tasks.length; i += p.batchSize) {
        const batch = p.tasks.slice(i, i + p.batchSize);
        logger_1.logger.info(`   第${Math.floor(i / p.batchSize) + 1}批: ${batch.join(', ')}`);
    }
    if (Object.values(p.filters).some(Boolean)) {
        logger_1.logger.info(`\n   筛选: ${JSON.stringify(p.filters)}`);
    }
    logger_1.logger.info('');
}
async function removePlan(id) {
    const ok = await (0, plan_store_1.deletePlan)(id);
    logger_1.logger.info(ok ? '✅ 已删除' : '❌ 未找到');
}
function generatePlan(tasks, teamSize, mode) {
    if (mode === 'claim') {
        return [{ phase: 1, tasks: tasks.map(t => t.id), assignees: [], estimatedDuration: tasks.length * 2 }];
    }
    const phases = [];
    const pc = Math.min(teamSize, tasks.length);
    for (let i = 0; i < tasks.length; i += pc) {
        const pts = tasks.slice(i, i + pc);
        phases.push({ phase: phases.length + 1, tasks: pts.map(t => t.id), assignees: pts.map(t => t.assignee || 'TBD'), estimatedDuration: 2 });
    }
    return phases;
}
function printPlan(plan, iteration) {
    logger_1.logger.info(`\n执行计划: ${iteration}\n`);
    for (const phase of plan) {
        logger_1.logger.info(`阶段 ${phase.phase}:`);
        for (let i = 0; i < phase.tasks.length; i++)
            logger_1.logger.info(`  ${phase.tasks[i]} -> ${phase.assignees[i] || 'TBD'}`);
        logger_1.logger.info(`  预计: ${phase.estimatedDuration}h\n`);
    }
}
function formatPlanMarkdown(plan, iteration) {
    const lines = [`# 执行计划 - ${iteration}`, '', `> 生成时间: ${new Date().toISOString()}`, ''];
    for (const phase of plan) {
        lines.push(`## 阶段 ${phase.phase}`, '', '| 任务 | 负责人 | 预计耗时 |', '| :--- | :--- | :--- |');
        for (let i = 0; i < phase.tasks.length; i++)
            lines.push(`| ${phase.tasks[i]} | ${phase.assignees[i] || 'TBD'} | 2h |`);
        lines.push('');
    }
    return lines.join('\n');
}
//# sourceMappingURL=plan.js.map