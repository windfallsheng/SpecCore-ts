/**
 * Execution State — 执行状态追踪
 *
 * 管理分批执行的状态：批次划分、断点续传、进度记录
 * 状态文件：.speccore/local/execution-state.json
 */

import { ensureFileSync, readFileSync, writeFileSync, existsSync } from 'fs-extra';
import { join } from 'path';

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
 * 清除执行状态（完成或取消后）
 */
export function clearExecutionState(): void {
  try {
    if (existsSync(STATE_PATH)) {
      const { unlinkSync } = require('fs');
      unlinkSync(STATE_PATH);
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
