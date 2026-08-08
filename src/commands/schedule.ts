import { logger } from '../utils/logger';
import { getDefaultIteration } from '../core/context';

// ============================================================
// 轻量 schedule store（内联，不依赖 daemon）
// ============================================================
import { writeFile, readFile, ensureDir } from 'fs-extra';
import { join } from 'path';

interface ScheduleTask {
  id: string;
  name: string;
  iteration: string;
  taskId: string | null;
  all: boolean;
  scheduledAt: string;
  createdAt: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  execOptions: Record<string, any>;
}

const SCHEDULE_FILE = '.speccore/local/schedule.json';
let _store: ScheduleTask[] | null = null;

async function loadStore(): Promise<ScheduleTask[]> {
  if (_store) return _store;
  await ensureDir(join(process.cwd(), '.speccore', 'local'));
  try {
    const data = await readFile(SCHEDULE_FILE, 'utf-8');
    _store = JSON.parse(data);
  } catch {
    _store = [];
  }
  return _store!;
}

async function saveStore(store: ScheduleTask[]): Promise<void> {
  _store = store;
  await writeFile(SCHEDULE_FILE, JSON.stringify(store, null, 2));
}

function generateId(): string {
  return `sch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================
// schedule create
// ============================================================
export interface ScheduleCreateOptions {
  task?: string; all?: boolean; iteration?: string;
  at: string; name?: string; batchSize?: string;
  assignee?: string; type?: string; priority?: string;
  platform?: string; backend?: boolean; frontend?: boolean;
}

export async function scheduleCreateCommand(options: ScheduleCreateOptions): Promise<void> {
  try {
    if (!options.task && !options.all) { logger.error('必须指定 --task 或 --all'); return; }
    if (options.task && options.all) { logger.error('--task 和 --all 不能同时使用'); return; }
    if (!options.at) { logger.error('必须指定 --at "YYYY-MM-DD HH:mm:ss"'); return; }

    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) { logger.error('未找到活跃迭代，请使用 --iteration 指定'); return; }

    const taskName = options.name || (options.all ? `Batch all [${iteration}]` : `Execute ${options.task} [${iteration}]`);

    const task: ScheduleTask = {
      id: generateId(),
      name: taskName,
      iteration,
      taskId: options.task || null,
      all: !!options.all,
      scheduledAt: options.at,
      createdAt: new Date().toISOString(),
      status: 'pending',
      execOptions: {
        batchSize: options.batchSize ? parseInt(options.batchSize, 10) : undefined,
        assignee: options.assignee, type: options.type,
        priority: options.priority, platform: options.platform,
        backend: options.backend, frontend: options.frontend,
      },
    };

    const store = await loadStore();
    store.push(task);
    await saveStore(store);

    logger.success(`调度任务已创建`);
    logger.info(`  ID:       ${task.id}`);
    logger.info(`  任务:     ${task.name}`);
    logger.info(`  执行时间: ${task.scheduledAt}`);
    logger.info(`  状态:     ⏳ 待执行`);
  } catch (error: any) {
    logger.error(`创建调度任务失败: ${error.message}`);
  }
}

// ============================================================
// schedule list
// ============================================================
export async function scheduleListCommand(): Promise<void> {
  try {
    const tasks = await loadStore();
    if (tasks.length === 0) { logger.info('没有调度任务'); return; }

    logger.info(`共 ${tasks.length} 个调度任务:`);
    for (const t of tasks) {
      logger.info(`  ${t.id.slice(0,14)}  ${t.name.padEnd(25)}  ${t.scheduledAt}  ${t.status}`);
    }
    logger.info('💡 speccore schedule detail --id=<id>  查看详情');
    logger.info('   speccore schedule cancel --id=<id>  取消任务');
  } catch (error: any) {
    logger.error(`查看失败: ${error.message}`);
  }
}

// ============================================================
// schedule cancel
// ============================================================
export async function scheduleCancelCommand(options: { id: string }): Promise<void> {
  try {
    if (!options.id) { logger.error('请指定 --id=<id>'); return; }
    const store = await loadStore();
    const idx = store.findIndex(t => t.id === options.id);
    if (idx === -1) { logger.error(`未找到: ${options.id}`); return; }
    store[idx].status = 'cancelled';
    await saveStore(store);
    logger.success(`已取消: ${store[idx].name}`);
  } catch (error: any) {
    logger.error(`取消失败: ${error.message}`);
  }
}

// ============================================================
// schedule detail
// ============================================================
export async function scheduleDetailCommand(options: { id: string }): Promise<void> {
  try {
    if (!options.id) { logger.error('请指定 --id=<id>'); return; }
    const store = await loadStore();
    const t = store.find(t => t.id === options.id);
    if (!t) { logger.error(`未找到: ${options.id}`); return; }

    logger.info(`📋 ${t.name}`);
    logger.info(`   ID:       ${t.id}`);
    logger.info(`   状态:     ${t.status}`);
    logger.info(`   迭代:     ${t.iteration}`);
    logger.info(`   执行时间: ${t.scheduledAt}`);
    if (t.taskId) logger.info(`   目标:     ${t.taskId}`);
    if (t.all) logger.info(`   目标:     全部 Task`);
  } catch (error: any) {
    logger.error(`查看失败: ${error.message}`);
  }
}

// ============================================================
// schedule delete
// ============================================================
export async function scheduleDeleteCommand(options: { id: string }): Promise<void> {
  try {
    if (!options.id) { logger.error('请指定 --id=<id>'); return; }
    const store = await loadStore();
    const idx = store.findIndex(t => t.id === options.id);
    if (idx === -1) { logger.error(`未找到: ${options.id}`); return; }
    store.splice(idx, 1);
    await saveStore(store);
    logger.success(`已删除: ${options.id}`);
  } catch (error: any) {
    logger.error(`删除失败: ${error.message}`);
  }
}
