import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { FileTransaction } from '../core/transaction';

/** 执行结果 */
export interface ExecuteResult {
  success: boolean;
  executed: string[];
  skipped: string[];
  errors: string[];
}

/** 执行选项 */
export interface ExecuteOptions {
  projectRoot: string;
  iteration: string;
  task?: string;
  assignee?: string;
  platform?: string;
  dryRun?: boolean;
}

/**
 * 执行控制中心 — 按条件执行 Task。
 *
 * 执行过程：
 * 1. 找到待执行的 Task
 * 2. 将状态从 pending → in_progress
 * 3. 写入 TASK.md 状态标记
 * 4. 更新 PROJECT_GRAPH.md
 * 5. 使用事务保证原子性
 */
export async function executeCommand(options: ExecuteOptions): Promise<ExecuteResult> {
  const { projectRoot, iteration, dryRun = false } = options;
  const executed: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  const iterDir = join(projectRoot, iteration);
  if (!existsSync(iterDir)) {
    return { success: false, executed, skipped, errors: [`期次不存在: ${iteration}`] };
  }

  const { readdirSync } = require('fs');
  const tasks = options.task
    ? [options.task]
    : readdirSync(iterDir).filter((f: string) => f.startsWith('Task-')).sort();

  const tx = new FileTransaction();
  let taskCount = 0;

  for (const task of tasks) {
    const taskMdPath = join(iterDir, task, 'backend', 'TASK.md');
    if (!existsSync(taskMdPath)) {
      skipped.push(`${task}: TASK.md 不存在，跳过`);
      continue;
    }

    const content = readFileSync(taskMdPath, 'utf-8');

    // 检查是否已经是完成/进行中状态
    if (content.includes('**状态**: ✅ 已完成') || content.includes('**状态**: ✅ completed')) {
      skipped.push(`${task}: 已完成，跳过`);
      continue;
    }

    if (content.includes('**状态**: 🔄 进行中') || content.includes('**状态**: 🔄 in_progress')) {
      skipped.push(`${task}: 已在执行中，跳过`);
      continue;
    }

    taskCount++;

    // 更新状态
    const updated = content.replace(
      /(\*\*状态\*\*:\s*)[^*\n]+/,
      '$1🔄 进行中'
    ).replace(
      /(\*\*Status\*\*:\s*)[^*\n]+/,
      '$1🔄 in_progress'
    );

    // 追加执行人（如指定）
    let finalContent = updated;
    if (options.assignee) {
      finalContent = finalContent.replace(
        /(\*\*执行人\*\*:\s*)[^*\n]*/,
        `$1${options.assignee}`
      );
    }

    if (!dryRun) {
      tx.write(taskMdPath, finalContent);
    }
    executed.push(`${task}: 已标记为 🔄 进行中${options.assignee ? ` (${options.assignee})` : ''}`);
  }

  // 更新 PROJECT_GRAPH.md
  const pgPath = join(iterDir, '00-期次总览', 'PROJECT_GRAPH.md');
  if (existsSync(pgPath) && taskCount > 0 && !dryRun) {
    const pgContent = readFileSync(pgPath, 'utf-8');
    const now = new Date().toISOString().split('T')[0];
    const note = `\n> ⚡ ${now}: 批量执行 ${taskCount} 个 Task`;
    tx.write(pgPath, pgContent + note);
  }

  if (dryRun) {
    return { success: true, executed, skipped, errors };
  }

  try {
    await tx.commit();
    return { success: true, executed, skipped, errors };
  } catch (e) {
    errors.push(`事务失败: ${(e as Error).message}`);
    return { success: false, executed, skipped, errors };
  }
}
