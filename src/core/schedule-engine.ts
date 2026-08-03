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
  logger.info(`\n━━━ Executing scheduled task: ${task.name} (${task.id}) ━━━`);

  await updateScheduleTask(task.id, {
    status: 'running',
    executedAt: new Date().toISOString(),
  });

  try {
    const args = ['execute'];

    if (task.all) {
      args.push('--all');
    } else if (task.taskId) {
      args.push('--task', task.taskId);
    }

    args.push('--force');
    args.push('--iteration', task.iteration);

    // 传递 execOptions
    const eo = task.execOptions;
    if (eo?.batchSize) args.push('--batch-size', String(eo.batchSize));
    if (eo?.assignee) args.push('--assignee', eo.assignee);
    if (eo?.type) args.push('--type', eo.type);
    if (eo?.priority) args.push('--priority', eo.priority);
    if (eo?.platform) args.push('--platform', eo.platform);
    if (eo?.backend) args.push('--backend');
    if (eo?.frontend) args.push('--frontend');

    logger.info(`Running: speccore ${args.join(' ')}`);

    // 同步执行，确保顺序
    const result = execSync(`speccore ${args.join(' ')}`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 600000, // 10 分钟超时
    });

    logger.info(result.slice(-500)); // 只打印最后 500 字符
    await updateScheduleTask(task.id, {
      status: 'completed',
      result: 'Execution completed successfully',
    });
    logger.info(`✅ Task ${task.id} completed`);

  } catch (error: any) {
    const errMsg = error.stderr || error.message || String(error);
    logger.error(`❌ Task ${task.id} failed: ${errMsg.slice(-300)}`);
    await updateScheduleTask(task.id, {
      status: 'failed',
      result: errMsg.slice(-500),
    });
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
