/**
 * done — 一键收尾：validate → archive → sync-global
 */
import { readFile, pathExists } from 'fs-extra';
import { join } from 'path';
import { execSync } from 'child_process';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { showNextSteps } from '../core/next-steps';

export interface DoneOptions {
  task?: string;
  iteration?: string;
  skipValidate?: boolean;
  skipSync?: boolean;
}

export async function doneCommand(options: DoneOptions): Promise<void> {
  if (!options.task) {
    logger.error('请指定任务: speccore done --task=Task-001');
    return;
  }

  const iteration = await getDefaultIteration(options.iteration);
  if (!iteration) {
    logger.error('未找到活跃期次');
    return;
  }

  const iterDir = `期次-${iteration}`;
  const tasks = await scanForTask(iterDir, options.task);
  if (tasks.length === 0) {
    logger.error(`Task 未找到: ${options.task}`);
    return;
  }

  const taskId = tasks[0];
  let spinner = new Spinner(`正在收尾 ${taskId}`);
  spinner.start();

  const steps: { ok: boolean; step: string }[] = [];

  // ── Step 1: Validate ──
  if (!options.skipValidate) {
    spinner.stop(); 
    logger.info('   1/4 校验...');
    try {
      execSync(`speccore validate --task=${taskId} --iteration=${iteration}`, { stdio: 'pipe' });
      steps.push({ ok: true, step: 'validate' });
      logger.info('     ✅ 校验通过');
    } catch {
      steps.push({ ok: false, step: 'validate' });
      logger.warn('     ⚠️ 校验发现问题（已继续）');
    }
    spinner = new Spinner(`正在收尾 ${taskId}`);
    spinner.start();
  }

  // ── Step 2: Archive ──
  spinner.stop();
  logger.info('   2/4 归档...');
  try {
    execSync(`speccore archive --task=${taskId} --iteration=${iteration}`, { stdio: 'pipe' });
    steps.push({ ok: true, step: 'archive' });
    logger.info('     ✅ 已归档');
  } catch {
    steps.push({ ok: false, step: 'archive' });
    logger.warn('     ⚠️ 归档失败');
  }
  spinner = new Spinner(`正在收尾 ${taskId}`);
  spinner.start();

  // ── Step 3: Sync to global ──
  if (!options.skipSync) {
    spinner.stop();
    logger.info('   3/4 同步到全局...');
    try {
      execSync(`speccore sync-global --iteration=${iteration} --direction=to_global`, { stdio: 'pipe' });
      steps.push({ ok: true, step: 'sync-global' });
      logger.info('     ✅ 已同步');
    } catch {
      steps.push({ ok: false, step: 'sync-global' });
      logger.warn('     ⚠️ 同步失败');
    }
    spinner = new Spinner(`正在收尾 ${taskId}`);
    spinner.start();
  }

  // ── Step 4: Audit summary ──
  spinner.stop();
  logger.info('   4/4 生成摘要...');
  try {
    const auditOutput = execSync(`speccore audit --detail --iteration=${iteration}`, { stdio: 'pipe', encoding: 'utf-8' });
    logger.info('     ✅ 审计完成');
  } catch {
    // audit might fail, that's OK
  }

  // ── Summary ──
  const okCount = steps.filter(s => s.ok).length;
  spinner.stop(`✅ ${taskId} 收尾完成 (${okCount}/${steps.length})`);

  logger.info('');
  showNextSteps('archive');
}

async function scanForTask(iterDir: string, taskId: string): Promise<string[]> {
  const fs = require('fs');
  const entries = fs.readdirSync(iterDir, { withFileTypes: true });
  return entries
    .filter((e: any) => e.isDirectory() && e.name.startsWith(taskId))
    .map((e: any) => e.name);
}
