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
 * 查找 speccore daemon 进程（跨平台）
 * macOS/Linux: pgrep -f
 * Windows: tasklist /FI "IMAGENAME eq node.exe" + wmic 查命令行
 */
function findDaemonPids(): number[] {
  const myPid = process.pid;
  const pids: number[] = [];
  try {
    if (process.platform === 'win32') {
      // Windows: 用 wmic 查命令行
      const wmicOut = execSync(
        'wmic process where "name=\'node.exe\'" get ProcessId,CommandLine /format:csv',
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
      );
      for (const line of wmicOut.split('\n')) {
        if (line.includes('schedule daemon') && line.includes('--foreground')) {
          const m = line.match(/,(\d+)\s*$/);
          if (m) {
            const pid = parseInt(m[1]);
            if (pid !== myPid) pids.push(pid);
          }
        }
      }
    } else {
      // macOS/Linux: pgrep
      const result = execSync(`pgrep -f "speccore schedule daemon"`, { encoding: 'utf-8' });
      for (const line of result.trim().split('\n')) {
        const pid = parseInt(line);
        if (!isNaN(pid) && pid !== myPid) pids.push(pid);
      }
    }
  } catch {
    // 没找到
  }
  return pids;
}

/**
 * 启动调度守护进程
 * 作为独立子进程运行，父进程立即返回
 */
export function startDaemon(): boolean {
  // 检查是否已在运行
  const existing = findDaemonPids();
  if (existing.length > 0) {
    logger.warn(`Schedule daemon is already running (PID: ${existing.join(', ')})`);
    return false;
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
  const pids = findDaemonPids();
  if (pids.length === 0) {
    logger.warn('No schedule daemon running');
    return false;
  }

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
      logger.info(`Stopped daemon process (PID: ${pid})`);
    } catch (e: any) {
      logger.warn(`Failed to stop PID ${pid}: ${e.message}`);
    }
  }
  return true;
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
      // 懒停止：没有 pending 任务时自动退出
      const { getPendingTasks } = await import('./schedule-store');
      const remaining = await getPendingTasks();
      if (remaining.length === 0) {
        logger.info('No pending tasks — daemon stopping (idle)');
        await updateDaemonStatus(false, null);
        clearInterval(interval);
        process.exit(0);
      }
    } catch (err) {
      // 保持运行，记录错误
    }
  };

  // 启动时立即检查一次
  await check();

  // 定时轮询
  const interval = setInterval(check, POLL_INTERVAL);
  // 不要 unref — daemon 需要事件循环保持存活
}

/**
 * 执行单个调度任务
 */
async function executeScheduledTask(task: ScheduleTask): Promise<void> {
  logger.info(`\n━━━ 到期任务: ${task.name} (${task.id}) ━━━`);

  // 直接执行到期任务，不再写触发文件等人来捞
  try {
    const { spawnSync } = await import('child_process');
    const args = ['execute'];
    if (task.taskId) {
      args.push('-t', task.taskId);
    }
    if (task.all) {
      args.push('--all');
    }
    if (task.iteration) {
      args.push('-I', task.iteration);
    }
    args.push('--auto', '--force');

    logger.info(`  🚀 自动执行: speccore ${args.join(' ')}`);
    const result = spawnSync('speccore', args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 600000, // 10分钟超时
      encoding: 'utf-8',
    });

    if (result.status === 0) {
      await updateScheduleTask(task.id, { status: 'completed', result: '执行成功' });
      logger.success(`  ✅ ${task.name} 执行完成`);
    } else {
      const errMsg = (result.stderr || result.stdout || '').slice(-500);
      await updateScheduleTask(task.id, { status: 'failed', result: errMsg });
      logger.error(`  ❌ ${task.name} 执行失败 (exit ${result.status})`);
    }
  } catch (e: any) {
    await updateScheduleTask(task.id, { status: 'failed', result: e.message });
    logger.error(`  ❌ 执行异常: ${e.message}`);
  }
}

/**
 * 检查守护进程是否在运行
 */
export function isDaemonRunning(): boolean {
  return findDaemonPids().length > 0;
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
