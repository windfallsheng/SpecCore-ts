import { ensureDir, readJson, writeJson, pathExists } from 'fs-extra';
import { join } from 'path';

/**
 * 调度任务状态
 */
export type ScheduleTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'ready';

/**
 * 单个调度任务
 */
export interface ScheduleTask {
  /** 唯一 ID，自动生成 */
  id: string;
  /** 任务名称/描述 */
  name: string;
  /** 目标迭代 */
  iteration: string;
  /** 指定执行的 Task ID（单个模式），null 表示批量模式 */
  taskId: string | null;
  /** 是否 --all 批量模式 */
  all: boolean;
  /** 调度时间，格式: "2026-08-10 21:00:00" */
  scheduledAt: string;
  /** ISO 8601 格式的调度时间 */
  scheduledAtISO: string;
  /** 任务状态 */
  status: ScheduleTaskStatus;
  /** 创建时间 */
  createdAt: string;
  /** 实际执行时间 */
  executedAt: string | null;
  /** 执行结果摘要 */
  result: string | null;
  /** 执行参数 (传递给 execute 命令的额外选项) */
  execOptions: {
    batchSize?: number;
    parallel?: number;
    assignee?: string;
    type?: string;
    priority?: string;
    status?: string;
    platform?: string;
    backend?: boolean;
    frontend?: boolean;
  };
}

/**
 * 调度存储文件
 */
export interface ScheduleStore {
  /** 版本号 */
  version: number;
  /** 所有调度任务 */
  tasks: ScheduleTask[];
  /** 守护进程是否在运行 */
  daemonRunning: boolean;
  /** 守护进程 PID */
  daemonPid: number | null;
  /** 最后更新时间 */
  updatedAt: string;
}

const SCHEDULE_PATH = join(process.cwd(), '.speccore', 'local', 'schedule.json');

/**
 * 生成唯一 ID
 */
function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `sch-${ts}-${rand}`;
}

/**
 * 解析时间字符串 "2026-08-10 21:00:00" 为 Date 和 ISO 字符串
 */
export function parseScheduleTime(timeStr: string): { date: Date; iso: string } {
  // 支持 "YYYY-MM-DD HH:mm:ss" 格式
  const match = timeStr.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid time format: "${timeStr}". Expected: YYYY-MM-DD HH:mm:ss (e.g., 2026-08-10 21:00:00)`);
  }
  const [, y, m, d, h, min, s] = match;
  // 使用本地时间构造
  const date = new Date(
    parseInt(y), parseInt(m) - 1, parseInt(d),
    parseInt(h), parseInt(min), parseInt(s)
  );
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date/time: "${timeStr}"`);
  }
  return { date, iso: date.toISOString() };
}

/**
 * 格式化时间为 "YYYY-MM-DD HH:mm:ss"
 */
export function formatScheduleTime(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

/**
 * 加载调度存储
 */
export async function loadScheduleStore(): Promise<ScheduleStore> {
  if (await pathExists(SCHEDULE_PATH)) {
    return await readJson(SCHEDULE_PATH) as ScheduleStore;
  }
  return {
    version: 1,
    tasks: [],
    daemonRunning: false,
    daemonPid: null,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 保存调度存储
 */
export async function saveScheduleStore(store: ScheduleStore): Promise<void> {
  await ensureDir(join(process.cwd(), '.speccore', 'local'));
  store.updatedAt = new Date().toISOString();
  store.version = (store.version || 0) + 1;
  await writeJson(SCHEDULE_PATH, store, { spaces: 2 });
}

/**
 * 带版本锁的原子操作，防止并发写入覆盖
 */
async function withStoreLock<T>(fn: (store: ScheduleStore) => Promise<{ result: T; store: ScheduleStore }>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    const store = await loadScheduleStore();
    const { result, store: newStore } = await fn(store);
    const preVersion = store.version;
    const currentStore = await loadScheduleStore();
    if (currentStore.version !== preVersion) {
      // 被其他进程修改了 → 重试
      if (i < maxRetries - 1) continue;
    }
    await saveScheduleStore(newStore);
    return result;
  }
  throw new Error('Failed to save schedule: max retries exceeded');
}

/**
 * 创建调度任务
 */
export async function createScheduleTask(params: {
  name: string;
  iteration: string;
  taskId: string | null;
  all: boolean;
  scheduledAt: string;
  execOptions?: ScheduleTask['execOptions'];
}): Promise<ScheduleTask> {
  const { date, iso } = parseScheduleTime(params.scheduledAt);
  const now = new Date();

  if (date <= now) {
    throw new Error(`Scheduled time must be in the future. Got: ${params.scheduledAt}, current: ${formatScheduleTime(now)}`);
  }

  return withStoreLock(async (store) => {
    const task: ScheduleTask = {
      id: generateId(),
      name: params.name,
      iteration: params.iteration,
      taskId: params.taskId,
      all: params.all,
      scheduledAt: params.scheduledAt,
    scheduledAtISO: iso,
    status: 'pending',
    createdAt: now.toISOString(),
    executedAt: null,
    result: null,
    execOptions: params.execOptions || {},
    };

    store.tasks.push(task);
    return { result: task, store };
  });
}

/**
 * 获取所有待执行的任务（按调度时间排序）
 */
export async function getPendingTasks(): Promise<ScheduleTask[]> {
  const store = await loadScheduleStore();
  return store.tasks
    .filter(t => t.status === 'pending')
    .sort((a, b) => new Date(a.scheduledAtISO).getTime() - new Date(b.scheduledAtISO).getTime());
}

/**
 * 获取所有任务（按状态筛选）
 */
export async function listScheduleTasks(status?: ScheduleTaskStatus): Promise<ScheduleTask[]> {
  const store = await loadScheduleStore();
  if (status) {
    return store.tasks.filter(t => t.status === status);
  }
  return [...store.tasks].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/** 获取单个调度任务详情 */
export async function getScheduleTask(id: string): Promise<ScheduleTask | null> {
  const store = await loadScheduleStore();
  return store.tasks.find(t => t.id.startsWith(id)) || null;
}

/**
 * 更新任务状态
 */
export async function updateScheduleTask(
  taskId: string,
  updates: Partial<Pick<ScheduleTask, 'status' | 'executedAt' | 'result'>>
): Promise<ScheduleTask | null> {
  return withStoreLock(async (store) => {
    const task = store.tasks.find(t => t.id === taskId);
    if (!task) return { result: null, store };

    if (updates.status !== undefined) task.status = updates.status;
    if (updates.executedAt !== undefined) task.executedAt = updates.executedAt;
    if (updates.result !== undefined) task.result = updates.result;

    return { result: task, store };
  });
}

/**
 * 取消调度任务
 */
export async function cancelScheduleTask(taskId: string): Promise<ScheduleTask | null> {
  const store = await loadScheduleStore();
  const task = store.tasks.find(t => t.id === taskId);
  if (!task) return null;
  if (task.status !== 'pending') {
    throw new Error(`Cannot cancel task "${taskId}" — current status is "${task.status}"`);
  }

  task.status = 'cancelled';
  await saveScheduleStore(store);
  return task;
}

/**
 * 删除调度任务（物理删除）
 */
export async function deleteScheduleTask(taskId: string): Promise<boolean> {
  const store = await loadScheduleStore();
  const idx = store.tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return false;

  store.tasks.splice(idx, 1);
  await saveScheduleStore(store);
  return true;
}

/**
 * 获取所有已到期但未执行的任务
 */
export async function getDueTasks(): Promise<ScheduleTask[]> {
  const store = await loadScheduleStore();
  const now = new Date();
  return store.tasks.filter(t => {
    if (t.status !== 'pending') return false;
    return new Date(t.scheduledAtISO) <= now;
  });
}

/**
 * 更新守护进程状态
 */
export async function updateDaemonStatus(running: boolean, pid: number | null): Promise<void> {
  const store = await loadScheduleStore();
  store.daemonRunning = running;
  store.daemonPid = pid;
  await saveScheduleStore(store);
}
