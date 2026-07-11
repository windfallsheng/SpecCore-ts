import { pathExists, readdir, readFile, ensureDir } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import { getDefaultIteration, updateContext, recordHistory } from '../core/context';
import { scanTasks, topologicalSort } from '../core/state';
import { FileTransaction } from '../core/transaction';
import { logOperation } from '../core/operation-log';
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
  batch?: string;
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
    if (options.task) tasks = tasks.filter(t => t.id === options.task);
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
    await executeWithProgress(sortedTasks, iteration);
  } catch (error) {
    logger.error(`Execution failed: ${error}`);
    throw error;
  }
}

// ============================================================
// Interactive selection (real prompt via inquirer)
// ============================================================
async function interactiveSelect(tasks: any[], iteration: string, options: ExecuteOptions): Promise<void> {
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
    const choices = tasks.map((t: any) => ({
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

    selectedTasks = tasks.filter((t: any) => picked.includes(t.id));
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

  await executeWithProgress(selectedTasks, iteration);
}

async function loadInquirer(): Promise<any> {
  try {
    return await import('inquirer');
  } catch {
    // Fallback for environments without inquirer
    return {
      prompt: async (questions: any[]) => {
        logger.info('⚠️ Inquirer not available, auto-selecting defaults.');
        const result: any = {};
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
async function executeWithProgress(tasks: any[], iteration: string): Promise<void> {
  const total = tasks.length;
  const startTime = Date.now();
  const completed: string[] = [];

  // Auto-create git branch for single task
  if (tasks.length === 1) {
    const task = tasks[0];
    const branch = createTaskBranch(task.id, task.name || 'feature');
    if (branch) {
      logger.info(`🌿 Created branch: ${branch}`);
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
    const batchTasks = getCurrentBatchTasks(state);
    if (batchTasks.length === 0) break;

    await processBatch(batchTasks, state, iteration);
    state = loadExecutionState()!;
  }

  logger.success('All batches completed!');
  clearExecutionState();
}

// ============================================================
// Batch execution mode
// ============================================================
async function executeBatchMode(tasks: any[], iteration: string, batchSize: number, options: ExecuteOptions): Promise<void> {
  const taskIds = tasks.map((t: any) => t.id);
  const state = initExecutionState(taskIds, iteration, batchSize);

  logger.info('');
  logger.info(`📦 Batch mode: ${state.totalBatches} batches of up to ${batchSize} tasks`);
  logger.info('');

  while (state.currentBatch <= state.totalBatches) {
    const batchTasks = getCurrentBatchTasks(state);
    if (batchTasks.length === 0) break;

    // Find actual task objects
    const taskObjs = batchTasks
      .map((id: string) => tasks.find((t: any) => t.id === id))
      .filter(Boolean);

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
async function processBatch(tasks: any[], state: ExecutionState, iteration: string): Promise<void> {
  const batchNum = state.currentBatch;
  const startTime = Date.now();

  logger.info(``);
  logger.info(`━━━ Batch ${batchNum}/${state.totalBatches} ━━━`);
  logger.info(``);

  // Context isolation: simulate context loading
  logger.info(`📖 Loading context for batch ${batchNum}...`);
  logger.info(`   CONSTITUTION.md → architecture constraints`);
  logger.info(`   PROJECT_GRAPH.md → dependency status`);
  logger.info(`   Tasks: ${tasks.map((t: any) => t.id || t).join(', ')}`);

  // Execute tasks in batch
  const completed: string[] = [];
  const total = tasks.length;
  const progressBar = createBar(0, 20);

  for (let i = 0; i < total; i++) {
    const task = tasks[i];
    const progress = Math.round(((i + 1) / total) * 100);
    const bar = createBar(progress, 20);

    logger.info(``);
    logger.info(`  ${bar} ${(i + 1)}/${total} — ${task.id || task} ${task.name || ''}`);
    logger.info(`  🔄 Executing...`);

    await simulateTaskExecution(task, iteration);
    completed.push(task.id || task);

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
function printExecutionPreview(tasks: any[], iteration: string): void {
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
async function simulateTaskExecution(task: any, iteration: string): Promise<void> {
  const taskDir = join(`期次-${iteration}`, task.id);
  let filesUpdated = 0;

  if (await pathExists(taskDir)) {
    const tx = new FileTransaction();

    // 读取后端 Spec 生成代码骨架
    const backendDir = join(taskDir, 'backend');
    if (await pathExists(backendDir)) {
      const reqPath = join(backendDir, 'REQ.md');
      const techPath = join(backendDir, 'TECH.md');
      const contractPath = join(taskDir, '_shared', 'API_CONTRACT.yaml');

      let className = convertToClassName(task.name || task.id);
      let packageName = task.name ? task.name.replace(/[^\w]/g, '-').toLowerCase() : 'feature';

      // 生成 Controller 骨架
      if (await pathExists(reqPath)) {
        const req = await readFile(reqPath, 'utf-8');
        const controllerCode = generateJavaController(className, packageName, req);
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
function generateJavaController(className: string, pkg: string, req: string): string {
  const desc = extractDescription(req);
  return `package ${pkg}.controller;

import org.springframework.web.bind.annotation.*;
import org.springframework.beans.factory.annotation.Autowired;
import ${pkg}.service.${className}Service;

/**
 * ${desc}
 * Generated by SpecCore execute
 */
@RestController
@RequestMapping("/api/v1")
public class ${className}Controller {

    @Autowired
    private ${className}Service ${className.substring(0, 1).toLowerCase() + className.substring(1)}Service;

    // TODO: Add endpoints based on API_CONTRACT.yaml
}
`;
}

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
  return name
    .split(/[-\s_]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
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

async function filterByPlatform(tasks: any[], iteration: string, platform: string): Promise<any[]> {
  const filtered: any[] = [];
  const iterDir = join(process.cwd(), `期次-${iteration}`);
  for (const task of tasks) {
    const platformDir = join(iterDir, task.id, 'frontend', platform);
    if (await pathExists(platformDir)) filtered.push(task);
  }
  return filtered;
}
