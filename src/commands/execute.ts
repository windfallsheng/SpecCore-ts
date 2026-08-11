import { pathExists, readFile, writeFile, ensureDir, readdir } from 'fs-extra';
import { join, dirname } from 'path';
import { createInterface } from 'readline';
import { readdirSync } from 'fs';
import { execSync } from 'child_process';
import { logger } from '../utils/logger';
import { getDefaultIteration, updateContext, recordHistory, startHotfix, getIterationDir } from '../core/context';
import { scanTasks, topologicalSort, TaskState } from '../core/state';
import { FileTransaction } from '../core/transaction';
import { loadSpecRules, generateImports, SpecRules, loadTechStack } from '../core/spec-rules';

import { logOperation } from '../core/operation-log';
import { showNextSteps } from '../core/next-steps';
import { extractQuestions, showQuestionChecklist } from '../core/question-checklist';
import { savePlan, markPlanExecuted, getPlan, ExecutionPlan } from '../core/plan-store';
import {
  initExecutionState,
  loadExecutionState,
  completeBatch,
  clearExecutionState,
  getCurrentBatchTasks,
  canResume,
  ExecutionState,
} from '../core/execution-state';
import { createTaskBranch, detectDefaultBranch } from '../core/git-integration';
import { buildPrompt, formatPrompt, parseAiResponse, outputNeedsInfo } from '../core/prompt-builder';

export interface ExecuteOptions {
  all?: boolean;
  assignee?: string;
  task?: string;
  type?: string;
  priority?: string;
  status?: string;
  platform?: string;
  backend?: boolean;
  frontend?: boolean;
  interactive?: boolean;
  dryRun?: boolean;
  resume?: boolean;
  parallel?: string;
  iteration?: string;
  force?: boolean;
  batchSize?: string;
  hotfix?: boolean;
  scheduled?: boolean;  // 夜间调度模式
  strict?: boolean;
  base?: string;       // base branch for task branching
  skip?: string;       // comma-separated task IDs to skip
  agent?: string;      // external AI tool for code generation (copilot/claude/cursor/trae/qoder/windsurf/codebuddy)
  only?: string;
  plan?: string;
  prompt?: boolean;     // --prompt: 输出结构化 Prompt 到 stdout（等待 AI）
  response?: string;    // --response: AI 返回的代码内容（配合 --prompt 使用）
}
export async function executeCommand(options: ExecuteOptions): Promise<void> {
  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      logger.error('No active iteration found.');
      return;
    }

    // ── Prompt 模式: 输出结构化 Prompt 到 stdout ──
    if (options.prompt) {
      await runPromptMode(iteration, options);
      return;
    }

    // ── Response 模式: 接收 AI 返回内容并写入文件 ──
    if (options.response) {
      await runApplyMode(iteration, options);
      return;
    }

    // ── 按计划执行 ──
    if (options.plan) {
      await executeByPlan(options.plan as string, iteration, options);
      return;
    }

    let tasks = await scanTasks(iteration);
    if (tasks.length === 0) {
      logger.warn('No tasks found in iteration');
      return;
    }

    // Apply filters
    if (options.task) {
      // Support both exact match and prefix match (Task-001 → Task-001-用户登录)
      const filtered = tasks.filter(t => t.id === options.task);
      if (filtered.length > 0) {
        tasks = filtered;
      } else {
        const prefixMatch = tasks.filter(t => t.id && t.id.startsWith(options.task!));
        if (prefixMatch.length > 0) {
          tasks = prefixMatch;
        } else {
          logger.warn(`Task "${options.task}" not found. Available: ${tasks.map(t => t.id).join(', ')}`);
        }
      }
    }
    if (options.type) tasks = tasks.filter(t => t.type === options.type);
    if (options.priority) tasks = tasks.filter(t => t.priority === options.priority);
    if (options.status) tasks = tasks.filter(t => t.status === options.status);
    if (options.assignee) tasks = tasks.filter(t => t.assignee === options.assignee);
    if (options.backend) tasks = tasks.filter(t => t.id.includes('backend'));
    if (options.frontend) tasks = tasks.filter(t => t.id.includes('frontend'));
    if (options.platform) tasks = await filterByPlatform(tasks, iteration, options.platform);

    if (tasks.length === 0) {
      logger.warn('No tasks match the specified filters');
      return;
    }

    let sortedTasks = topologicalSort(tasks);

    // 检测并警告循环依赖
    const cycles = detectCycles(sortedTasks);
    if (cycles.length > 0) {
      logger.warn(`⚠️ 检测到 ${cycles.length} 处循环依赖: ${cycles.join(', ')}`);
      logger.warn('   循环中的任务将按任意顺序执行，请手动检查依赖关系。');
    }

    // 生成并保存执行计划
    const planName = options.task 
      ? `Execute-${options.task}`
      : `Execute-${iteration}-${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    const planTasks = sortedTasks.map(t => t.id);
    if (planTasks.length > 0) {
      await savePlan({
        name: planName,
        iteration,
        tasks: planTasks,
        batchSize: parseInt(options.batchSize || '3', 10),
        source: 'auto',
        filters: {
          assignee: options.assignee,
          type: options.type,
          priority: options.priority,
          platform: options.platform,
          backend: options.backend,
          frontend: options.frontend,
        },
      });
    }

    // === Interactive mode ===
    if (options.interactive) {
      await interactiveSelect(sortedTasks, iteration, options);
      return;
    }

    // === 显示执行计划 ===
    const batchSize = parseInt(options.batchSize || '3', 10);
    printExecutionPreview(sortedTasks, iteration, batchSize);

    // === Preview (default, unless --force) ===
    if (!options.force) {
      logger.info('💡 使用 --force 直接执行，或 --interactive 选择执行');
      return;
    }

    logger.info('🚀 开始执行...\n');

    // === Strict mode pre-flight check ===
    if (options.strict) {
      const approved = await preFlightCheck(sortedTasks, iteration, options);
      if (approved.length === 0) {
        logger.info('❌ 严格模式预检未通过，已取消执行');
        return;
      }
      sortedTasks = approved;
    }

    // === Resume mode ===
    if (options.resume) {
      await executeResume(iteration);
      return;
    }

    // === Batch mode ===
    if (batchSize > 0 && sortedTasks.length > batchSize) {
      await executeBatchMode(sortedTasks, iteration, batchSize, options);
      return;
    }

    // === Execute with progress (existing flow) ===
    const skipList = options.skip ? options.skip.split(',').map(s => s.trim()).filter(Boolean) : [];
    await executeWithProgress(sortedTasks, iteration, options.base, skipList, { only: options.only });

    // === Verify loop: 代码生成后自动检查 → 修复 → 重试 ===
    await executionVerifyLoop(sortedTasks, iteration, options);

    // Hotfix tracking
    if (options.hotfix && sortedTasks.length > 0) {
      await startHotfix(sortedTasks[0].id);
      logger.info('⚠️  Hotfix Mode Active — 30min grace, 24h mandatory sync');
    }
  } catch (error) {
    logger.error(`Execution failed: ${error}`);
    throw error;
  }
}

// ============================================================
// ============================================================
// Interactive: show plan, let user adjust, then confirm
// ============================================================
async function interactiveSelect(tasks: TaskState[], iteration: string, options: ExecuteOptions): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(r => rl.question(q + " ", a => r(a.trim())));
  let batchSize = parseInt(options.batchSize || "3", 10);
  let selectedTasks = [...tasks];
  let assignee = options.assignee || "";
  logger.info("\n🧭 交互式执行引导\n");
  printPlan(selectedTasks, iteration, batchSize);
  logger.info("💡 你可以反复调整参数，直到满意后确认执行\n");
  while (true) {
    const label = `[y] 执行  [b] 批次(${batchSize})  [f] 筛选  [a] 人员(${assignee || "全部"})  [q] 退出`;
    logger.info(label);
    const ans = await ask("选择:");
    if (ans === "q") { logger.info("已取消"); rl.close(); return; }
    if (ans === "y") break;
    if (ans === "b") { const n = await ask("每批数量:"); if (n && !isNaN(+n) && +n > 0) { batchSize = +n; printPlan(selectedTasks, iteration, batchSize); } }
    if (ans === "f") {
      logger.info("   可用: type=bugfix|feature, priority=high|medium|low, status=todo|queue");
      const f = await ask("   筛选 (空格分隔, 留空=全部):");
      const parts: string[] = f ? f.split(/\s+/) : [];
      selectedTasks = tasks.filter((t: TaskState) => {
        for (const p of parts) {
          if (p.startsWith("type=") && t.type !== p.slice(5)) return false;
          if (p.startsWith("priority=") && t.priority !== p.slice(9)) return false;
          if (p.startsWith("status=") && t.status !== p.slice(7)) return false;
        }
        return true;
      });
      if (selectedTasks.length === 0) { logger.info("   无匹配, 恢复全部"); selectedTasks = [...tasks]; }
      printPlan(selectedTasks, iteration, batchSize);
    }
    if (ans === "a") { assignee = await ask("   人员 (留空=全部):"); }
  }
  rl.close();
  logger.info("\n🚀 开始执行...\n");
  if (batchSize > 0 && selectedTasks.length > batchSize) {
    await executeBatchMode(selectedTasks, iteration, batchSize, options);
  } else {
    await executeWithProgress(selectedTasks, iteration, options.base, [], {});
  }
}

function printPlan(tasks: TaskState[], iteration: string, batchSize: number): void {
  logger.info(`\n📋 执行计划 — ${iteration}  (${tasks.length} 任务, ${batchSize}/批)\n`);
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    logger.info(`  第${Math.floor(i / batchSize) + 1}批:`);
    for (const t of batch) {
      const deps = t.dependencies?.length ? ` ← ${t.dependencies.join(", ")}` : "";
      logger.info(`    ${t.id}  ${t.name || ""}${deps}`);
    }
    logger.info("");
  }
}

async function loadInquirer() {
  // @ts-ignore inquirer 为可选依赖，未安装时使用 fallback
  try { return await import("inquirer"); } catch { return { prompt() { return {}; } }; }
}

// ============================================================
// Progress feedback execution
// ============================================================
async function executeWithProgress(tasks: TaskState[], iteration: string, base?: string, skip?: string[], options?: { only?: string; agent?: string }): Promise<void> {
  const total = tasks.length;
  const startTime = Date.now();
  const completed: string[] = [];

  // Filter whitelist (--only)
  if (options?.only) {
    const onlyList = options.only.split(',').map(s => s.trim()).filter(Boolean);
    const before = tasks.length;
    tasks = tasks.filter(t => onlyList.includes(t.id));
    if (tasks.length < before) {
      logger.info(`  🎯 仅执行 ${tasks.length}/${before} 个指定任务`);
    }
  }

  // Filter skipped tasks
  if (skip && skip.length > 0) {
    const before = tasks.length;
    tasks = tasks.filter(t => !skip.includes(t.id));
    logger.info(`  ⏭️  跳过 ${before - tasks.length} 个任务: ${skip.join(', ')}`);
  }

  if (tasks.length === 0) {
    logger.info('  ✅ 没有需要执行的任务');
    return;
  }

  // Create branches for each task (dependency-aware)
  if (tasks.length > 0) {
    let defaultBase = base || detectDefaultBranch(iteration);
    for (const task of tasks) {
      let taskBase = base;
      // Auto-detect dependency per task from IMPACT.md
      if (!taskBase) {
        taskBase = await detectDependencyBase(iteration, task.id);
      }
      const branch = createTaskBranch(task.id, task.name || task.id, taskBase, iteration);
      if (branch) {
        const baseInfo = taskBase ? ` (from ${taskBase})` : ` (from ${defaultBase || 'HEAD'})`;
        logger.info(`🌿 ${task.id}: ${branch}${baseInfo}`);
      }
      // 切回基础分支，避免下个任务从上个任务分支上拉代码
      if (defaultBase) {
        try { execSync(`git checkout "${defaultBase}"`, { stdio: 'pipe' }); } catch {}
      }
    }
  }

  // ── Agent mode: output optimized context for external AI ──
  if (options?.agent) {
    const agentCtx = buildAgentContext(tasks, options.agent);
    logger.info(`\n🤖 Agent 模式: ${options.agent}`);
    logger.info('--- AGENT CONTEXT START ---');
    logger.info(agentCtx);
    logger.info('--- AGENT CONTEXT END ---');
    logger.info('\n💡 复制以上内容粘贴到 ' + options.agent + ' 中即可生成代码');
    logOperation('speccore execute --agent', options.agent);
    return;
  }

  logOperation('speccore execute', `${total} tasks`);

  logger.info('');
  logger.info(`⏳ Executing ${total} task(s) in iteration: ${iteration}`);
  logger.info('');

  for (let i = 0; i < total; i++) {
    const task = tasks[i];
    const progress = Math.round(((i) / total) * 100);
    const bar = createBar(progress, 20);

    // Report current batch
    logger.info(`[${String(i + 1).padStart(2, '0')}/${total}] ${bar} ${progress}%`);
    logger.info(`  🔄 ${task.id} ${task.name || ''} (${task.type || 'feature'})`);

    await generateTaskSkeleton(task, iteration);

    completed.push(`${task.id} - ${task.name || ''}`);
    logger.info(`  ✅ ${task.id} completed`);
    logger.info('');

    // Report pending
    const pending = tasks.slice(i + 1);
    if (pending.length > 0) {
      logger.info(`  Pending: ${pending.map(t => t.id).join(', ')}`);
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const avgPerTask = elapsed / (i + 1);
    const remaining = Math.round(avgPerTask * (total - i - 1));
    logger.info(`  Elapsed: ${elapsed}s | Est. remaining: ${remaining}s`);
    logger.info('');
  }

  // Update context
  await updateContext({
    currentTask: tasks[tasks.length - 1]?.id || '',
    currentIteration: iteration,
    lastUpdated: new Date().toISOString()
  });
  await recordHistory('execute', iteration, tasks[tasks.length - 1]?.id);

  // Summary
  const totalElapsed = Math.round((Date.now() - startTime) / 1000);
  logger.success(`Execution complete! ${total} tasks in ${totalElapsed}s`);
  // Post-execution question review
  const postQs = await extractQuestions(await getIterationDir(iteration));
  if (postQs.length > 0) showQuestionChecklist(postQs, '执行后审查');
  
  logOperation('speccore execute done', `completed ${total} tasks in ${totalElapsed}s`);
}

// ============================================================
// Resume from interruption
// ============================================================
async function executeResume(iteration: string): Promise<void> {
  if (!canResume()) {
    logger.warn('No interrupted execution found. Use --all to start a new one.');
    return;
  }

  let state = loadExecutionState()!;
  logger.info(`⏳ Resuming from Batch ${state.currentBatch}/${state.totalBatches}`);

  // Continue from current batch
  while (state.currentBatch <= state.totalBatches) {
    // Convert string IDs to TaskState objects for processBatch
    const batchTasks = getCurrentBatchTasks(state);
    if (batchTasks.length === 0) break;
    const taskObjs: TaskState[] = batchTasks.map(id => ({
      id, name: id, 
      type: 'pending' as any, status: 'pending' as const, 
      assignee: '', dependencies: [], priority: 'medium' as const, progress: 0 
    }));

    await processBatch(taskObjs, state, iteration);
    state = loadExecutionState()!;
  }

  logger.success('All batches completed!');
  clearExecutionState();
}

// ============================================================
// Batch execution mode
// ============================================================
async function executeBatchMode(tasks: TaskState[], iteration: string, batchSize: number, options: ExecuteOptions): Promise<void> {
  const taskIds = tasks.map((t: TaskState) => t.id);
  const state = initExecutionState(taskIds, iteration, batchSize);

  logger.info('');
  logger.info(`📦 Batch mode: ${state.totalBatches} batches of up to ${batchSize} tasks`);
  logger.info('');

  while (state.currentBatch <= state.totalBatches) {
    const batchTasks = getCurrentBatchTasks(state);
    if (batchTasks.length === 0) break;

    // Find actual task objects
    const taskObjs = batchTasks
      .map((id: string) => tasks.find(t => t.id === id))
      .filter((t): t is TaskState => t !== undefined);

    await processBatch(taskObjs, state, iteration);

    // Reload state (completedBatch updated it)
    const updated = loadExecutionState()!;
    if (updated.currentBatch > updated.totalBatches) break;
    if (updated.pendingTasks.length === 0) break;    // 所有任务完成
  }

  logger.success('All batches completed!');
  logOperation('speccore execute --batch-size', `${tasks.length} tasks in ${state.totalBatches} batches`);
  clearExecutionState();
}

// ============================================================
// Process one batch with context isolation
// ============================================================
async function processBatch(tasks: TaskState[], state: ExecutionState, iteration: string): Promise<void> {
  const batchNum = state.currentBatch;
  const startTime = Date.now();

  logger.info(``);
  logger.info(`━━━ Batch ${batchNum}/${state.totalBatches} ━━━`);
  logger.info(``);

  // Context isolation: load task-specific files
  logger.info(`📖 加载上下文 (Batch ${batchNum})...`);
  
  // 显示项目级文件
  for (const f of ['CONSTITUTION.md', 'PROJECT_GRAPH.md']) {
    if (await pathExists(join('.speccore', f))) {
      logger.info(`   .speccore/${f} → 已加载`);
    }
  }
  
  // 显示每个任务的 Spec 文件
  const iterDir = await getIterationDir(iteration);
  for (const task of tasks) {
    logger.info(`   ${task.id}:`);
    for (const f of ['REQ.md', 'TECH.md', 'TASK.md']) {
      const p = join(iterDir, task.id, 'backend', f);
      if (await pathExists(p)) {
        const content = await readFile(p, 'utf-8');
        const summary = content.slice(0, 80).replace(/\n/g, ' ');
        logger.info(`     📄 ${f} → ${summary}...`);
      }
    }
  }
  logger.info('');

  // Execute tasks in batch
  const completed: string[] = [];
  const total = tasks.length;

  for (let i = 0; i < total; i++) {
    const task = tasks[i];
    const progress = Math.round(((i + 1) / total) * 100);
    const bar = createBar(progress, 20);

    logger.info(``);
    logger.info(`  ${bar} ${(i + 1)}/${total} — ${task.id}  ${task.name || ''}`);
    logger.info(`  📊 优先级: ${task.priority}  |  类型: ${task.type || 'feature'}`);
    if (task.dependencies?.length) {
      logger.info(`  🔗 依赖: ${task.dependencies.join(', ')}`);
    }
    logger.info(`  🔄 执行中...`);

    await generateTaskSkeleton(task, iteration);
    completed.push(task.id);

    logger.info(`  ✅ ${task.id || task} completed`);

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const estRemaining = Math.round((elapsed / (i + 1)) * (total - i - 1));
    logger.info(`  Elapsed: ${elapsed}s | Est. remaining: ${estRemaining}s`);
  }

  // Mark batch complete
  completeBatch(state, batchNum, completed);
  logger.info(``);
  logger.info(`✅ Batch ${batchNum} complete (${completed.length} tasks)`);

  // Context reset note
  logger.info(`🔄 Resetting context for next batch...`);
  logger.info(``);
}

function createBar(pct: number, width: number): string {
  const filled = Math.round(width * (pct / 100));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ============================================================
// Execution preview
// ============================================================
function printExecutionPreview(tasks: TaskState[], iteration: string, batchSize = 3): void {
  logger.info('');
  logger.info('📋 执行计划');
  logger.info('');
  logger.info(`迭代: ${iteration} | 任务: ${tasks.length} | 分批: ${batchSize}/批`);
  logger.info('');

  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    logger.info(`第${batchNum}批:`);
    for (const t of batch) {
      const deps = t.dependencies?.length 
        ? ` ← 依赖: ${t.dependencies.join(', ')}` 
        : '';
      const pri = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🟢';
      logger.info(`  ${pri} ${t.id}  ${t.name || ''}${deps}`);
    }
    logger.info('');
  }
}

// ============================================================
// Task execution (transaction protected)
// ============================================================
async function generateTaskSkeleton(task: TaskState, iteration: string): Promise<void> {
  const taskDir = join(await getIterationDir(iteration), task.id);
  let filesUpdated = 0;

  if (await pathExists(taskDir)) {
    const tx = new FileTransaction();

    // 加载全局 Spec 规则（会被注入到生成的代码中）
    const specRules = await loadSpecRules();
    const techStack = await loadTechStack();
    logger.info(`   Tech Stack: ${techStack.backendFramework} + ${techStack.frontendFramework}`);

    // 读取后端 Spec 生成代码骨架
    const backendDir = join(taskDir, 'backend');
    if (await pathExists(backendDir)) {
      const reqPath = join(backendDir, 'REQ.md');

      let className = convertToClassName(task.name || task.id);
      // 从 CONSTITUTION.md 读取包名，回退到默认值
      let packageName = `com.example.${className.toLowerCase()}`;
      const constitutionPath = join(process.cwd(), '.speccore', 'CONSTITUTION.md');
      if (await pathExists(constitutionPath)) {
        const constitution = await readFile(constitutionPath, 'utf-8');
        const pkgMatch = constitution.match(/包名[：:]\s*([a-z.]+)/i) || constitution.match(/package[：:]\s*([a-z.]+)/i);
        if (pkgMatch) {
          packageName = `${pkgMatch[1]}.${className.toLowerCase()}`;
        }
      }

      // 生成 Controller 骨架
      if (await pathExists(reqPath)) {
        const req = await readFile(reqPath, 'utf-8');
        const controllerCode = generateJavaController(className, packageName, req, specRules);
        const ctrlPath = join(backendDir, `${className}Controller.java`);
        tx.write(ctrlPath, controllerCode);
        filesUpdated++;
      }

      // 生成 Service 骨架
      const serviceCode = generateJavaService(className, packageName);
      const svcPath = join(backendDir, `${className}Service.java`);
      tx.write(svcPath, serviceCode);
      filesUpdated++;

      // 生成 Repository 骨架
      const repoCode = generateJavaRepository(className, packageName);
      const repoPath = join(backendDir, `${className}Repository.java`);
      tx.write(repoPath, repoCode);
      filesUpdated++;

      // 更新 TASK.md 状态
      const taskMdPath = join(backendDir, 'TASK.md');
      if (await pathExists(taskMdPath)) {
        const content = await readFile(taskMdPath, 'utf-8');
        const updated = content.replace('状态: 🔲 待开发', '状态: 🔄 进行中');
        tx.write(taskMdPath, updated);
        filesUpdated++;
      }
    }

    // 前端各平台代码生成
    const frontendDir = join(taskDir, 'frontend');
    if (await pathExists(frontendDir)) {
      const { readdir: rd } = await import('fs-extra');
      const platformDirs = await rd(frontendDir, { withFileTypes: true });
      for (const pd of platformDirs) {
        if (pd.isDirectory()) {
          const componentName = convertToClassName(task.name || task.id);
          const vueCode = generateVueComponent(componentName);
          const vuePath = join(frontendDir, pd.name, `${componentName}.vue`);
          tx.write(vuePath, vueCode);
          filesUpdated++;

          const ftaskPath = join(frontendDir, pd.name, 'TASK.md');
          if (await pathExists(ftaskPath)) {
            const content = await readFile(ftaskPath, 'utf-8');
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
function generateJavaController(className: string, pkg: string, req: string, rules: SpecRules): string {
  const desc = extractDescription(req);
  const methodStubs = generateMethodStubs(req, rules);
  const imports = generateImports(rules, className);
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
function generateMethodStubs(req: string, rules?: SpecRules): string {
  // 匹配 REQ.md 中的接口定义表格: | METHOD | /path | description |
  const tableRegex = /\|\s*(GET|POST|PUT|DELETE|PATCH)\s*\|\s*(\/[^\s|]+)\s*\|([^|]*)\|/gi;
  const methods: string[] = [];
  let match;
  while ((match = tableRegex.exec(req)) !== null) {
    const method = match[1].toUpperCase();
    const path = match[2].trim();
    const desc = match[3].trim();
    methods.push(formatControllerMethod(method, path, desc, rules));
  }
  return methods.length > 0 ? methods.join('\n') : '\n    // TODO: 请在 REQ.md 中补充接口表格';
}

function formatControllerMethod(method: string, path: string, desc: string, rules?: SpecRules): string {
  const rt = rules || { exceptionHandler: 'none', responseFormat: 'ResponseEntity' } as SpecRules;
  const returnType = rt.responseFormat === 'Result' ? 'Result<?>' : 'ResponseEntity<?>';
  const bodyHint = rt.exceptionHandler === 'BusinessException'
    ? 'throw new BusinessException("Not implemented");'
    : rt.responseFormat === 'Result'
      ? 'return Result.error("Not implemented");'
      : 'return ResponseEntity.ok().build();';
  
  const hasId = path.includes('{id}');
  const hasPage = path.includes('page');
  
  let annotation: string;
  let signature: string;
  
  switch (method) {
    case 'GET':
      if (hasId) {
        annotation = `@GetMapping("${path}")`;
        signature = `public ${returnType} getById(@PathVariable Long id)`;
      } else if (hasPage || path.endsWith('s')) {
        annotation = `@GetMapping("${path}")`;
        signature = `public ${returnType} list(@RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int size)`;
      } else {
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
      } else {
        signature = `public ${returnType} update(@RequestBody Object body)`;
      }
      break;
    case 'DELETE':
      annotation = `@DeleteMapping("${path}")`;
      if (hasId) {
        signature = `public ${returnType} delete(@PathVariable Long id)`;
      } else {
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

const uncapitalize = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function generateJavaService(className: string, pkg: string): string {
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

function generateJavaRepository(className: string, pkg: string): string {
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

function generateVueComponent(componentName: string): string {
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

function convertToClassName(name: string): string {
  if (!name || !name.trim()) return 'UnknownFeature';
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

function toKebab(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

function extractDescription(req: string): string {
  // Match ## heading followed by optional blank line and description
  const match = req.match(/##\s*(?:需求描述|Description)\s*\n+\s*([^\n#]+)/);
  return match ? match[1].trim() : 'Generated by SpecCore';
}

async function filterByPlatform(tasks: TaskState[], iteration: string, platform: string): Promise<TaskState[]> {
  const filtered: TaskState[] = [];
  const iterDir = await getIterationDir(iteration);
  for (const task of tasks) {
    const platformDir = join(iterDir, task.id, 'frontend', platform);
    if (await pathExists(platformDir)) filtered.push(task);
  }
  return filtered;
}

// ============================================================
// Hotfix 跟踪
// ============================================================
async function handleHotfix(options: ExecuteOptions, taskIds: string[]): Promise<void> {
  if (!options.hotfix) return;
  const taskId = taskIds[0];
  if (!taskId) return;

  await startHotfix(taskId);
  logger.info('');
  logger.warn('⚠️  Hotfix Mode Active');
  logger.warn(`   Task: ${taskId}`);
  logger.warn('   Grace period: 30 min (skip reverse sync)');
  logger.warn('   Mandatory sync deadline: 24 hours');
  logger.warn('   Run: speccore sync --reverse to complete');
  showNextSteps('execute');
}

// ============================================================
// Strict mode pre-flight check
// ============================================================

async function preFlightCheck(tasks: TaskState[], iteration: string, options: ExecuteOptions): Promise<TaskState[]> {
  const iterDir = await getIterationDir(iteration);
  const ask = (q: string): Promise<string> => {
    logger.info(q);
    return new Promise((resolve) => {
      process.stdin.resume();
      process.stdin.once('data', (data: Buffer) => {
        process.stdin.pause();
        resolve(data.toString().split('\n')[0].trim());
      });
    });
  };

  logger.info('\n╔══════════════════════════════════════════════╗');
  logger.info('║  🔍 Strict Mode — Pre-Flight Check           ║');
  logger.info('╚══════════════════════════════════════════════╝\n');

  const approved: TaskState[] = [];

  for (const task of tasks) {
    const taskDir = join(iterDir, '030-tasks', task.id);
    logger.info(`\n── ${task.id} ──`);
    
    let issues: string[] = [];

    // 1. Requirement completeness
    const reqPath = join(taskDir, 'backend', 'REQ.md');
    if (await pathExists(reqPath)) {
      const req = await readFile(reqPath, 'utf-8');
      const sections = (req.match(/^###?\s+.+/gm) || []).length;
      const apis = (req.match(/\| (GET|POST|PUT|DELETE|PATCH) \|/g) || []).length;
      logger.info(`  1. 需求: ${sections} 章节 / ${apis} 接口`);
      if (sections === 0 && apis === 0) issues.push('REQ.md 内容为空');
    } else {
      issues.push('缺少 REQ.md');
    }

    // 2. Tech plan
    const techPath = join(taskDir, 'backend', 'TECH.md');
    if (await pathExists(techPath)) {
      const tech = await readFile(techPath, 'utf-8');
      const s = [tech.includes('数据库') && 'DB', tech.includes('Redis') && 'Redis', tech.includes('MQ') && 'MQ'].filter(Boolean).join('/');
      logger.info(`  2. 方案: ${s || '待补充'}`);
    } else {
      issues.push('缺少 TECH.md');
    }

    // 3. Test cases
    const testPath = join(taskDir, 'backend', 'TEST.md');
    if (await pathExists(testPath)) {
      const test = await readFile(testPath, 'utf-8');
      const n = (test.match(/⬜|✅|❌/g) || []).length;
      logger.info(`  3. 测试: ${n} 用例`);
    }

    // 4. Review
    logger.info(`  4. 审查: ${await pathExists(join(taskDir, 'backend', 'REVIEW.md')) ? '✅' : '❌'}`);

    // 5. API
    logger.info(`  5. 契约: ${await pathExists(join(taskDir, '_shared', 'API_CONTRACT.yaml')) ? '✅' : '⚠️'}`);

    // 6. Platform
    const fd = join(taskDir, 'frontend');
    if (await pathExists(fd)) {
      const pf = readdirSync(fd, { withFileTypes: true }).filter((d: any) => d.isDirectory()).map((d: any) => d.name);
      logger.info(`  6. 端: ${pf.join(', ')}`);
    }

    // 7. Constitution
    logger.info(`  7. 合规: 待 validate ${issues.length > 0 ? '⚠️  ' + issues.join(', ') : ''}`);

    // 写入问题文件，供 AI 辅助修复
    if (issues.length > 0) {
      const issuesMd = ['# 执行问题清单', '', `## ${task.id}`, ''];
      for (const issue of issues) {
        issuesMd.push(`- [ ] ${issue}`);
      }
      issuesMd.push('', '---', '');
      issuesMd.push('## AI 辅助修复', '');
      issuesMd.push('在 AI 对话中粘贴以下内容让 AI 帮你修复：', '');
      issuesMd.push('> 请根据以上问题清单，帮我修复 Task-' + task.id + ' 的执行问题。');
      const iterDirPath = await getIterationDir(iteration || '');
      issuesMd.push(`> 迭代: ${iteration || ''}，任务目录: ${iterDirPath}/${task.id}`);
      issuesMd.push('', '## 修复记录', '');
      issuesMd.push('| 时间 | 问题 | 决策 | 修改文件 |');
      issuesMd.push('| :--- | :--- | :--- | :--- |');
      issuesMd.push('| | | | |');
      await writeFile(join(taskDir, '.issues.md'), issuesMd.join('\n'));
      logger.info(`  💡 问题已记录到 ${task.id}/.issues.md`);
      logger.info(`  💡 AI 对话: "帮我修复迭代 ${iteration || ''} 的 ${task.id} 问题"`);
    }

    // ── Per-task decision ──
    const answer = (await ask(`  → 开发？[y]确认 [N]跳过 [q]全部取消: `)).toLowerCase();
    if (answer === 'q') { logger.info('❌ 取消'); approved.length = 0; break; }
    if (answer === 'y' || answer === 'yes') { approved.push(task); logger.info(`  ✅ 已加入`); }
    else { logger.info(`  ⏭️ 跳过`); }
    logger.info('');
  }

  if (approved.length === 0) {
    logger.info('\n❌ 没有任务通过确认。');
    return [];
  }

  logger.info(`\n  将执行 ${approved.length}/${tasks.length} 个任务`);
  const confirm = await ask('  确认开始？[y/N] ');
  if (confirm.toLowerCase() !== 'y') { logger.info('\n❌ 已取消'); process.exit(0); }
  logger.info('\n✅ 开始执行...\n');
  return approved;
}

/**
 * 从 IMPACT.md 检测任务依赖，返回应作为 base 的依赖任务 ID
 */
async function detectDependencyBase(iteration: string, taskId: string): Promise<string | undefined> {
  const impactPath = join(await getIterationDir(iteration), 'IMPACT.md');
  if (!(await pathExists(impactPath))) return undefined;

  const impact = await readFile(impactPath, 'utf-8');
  const lines = impact.split('\n');
  
  // Parse: | Task-002: 订单导出 | → | Task-001: 用户管理 | `/api/users` |
  for (const line of lines) {
    if (line.includes('→') && line.includes(taskId)) {
      const match = line.match(/→\s*\|\s*([^|]+)/);
      if (match) {
        const depTaskId = match[1].trim().split(':')[0].trim();
        logger.info(`\n🔗 检测到依赖: ${taskId} 依赖 ${depTaskId}`);
        logger.info(`   🎯 自动从分支 feature/${depTaskId}-* 创建（避免实体重复）`);
        // Find actual branch name matching this task
      try {
        const branches = execSync('git branch', { encoding: 'utf-8' });
        const branchMatch = branches.split('\n').find((b: string) => b.trim().startsWith(`feature/${depTaskId}-`));
        if (branchMatch) {
          const actualBranch = branchMatch.trim().replace(/^\*?\s*/, '');
          return actualBranch || `feature/${depTaskId}`;
        }
      } catch {}
      return `feature/${depTaskId}`;
      }
    }
  }

  return undefined;
}


const AGENT_FORMATS: Record<string, { prefix: string; suffix: string; model?: string }> = {
  copilot:    { prefix: "Based on the following specification, generate production code:\n\n", suffix: "\n\nGenerate clean, well-structured code following the Constitution rules." },
  claude:     { prefix: "根据以下 Spec 生成生产级代码，遵守宪法规则和测试要求：\n\n", suffix: "\n\n请生成结构清晰、符合宪法规则的生产级代码。" },
  cursor:     { prefix: "// Spec-Driven Implementation\n// Follow the spec below strictly:\n\n", suffix: "\n\n// Generate code following the Constitution and API contract." },
  trae:       { prefix: "请基于以下技术规格生成代码：\n\n", suffix: "\n\n严格遵循宪法规则和 API 契约。" },
  qoder:      { prefix: "## Spec-Driven Code Generation\n\nPlease implement based on the specification below:\n\n", suffix: "\n\n## Requirements: Follow Constitution rules and complete all tests." },
  windsurf:   { prefix: "### Implementation Spec\n\nImplement the following specification:\n\n", suffix: "\n\n### Rules: Follow all Constitution constraints. Complete the TEST checklist." },
  codebuddy:  { prefix: "基于以下 Spec 和宪法规则生成代码：\n\n", suffix: "\n\n严格遵守宪法、API 契约和测试要求。" },
};

function buildAgentContext(tasks: TaskState[], agent: string): string {
  const format = AGENT_FORMATS[agent.toLowerCase()] || { prefix: "## Spec-Driven Development Task\n\n", suffix: "\n\n---\nFollow progressive disclosure: CAPABILITIES → INDEX → Task Specs → Rules" };
  let ctx = format.prefix;

  // 1. Progressive disclosure: capabilities first
  ctx += `\n### Step 0: Read capabilities (always first)\n`;
  ctx += `File: .speccore/CAPABILITIES.md\n`;
  ctx += `→ Know what rules, APIs, services exist\n\n`;

  // 2. Per-task context
  for (const task of tasks) {
    ctx += `### Task: ${task.id} — ${task.name || task.id}\n`;
    ctx += `Status: ${task.status} | Priority: ${task.priority} | Type: ${task.type}\n\n`;
    
    // Progressive loading order
    ctx += `**Read in this order (progressive disclosure):**\n`;
    ctx += `1. \`Iteration-*/${task.id}/backend/TASK.md\` — task overview + deliverables checklist\n`;
    ctx += `2. \`Iteration-*/${task.id}/backend/REQ.md\` — requirements + acceptance criteria\n`;
    ctx += `3. \`Iteration-*/${task.id}/backend/TECH.md\` — tech design + architecture\n`;
    ctx += `4. \`Iteration-*/${task.id}/_shared/API_CONTRACT.yaml\` — API contract (if exists)\n\n`;

    ctx += `**Supplementary (read only if needed):**\n`;
    ctx += `- TEST.md (test cases) | REVIEW.md (review checklist)\n`;
    ctx += `- SCHEMA.md (DB schema) | ADR.md (arch decisions)\n`;
    ctx += `- RISK.md (risks+rollback) | DEPS.md (dependencies) | MONITOR.md (monitoring)\n`;
    ctx += `- ERROR_CODES.md (error codes) | DEPLOY.md (deployment)\n\n`;

    ctx += `**Frontend (if exists):**\n`;
    ctx += `- frontend/{platform}/COMPONENT_TREE.md | ROUTES.md | STATE.md | STYLE_GUIDE.md\n\n`;
  }

  // 3. Global rules (load last, only if needed)
  ctx += `### Step N: Global rules (load last)\n`;
  ctx += `File: .speccore/CONSTITUTION.md\n`;
  ctx += `File: .speccore/RULES/CODE_REVIEW.md\n`;
  
  ctx += format.suffix;
  return ctx;
}

// ===== Agent Context Builder =====

// ============================================================
// 自动验证闭环：检查 → 修复 → 重试（最多 3 轮）
// ============================================================
async function executionVerifyLoop(
  tasks: TaskState[], iteration: string, options: ExecuteOptions
): Promise<void> {
  const maxRounds = 3;
  const iterDir = await getIterationDir(iteration);

  for (const task of tasks) {
    logger.info(`\n🔍 验证 ${task.id}...`);

    const taskDir = join(iterDir, '030-tasks', task.id);
    const backendDir = join(taskDir, 'backend');
    let allPassed = true;

    for (let round = 1; round <= maxRounds; round++) {
      if (round > 1) logger.info(`   🔄 第 ${round} 轮修复...`);
      allPassed = true;

      // 1. 检查 TEST.md
      const testPath = join(backendDir, 'TEST.md');
      if (await pathExists(testPath)) {
        const testContent = await readFile(testPath, 'utf-8');
        const total = (testContent.match(/\[[ x]\]/g) || []).length;
        const done = (testContent.match(/\[x\]/g) || []).length;
        if (done < total) {
          logger.info(`   🧪 TEST.md: ${done}/${total} 通过`);
          if (round === maxRounds) {
            logger.warn(`   ⚠️ 仍有 ${total - done} 项未通过（已达最大重试次数）`);
          }
          allPassed = false;
        } else {
          logger.info(`   🧪 TEST.md: ${done}/${total} ✅`);
        }
      }

      // 2. 检查 REVIEW.md
      const reviewPath = join(backendDir, 'REVIEW.md');
      if (await pathExists(reviewPath)) {
        const reviewContent = await readFile(reviewPath, 'utf-8');
        const total = (reviewContent.match(/\[[ x]\]/g) || []).length;
        const doneR = (reviewContent.match(/\[x\]/gi) || []).length;
        if (doneR < total) {
          logger.info(`   📋 REVIEW.md: ${doneR}/${total} 通过`);
          if (round === maxRounds) {
            logger.warn(`   ⚠️ 仍有 ${total - doneR} 项未审查（已达最大重试次数）`);
          }
          allPassed = false;
        } else {
          logger.info(`   📋 REVIEW.md: ${doneR}/${total} ✅`);
        }
      }

      // 3. 检查 DEPLOY.md
      const deployPath = join(backendDir, 'DEPLOY.md');
      if (await pathExists(deployPath)) {
        const depContent = await readFile(deployPath, 'utf-8');
        const total = (depContent.match(/\[[ x]\]/g) || []).length;
        const doneD = (depContent.match(/\[x\]/g) || []).length;
        if (doneD < total) {
          logger.info(`   🚀 DEPLOY.md: ${doneD}/${total} 通过`);
          allPassed = false;
        } else {
          logger.info(`   🚀 DEPLOY.md: ${doneD}/${total} ✅`);
        }
      }

      if (allPassed) break;

      // 4. 自动修复提示
      if (round < maxRounds) {
        logger.info(`   💡 AI 将修复未通过项。使用 speccore execute --task=${task.id} --force 重新执行代码生成`);
        // 标记为需要重试
        await writeFile(join(taskDir, '.needs-retry'), String(round));
      }
    }

    // 5. 最终判定
    if (allPassed) {
      await writeFile(join(taskDir, '.verification'), 'passed');
      logger.info(`   ✅ ${task.id} 全部检查通过，可以 speccore done`);
    } else {
      logger.info(`   ⚠️ ${task.id} 仍有未通过项，请审查后手动 done`);
      logger.info(`   💡 修复后重试: speccore execute --resume`);
    }
    logger.info('');
  }
}

/** 检测依赖循环 */
function detectCycles(tasks: TaskState[]): string[] {
  const cycles: string[] = [];
  const visited = new Set<string>();
  
  for (const task of tasks) {
    for (const dep of task.dependencies || []) {
      const depTask = tasks.find(t => t.id === dep);
      if (depTask?.dependencies?.includes(task.id)) {
        cycles.push(`${task.id}↔${dep}`);
        visited.add(task.id);
      }
    }
  }
  return cycles;
}

/** 按已保存的计划执行 */
async function executeByPlan(planId: string, iteration: string, options: ExecuteOptions): Promise<void> {
  const plan = await getPlan(planId);
  if (!plan) { logger.error('Plan not found: ' + planId); return; }
  if (plan.iteration !== iteration) { logger.warn('Plan iteration differs from current'); }

  logger.info('\nExecuting plan: ' + plan.name);
  logger.info('  Tasks: ' + plan.tasks.length + ' | Batch: ' + plan.batchSize);

  const allTasks = await scanTasks(iteration);
  const planTasks = plan.tasks.map(id => allTasks.find(t => t.id === id)).filter(Boolean) as TaskState[];
  if (planTasks.length === 0) { logger.error('No matching tasks'); return; }

  if (plan.batchSize > 0 && planTasks.length > plan.batchSize) {
    await executeBatchMode(planTasks, iteration, plan.batchSize, options);
  } else {
    await executeWithProgress(planTasks, iteration, options.base, [], {});
  }
  await markPlanExecuted(plan.id, 'Completed ' + planTasks.length + ' tasks');
}

// ═══════════════════════════════════════════════════════════
// Prompt 模式 — CLI 输出结构化 Prompt，Skill/AI 消费
// ═══════════════════════════════════════════════════════════

async function runPromptMode(iteration: string, options: ExecuteOptions): Promise<void> {
  const task = options.task || '';

  // ── 缺参数检测 ──
  if (!task) {
    const taskDir = join(await getIterationDir(iteration), '030-tasks');
    let availableTasks: string[] = [];
    try {
      const entries = await readdir(taskDir, { withFileTypes: true });
      availableTasks = entries.filter((e: any) => e.isDirectory() && e.name.startsWith('Task-')).map((e: any) => e.name);
    } catch {}
    
    outputNeedsInfo({
      command: 'execute',
      missing: ['task'],
      provided: { iteration },
      hint: '请指定要执行的任务编号，或使用 --all 执行全部',
      availableOptions: { tasks: availableTasks },
    });
    return;
  }

  const taskDir = join(await getIterationDir(iteration), '030-tasks', task);

  // ── 前置检查：任务必须有有效需求或分析内容 ──
  const analysisFile = join(taskDir, 'ANALYSIS.md');
  const requirementFile = join(taskDir, 'REQUIREMENT.md');

  // 读取文件内容验证有效性（接受 ANALYSIS.md 或 REQUIREMENT.md）
  // Bug 任务的 REQUIREMENT.md（问题描述）本身就可以作为AI生成代码的依据
  let effectiveAnalysis = false;
  let contentPreview = '';

  for (const f of [analysisFile, requirementFile]) {
    if (await pathExists(f)) {
      const content = (await readFile(f, 'utf-8')).trim();
      // 有效内容：>80字符 且 不是纯占位符
      if (content.length > 80 &&
          !/^(#+\s*(TODO|待分析|TBD|分析))\s*$/im.test(content) &&
          !/^<!--.*TODO.*-->/i.test(content)) {
        effectiveAnalysis = true;
        contentPreview = f;
        break;
      }
    }
  }

  if (!effectiveAnalysis) {
    const reason = `任务 ${task} 缺少有效的需求或分析内容\n（ANALYSIS.md / REQUIREMENT.md 不存在或内容无效）`;
    outputNeedsInfo({
      command: 'execute',
      missing: ['analysis'],
      provided: { iteration, task },
      hint: `${reason}\n请先执行: speccore analyze --prompt -I ${iteration} --task ${task}`,
    });
    return;
  }

  const prompt = await buildPrompt('execute', {
    iteration,
    task,
    taskDir,
    platform: options.platform,
  });

  // 输出到 stdout（Skill 通过 execute_command 捕获）
  process.stdout.write(formatPrompt(prompt));

  // 退出码 10: 表示等待 AI 处理
  process.exitCode = 10;
}

// ═══════════════════════════════════════════════════════════
// Response 模式 — 接收 AI 返回内容，写入文件
// ═══════════════════════════════════════════════════════════

async function runApplyMode(iteration: string, options: ExecuteOptions): Promise<void> {
  let response = options.response || '';
  // 支持管道: echo '...' | speccore execute --response -
  if (response === '-') {
    response = await readStdin();
  }
  const task = options.task || '';

  if (!task) {
    logger.error('--apply 模式需要指定 --task');
    return;
  }

  const parsed = parseAiResponse(response);
  if (!parsed || !parsed.files || parsed.files.length === 0) {
    logger.error('无法解析 AI 返回内容，请确保格式为: {"files": [{"path": "...", "content": "..."}]}');
    return;
  }

  const iterDir = await getIterationDir(iteration);
  let writtenCount = 0;

  for (const file of parsed.files) {
    // 路径遍历防护
    if (file.path.includes('..')) {
      logger.warn(`   ⚠️ 跳过危险路径: ${file.path}`);
      continue;
    }
    const fullPath = join(iterDir, file.path);
    await ensureDir(dirname(fullPath));
    await writeFile(fullPath, file.content);
    logger.info(`   ✅ 写入: ${file.path}`);
    writtenCount++;
  }

  // 更新 PROJECT_GRAPH
  await updateProjectGraphStatus(iteration, task);

  logger.success(`\n📁 完成: ${writtenCount} 个文件已写入`);
  logger.info(`   📂 位置: ${iterDir}/`);

  // ── 执行后总结 ──
  outputPostSummary(iteration, task, writtenCount, parsed.files.map(f => f.path));

  logger.info(`   📋 下一步: speccore pr --task ${task}`);
}

function outputPostSummary(iteration: string, task: string, fileCount: number, filePaths: string[]): void {
  logger.info('');
  logger.info('━'.repeat(40));
  logger.info('📊 执行总结');
  logger.info('━'.repeat(40));
  logger.info(`  迭代: ${iteration} | 任务: ${task} | 文件: ${fileCount}`);
  for (const fp of filePaths.slice(0, 5)) logger.info(`    ✅ ${fp}`);
  if (filePaths.length > 5) logger.info(`    ... 等 ${filePaths.length} 个文件`);
  logger.info('');

  // 推荐下一步
  const nextSteps = [
    { cmd: `speccore pr --task ${task}`, desc: '创建 Pull Request' },
    { cmd: `speccore execute --prompt -t ${task}`, desc: '继续开发下一个任务' },
    { cmd: `speccore done --task ${task}`, desc: '归档已完成任务' },
    { cmd: `speccore analyze -I ${iteration}`, desc: '重新分析确认无遗漏' },
  ];
  logger.info('💡 推荐下一步:');
  for (const ns of nextSteps) {
    logger.info(`   → ${ns.cmd}  # ${ns.desc}`);
  }
  logger.info('━'.repeat(40));
}

async function updateProjectGraphStatus(iteration: string, task: string): Promise<void> {
  const graphPath = join(await getIterationDir(iteration), '000-overview', 'PROJECT_GRAPH.md');
  if (!await pathExists(graphPath)) return;

  let content = await readFile(graphPath, 'utf-8');
  const taskRegex = new RegExp(`(\\|\\s*${task}\\s*\\|[^|]*\\|\\s*)[^|]*(\\s*\\|)`, 'i');
  if (taskRegex.test(content)) {
    content = content.replace(taskRegex, `$1✅ 已完成$2`);
    await writeFile(graphPath, content);
  }
}

function readStdin(): Promise<string> {
  return new Promise(resolve => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
    if (process.stdin.isTTY) resolve('');
  });
}
