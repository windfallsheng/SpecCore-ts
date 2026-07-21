import { pathExists, readFile } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import { getDefaultIteration, updateContext, recordHistory, startHotfix } from '../core/context';
import { scanTasks, topologicalSort, TaskState } from '../core/state';
import { FileTransaction } from '../core/transaction';
import { loadSpecRules, generateImports, SpecRules, loadTechStack } from '../core/spec-rules';

import { logOperation } from '../core/operation-log';
import { showNextSteps } from '../core/next-steps';
import {
  initExecutionState,
  loadExecutionState,
  completeBatch,
  clearExecutionState,
  getCurrentBatchTasks,
  canResume,
  ExecutionState,
} from '../core/execution-state';
import { createTaskBranch } from '../core/git-integration';

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
  strict?: boolean;
  base?: string;       // base branch for task branching   // 严格模式: 编码前逐项确认
}

export async function executeCommand(options: ExecuteOptions): Promise<void> {
  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      logger.error('No active iteration found. Please specify --iteration or create one first.');
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

    const sortedTasks = topologicalSort(tasks);

    // === Interactive mode ===
    if (options.interactive) {
      await interactiveSelect(sortedTasks, iteration, options);
      return;
    }

    // === Dry run ===
    if (options.dryRun) {
      printExecutionPreview(sortedTasks, iteration);
      logOperation(`speccore execute --dry-run`, `${sortedTasks.length} tasks`);
      return;
    }

    // === Strict mode: pre-flight check before executing ===
    if (options.strict) {
      const approved = await preFlightCheck(sortedTasks, iteration, options);
      if (approved.length === 0) return;
      sortedTasks.length = 0;
      sortedTasks.push(...approved);
    }

    // === Preview (default, unless --force) ===
    if (!options.force) {
      printExecutionPreview(sortedTasks, iteration);
      logger.info('');
      logger.info('💡 Use --force to execute directly, or --interactive to select');
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
    await executeWithProgress(sortedTasks, iteration, options.base);

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
// Interactive selection (real prompt via inquirer)
// ============================================================
async function interactiveSelect(tasks: TaskState[], iteration: string, options: ExecuteOptions): Promise<void> {
  const inquirer = await loadInquirer();

  logger.info('');
  logger.info(`📋 Preparing ${tasks.length} tasks:`);
  logger.info('');

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const pri = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🟢';
    logger.info(`  ${i + 1}. ${t.id} ${t.name || ''} ${pri}`);
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
    logger.info('Cancelled.');
    return;
  }

  let selectedTasks = tasks;

  if (mode === 'select') {
    const choices = tasks.map((t: TaskState) => ({
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
      logger.info('No tasks selected. Cancelled.');
      return;
    }

    selectedTasks = tasks.filter((t: TaskState) => picked.includes(t.id));
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
    logger.info('Cancelled.');
    return;
  }

  await executeWithProgress(selectedTasks, iteration, options.base);
}

async function loadInquirer(): Promise<any> {
  try {
    return await import('inquirer');
  } catch {
    // Fallback for environments without inquirer
    return {
      prompt: async (questions: { name: string }[]) => {
        logger.info('⚠️ Inquirer not available, auto-selecting defaults.');
        const result: Record<string, unknown> = {};
        for (const q of questions) {
          if (q.name === 'mode') result[q.name] = 'all';
          if (q.name === 'picked') result[q.name] = [];
          if (q.name === 'confirm') result[q.name] = true;
        }
        return result;
      },
    };
  }
}

// ============================================================
// Progress feedback execution
// ============================================================
async function executeWithProgress(tasks: TaskState[], iteration: string, base?: string): Promise<void> {
  const total = tasks.length;
  const startTime = Date.now();
  const completed: string[] = [];

  // Auto-create git branch for single task
  if (tasks.length === 1) {
    const task = tasks[0];
    
    // Auto-detect dependency base from IMPACT.md
    if (!base) {
      base = await detectDependencyBase(iteration, task.id);
    }
    
    const branch = createTaskBranch(task.id, task.name || 'feature', base);
    if (branch) {
      const baseInfo = base ? ` (from ${base})` : '';
      logger.info(`🌿 Created branch: ${branch}${baseInfo}`);
    }
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

    await simulateTaskExecution(task, iteration);

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
    const taskObjs: TaskState[] = batchTasks.map(id => ({ id, name: id, type: 'unknown', status: 'pending' as const, assignee: '', dependencies: [], priority: 'medium' as const, progress: 0 }));

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

  // Context isolation: simulate context loading
  logger.info(`📖 Loading context for batch ${batchNum}...`);
  logger.info(`   CONSTITUTION.md → architecture constraints`);
  logger.info(`   PROJECT_GRAPH.md → dependency status`);
  logger.info(`   Tasks: ${tasks.map(t => t.id).join(', ')}`);

  // Execute tasks in batch
  const completed: string[] = [];
  const total = tasks.length;

  for (let i = 0; i < total; i++) {
    const task = tasks[i];
    const progress = Math.round(((i + 1) / total) * 100);
    const bar = createBar(progress, 20);

    logger.info(``);
    logger.info(`  ${bar} ${(i + 1)}/${total} — ${task.id} ${task.name}`);
    logger.info(`  🔄 Executing...`);

    await simulateTaskExecution(task, iteration);
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
function printExecutionPreview(tasks: TaskState[], iteration: string): void {
  logger.info('');
  logger.info('📋 Execution Preview');
  logger.info('');
  logger.info(`Iteration: ${iteration}`);
  logger.info(`Tasks: ${tasks.length}`);
  logger.info('');

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const icon = i === 0 ? '🔄' : '⏳';
    const pri = t.priority === 'high' ? '[HIGH]' : t.priority === 'medium' ? '[MED]' : '[LOW]';
    logger.info(`  ${icon} ${t.id} ${pri} - ${t.name || 'unnamed'}`);
  }
  logger.info('');
}

// ============================================================
// Task execution (transaction protected)
// ============================================================
async function simulateTaskExecution(task: TaskState, iteration: string): Promise<void> {
  const taskDir = join(`期次-${iteration}`, task.id);
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
      // 使用安全的 Java 包名：com.example.{className小写}
      let packageName = `com.example.${className.toLowerCase()}`;

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
  const iterDir = join(process.cwd(), `期次-${iteration}`);
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
  const iterDir = `期次-${iteration}`;
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
    const taskDir = join(iterDir, task.id);
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
      const pf = require('fs').readdirSync(fd, { withFileTypes: true }).filter((d: any) => d.isDirectory()).map((d: any) => d.name);
      logger.info(`  6. 端: ${pf.join(', ')}`);
    }

    // 7. Constitution
    logger.info(`  7. 合规: 待 validate ${issues.length > 0 ? '⚠️  ' + issues.join(', ') : ''}`);

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
  const impactPath = join(`期次-${iteration}`, 'IMPACT.md');
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
        const branches = require('child_process').execSync('git branch', { encoding: 'utf-8' });
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
