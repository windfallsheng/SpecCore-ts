"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeCommand = executeCommand;
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
const logger_1 = require("../utils/logger");
const context_1 = require("../core/context");
const state_1 = require("../core/state");
const transaction_1 = require("../core/transaction");
const operation_log_1 = require("../core/operation-log");
const execution_state_1 = require("../core/execution-state");
async function executeCommand(options) {
    try {
        const iteration = await (0, context_1.getDefaultIteration)(options.iteration);
        if (!iteration) {
            logger_1.logger.error('No active iteration found. Please specify --iteration or create one first.');
            return;
        }
        let tasks = await (0, state_1.scanTasks)(iteration);
        if (tasks.length === 0) {
            logger_1.logger.warn('No tasks found in iteration');
            return;
        }
        // Apply filters
        if (options.task)
            tasks = tasks.filter(t => t.id === options.task);
        if (options.type)
            tasks = tasks.filter(t => t.type === options.type);
        if (options.priority)
            tasks = tasks.filter(t => t.priority === options.priority);
        if (options.status)
            tasks = tasks.filter(t => t.status === options.status);
        if (options.assignee)
            tasks = tasks.filter(t => t.assignee === options.assignee);
        if (options.backend)
            tasks = tasks.filter(t => t.id.includes('backend'));
        if (options.frontend)
            tasks = tasks.filter(t => t.id.includes('frontend'));
        if (options.platform)
            tasks = await filterByPlatform(tasks, iteration, options.platform);
        if (tasks.length === 0) {
            logger_1.logger.warn('No tasks match the specified filters');
            return;
        }
        const sortedTasks = (0, state_1.topologicalSort)(tasks);
        // === Interactive mode ===
        if (options.interactive) {
            await interactiveSelect(sortedTasks, iteration, options);
            return;
        }
        // === Dry run ===
        if (options.dryRun) {
            printExecutionPreview(sortedTasks, iteration);
            (0, operation_log_1.logOperation)(`speccore execute --dry-run`, `${sortedTasks.length} tasks`);
            return;
        }
        // === Preview (default, unless --force) ===
        if (!options.force) {
            printExecutionPreview(sortedTasks, iteration);
            logger_1.logger.info('');
            logger_1.logger.info('💡 Use --force to execute directly, or --interactive to select');
            return;
        }
        // === Resume mode ===
        if (options.resume) {
            await executeResume(iteration);
            return;
        }
        // === Batch mode ===
        const batchSize = parseInt(options.batchSize || options.batch || '0', 10);
        if (batchSize > 0 && sortedTasks.length > batchSize) {
            await executeBatchMode(sortedTasks, iteration, batchSize, options);
            return;
        }
        // === Execute with progress (existing flow) ===
        await executeWithProgress(sortedTasks, iteration);
    }
    catch (error) {
        logger_1.logger.error(`Execution failed: ${error}`);
        throw error;
    }
}
// ============================================================
// Interactive selection
// ============================================================
async function interactiveSelect(tasks, iteration, options) {
    logger_1.logger.info('');
    logger_1.logger.info(`📋 Preparing ${tasks.length} tasks:`);
    logger_1.logger.info('');
    for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        const pri = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🟢';
        logger_1.logger.info(`  ${i + 1}. ${t.id} ${t.name || ''} ${pri}`);
    }
    logger_1.logger.info('');
    logger_1.logger.info('Select execution mode:');
    logger_1.logger.info('  [1] Execute all (serial)');
    logger_1.logger.info('  [2] Execute all (parallel, max 2)');
    logger_1.logger.info('  [3] Select specific tasks');
    logger_1.logger.info('  [4] Cancel');
    // In interactive mode, default to "all serial" (--force style)
    logger_1.logger.info('');
    logger_1.logger.info('💡 Auto-selecting mode [1] (all serial). Use --interactive in AI tools for full prompts.');
    logger_1.logger.info('');
    await executeWithProgress(tasks, iteration);
}
// ============================================================
// Progress feedback execution
// ============================================================
async function executeWithProgress(tasks, iteration) {
    const total = tasks.length;
    const startTime = Date.now();
    const completed = [];
    (0, operation_log_1.logOperation)('speccore execute', `${total} tasks`);
    logger_1.logger.info('');
    logger_1.logger.info(`⏳ Executing ${total} task(s) in iteration: ${iteration}`);
    logger_1.logger.info('');
    for (let i = 0; i < total; i++) {
        const task = tasks[i];
        const progress = Math.round(((i) / total) * 100);
        const bar = createBar(progress, 20);
        // Report current batch
        logger_1.logger.info(`[${String(i + 1).padStart(2, '0')}/${total}] ${bar} ${progress}%`);
        logger_1.logger.info(`  🔄 ${task.id} ${task.name || ''} (${task.type || 'feature'})`);
        await simulateTaskExecution(task, iteration);
        completed.push(`${task.id} - ${task.name || ''}`);
        logger_1.logger.info(`  ✅ ${task.id} completed`);
        logger_1.logger.info('');
        // Report pending
        const pending = tasks.slice(i + 1);
        if (pending.length > 0) {
            logger_1.logger.info(`  Pending: ${pending.map(t => t.id).join(', ')}`);
        }
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const avgPerTask = elapsed / (i + 1);
        const remaining = Math.round(avgPerTask * (total - i - 1));
        logger_1.logger.info(`  Elapsed: ${elapsed}s | Est. remaining: ${remaining}s`);
        logger_1.logger.info('');
    }
    // Update context
    await (0, context_1.updateContext)({
        currentTask: tasks[tasks.length - 1]?.id || '',
        currentIteration: iteration,
        lastUpdated: new Date().toISOString()
    });
    await (0, context_1.recordHistory)('execute', iteration, tasks[tasks.length - 1]?.id);
    // Summary
    const totalElapsed = Math.round((Date.now() - startTime) / 1000);
    logger_1.logger.success(`Execution complete! ${total} tasks in ${totalElapsed}s`);
    (0, operation_log_1.logOperation)('speccore execute done', `completed ${total} tasks in ${totalElapsed}s`);
}
// ============================================================
// Resume from interruption
// ============================================================
async function executeResume(iteration) {
    if (!(0, execution_state_1.canResume)()) {
        logger_1.logger.warn('No interrupted execution found. Use --all to start a new one.');
        return;
    }
    let state = (0, execution_state_1.loadExecutionState)();
    logger_1.logger.info(`⏳ Resuming from Batch ${state.currentBatch}/${state.totalBatches}`);
    // Continue from current batch
    while (state.currentBatch <= state.totalBatches) {
        const batchTasks = (0, execution_state_1.getCurrentBatchTasks)(state);
        if (batchTasks.length === 0)
            break;
        await processBatch(batchTasks, state, iteration);
        state = (0, execution_state_1.loadExecutionState)();
    }
    logger_1.logger.success('All batches completed!');
    (0, execution_state_1.clearExecutionState)();
}
// ============================================================
// Batch execution mode
// ============================================================
async function executeBatchMode(tasks, iteration, batchSize, options) {
    const taskIds = tasks.map((t) => t.id);
    const state = (0, execution_state_1.initExecutionState)(taskIds, iteration, batchSize);
    logger_1.logger.info('');
    logger_1.logger.info(`📦 Batch mode: ${state.totalBatches} batches of up to ${batchSize} tasks`);
    logger_1.logger.info('');
    while (state.currentBatch <= state.totalBatches) {
        const batchTasks = (0, execution_state_1.getCurrentBatchTasks)(state);
        if (batchTasks.length === 0)
            break;
        // Find actual task objects
        const taskObjs = batchTasks
            .map((id) => tasks.find((t) => t.id === id))
            .filter(Boolean);
        await processBatch(taskObjs, state, iteration);
        // Reload state (completedBatch updated it)
        const updated = (0, execution_state_1.loadExecutionState)();
        if (updated.currentBatch > updated.totalBatches)
            break;
    }
    logger_1.logger.success('All batches completed!');
    (0, operation_log_1.logOperation)('speccore execute --batch-size', `${tasks.length} tasks in ${state.totalBatches} batches`);
    (0, execution_state_1.clearExecutionState)();
}
// ============================================================
// Process one batch with context isolation
// ============================================================
async function processBatch(tasks, state, iteration) {
    const batchNum = state.currentBatch;
    const startTime = Date.now();
    logger_1.logger.info(``);
    logger_1.logger.info(`━━━ Batch ${batchNum}/${state.totalBatches} ━━━`);
    logger_1.logger.info(``);
    // Context isolation: simulate context loading
    logger_1.logger.info(`📖 Loading context for batch ${batchNum}...`);
    logger_1.logger.info(`   CONSTITUTION.md → architecture constraints`);
    logger_1.logger.info(`   PROJECT_GRAPH.md → dependency status`);
    logger_1.logger.info(`   Tasks: ${tasks.map((t) => t.id || t).join(', ')}`);
    // Execute tasks in batch
    const completed = [];
    const total = tasks.length;
    const progressBar = createBar(0, 20);
    for (let i = 0; i < total; i++) {
        const task = tasks[i];
        const progress = Math.round(((i + 1) / total) * 100);
        const bar = createBar(progress, 20);
        logger_1.logger.info(``);
        logger_1.logger.info(`  ${bar} ${(i + 1)}/${total} — ${task.id || task} ${task.name || ''}`);
        logger_1.logger.info(`  🔄 Executing...`);
        await simulateTaskExecution(task, iteration);
        completed.push(task.id || task);
        logger_1.logger.info(`  ✅ ${task.id || task} completed`);
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const estRemaining = Math.round((elapsed / (i + 1)) * (total - i - 1));
        logger_1.logger.info(`  Elapsed: ${elapsed}s | Est. remaining: ${estRemaining}s`);
    }
    // Mark batch complete
    (0, execution_state_1.completeBatch)(state, batchNum, completed);
    logger_1.logger.info(``);
    logger_1.logger.info(`✅ Batch ${batchNum} complete (${completed.length} tasks)`);
    // Context reset note
    logger_1.logger.info(`🔄 Resetting context for next batch...`);
    logger_1.logger.info(``);
}
function createBar(pct, width) {
    const filled = Math.round(width * (pct / 100));
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}
// ============================================================
// Execution preview
// ============================================================
function printExecutionPreview(tasks, iteration) {
    logger_1.logger.info('');
    logger_1.logger.info('📋 Execution Preview');
    logger_1.logger.info('');
    logger_1.logger.info(`Iteration: ${iteration}`);
    logger_1.logger.info(`Tasks: ${tasks.length}`);
    logger_1.logger.info('');
    for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        const icon = i === 0 ? '🔄' : '⏳';
        const pri = t.priority === 'high' ? '[HIGH]' : t.priority === 'medium' ? '[MED]' : '[LOW]';
        logger_1.logger.info(`  ${icon} ${t.id} ${pri} - ${t.name || 'unnamed'}`);
    }
    logger_1.logger.info('');
}
// ============================================================
// Task execution (transaction protected)
// ============================================================
async function simulateTaskExecution(task, iteration) {
    const taskDir = (0, path_1.join)(`期次-${iteration}`, task.id);
    let filesUpdated = 0;
    if (await (0, fs_extra_1.pathExists)(taskDir)) {
        const tx = new transaction_1.FileTransaction();
        const taskMdPath = (0, path_1.join)(taskDir, 'backend', 'TASK.md');
        if (await (0, fs_extra_1.pathExists)(taskMdPath)) {
            const content = await (0, fs_extra_1.readFile)(taskMdPath, 'utf-8');
            const updated = content.replace('状态: 🔲 待开发', '状态: 🔄 进行中');
            tx.write(taskMdPath, updated);
            filesUpdated++;
        }
        const frontendDir = (0, path_1.join)(taskDir, 'frontend');
        if (await (0, fs_extra_1.pathExists)(frontendDir)) {
            const { readdir: rd } = await Promise.resolve().then(() => __importStar(require('fs-extra')));
            const platformDirs = await rd(frontendDir, { withFileTypes: true });
            for (const pd of platformDirs) {
                if (pd.isDirectory()) {
                    const ftaskPath = (0, path_1.join)(frontendDir, pd.name, 'TASK.md');
                    if (await (0, fs_extra_1.pathExists)(ftaskPath)) {
                        const content = await (0, fs_extra_1.readFile)(ftaskPath, 'utf-8');
                        const updated = content.replace('状态: 🔲 待开发', '状态: 🔄 进行中');
                        tx.write(ftaskPath, updated);
                        filesUpdated++;
                    }
                }
            }
        }
        if (tx.length > 0) {
            await tx.commit();
        }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
}
async function filterByPlatform(tasks, iteration, platform) {
    const filtered = [];
    const iterDir = (0, path_1.join)(process.cwd(), `期次-${iteration}`);
    for (const task of tasks) {
        const platformDir = (0, path_1.join)(iterDir, task.id, 'frontend', platform);
        if (await (0, fs_extra_1.pathExists)(platformDir))
            filtered.push(task);
    }
    return filtered;
}
//# sourceMappingURL=execute.js.map