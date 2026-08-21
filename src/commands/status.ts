import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from "../core/context";
import { TaskState } from "../core/state";
import { readProjectGraph, scanTasks } from '../core/state';
import { checkLock } from '../core/lock-manager';
import { getNotifications, formatNotification } from '../core/notification';
import { generateRecommendations, printRecommendations } from '../core/smart-recommend';
import { pathExists, readdir } from 'fs-extra';
import { join } from 'path';

export interface StatusOptions {
  iteration?: string;
  assignee?: string;
  type?: string;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  const spinner = new Spinner('Checking status');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('No active iteration found. Please specify --iteration or create one first.');
      return;
    }

    const graph = await readProjectGraph(iteration);
    const tasks = graph.tasks.length > 0 ? graph.tasks : await scanTasks(iteration);

    spinner.stop('Status loaded');
    printStatus(iteration, tasks, options);

    // v7.2.0+: 显示全局分析进度
    await printGlobalAnalysisStatus();

    // v7.2.0+: 检测全局分析文档是否因源码变更而过期
    try {
      const { detectStaleGlobalDocs, printStaleDocReport } = await import('../core/change-impact-global');
      const staleDocs = await detectStaleGlobalDocs(process.cwd());
      printStaleDocReport(staleDocs);
    } catch { /* ignore */ }

    await printLockAndNotifications();

    // v6.96.0+: 智能推荐
    const recommendations = await generateRecommendations(process.cwd());
    if (recommendations.length > 0) {
      printRecommendations(recommendations);
    }
  } catch (error) {
    spinner.fail(`Status check failed: ${error}`);
    throw error;
  }
}

function printStatus(iteration: string, tasks: TaskState[], options: StatusOptions): void {
  const total = tasks.length;
  const completed = tasks.filter(t => t.status === 'completed').length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length;
  const pending = tasks.filter(t => t.status === 'pending').length;

  logger.info('');
  logger.info(`📊 Status: ${iteration}`);
  logger.info('');
  logger.info(`Total Tasks: ${total}`);
  logger.info(`✅ Completed: ${completed}`);
  logger.info(`🔄 In Progress: ${inProgress}`);
  logger.info(`🔲 Pending: ${pending}`);
  logger.info('');

  if (options.assignee) {
    const filtered = tasks.filter(t => t.assignee === options.assignee);
    logger.info(`Tasks assigned to ${options.assignee}: ${filtered.length}`);
  }

  if (options.type) {
    const filtered = tasks.filter(t => t.type === options.type);
    logger.info(`${options.type} tasks: ${filtered.length}`);
  }
}

// ── v7.2.0+: 全局分析进度面板 ──
async function printGlobalAnalysisStatus(): Promise<void> {
  const globalDir = join(process.cwd(), '.speccore', 'GLOBAL');
  if (!(await pathExists(globalDir))) return;

  logger.info('');
  logger.info('🌍 全局分析进度');
  logger.info('');

  // Layer 1: 检查各端 _INDEX.md
  let layer1Done = false;
  let layer2Done = false;
  let layer3Done = false;
  let layer4Done = false;
  let layer4SubCompleted: string[] = [];

  try {
    const platformsDir = join(globalDir, 'platforms');
    if (await pathExists(platformsDir)) {
      const entries = await readdir(platformsDir, { withFileTypes: true });
      const platformDirs = entries.filter(e => e.isDirectory() && e.name !== '_shared').map(e => e.name);
      const hasIndex = platformDirs.length > 0 && (await Promise.all(
        platformDirs.map(async d => pathExists(join(platformsDir, d, '_INDEX.md')))
      )).some(Boolean);
      layer1Done = hasIndex;
    }
  } catch { /* ignore */ }

  // Layer 2: _ASSOCIATION.md
  if (layer1Done) {
    layer2Done = await pathExists(join(globalDir, 'platforms', '_shared', '_ASSOCIATION.md'));
  }

  // Layer 3: _MODULES.md
  if (layer2Done) {
    layer3Done = await pathExists(join(globalDir, 'platforms', '_shared', '_MODULES.md'));
  }

  // Layer 4: 子层检测
  if (layer3Done) {
    const overviewDir = join(globalDir, 'overview');
    const requirementsDir = join(globalDir, 'requirements');
    if (await pathExists(join(requirementsDir, 'REQUIREMENT.md'))) layer4SubCompleted.push('4a');
    if (await pathExists(join(overviewDir, 'ARCHITECTURE.md')) && await pathExists(join(overviewDir, 'FUNCTION_MAP.md'))) layer4SubCompleted.push('4b');
    if (await pathExists(join(overviewDir, 'SECURITY_AUDIT.md')) || await pathExists(join(overviewDir, 'DATA_FLOW.md'))) layer4SubCompleted.push('4c');
    try {
      const platformsDir = join(globalDir, 'platforms');
      const entries = await readdir(platformsDir, { withFileTypes: true });
      const platformDirs = entries.filter(e => e.isDirectory() && e.name !== '_shared').map(e => e.name);
      const hasPlatformDoc = platformDirs.length > 0 && (await Promise.all(
        platformDirs.map(async d => pathExists(join(platformsDir, d, 'API_INVENTORY.md')) || pathExists(join(platformsDir, d, 'UI_FLOW.md')))
      )).some(Boolean);
      if (hasPlatformDoc) layer4SubCompleted.push('4d');
    } catch { /* ignore */ }
    layer4Done = layer4SubCompleted.length === 4;
  }

  const layers = [
    { name: 'Layer 1 索引扫描', done: layer1Done },
    { name: 'Layer 2 跨端关联', done: layer2Done },
    { name: 'Layer 3 模块深入', done: layer3Done },
    { name: 'Layer 4 全局汇总', done: layer4Done },
  ];

  for (const layer of layers) {
    const status = layer.done ? '✅' : '⬜';
    logger.info(`   ${status} ${layer.name}`);
  }

  // Layer 4 子层详情
  if (layer3Done && !layer4Done) {
    logger.info('');
    logger.info('   Layer 4 子层:');
    const subNames: Record<string, string> = {
      '4a': '产品视角（requirements/）',
      '4b': '技术核心（overview/）',
      '4c': '技术扩展（overview/）',
      '4d': '各端技术（platforms/）',
    };
    for (const sub of ['4a', '4b', '4c', '4d']) {
      const done = layer4SubCompleted.includes(sub);
      logger.info(`      ${done ? '✅' : '⬜'} ${subNames[sub]}`);
    }
  }

  // 下一步提示
  if (!layer4Done) {
    logger.info('');
    const nextLayer = layer1Done ? (layer2Done ? (layer3Done ? 4 : 3) : 2) : 1;
    logger.info(`   ➡️  下一步: speccore analyze --scope global --layer ${nextLayer}`);
  } else {
    logger.info('');
    logger.info('   🎉 全局分析全部完成');
  }

  // 统计文档数量
  try {
    let docCount = 0;
    const overviewDir = join(globalDir, 'overview');
    const requirementsDir = join(globalDir, 'requirements');
    if (await pathExists(overviewDir)) {
      const files = await readdir(overviewDir);
      docCount += files.filter(f => f.endsWith('.md') || f.endsWith('.yaml') || f.endsWith('.yml')).length;
    }
    if (await pathExists(requirementsDir)) {
      const files = await readdir(requirementsDir);
      docCount += files.filter(f => f.endsWith('.md')).length;
    }
    logger.info(`   📄 已生成文档: ${docCount} 份`);
  } catch { /* ignore */ }
}

async function printLockAndNotifications(): Promise<void> {
  // 锁状态
  const lock = await checkLock(process.cwd(), 'iteration');
  if (lock) {
    logger.info('🔒 并发锁状态');
    logger.info(`   持有者: ${lock.holder}`);
    logger.info(`   任务: ${lock.task || 'unknown'}`);
    logger.info(`   获取时间: ${new Date(lock.acquiredAt).toLocaleString('zh-CN')}`);
    logger.info('');
  }

  // 未读通知
  const unread = await getNotifications(process.cwd(), { unreadOnly: true });
  if (unread.length > 0) {
    logger.info(`🔔 未读通知 (${unread.length})`);
    for (const n of unread.slice(0, 5)) {
      logger.info(`   ${formatNotification(n)}`);
    }
    if (unread.length > 5) {
      logger.info(`   ... 及其他 ${unread.length - 5} 条`);
    }
    logger.info('   💡 运行 speccore notify 查看全部通知');
    logger.info('');
  }
}
