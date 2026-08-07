import { logger } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import {
  createScheduleTask,
  listScheduleTasks,
  cancelScheduleTask,
  deleteScheduleTask,
  deleteScheduleTask as removeScheduleTask,
  formatScheduleTime,
  getScheduleTask,
  ScheduleTaskStatus,
} from '../core/schedule-store';
import {
  startDaemon,
  stopDaemon,
  runDaemonLoop,
  daemonStatus,
} from '../core/schedule-engine';

// ============================================================
// schedule create — 创建定时任务
// ============================================================
export interface ScheduleCreateOptions {
  task?: string;
  all?: boolean;
  iteration?: string;
  at: string;
  name?: string;
  plan?: string;
  batchSize?: string;
  parallel?: string;
  assignee?: string;
  type?: string;
  priority?: string;
  status?: string;
  platform?: string;
  backend?: boolean;
  frontend?: boolean;
}

export async function scheduleCreateCommand(options: ScheduleCreateOptions): Promise<void> {
  try {
    // 验证参数
    if (!options.task && !options.all) {
      logger.error('必须指定 --task <task-id> 或 --all');
      return;
    }
    if (options.task && options.all) {
      logger.error('--task 和 --all 不能同时使用');
      return;
    }
    if (!options.at) {
      logger.error('必须指定 --at "YYYY-MM-DD HH:mm:ss"');
      return;
    }

    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      logger.error('未找到活跃迭代，请使用 --iteration 指定');
      return;
    }

    const taskName = options.name
      || (options.all
        ? `Batch execute all tasks [${iteration}]`
        : `Execute ${options.task} [${iteration}]`);

    const scheduled = await createScheduleTask({
      name: taskName,
      iteration,
      taskId: options.task || null,
      all: !!options.all,
      scheduledAt: options.at,
      execOptions: {
        batchSize: options.batchSize ? parseInt(options.batchSize, 10) : undefined,
        parallel: options.parallel ? parseInt(options.parallel, 10) : undefined,
        assignee: options.assignee,
        type: options.type,
        priority: options.priority,
        status: options.status,
        platform: options.platform,
        backend: options.backend,
        frontend: options.frontend,
      },
    });

    logger.success(`调度任务已创建`);
    logger.info('');
    logger.info(`  ID:       ${scheduled.id}`);
    logger.info(`  任务:     ${scheduled.name}`);
    logger.info(`  迭代:     ${scheduled.iteration}`);
    logger.info(`  执行时间: ${scheduled.scheduledAt}`);
    logger.info(`  状态:     ${statusLabel(scheduled.status)}`);
    logger.info('');
    logger.info('💡 确保 schedule daemon 在运行: speccore schedule daemon start');

  } catch (error: any) {
    logger.error(`创建调度任务失败: ${error.message}`);
  }
}

// ============================================================
// schedule list — 查看调度任务
// ============================================================
export interface ScheduleListOptions {
  status?: string;
  all?: boolean;
}

export async function scheduleListCommand(options: ScheduleListOptions): Promise<void> {
  try {
    const status = options.status as ScheduleTaskStatus | undefined;
    const tasks = await listScheduleTasks(status);

    if (tasks.length === 0) {
      logger.info('没有调度任务');
      const ds = await daemonStatus();
      logger.info(`调度守护进程: ${ds.running ? '运行中' : '未运行'}`);
      return;
    }

    const ds = await daemonStatus();
    logger.info('');
    logger.info(`调度守护进程: ${ds.running ? `🟢 运行中 (PID: ${ds.pid})` : '🔴 未运行'}`);
    logger.info('');
    logger.info(`共 ${tasks.length} 个调度任务:`);
    logger.info('');

    // 表头
    const idHeader = 'ID';
    const nameHeader = '任务名称';
    const timeHeader = '执行时间';
    const statusHeader = '状态';
    logger.info(`  ${idHeader.padEnd(18)} ${nameHeader.padEnd(30)} ${timeHeader.padEnd(20)} ${statusHeader}`);
    logger.info(`  ${'─'.repeat(18)} ${'─'.repeat(30)} ${'─'.repeat(20)} ${'─'.repeat(10)}`);

    for (const task of tasks) {
      const shortId = task.id.slice(0, 16);
      const shortName = task.name.length > 28 ? task.name.slice(0, 27) + '…' : task.name;
      const stLabel = statusLabel(task.status);
      logger.info(`  ${shortId.padEnd(18)} ${shortName.padEnd(30)} ${task.scheduledAt.padEnd(20)} ${stLabel}`);
    }

    logger.info('');
    logger.info('💡 speccore schedule detail --id=<id>  查看详情');
    logger.info('   speccore schedule cancel --id=<id>  取消任务');
    logger.info('   speccore schedule daemon start       启动守护进程');

  } catch (error: any) {
    logger.error(`查看调度任务失败: ${error.message}`);
  }
}

// ============================================================
// schedule cancel — 取消调度任务
// ============================================================
export interface ScheduleCancelOptions {
  id: string;
}

export async function scheduleCancelCommand(options: ScheduleCancelOptions): Promise<void> {
  try {
    if (!options.id) {
      logger.error('请指定要取消的任务 ID: --id=<id>');
      return;
    }

    const task = await cancelScheduleTask(options.id);
    if (!task) {
      logger.error(`未找到调度任务: ${options.id}`);
      logger.info('💡 使用 speccore schedule list 查看所有任务');
      return;
    }

    logger.success(`已取消调度任务: ${task.name}`);
    logger.info(`  原定执行时间: ${task.scheduledAt}`);
  } catch (error: any) {
    logger.error(`取消任务失败: ${error.message}`);
  }
}

// ============================================================
// schedule delete — 删除调度记录
// ============================================================
export interface ScheduleDeleteOptions {
  id: string;
}

export async function scheduleDeleteCommand(options: ScheduleDeleteOptions): Promise<void> {
  try {
    if (!options.id) {
      logger.error('请指定要删除的任务 ID: --id=<id>');
      return;
    }

    const deleted = await removeScheduleTask(options.id);
    if (!deleted) {
      logger.error(`未找到调度任务: ${options.id}`);
      return;
    }

    logger.success(`已删除调度记录: ${options.id}`);
  } catch (error: any) {
    logger.error(`删除记录失败: ${error.message}`);
  }
}

// ============================================================
// schedule daemon — 守护进程管理
// ============================================================
export interface ScheduleDaemonOptions {
  action?: string;
  foreground?: boolean;
}

export async function scheduleDaemonCommand(options: ScheduleDaemonOptions): Promise<void> {
  try {
    // --foreground 模式（由 start 子命令内部使用）
    if (options.foreground) {
      await runDaemonLoop();
      return;
    }

    const action = options.action || 'status';

    switch (action) {
      case 'start': {
        logger.info('正在启动调度守护进程...');
        const started = startDaemon();
        if (started) {
          logger.info('💡 使用 speccore schedule list 查看待执行任务');
          logger.info('   speccore schedule daemon stop  停止守护进程');
          logger.info('   speccore schedule daemon status 查看状态');
        }
        break;
      }

      case 'stop': {
        logger.info('正在停止调度守护进程...');
        stopDaemon();
        logger.success('调度守护进程已停止');
        break;
      }

      case 'restart': {
        logger.info('正在重启调度守护进程...');
        stopDaemon();
        // 等待一下
        await new Promise(resolve => setTimeout(resolve, 1000));
        startDaemon();
        break;
      }

      case 'status':
      default: {
        const ds = await daemonStatus();
        logger.info('');
        if (ds.running) {
          logger.info(`调度守护进程: 🟢 运行中`);
          logger.info(`  PID: ${ds.pid || 'unknown'}`);
        } else {
          logger.info(`调度守护进程: 🔴 未运行`);
        }
        logger.info('');
        const pendingTasks = await listScheduleTasks('pending');
        logger.info(`待执行任务: ${pendingTasks.length} 个`);
        if (pendingTasks.length > 0) {
          logger.info(`下一个任务: ${pendingTasks[0].name} @ ${pendingTasks[0].scheduledAt}`);
        }
        logger.info('');
        logger.info('💡 speccore schedule daemon start  启动守护进程');
        break;
      }
    }
  } catch (error: any) {
    logger.error(`守护进程操作失败: ${error.message}`);
  }
}

// ============================================================
// Helpers
// ============================================================
function statusLabel(status: ScheduleTaskStatus): string {
  const map: Record<ScheduleTaskStatus, string> = {
    pending: '⏳ 待执行',
    running: '🔄 执行中',
    completed: '✅ 已完成',
    failed: '❌ 失败',
    cancelled: '🚫 已取消',
  };
  return map[status] || status;
}

// ============================================================
// schedule detail — 查看调度任务详情
// ============================================================
export interface ScheduleDetailOptions {
  id: string;
}

export async function scheduleDetailCommand(options: ScheduleDetailOptions): Promise<void> {
  try {
    if (!options.id) { logger.error('请指定 --id=<id>'); return; }
    const task = await getScheduleTask(options.id);
    if (!task) { logger.error(`未找到: ${options.id}`); return; }

    logger.info('');
    logger.info(`📋 ${task.name}`);
    logger.info(`   ID:          ${task.id}`);
    logger.info(`   状态:        ${statusLabel(task.status)}`);
    logger.info(`   迭代:        ${task.iteration}`);
    logger.info(`   执行时间:    ${task.scheduledAt}`);
    logger.info(`   创建时间:    ${new Date(task.createdAt).toLocaleString()}`);
    
    const eo = task.execOptions;
    if (task.all) {
      logger.info(`   目标:        全部 Task`);
    } else if (task.taskId) {
      logger.info(`   目标:        ${task.taskId}`);
    }

    if (eo.assignee)  logger.info(`   人员:        ${eo.assignee}`);
    if (eo.batchSize) logger.info(`   分批:        ${eo.batchSize} 个/批`);
    if (eo.parallel)  logger.info(`   并行:        ${eo.parallel}`);
    if (eo.type)      logger.info(`   类型:        ${eo.type}`);
    if (eo.priority)  logger.info(`   优先级:      ${eo.priority}`);
    if (eo.platform)  logger.info(`   平台:        ${eo.platform}`);
    if (eo.backend)   logger.info(`   范围:        仅后端`);
    if (eo.frontend)  logger.info(`   范围:        仅前端`);
    logger.info('');

  } catch (error: any) {
    logger.error(`查看失败: ${error.message}`);
  }
}
