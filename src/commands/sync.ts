/**
 * sync - 反向同步命令
 * 检测代码与 Spec 的差异，更新 Spec 文件
 */

import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { readFile, pathExists } from 'fs-extra';
import { join } from 'path';
import { FileTransaction } from '../core/transaction';
import { reverseSync } from '../core/reverse-sync';

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
      // Show reverse sync preview in dry-run mode
      const rootDir = process.cwd();
      logger.info('');
      logger.info('🔍 Scanning code for @spec annotations...');
      const refs = await (await import('../core/reverse-sync')).scanCodeForSpecAnnotations(rootDir);
      logger.info(`   Found ${refs.length} @spec references in code`);
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

    // Real time reverse sync: scan code → update TASK.md
    const rootDir = process.cwd();
    logger.info('🔄 Reverse sync: scanning code for @spec annotations...');
    const result = await reverseSync(rootDir, iteration);
    if (result.length > 0) {
      logger.success(`Reverse sync complete: ${result.length} tasks updated`);
    } else {
      logger.info('   No @spec references found in code');
    }
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

  // 检查必需文件 + 内容分析
  const checks = [
    { file: '.task-type', label: '任务类型' },
    { file: 'backend/REQ.md', label: '后端需求', check: (c: string) => c.includes('## 需求描述'), warn: '缺少需求描述章节' },
    { file: 'backend/TECH.md', label: '后端方案', check: (c: string) => c.includes('## 技术'), warn: '缺少技术方案章节' },
    { file: 'backend/TASK.md', label: '任务追踪', check: (c: string) => c.includes('变更履历'), warn: '缺少变更履历' },
    { file: '_shared/API_CONTRACT.yaml', label: 'API契约', check: (c: string) => c.includes('api:') || c.includes('paths:'), warn: '缺少 API 定义' },
  ];

  for (const { file, label, check, warn } of checks) {
    const filePath = join(taskDir, file);
    if (await pathExists(filePath)) {
      const content = await readFile(filePath, 'utf-8');
      if (check && !check(content)) {
        logger.warn(`   ⚠️ ${label}: ${warn}`);
      } else {
        logger.info(`   ✅ ${label}`);
      }
    } else {
      logger.warn(`   ❌ ${label}: 文件缺失`);
    }
  }
}

async function syncTaskSpec(task: string, iteration: string, auto: boolean): Promise<void> {
  const taskDir = join(process.cwd(), iteration, task);
  const tx = new FileTransaction();

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
      const historyMatch = content.match(/变更履历[\s\S]*?(?=\n##\s)/);
      if (historyMatch) {
        logger.info(historyMatch[0].substring(0, 300));
      }
    }

    // 自动模式下添加上下文更新记录（使用事务）
    if (auto) {
      const syncEntry = `| ${now} | auto | 自动反向同步: 更新 Spec 文件 | SpecCore |\n`;
      const updated = content.replace(
        /(\| :--- \| :--- \| :--- \| :--- \|)/,
        `$1\n${syncEntry}`
      );
      tx.write(taskMdPath, updated);
    }
  }

  // 同步前端各平台 TASK.md
  const frontendDir = join(taskDir, 'frontend');
  if (await pathExists(frontendDir)) {
    const { readdir } = await import('fs-extra');
    const platformDirs = await readdir(frontendDir, { withFileTypes: true });
    for (const pd of platformDirs) {
      if (pd.isDirectory()) {
        const ftaskPath = join(frontendDir, pd.name, 'TASK.md');
        if (await pathExists(ftaskPath) && auto) {
          let content = await readFile(ftaskPath, 'utf-8');
          const now = new Date().toISOString().split('T')[0];
          const syncEntry = `| ${now} | auto | 自动反向同步: 更新 Spec 文件 | SpecCore |\n`;
          const updated = content.replace(
            /(\| :--- \| :--- \| :--- \| :--- \|)/,
            `$1\n${syncEntry}`
          );
          tx.write(ftaskPath, updated);
        }
      }
    }
  }

  // 提交事务 — 原子写入所有变更
  if (tx.length > 0) {
    await tx.commit();
    logger.info(`✅ 已同步: ${task}/ (${tx.length} 个文件，事务保护)`);
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
