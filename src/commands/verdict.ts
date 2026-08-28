/**
 * verdict — 契约冲突裁决命令
 *
 * v8.3.24+: 查看待裁决冲突、进行人工裁决、查看裁决书
 */

import { pathExists, readFile } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import { getDefaultIteration, getIterationDir } from '../core/context';
import { findTaskDir } from '../core/task-paths';
import type { VerdictOutcome } from '../core/arbitration/verdict-types';

export interface VerdictOptions {
  list?: boolean;
  conflict?: string;
  decide?: string;
  reason?: string;
  report?: string;
  task?: string;
  iteration?: string;
}

export async function verdictCommand(options: VerdictOptions): Promise<void> {
  // 1. 查看裁决书
  if (options.report) {
    await showReport(options.report, options.iteration);
    return;
  }

  // 2. 列出待裁决冲突
  if (options.list) {
    await listPendingConflicts(options.task, options.iteration);
    return;
  }

  // 3. 人工裁决
  if (options.conflict && options.decide) {
    await makeDecision(options.conflict, options.decide as VerdictOutcome, options.reason, options.task, options.iteration);
    return;
  }

  // 默认：帮助信息
  logger.info('');
  logger.info('⚖️  契约冲突裁决命令');
  logger.info('');
  logger.info('用法:');
  logger.info('  speccore verdict --list [--task <Task-ID>]');
  logger.info('  speccore verdict --conflict <ID> --decide <pass|pass-with-conditions|reject|defer> [--reason <说明>]');
  logger.info('  speccore verdict --report <Task-ID>');
  logger.info('');
  logger.info('示例:');
  logger.info('  speccore verdict --list');
  logger.info('  speccore verdict --conflict L3-security-xxx --decide pass --reason "已改为参数化查询"');
  logger.info('  speccore verdict --report Task-001');
}

/** 查看裁决书 */
async function showReport(taskId: string, iteration?: string): Promise<void> {
  const iter = iteration || await getDefaultIteration();
  const iterDir = await getIterationDir(iter);
  const tasksRoot = join(iterDir, '030-tasks');
  const taskDir = await findTaskDir(tasksRoot, taskId);

  if (!taskDir) {
    logger.error(`未找到 Task: ${taskId}`);
    return;
  }

  const reportPath = join(taskDir, 'ARBITRATION_REPORT.md');
  if (await pathExists(reportPath)) {
    const content = await readFile(reportPath, 'utf-8');
    logger.info('');
    logger.info(content);
  } else {
    logger.warn(`未找到裁决书: ${reportPath}`);
    logger.info('提示: 该任务尚未执行裁决流程');
  }
}

/** 列出待裁决冲突 */
async function listPendingConflicts(taskId?: string, iteration?: string): Promise<void> {
  const iter = iteration || await getDefaultIteration();
  const iterDir = await getIterationDir(iter);
  const tasksRoot = join(iterDir, '030-tasks');

  if (taskId) {
    const taskDir = await findTaskDir(tasksRoot, taskId);
    if (taskDir) {
      await showTaskConflicts(taskId, taskDir);
    } else {
      logger.error(`未找到 Task: ${taskId}`);
    }
    return;
  }

  // 扫描所有任务
  const fs = require('fs-extra');
  const entries = await fs.readdir(tasksRoot, { withFileTypes: true }).catch(() => []);
  let foundAny = false;

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const taskDir = join(tasksRoot, entry.name);
    const hasPending = await showTaskConflicts(entry.name, taskDir, true);
    if (hasPending) foundAny = true;
  }

  if (!foundAny) {
    logger.info('');
    logger.info('✅ 当前迭代无待裁决冲突');
  }
}

/** 显示单个任务的待裁决冲突 */
async function showTaskConflicts(taskId: string, taskDir: string, silentOnEmpty = false): Promise<boolean> {
  const reportPath = join(taskDir, 'ARBITRATION_REPORT.md');
  if (!(await pathExists(reportPath))) return false;

  const content = await readFile(reportPath, 'utf-8');

  // 简单解析：查找 pending-review 和 pending-fix
  const pendingL3 = content.match(/待裁决/g) || [];
  const pendingL2 = content.match(/待确认/g) || [];
  const hasPending = pendingL3.length > 0 || pendingL2.length > 0;

  if (!hasPending && silentOnEmpty) return false;

  logger.info('');
  logger.info(`📋 ${taskId}:`);

  if (pendingL3.length > 0) {
    logger.info(`   ⏳ ${pendingL3.length} 项 L3 冲突待人工裁决`);
  }
  if (pendingL2.length > 0) {
    logger.info(`   💡 ${pendingL2.length} 项 L2 冲突待确认修复`);
  }
  if (!hasPending) {
    logger.info('   ✅ 无待裁决冲突');
  }

  return hasPending;
}

/** 人工做出裁决 */
async function makeDecision(
  conflictId: string,
  outcome: VerdictOutcome,
  reason?: string,
  taskId?: string,
  iteration?: string
): Promise<void> {
  const iter = iteration || await getDefaultIteration();
  const iterDir = await getIterationDir(iter);
  const tasksRoot = join(iterDir, '030-tasks');

  // 如果没指定 taskId，尝试从 conflictId 推断
  const targetTaskId = taskId || await findTaskByConflict(tasksRoot, conflictId);
  if (!targetTaskId) {
    logger.error(`无法定位冲突所属任务。请使用 --task 指定 Task-ID`);
    return;
  }

  const taskDir = await findTaskDir(tasksRoot, targetTaskId);
  if (!taskDir) {
    logger.error(`未找到 Task: ${targetTaskId}`);
    return;
  }

  const reportPath = join(taskDir, 'ARBITRATION_REPORT.md');
  if (!(await pathExists(reportPath))) {
    logger.error(`未找到裁决书。该任务可能尚未执行裁决流程。`);
    return;
  }

  // 读取现有裁决书，找到对应冲突
  const reportContent = await readFile(reportPath, 'utf-8');
  if (!reportContent.includes(conflictId)) {
    logger.error(`未在裁决书中找到冲突: ${conflictId}`);
    return;
  }

  // 构建裁决理由
  const finalReason = reason || `人工裁决: ${outcome}`;

  // 在裁决书中追加裁决记录
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const verdictEntry = `

---

> **人工裁决记录** | ${now}
> - 冲突: ${conflictId}
> - 裁决: ${outcome}
> - 理由: ${finalReason}
> - 裁决者: Human
`;

  const updatedContent = reportContent + verdictEntry;
  await require('fs-extra').writeFile(reportPath, updatedContent, 'utf-8');

  logger.success(`已记录裁决: ${conflictId} → ${outcome}`);
  logger.info(`   理由: ${finalReason}`);
  logger.info(`   裁决书已更新: ${reportPath}`);

  if (outcome === 'pass-with-conditions') {
    logger.info('');
    logger.info('⚠️  有条件通过，请确保满足所有附加条件后再执行 done');
  }
}

/** 通过扫描裁决书查找冲突所属任务 */
async function findTaskByConflict(tasksRoot: string, conflictId: string): Promise<string | null> {
  const fs = require('fs-extra');
  const entries = await fs.readdir(tasksRoot, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const reportPath = join(tasksRoot, entry.name, 'ARBITRATION_REPORT.md');
    if (await pathExists(reportPath)) {
      const content = await readFile(reportPath, 'utf-8');
      if (content.includes(conflictId)) return entry.name;
    }
  }

  return null;
}
