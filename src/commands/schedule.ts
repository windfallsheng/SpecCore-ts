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

        // 重新安装 LaunchAgent 到当前项目（daemon 的 WorkingDirectory 必须 = 当前项目）
    try { await installSystemSchedule(); startDaemon(); } catch {}

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

    // 懒停止：取消后无 pending 任务则自动退出 daemon
    try {
      const { getPendingTasks: getPending } = await import('../core/schedule-store');
      const { isDaemonRunning, stopDaemon } = await import('../core/schedule-engine');
      const remaining = await getPending();
      if (remaining.length === 0 && isDaemonRunning()) {
        stopDaemon();
      }
    } catch {}
  } catch (error: any) {
    logger.error(`取消任务失败: ${error.message}`);
  }
}

// ============================================================
// schedule retry — 重新调度（基于已有任务改时间）
// ============================================================
export interface ScheduleRetryOptions {
  id: string;
  at?: string;
}

export async function scheduleRetryCommand(options: ScheduleRetryOptions): Promise<void> {
  try {
    if (!options.id) {
      logger.error('请指定要重调度的任务 ID: --id=<id>');
      return;
    }

    const task = await getScheduleTask(options.id);
    if (!task) {
      logger.error(`未找到调度任务: ${options.id}`);
      logger.info('💡 使用 speccore schedule list 查看所有任务');
      return;
    }

    const newTime = options.at || task.scheduledAt; // 默认用原时间（到了立即触发）
    if (!options.at) {
      // 如果没指定时间，默认 1 分钟后
      const now = new Date();
      now.setMinutes(now.getMinutes() + 1);
      const pad = (n: number) => String(n).padStart(2, '0');
      const defaultAt = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      const updated = await createScheduleTask({
        name: task.name,
        iteration: task.iteration,
        taskId: task.taskId,
        all: task.all,
        scheduledAt: defaultAt,
        execOptions: task.execOptions,
      });
      logger.success(`✅ 已创建新调度: ${updated.id.slice(0, 12)}`);
      logger.info(`   任务: ${task.name}`);
      logger.info(`   时间: ${defaultAt}`);
      logger.info(`   💡 旧任务已保留，可 speccore schedule cancel --id=${options.id} 取消`);
      return;
    }

    // 指定了时间的：取消旧任务 + 创建新任务
    await cancelScheduleTask(options.id);
    const updated = await createScheduleTask({
      name: task.name,
      iteration: task.iteration,
      taskId: task.taskId,
      all: task.all,
      scheduledAt: newTime,
      execOptions: task.execOptions,
    });
    logger.success(`✅ 已重新调度: ${updated.id.slice(0, 12)}`);
    logger.info(`   原时间: ${task.scheduledAt}`);
    logger.info(`   新时间: ${newTime}`);
  } catch (error: any) {
    logger.error(`重调度失败: ${error.message}`);
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
    if (options.action === 'install') {
      await installSystemSchedule();
      return;
    }

    // --foreground 模式（由 start 子命令内部使用）
    if (options.foreground) {
      await runDaemonLoop();
      return;
    }

    const action = options.action || 'status';

    switch (action) {
      case 'start': {
        // 自动安装系统调度（幂等，已安装则跳过）
        logger.info('📦 安装/更新系统调度...');
        await installSystemSchedule();
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
    ready: '🤖 等待 AI',
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

export async function installSystemSchedule(): Promise<void> {
  const { join } = await import('path');
  const { writeFile, ensureDir } = await import('fs-extra');
  const projectDir = process.cwd();
  const cmd = `${process.execPath} ${join(__dirname, '..', '..', 'dist', 'cli.js')} schedule daemon --foreground`;
  const os = await import('os');

  if (process.platform === 'darwin') {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.speccore.schedule</string>
<key>ProgramArguments</key><array><string>${process.execPath}</string><string>${join(__dirname, '..', '..', 'dist', 'cli.js')}</string><string>schedule</string><string>daemon</string><string>--foreground</string></array>
<key>WorkingDirectory</key><string>${projectDir}</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>${join(os.homedir(), '.speccore', 'daemon.log')}</string>
<key>StandardErrorPath</key><string>${join(os.homedir(), '.speccore', 'daemon-error.log')}</string>
</dict></plist>`;
    const plistPath = join(os.homedir(), 'Library', 'LaunchAgents', 'com.speccore.schedule.plist');
    await ensureDir(join(os.homedir(), '.speccore'));
    await writeFile(plistPath, plist);
    require('child_process').execSync(`launchctl unload "${plistPath}" 2>/dev/null; launchctl load "${plistPath}"`, { stdio: 'pipe' });
    logger.success(`✅ 已安装系统调度服务`);
    logger.info(`   macOS LaunchAgent: ${plistPath}`);
    logger.info('   开机自启，自动轮询到期任务');
  } else if (process.platform === 'linux') {
    const cronEntry = `*/5 * * * * cd ${projectDir} && ${cmd}`;
    const current = await require('fs-extra').readFile('/tmp/speccore-cron', 'utf-8').catch(() => '');
    await writeFile('/tmp/speccore-cron', cronEntry);
    require('child_process').execSync(`(echo "${cronEntry}") | crontab -`, { stdio: 'pipe' }).toString();
    logger.success('✅ 已安装 crontab 调度');
    logger.info('   每5分钟检查到期任务');
  } else if (process.platform === 'win32') {
    const taskName = 'SpecCoreDaemon';
    const nodePath = process.execPath;
    const scriptPath = join(__dirname, '..', '..', 'dist', 'cli.js');
    // 用 spawnSync 直接传参数数组，避免 shell 转义陷阱
    const { spawnSync } = require('child_process');
    // 先删除可能存在的旧任务（-f 仍然需要所以这里手动 delete）
    try {
      spawnSync('schtasks', ['/delete', '/tn', taskName, '/f'], { stdio: 'pipe', shell: false });
    } catch {}
    const result = spawnSync('schtasks', [
      '/create',
      '/tn', taskName,
      '/tr', `${nodePath} "${scriptPath}" schedule daemon --foreground`,
      '/sc', 'minute',
      '/mo', '5',
      '/f',
      '/rl', 'LIMITED',
    ], { stdio: 'pipe', shell: false, encoding: 'utf-8' });

    if (result.status !== 0) {
      logger.error('❌ 创建计划任务失败');
      logger.info(`   ${result.stderr || result.stdout || ''}`);
      return;
    }
    logger.success('✅ 已安装 Windows Task Scheduler');
    logger.info(`   任务名: ${taskName}`);
    logger.info(`   节点: ${nodePath}`);
    logger.info(`   每5分钟检查到期任务`);
  } else {
    logger.warn('⚠️ 当前平台不支持系统级调度');
    logger.info('   请使用 speccore schedule daemon start 手动启动');
  }
}
