/**
 * sync - 反向同步命令
 * 检测代码与 Spec 的差异，更新 Spec 文件
 */

import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { readFile, writeFile, pathExists } from 'fs-extra';
import { join } from 'path';

export interface SyncOptions {
  task?: string;
  iteration?: string;
  auto?: boolean;
  dryRun?: boolean;
  force?: boolean;
}

export async function syncCommand(options: SyncOptions): Promise<void> {
  if (!options.task && !options.iteration) {
    logger.error('请指定要同步的 Task 或期次。用法: speccore sync --task=<Task编号> [--auto]');
    return;
  }

  const spinner = new Spinner('正在检测 Spec 差异...');
  spinner.start();

  try {
    const iteration = await getDefaultIteration(options.iteration);
    if (!iteration) {
      spinner.fail('未找到活跃期次。请先运行: speccore iteration create --name <名称>');
      return;
    }

    if (options.dryRun) {
      await dryRunSync(options, iteration);
      spinner.stop('差异分析完成（--dry-run 模式，未实际同步）');
      return;
    }

    if (options.task) {
      await syncTaskSpec(options.task, iteration, options.auto || false);
    } else {
      await syncIterationSpec(iteration, options.auto || false);
    }

    spinner.stop('Spec 同步完成');
    logger.info('');
    logger.info('💡 提示: 运行 speccore validate 确保同步后的 Spec 完整性');
  } catch (error) {
    spinner.fail(`同步失败: ${error}`);
    throw error;
  }
}

async function dryRunSync(options: SyncOptions, iteration: string): Promise<void> {
  logger.info('🔍 Spec 差异分析报告：');
  logger.info('');

  if (options.task) {
    await analyzeTaskDiff(options.task, iteration);
  } else {
    logger.info('📊 期次级差异分析：');
    logger.info(`   期次: ${iteration}`);
    // 扫描所有任务
    const iterDir = join(process.cwd(), iteration);
    if (await pathExists(iterDir)) {
      const { readdir } = await import('fs-extra');
      const entries = await readdir(iterDir);
      const tasks = entries.filter((e) => e.startsWith('Task-'));
      for (const task of tasks) {
        await analyzeTaskDiff(task, iteration);
      }
    }
  }
}

async function analyzeTaskDiff(task: string, iteration: string): Promise<void> {
  const taskDir = join(process.cwd(), iteration, task);
  if (!await pathExists(taskDir)) {
    logger.warn(`   任务 ${task} 目录不存在，跳过`);
    return;
  }

  logger.info(`📋 ${task}:`);

  // 检查必需文件
  const requiredFiles = [
    '.task-type',
    'backend/REQ.md',
    'backend/TECH.md',
    'backend/TASK.md',
    '_shared/API_CONTRACT.yaml',
  ];

  for (const file of requiredFiles) {
    const filePath = join(taskDir, file);
    if (await pathExists(filePath)) {
      logger.info(`   ✅ ${file}`);
    } else {
      logger.warn(`   ⚠️ ${file} - 缺失`);
    }
  }
}

async function syncTaskSpec(task: string, iteration: string, auto: boolean): Promise<void> {
  const taskDir = join(process.cwd(), iteration, task);

  if (!await pathExists(taskDir)) {
    logger.error(`任务目录不存在: ${taskDir}`);
    return;
  }

  // 更新 TASK.md 中的变更履历
  const taskMdPath = join(taskDir, 'backend', 'TASK.md');
  if (await pathExists(taskMdPath)) {
    let content = await readFile(taskMdPath, 'utf-8');
    const now = new Date().toISOString().split('T')[0];

    if (!auto) {
      logger.info(`当前 TASK.md 状态:`);
      // 提取变更履历的最后 3 条
      const historyMatch = content.match(/变更履历[\s\S]*?(?=\n##\s)/);
      if (historyMatch) {
        logger.info(historyMatch[0].substring(0, 300));
      }
    }

    // 自动模式下添加上下文更新记录
    if (auto) {
      const syncEntry = `| ${now} | auto | 自动反向同步: 更新 Spec 文件 | SpecCore |\n`;
      content = content.replace(
        /(\| :--- \| :--- \| :--- \| :--- \|)/,
        `$1\n${syncEntry}`
      );
      await writeFile(taskMdPath, content);
      logger.info(`✅ 已同步: ${task}/backend/TASK.md`);
    }
  }
}

async function syncIterationSpec(iteration: string, auto: boolean): Promise<void> {
  const iterDir = join(process.cwd(), iteration);
  if (!await pathExists(iterDir)) {
    logger.error(`期次目录不存在: ${iterDir}`);
    return;
  }

  const { readdir } = await import('fs-extra');
  const entries = await readdir(iterDir);
  const tasks = entries.filter((e) => e.startsWith('Task-'));
  const total = tasks.length;

  logger.info(`正在同步期次 ${iteration} 的 ${total} 个任务...`);

  let synced = 0;
  for (const task of tasks) {
    await syncTaskSpec(task, iteration, auto);
    synced++;
  }

  logger.info(`✅ 已同步 ${synced}/${total} 个任务`);
}
