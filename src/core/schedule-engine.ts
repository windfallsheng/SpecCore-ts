import { spawn, execSync } from 'child_process';
import { join } from 'path';
import { logger } from '../utils/logger';
import {
  getDueTasks,
  updateScheduleTask,
  updateDaemonStatus,
  loadScheduleStore,
  ScheduleTask,
} from './schedule-store';

/**
 * 调度引擎 — 负责守护进程的启停和任务到时触发
 */

/** 检查间隔（毫秒） */
const POLL_INTERVAL = 30000; // 30 秒轮询一次
/** 守护进程锁文件 */
const LOCK_FILE = '.speccore/local/schedule.lock';

/**
 * 启动调度守护进程
 * 作为独立子进程运行，父进程立即返回
 */
export function startDaemon(): boolean {
  // 检查是否已在运行
  try {
    const result = execSync(`pgrep -f "speccore schedule daemon"`, { encoding: 'utf-8' });
    const pids = result.trim().split('\n').filter(Boolean);
    // 排除当前进程
    const myPid = process.pid.toString();
    const others = pids.filter(p => p !== myPid);
    if (others.length > 0) {
      logger.warn(`Schedule daemon is already running (PID: ${others.join(', ')})`);
      return false;
    }
  } catch {
    // pgrep 没找到，正常
  }

  // 以 detached 模式启动子进程
  const child = spawn(
    process.execPath,
    [join(__dirname, '..', '..', 'dist', 'cli.js'), 'schedule', 'daemon', '--foreground'],
    {
      detached: true,
      stdio: 'ignore',
      cwd: process.cwd(),
    }
  );

  child.unref();
  logger.success(`Schedule daemon started (PID: ${child.pid})`);
  logger.info(`It will check for due tasks every ${POLL_INTERVAL / 1000}s`);
  return true;
}

/**
 * 停止调度守护进程
 */
export function stopDaemon(): boolean {
  try {
    const result = execSync(`pgrep -f "speccore schedule daemon"`, { encoding: 'utf-8' });
    const pids = result.trim().split('\n').filter(Boolean);
    const myPid = process.pid.toString();
    const others = pids.filter(p => p !== myPid);

    if (others.length === 0) {
      logger.warn('No schedule daemon running');
      return false;
    }

    for (const pid of others) {
      process.kill(parseInt(pid), 'SIGTERM');
      logger.info(`Stopped daemon process (PID: ${pid})`);
    }
    return true;
  } catch {
    logger.warn('No schedule daemon running');
    return false;
  }
}

/**
 * 守护进程主循环（在 daemon --foreground 子进程中运行）
 */
export async function runDaemonLoop(): Promise<void> {
  logger.info('Schedule daemon started');
  logger.info(`Polling every ${POLL_INTERVAL / 1000}s for due tasks...`);

  await updateDaemonStatus(true, process.pid);

  // 优雅退出
  const cleanup = async () => {
    logger.info('Shutting down schedule daemon...');
    await updateDaemonStatus(false, null);
    process.exit(0);
  };
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  // 主循环
  const check = async () => {
    try {
      const dueTasks = await getDueTasks();
      for (const task of dueTasks) {
        await executeScheduledTask(task);
      }
    } catch (err) {
      // 保持运行，记录错误
    }
  };

  // 启动时立即检查一次
  await check();

  // 定时轮询
  const interval = setInterval(check, POLL_INTERVAL);
  interval.unref();
}

/**
 * 执行单个调度任务
 */
async function executeScheduledTask(task: ScheduleTask): Promise<void> {
  logger.info(`\n━━━ Scheduled task due: ${task.name} (${task.id}) ━━━`);

  // 写入 AI 触发文件 → spec-ask Skill 轮询后自动处理完整流水线
  try {
    const { writeFile, ensureDir } = await import('fs-extra');
    const { join } = await import('path');
    const triggerDir = join(process.cwd(), '.speccore', 'local');
    await ensureDir(triggerDir);
    const triggerFile = join(triggerDir, '.scheduled-trigger.json');

    let triggerTasks: any[] = [];
    try { triggerTasks = JSON.parse(await require('fs-extra').readFile(triggerFile, 'utf-8')).tasks || []; } catch {}

    triggerTasks.push({
      id: task.id, name: task.name,
      taskId: task.taskId, iteration: task.iteration,
      type: task.execOptions?.type || 'execute',
      scheduledAt: new Date().toISOString(), status: 'pending',
    });

    await writeFile(triggerFile, JSON.stringify({ tasks: triggerTasks, updatedAt: new Date().toISOString() }, null, 2));

    await updateScheduleTask(task.id, { status: 'ready', result: '等待 AI 处理' });
    logger.info(`📋 ${task.taskId || task.name} → 等待 AI 处理`);
  } catch (e: any) {
    logger.error(`Failed to write trigger: ${e.message}`);
  }
}

/**
 * 检查守护进程是否在运行
 */
export function isDaemonRunning(): boolean {
  try {
    const result = execSync(`pgrep -f "speccore schedule daemon"`, { encoding: 'utf-8' });
    const pids = result.trim().split('\n').filter(Boolean);
    const myPid = process.pid.toString();
    const others = pids.filter(p => p !== myPid);
    return others.length > 0;
  } catch {
    return false;
  }
}

/**
 * 检查守护进程状态并显示
 */
export async function daemonStatus(): Promise<{ running: boolean; pid: number | null }> {
  const store = await loadScheduleStore();
  const actualRunning = isDaemonRunning();

  // 自动修复不一致状态
  if (store.daemonRunning !== actualRunning) {
    await updateDaemonStatus(actualRunning, actualRunning ? store.daemonPid : null);
  }

  return {
    running: actualRunning,
    pid: actualRunning ? store.daemonPid : null,
  };
}
