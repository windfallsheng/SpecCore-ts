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
const spec_rules_1 = require("../core/spec-rules");
const operation_log_1 = require("../core/operation-log");
const next_steps_1 = require("../core/next-steps");
const question_checklist_1 = require("../core/question-checklist");
const execution_state_1 = require("../core/execution-state");
const git_integration_1 = require("../core/git-integration");
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
        if (options.task) {
            // Support both exact match and prefix match (Task-001 → Task-001-用户登录)
            const filtered = tasks.filter(t => t.id === options.task);
            if (filtered.length > 0) {
                tasks = filtered;
            }
            else {
                const prefixMatch = tasks.filter(t => t.id && t.id.startsWith(options.task));
                if (prefixMatch.length > 0) {
                    tasks = prefixMatch;
                }
                else {
                    logger_1.logger.warn(`Task "${options.task}" not found. Available: ${tasks.map(t => t.id).join(', ')}`);
                }
            }
        }
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
        // === Strict mode: pre-flight check before executing ===
        if (options.strict) {
            const approved = await preFlightCheck(sortedTasks, iteration, options);
            if (approved.length === 0)
                return;
            sortedTasks.length = 0;
            sortedTasks.push(...approved);
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
        const batchSize = parseInt(options.batchSize || '0', 10);
        if (batchSize > 0 && sortedTasks.length > batchSize) {
            await executeBatchMode(sortedTasks, iteration, batchSize, options);
            return;
        }
        // === Execute with progress (existing flow) ===
        const skipList = options.skip ? options.skip.split(',').map(s => s.trim()).filter(Boolean) : [];
        await executeWithProgress(sortedTasks, iteration, options.base, skipList, { only: options.only });
        // Hotfix tracking
        if (options.hotfix && sortedTasks.length > 0) {
            await (0, context_1.startHotfix)(sortedTasks[0].id);
            logger_1.logger.info('⚠️  Hotfix Mode Active — 30min grace, 24h mandatory sync');
        }
    }
    catch (error) {
        logger_1.logger.error(`Execution failed: ${error}`);
        throw error;
    }
}
// ============================================================
// Interactive selection (real prompt via inquirer)
// ============================================================
async function interactiveSelect(tasks, iteration, options) {
    const inquirer = await loadInquirer();
    logger_1.logger.info('');
    logger_1.logger.info(`📋 Preparing ${tasks.length} tasks:`);
    logger_1.logger.info('');
    for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        const pri = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🟢';
        logger_1.logger.info(`  ${i + 1}. ${t.id} ${t.name || ''} ${pri}`);
    }
    const { mode } = await inquirer.prompt([
        {
            type: 'list',
            name: 'mode',
            message: 'Please select execution mode:',
            choices: [
                { name: '[1] Execute all (serial)', value: 'all' },
                { name: '[2] Execute all (parallel, max 2)', value: 'parallel2' },
                { name: '[3] Select specific tasks', value: 'select' },
                { name: '[4] Cancel', value: 'cancel' },
            ],
        },
    ]);
    if (mode === 'cancel') {
        logger_1.logger.info('Cancelled.');
        return;
    }
    let selectedTasks = tasks;
    if (mode === 'select') {
        const choices = tasks.map((t) => ({
            name: `${t.id} ${t.name || ''} (${t.priority || 'medium'})`,
            value: t.id,
            checked: t.priority === 'high',
        }));
        const { picked } = await inquirer.prompt([
            {
                type: 'checkbox',
                name: 'picked',
                message: 'Select tasks to execute (space to toggle, enter to confirm):',
                choices,
            },
        ]);
        if (picked.length === 0) {
            logger_1.logger.info('No tasks selected. Cancelled.');
            return;
        }
        selectedTasks = tasks.filter((t) => picked.includes(t.id));
    }
    const { confirm } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirm',
            message: `Execute ${selectedTasks.length} task(s)?`,
            default: true,
        },
    ]);
    if (!confirm) {
        logger_1.logger.info('Cancelled.');
        return;
    }
    const skipList2 = options.skip ? options.skip.split(',').map(s => s.trim()).filter(Boolean) : [];
    await executeWithProgress(selectedTasks, iteration, options.base, skipList2, { only: options.only });
}
async function loadInquirer() {
    try {
        return await Promise.resolve().then(() => __importStar(require('inquirer')));
    }
    catch {
        // Fallback for environments without inquirer
        return {
            prompt: async (questions) => {
                logger_1.logger.info('⚠️ Inquirer not available, auto-selecting defaults.');
                const result = {};
                for (const q of questions) {
                    if (q.name === 'mode')
                        result[q.name] = 'all';
                    if (q.name === 'picked')
                        result[q.name] = [];
                    if (q.name === 'confirm')
                        result[q.name] = true;
                }
                return result;
            },
        };
    }
}
// ============================================================
// Progress feedback execution
// ============================================================
async function executeWithProgress(tasks, iteration, base, skip, options) {
    const total = tasks.length;
    const startTime = Date.now();
    const completed = [];
    // Filter whitelist (--only)
    if (options?.only) {
        const onlyList = options.only.split(',').map(s => s.trim()).filter(Boolean);
        const before = tasks.length;
        tasks = tasks.filter(t => onlyList.includes(t.id));
        if (tasks.length < before) {
            logger_1.logger.info(`  🎯 仅执行 ${tasks.length}/${before} 个指定任务`);
        }
    }
    // Filter whitelist (--only)
    if (options?.only) {
        const onlyList = options.only.split(',').map(s => s.trim()).filter(Boolean);
        const before = tasks.length;
        tasks = tasks.filter(t => onlyList.includes(t.id));
        if (tasks.length < before) {
            logger_1.logger.info(`  🎯 仅执行 ${tasks.length}/${before} 个指定任务`);
        }
    }
    // Filter skipped tasks
    if (skip && skip.length > 0) {
        const before = tasks.length;
        tasks = tasks.filter(t => !skip.includes(t.id));
        logger_1.logger.info(`  ⏭️  跳过 ${before - tasks.length} 个任务: ${skip.join(', ')}`);
    }
    if (tasks.length === 0) {
        logger_1.logger.info('  ✅ 没有需要执行的任务');
        return;
    }
    // Create branches for each task (dependency-aware)
    if (tasks.length > 0) {
        for (const task of tasks) {
            let taskBase = base;
            // Auto-detect dependency per task from IMPACT.md
            if (!taskBase) {
                taskBase = await detectDependencyBase(iteration, task.id);
            }
            const branch = (0, git_integration_1.createTaskBranch)(task.id, task.id, taskBase);
            if (branch) {
                const baseInfo = taskBase ? ` (from ${taskBase})` : '';
                logger_1.logger.info(`🌿 ${task.id}: ${branch}${baseInfo}`);
            }
            // Switch back to a neutral branch for next task if needed
        }
    }
    // ── Agent mode: output optimized context for external AI ──
    if (options?.agent) {
        const agentCtx = buildAgentContext(tasks, options.agent);
        logger_1.logger.info(`\n🤖 Agent 模式: ${options.agent}`);
        logger_1.logger.info('--- AGENT CONTEXT START ---');
        logger_1.logger.info(agentCtx);
        logger_1.logger.info('--- AGENT CONTEXT END ---');
        logger_1.logger.info('\n💡 复制以上内容粘贴到 ' + options.agent + ' 中即可生成代码');
        (0, operation_log_1.logOperation)('speccore execute --agent', options.agent);
        return;
    }
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
    // Post-execution question review
    const postQs = await (0, question_checklist_1.extractQuestions)(`期次-${iteration}`);
    if (postQs.length > 0)
        (0, question_checklist_1.showQuestionChecklist)(postQs, '执行后审查');
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
        // Convert string IDs to TaskState objects for processBatch
        const batchTasks = (0, execution_state_1.getCurrentBatchTasks)(state);
        if (batchTasks.length === 0)
            break;
        const taskObjs = batchTasks.map(id => ({ id, name: id, type: 'unknown', status: 'pending', assignee: '', dependencies: [], priority: 'medium', progress: 0 }));
        await processBatch(taskObjs, state, iteration);
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
            .map((id) => tasks.find(t => t.id === id))
            .filter((t) => t !== undefined);
        await processBatch(taskObjs, state, iteration);
        // Reload state (completedBatch updated it)
        const updated = (0, execution_state_1.loadExecutionState)();
        if (updated.currentBatch > updated.totalBatches)
            break;
        if (updated.pendingTasks.length === 0)
            break; // 所有任务完成
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
    logger_1.logger.info(`   Tasks: ${tasks.map(t => t.id).join(', ')}`);
    // Execute tasks in batch
    const completed = [];
    const total = tasks.length;
    for (let i = 0; i < total; i++) {
        const task = tasks[i];
        const progress = Math.round(((i + 1) / total) * 100);
        const bar = createBar(progress, 20);
        logger_1.logger.info(``);
        logger_1.logger.info(`  ${bar} ${(i + 1)}/${total} — ${task.id} ${task.name}`);
        logger_1.logger.info(`  🔄 Executing...`);
        await simulateTaskExecution(task, iteration);
        completed.push(task.id);
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
        // 加载全局 Spec 规则（会被注入到生成的代码中）
        const specRules = await (0, spec_rules_1.loadSpecRules)();
        const techStack = await (0, spec_rules_1.loadTechStack)();
        logger_1.logger.info(`   Tech Stack: ${techStack.backendFramework} + ${techStack.frontendFramework}`);
        // 读取后端 Spec 生成代码骨架
        const backendDir = (0, path_1.join)(taskDir, 'backend');
        if (await (0, fs_extra_1.pathExists)(backendDir)) {
            const reqPath = (0, path_1.join)(backendDir, 'REQ.md');
            let className = convertToClassName(task.name || task.id);
            // 使用安全的 Java 包名：com.example.{className小写}
            let packageName = `com.example.${className.toLowerCase()}`;
            // 生成 Controller 骨架
            if (await (0, fs_extra_1.pathExists)(reqPath)) {
                const req = await (0, fs_extra_1.readFile)(reqPath, 'utf-8');
                const controllerCode = generateJavaController(className, packageName, req, specRules);
                const ctrlPath = (0, path_1.join)(backendDir, `${className}Controller.java`);
                tx.write(ctrlPath, controllerCode);
                filesUpdated++;
            }
            // 生成 Service 骨架
            const serviceCode = generateJavaService(className, packageName);
            const svcPath = (0, path_1.join)(backendDir, `${className}Service.java`);
            tx.write(svcPath, serviceCode);
            filesUpdated++;
            // 生成 Repository 骨架
            const repoCode = generateJavaRepository(className, packageName);
            const repoPath = (0, path_1.join)(backendDir, `${className}Repository.java`);
            tx.write(repoPath, repoCode);
            filesUpdated++;
            // 更新 TASK.md 状态
            const taskMdPath = (0, path_1.join)(backendDir, 'TASK.md');
            if (await (0, fs_extra_1.pathExists)(taskMdPath)) {
                const content = await (0, fs_extra_1.readFile)(taskMdPath, 'utf-8');
                const updated = content.replace('状态: 🔲 待开发', '状态: 🔄 进行中');
                tx.write(taskMdPath, updated);
                filesUpdated++;
            }
        }
        // 前端各平台代码生成
        const frontendDir = (0, path_1.join)(taskDir, 'frontend');
        if (await (0, fs_extra_1.pathExists)(frontendDir)) {
            const { readdir: rd } = await Promise.resolve().then(() => __importStar(require('fs-extra')));
            const platformDirs = await rd(frontendDir, { withFileTypes: true });
            for (const pd of platformDirs) {
                if (pd.isDirectory()) {
                    const componentName = convertToClassName(task.name || task.id);
                    const vueCode = generateVueComponent(componentName);
                    const vuePath = (0, path_1.join)(frontendDir, pd.name, `${componentName}.vue`);
                    tx.write(vuePath, vueCode);
                    filesUpdated++;
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
// ============================================================
// Code generation helpers
// ============================================================
function generateJavaController(className, pkg, req, rules) {
    const desc = extractDescription(req);
    const methodStubs = generateMethodStubs(req, rules);
    const imports = (0, spec_rules_1.generateImports)(rules, className);
    return `package ${pkg}.controller;

${imports}

/**
 * ${desc}
 * Generated by SpecCore execute
 */
@RestController
@RequestMapping("/api/v1")
public class ${className}Controller {

    @Autowired
    private ${className}Service ${uncapitalize(className)}Service;
${methodStubs}
}
`;
}
/** 从 REQ.md 的接口表格中提取方法签名 */
function generateMethodStubs(req, rules) {
    // 匹配 REQ.md 中的接口定义表格: | METHOD | /path | description |
    const tableRegex = /\|\s*(GET|POST|PUT|DELETE|PATCH)\s*\|\s*(\/[^\s|]+)\s*\|([^|]*)\|/gi;
    const methods = [];
    let match;
    while ((match = tableRegex.exec(req)) !== null) {
        const method = match[1].toUpperCase();
        const path = match[2].trim();
        const desc = match[3].trim();
        methods.push(formatControllerMethod(method, path, desc, rules));
    }
    return methods.length > 0 ? methods.join('\n') : '\n    // TODO: 请在 REQ.md 中补充接口表格';
}
function formatControllerMethod(method, path, desc, rules) {
    const rt = rules || { exceptionHandler: 'none', responseFormat: 'ResponseEntity' };
    const returnType = rt.responseFormat === 'Result' ? 'Result<?>' : 'ResponseEntity<?>';
    const bodyHint = rt.exceptionHandler === 'BusinessException'
        ? 'throw new BusinessException("Not implemented");'
        : rt.responseFormat === 'Result'
            ? 'return Result.error("Not implemented");'
            : 'return ResponseEntity.ok().build();';
    const hasId = path.includes('{id}');
    const hasPage = path.includes('page');
    let annotation;
    let signature;
    switch (method) {
        case 'GET':
            if (hasId) {
                annotation = `@GetMapping("${path}")`;
                signature = `public ${returnType} getById(@PathVariable Long id)`;
            }
            else if (hasPage || path.endsWith('s')) {
                annotation = `@GetMapping("${path}")`;
                signature = `public ${returnType} list(@RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int size)`;
            }
            else {
                annotation = `@GetMapping("${path}")`;
                signature = `public ${returnType} get()`;
            }
            break;
        case 'POST':
            annotation = `@PostMapping("${path}")`;
            signature = `public ${returnType} create(@RequestBody Object body)`;
            break;
        case 'PUT':
            annotation = `@PutMapping("${path}")`;
            if (hasId) {
                signature = `public ${returnType} update(@PathVariable Long id, @RequestBody Object body)`;
            }
            else {
                signature = `public ${returnType} update(@RequestBody Object body)`;
            }
            break;
        case 'DELETE':
            annotation = `@DeleteMapping("${path}")`;
            if (hasId) {
                signature = `public ${returnType} delete(@PathVariable Long id)`;
            }
            else {
                signature = `public ${returnType} delete()`;
            }
            break;
        default:
            annotation = `@PostMapping("${path}")`;
            signature = `public ${returnType} handle(@RequestBody Object body)`;
    }
    return `
    /** ${desc} */
    ${annotation}
    ${signature} {
        ${bodyHint}
    }`;
}
const uncapitalize = (s) => s.charAt(0).toLowerCase() + s.slice(1);
function generateJavaService(className, pkg) {
    return `package ${pkg}.service;

import org.springframework.stereotype.Service;

/**
 * Generated by SpecCore execute
 */
@Service
public class ${className}Service {

    // TODO: Implement business logic based on REQ.md
}
`;
}
function generateJavaRepository(className, pkg) {
    return `package ${pkg}.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

/**
 * Generated by SpecCore execute
 */
@Repository
public interface ${className}Repository extends JpaRepository<${className}, Long> {

    // TODO: Add custom queries based on TECH.md
}
`;
}
function generateVueComponent(componentName) {
    return `<template>
  <div class="${toKebab(componentName)}">
    <!-- Generated by SpecCore execute -->
    <h1>${componentName}</h1>
  </div>
</template>

<script setup lang="ts">
// TODO: Implement component logic based on Spec
</script>

<style scoped>
.${toKebab(componentName)} {
  /* TODO: Add styles */
}
</style>
`;
}
function convertToClassName(name) {
    if (!name || !name.trim())
        return 'UnknownFeature';
    // 提取 Task ID 的纯数字部分作为类名前缀，避免中文混入类名
    // "Task-001-任务CRUD" → "Task001"
    const idMatch = name.match(/Task-(\d+)/i);
    if (idMatch) {
        return `Task${idMatch[1].padStart(3, '0')}`;
    }
    // 回退：只保留 ASCII 字母数字
    return name
        .replace(/[^a-zA-Z0-9]/g, '')
        .replace(/^[a-z]/, c => c.toUpperCase()) || 'Feature';
}
function toKebab(name) {
    return name
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase();
}
function extractDescription(req) {
    // Match ## heading followed by optional blank line and description
    const match = req.match(/##\s*(?:需求描述|Description)\s*\n+\s*([^\n#]+)/);
    return match ? match[1].trim() : 'Generated by SpecCore';
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
// ============================================================
// Hotfix 跟踪
// ============================================================
async function handleHotfix(options, taskIds) {
    if (!options.hotfix)
        return;
    const taskId = taskIds[0];
    if (!taskId)
        return;
    await (0, context_1.startHotfix)(taskId);
    logger_1.logger.info('');
    logger_1.logger.warn('⚠️  Hotfix Mode Active');
    logger_1.logger.warn(`   Task: ${taskId}`);
    logger_1.logger.warn('   Grace period: 30 min (skip reverse sync)');
    logger_1.logger.warn('   Mandatory sync deadline: 24 hours');
    logger_1.logger.warn('   Run: speccore sync --reverse to complete');
    (0, next_steps_1.showNextSteps)('execute');
}
// ============================================================
// Strict mode pre-flight check
// ============================================================
async function preFlightCheck(tasks, iteration, options) {
    const iterDir = `期次-${iteration}`;
    const ask = (q) => {
        logger_1.logger.info(q);
        return new Promise((resolve) => {
            process.stdin.resume();
            process.stdin.once('data', (data) => {
                process.stdin.pause();
                resolve(data.toString().split('\n')[0].trim());
            });
        });
    };
    logger_1.logger.info('\n╔══════════════════════════════════════════════╗');
    logger_1.logger.info('║  🔍 Strict Mode — Pre-Flight Check           ║');
    logger_1.logger.info('╚══════════════════════════════════════════════╝\n');
    const approved = [];
    for (const task of tasks) {
        const taskDir = (0, path_1.join)(iterDir, task.id);
        logger_1.logger.info(`\n── ${task.id} ──`);
        let issues = [];
        // 1. Requirement completeness
        const reqPath = (0, path_1.join)(taskDir, 'backend', 'REQ.md');
        if (await (0, fs_extra_1.pathExists)(reqPath)) {
            const req = await (0, fs_extra_1.readFile)(reqPath, 'utf-8');
            const sections = (req.match(/^###?\s+.+/gm) || []).length;
            const apis = (req.match(/\| (GET|POST|PUT|DELETE|PATCH) \|/g) || []).length;
            logger_1.logger.info(`  1. 需求: ${sections} 章节 / ${apis} 接口`);
            if (sections === 0 && apis === 0)
                issues.push('REQ.md 内容为空');
        }
        else {
            issues.push('缺少 REQ.md');
        }
        // 2. Tech plan
        const techPath = (0, path_1.join)(taskDir, 'backend', 'TECH.md');
        if (await (0, fs_extra_1.pathExists)(techPath)) {
            const tech = await (0, fs_extra_1.readFile)(techPath, 'utf-8');
            const s = [tech.includes('数据库') && 'DB', tech.includes('Redis') && 'Redis', tech.includes('MQ') && 'MQ'].filter(Boolean).join('/');
            logger_1.logger.info(`  2. 方案: ${s || '待补充'}`);
        }
        else {
            issues.push('缺少 TECH.md');
        }
        // 3. Test cases
        const testPath = (0, path_1.join)(taskDir, 'backend', 'TEST.md');
        if (await (0, fs_extra_1.pathExists)(testPath)) {
            const test = await (0, fs_extra_1.readFile)(testPath, 'utf-8');
            const n = (test.match(/⬜|✅|❌/g) || []).length;
            logger_1.logger.info(`  3. 测试: ${n} 用例`);
        }
        // 4. Review
        logger_1.logger.info(`  4. 审查: ${await (0, fs_extra_1.pathExists)((0, path_1.join)(taskDir, 'backend', 'REVIEW.md')) ? '✅' : '❌'}`);
        // 5. API
        logger_1.logger.info(`  5. 契约: ${await (0, fs_extra_1.pathExists)((0, path_1.join)(taskDir, '_shared', 'API_CONTRACT.yaml')) ? '✅' : '⚠️'}`);
        // 6. Platform
        const fd = (0, path_1.join)(taskDir, 'frontend');
        if (await (0, fs_extra_1.pathExists)(fd)) {
            const pf = require('fs').readdirSync(fd, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
            logger_1.logger.info(`  6. 端: ${pf.join(', ')}`);
        }
        // 7. Constitution
        logger_1.logger.info(`  7. 合规: 待 validate ${issues.length > 0 ? '⚠️  ' + issues.join(', ') : ''}`);
        // ── Per-task decision ──
        const answer = (await ask(`  → 开发？[y]确认 [N]跳过 [q]全部取消: `)).toLowerCase();
        if (answer === 'q') {
            logger_1.logger.info('❌ 取消');
            approved.length = 0;
            break;
        }
        if (answer === 'y' || answer === 'yes') {
            approved.push(task);
            logger_1.logger.info(`  ✅ 已加入`);
        }
        else {
            logger_1.logger.info(`  ⏭️ 跳过`);
        }
        logger_1.logger.info('');
    }
    if (approved.length === 0) {
        logger_1.logger.info('\n❌ 没有任务通过确认。');
        return [];
    }
    logger_1.logger.info(`\n  将执行 ${approved.length}/${tasks.length} 个任务`);
    const confirm = await ask('  确认开始？[y/N] ');
    if (confirm.toLowerCase() !== 'y') {
        logger_1.logger.info('\n❌ 已取消');
        process.exit(0);
    }
    logger_1.logger.info('\n✅ 开始执行...\n');
    return approved;
}
/**
 * 从 IMPACT.md 检测任务依赖，返回应作为 base 的依赖任务 ID
 */
async function detectDependencyBase(iteration, taskId) {
    const impactPath = (0, path_1.join)(`期次-${iteration}`, 'IMPACT.md');
    if (!(await (0, fs_extra_1.pathExists)(impactPath)))
        return undefined;
    const impact = await (0, fs_extra_1.readFile)(impactPath, 'utf-8');
    const lines = impact.split('\n');
    // Parse: | Task-002: 订单导出 | → | Task-001: 用户管理 | `/api/users` |
    for (const line of lines) {
        if (line.includes('→') && line.includes(taskId)) {
            const match = line.match(/→\s*\|\s*([^|]+)/);
            if (match) {
                const depTaskId = match[1].trim().split(':')[0].trim();
                logger_1.logger.info(`\n🔗 检测到依赖: ${taskId} 依赖 ${depTaskId}`);
                logger_1.logger.info(`   🎯 自动从分支 feature/${depTaskId}-* 创建（避免实体重复）`);
                // Find actual branch name matching this task
                try {
                    const branches = require('child_process').execSync('git branch', { encoding: 'utf-8' });
                    const branchMatch = branches.split('\n').find((b) => b.trim().startsWith(`feature/${depTaskId}-`));
                    if (branchMatch) {
                        const actualBranch = branchMatch.trim().replace(/^\*?\s*/, '');
                        return actualBranch || `feature/${depTaskId}`;
                    }
                }
                catch { }
                return `feature/${depTaskId}`;
            }
        }
    }
    return undefined;
}
const AGENT_FORMATS = {
    copilot: { prefix: "Based on the following specification, generate production code:\n\n", suffix: "\n\nGenerate clean, well-structured code following the Constitution rules." },
    claude: { prefix: "根据以下 Spec 生成生产级代码，遵守宪法规则和测试要求：\n\n", suffix: "\n\n请生成结构清晰、符合宪法规则的生产级代码。" },
    cursor: { prefix: "// Spec-Driven Implementation\n// Follow the spec below strictly:\n\n", suffix: "\n\n// Generate code following the Constitution and API contract." },
    trae: { prefix: "请基于以下技术规格生成代码：\n\n", suffix: "\n\n严格遵循宪法规则和 API 契约。" },
    qoder: { prefix: "## Spec-Driven Code Generation\n\nPlease implement based on the specification below:\n\n", suffix: "\n\n## Requirements: Follow Constitution rules and complete all tests." },
    windsurf: { prefix: "### Implementation Spec\n\nImplement the following specification:\n\n", suffix: "\n\n### Rules: Follow all Constitution constraints. Complete the TEST checklist." },
    codebuddy: { prefix: "基于以下 Spec 和宪法规则生成代码：\n\n", suffix: "\n\n严格遵守宪法、API 契约和测试要求。" },
};
function buildAgentContext(tasks, agent) {
    const format = AGENT_FORMATS[agent.toLowerCase()] || { prefix: "Generate code based on:\n\n", suffix: "\n\nFollow all Constitution rules." };
    let ctx = format.prefix;
    for (const task of tasks) {
        ctx += `## Task: ${task.id} - ${task.name || task.id}\n`;
        ctx += `- Status: ${task.status}\n`;
        ctx += `- Priority: ${task.priority}\n`;
        ctx += `\n> Files: Iteration/${task.id}/backend/REQ.md TECH.md TEST.md REVIEW.md API_CONTRACT.yaml\n\n`;
    }
    ctx += `\n## Constitution Rules (from .speccore/PROJECT/CONSTITUTION.md)\n`;
    ctx += `- Follow all mandatory (🔒) rules strictly\n`;
    ctx += `- API must follow RESTful conventions\n`;
    ctx += `- All code must include error handling and validation\n`;
    ctx += format.suffix;
    return ctx;
}
// ===== Agent Context Builder =====
//# sourceMappingURL=execute.js.map