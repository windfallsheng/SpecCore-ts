/**
 * Execution State — 执行状态追踪
 *
 * 管理分批执行的状态：批次划分、断点续传、进度记录
 * 状态文件：.speccore/local/execution-state.json
 */

import { ensureFileSync, readFileSync, writeFileSync, existsSync } from 'fs-extra';
import { join } from 'path';

export interface TaskSummary {
  taskId: string;
  taskName: string;
  type: string;
  status: 'completed' | 'failed' | 'skipped';
  summary: string;          // 一句话摘要（AI 生成或自动提取）
  outputs: string[];         // 关键产出文件路径（相对任务目录）
  dependencies: string[];    // 依赖的任务 ID
  completedAt: string;
}

export interface ExecutionState {
  iteration: string;
  totalBatches: number;
  currentBatch: number;
  batchSize: number;
  totalTasks: number;
  completedTasks: string[];
  failedTasks: string[];
  pendingTasks: string[];
  batchStatus: Record<string, BatchStatus>;
  taskSummaries: Record<string, TaskSummary>;
  contextSummary?: string;   // 紧凑的上下文摘要，供新会话快速恢复
  startedAt: string;
  updatedAt: string;
}

export interface BatchStatus {
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  tasks: string[];
  startedAt?: string;
  completedAt?: string;
}

const STATE_PATH = '.speccore/local/execution-state.json';

/**
 * 初始化执行状态
 */
export function initExecutionState(
  tasks: string[],
  iteration: string,
  batchSize: number = 3
): ExecutionState {
  const batches = chunkArray(tasks, batchSize);
  const batchStatus: Record<string, BatchStatus> = {};

  batches.forEach((batch, i) => {
    batchStatus[String(i + 1)] = {
      status: i === 0 ? 'in_progress' : 'pending',
      tasks: batch,
    };
  });

  const state: ExecutionState = {
    iteration,
    totalBatches: batches.length,
    currentBatch: 1,
    batchSize,
    totalTasks: tasks.length,
    completedTasks: [],
    failedTasks: [],
    pendingTasks: tasks.slice(),
    batchStatus,
    taskSummaries: {},
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  saveExecutionState(state);
  return state;
}

/**
 * 加载执行状态
 */
export function loadExecutionState(): ExecutionState | null {
  try {
    if (!existsSync(STATE_PATH)) return null;
    const raw = readFileSync(STATE_PATH, 'utf-8');
    return JSON.parse(raw) as ExecutionState;
  } catch {
    return null;
  }
}

/**
 * 保存执行状态
 */
export function saveExecutionState(state: ExecutionState): void {
  state.updatedAt = new Date().toISOString();
  ensureFileSync(STATE_PATH);
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * 标记批次完成
 */
export function completeBatch(state: ExecutionState, batchNum: number, completedTasks: string[]): ExecutionState {
  const batch = state.batchStatus[String(batchNum)];
  if (batch) {
    batch.status = 'completed';
    batch.completedAt = new Date().toISOString();
  }

  state.completedTasks.push(...completedTasks);
  state.pendingTasks = state.pendingTasks.filter((t) => !completedTasks.includes(t));

  // 移动到下一个批次
  const nextBatch = batchNum + 1;
  if (state.batchStatus[String(nextBatch)]) {
    state.currentBatch = nextBatch;
    state.batchStatus[String(nextBatch)].status = 'in_progress';
    state.batchStatus[String(nextBatch)].startedAt = new Date().toISOString();
  } else {
    // 已经是最后一个批次，标记完成
    state.currentBatch = nextBatch;
  }

  saveExecutionState(state);
  return state;
}

/**
 * 标记任务失败
 */
export function failTask(state: ExecutionState, taskId: string): ExecutionState {
  if (!state.failedTasks.includes(taskId)) {
    state.failedTasks.push(taskId);
  }
  state.pendingTasks = state.pendingTasks.filter((t) => t !== taskId);
  saveExecutionState(state);
  return state;
}

/**
 * 记录单个任务的执行摘要
 */
export function addTaskSummary(
  state: ExecutionState,
  summary: TaskSummary
): ExecutionState {
  state.taskSummaries[summary.taskId] = summary;
  // 同步更新 completedTasks / failedTasks
  if (summary.status === 'completed' && !state.completedTasks.includes(summary.taskId)) {
    state.completedTasks.push(summary.taskId);
  } else if (summary.status === 'failed' && !state.failedTasks.includes(summary.taskId)) {
    state.failedTasks.push(summary.taskId);
  }
  state.pendingTasks = state.pendingTasks.filter(
    t => t !== summary.taskId
  );
  saveExecutionState(state);
  return state;
}

/**
 * 生成紧凑的上下文摘要（~1K tokens），供新会话快速恢复全局视角
 */
export function generateContextSummary(state: ExecutionState): string {
  const lines: string[] = [];
  lines.push(`# 执行状态摘要`);
  lines.push(``);
  lines.push(`- 迭代: ${state.iteration}`);
  lines.push(`- 进度: ${state.completedTasks.length}/${state.totalTasks} 任务完成`);
  lines.push(`- 批次: ${state.currentBatch}/${state.totalBatches}`);
  lines.push(`- 开始时间: ${state.startedAt}`);
  lines.push(``);

  // 已完成任务摘要
  if (state.completedTasks.length > 0) {
    lines.push(`## ✅ 已完成`);
    for (const taskId of state.completedTasks) {
      const s = state.taskSummaries[taskId];
      if (s) {
        const outputs = s.outputs.length > 0 ? ` → ${s.outputs.join(', ')}` : '';
        lines.push(`- **${taskId}** (${s.type}): ${s.summary}${outputs}`);
      } else {
        lines.push(`- **${taskId}**: 已完成`);
      }
    }
    lines.push(``);
  }

  // 失败任务
  if (state.failedTasks.length > 0) {
    lines.push(`## ❌ 失败`);
    for (const taskId of state.failedTasks) {
      const s = state.taskSummaries[taskId];
      lines.push(`- **${taskId}**: ${s?.summary || '执行失败'}`);
    }
    lines.push(``);
  }

  // 待执行任务 + 依赖
  if (state.pendingTasks.length > 0) {
    lines.push(`## ⏳ 待执行`);
    for (const taskId of state.pendingTasks) {
      const s = state.taskSummaries[taskId];
      const deps = s?.dependencies?.length ? ` (依赖: ${s.dependencies.join(', ')})` : '';
      lines.push(`- **${taskId}**${deps}`);
    }
    lines.push(``);
  }

  // 下一批次指引
  const nextBatch = state.batchStatus[String(state.currentBatch)];
  if (nextBatch && nextBatch.status !== 'completed') {
    lines.push(`## 📦 下一批次`);
    lines.push(`批次 ${state.currentBatch}/${state.totalBatches}，任务: ${nextBatch.tasks.join(', ')}`);
    lines.push(``);
    lines.push(`继续执行命令:`);
    lines.push(`\`\`\`bash`);
    lines.push(`speccore execute --prompt --task=${nextBatch.tasks[0]} -i ${state.iteration} --batch-size ${state.batchSize}`);
    lines.push(`\`\`\``);
  } else {
    lines.push(`✅ 所有批次已完成！`);
  }

  return lines.join('\n');
}

/**
 * 将上下文摘要写入文件，供新会话读取
 */
export async function writeContextSummaryFile(state: ExecutionState): Promise<string> {
  const { ensureDir, writeFile } = await import('fs-extra');
  const summaryPath = join('.speccore', 'local', 'execution-summary.md');
  const summary = generateContextSummary(state);
  state.contextSummary = summary;
  saveExecutionState(state);
  await ensureDir(join('.speccore', 'local'));
  await writeFile(summaryPath, summary, 'utf-8');
  return summaryPath;
}

/**
 * 清除执行状态（完成或取消后）
 */
export function clearExecutionState(): void {
  try {
    if (existsSync(STATE_PATH)) {
      const { unlinkSync } = require('fs');
      unlinkSync(STATE_PATH);
    }
    // 同时清除摘要文件
    const summaryPath = join('.speccore', 'local', 'execution-summary.md');
    if (existsSync(summaryPath)) {
      const { unlinkSync } = require('fs');
      unlinkSync(summaryPath);
    }
  } catch {}
}

/**
 * 获取当前批次的任务列表
 */
export function getCurrentBatchTasks(state: ExecutionState): string[] {
  const batch = state.batchStatus[String(state.currentBatch)];
  return batch?.tasks || [];
}

/**
 * 检查是否有断点可恢复
 */
export function canResume(): boolean {
  const state = loadExecutionState();
  if (!state) return false;

  // 检查是否有未完成的批次
  for (const [key, batch] of Object.entries(state.batchStatus)) {
    if (batch.status === 'pending' || batch.status === 'in_progress') {
      return true;
    }
  }
  return false;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
