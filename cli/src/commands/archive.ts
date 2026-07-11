import { readFileSync, existsSync, renameSync, mkdirSync } from 'fs';
import { join } from 'path';
import { FileTransaction } from '../core/transaction';

/** 归档结果 */
export interface ArchiveResult {
  success: boolean;
  archived: string[];
  skipped: string[];
  errors: string[];
}

/**
 * 归档命令 — 将已完成的 Task 移动到 archived/ 目录。
 *
 * 流程：
 * 1. 找到状态为「已完成」的 Task
 * 2. 移动到 期次-XXX/archived/ 目录
 * 3. 更新 PROJECT_GRAPH.md 归档记录
 * 4. 使用事务保护
 */
export async function archiveCommand(options: {
  projectRoot: string;
  iteration: string;
  task?: string;
  all?: boolean;
  dryRun?: boolean;
}): Promise<ArchiveResult> {
  const { projectRoot, iteration, dryRun = false } = options;
  const archived: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  const iterDir = join(projectRoot, iteration);
  if (!existsSync(iterDir)) {
    return { success: false, archived, skipped, errors: [`期次不存在: ${iteration}`] };
  }

  const { readdirSync } = require('fs');
  const archiveDir = join(iterDir, 'archived');

  // 确定要归档的 Task
  let tasksToArchive: string[] = [];
  if (options.task) {
    tasksToArchive = [options.task];
  } else if (options.all) {
    const entries = readdirSync(iterDir);
    tasksToArchive = entries.filter(
      (f: string) => f.startsWith('Task-') && f !== 'Task-模板'
    );
  }

  if (tasksToArchive.length === 0) {
    return { success: true, archived, skipped, errors };
  }

  const tx = new FileTransaction();

  for (const task of tasksToArchive) {
    const taskPath = join(iterDir, task);
    const taskMdPath = join(taskPath, 'backend', 'TASK.md');

    if (!existsSync(taskPath)) {
      skipped.push(`${task}: 目录不存在，跳过`);
      continue;
    }

    // 检查是否已完成
    if (existsSync(taskMdPath)) {
      const content = readFileSync(taskMdPath, 'utf-8');
      if (!(content.includes('✅ 已完成') || content.includes('✅ completed'))) {
        skipped.push(`${task}: 未完成，跳过归档`);
        continue;
      }
    }

    if (dryRun) {
      archived.push(`${task}: 将归档到 archived/`);
    } else {
      // 移动整个 Task 目录到 archived/
      const dest = join(archiveDir, task);
      tsMoveDir(taskPath, dest);
      archived.push(`${task}: 已归档`);
    }
  }

  // 更新 PROJECT_GRAPH.md
  const pgPath = join(iterDir, '00-期次总览', 'PROJECT_GRAPH.md');
  if (existsSync(pgPath) && archived.length > 0) {
    const now = new Date().toISOString().split('T')[0];
    const pgContent = readFileSync(pgPath, 'utf-8');

    const archiveSection = `\n> 📦 ${now}: ` + archived.filter(a => !a.includes('将归档')).map(a => {
      const match = a.match(/Task-\d+/);
      return match ? match[0] : '';
    }).filter(Boolean).join(', ') + ' 已归档';

    if (!dryRun) {
      tx.write(pgPath, pgContent + archiveSection);
    }
  }

  if (dryRun) {
    return { success: true, archived, skipped, errors };
  }

  try {
    await tx.commit();
    return { success: true, archived, skipped, errors };
  } catch (e) {
    errors.push(`事务失败: ${(e as Error).message}`);
    return { success: false, archived, skipped, errors };
  }
}

/**
 * 递归移动目录（用于事务操作）
 * 注意：此操作不可逆，仅用于已完成归档场景
 */
function tsMoveDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  const { readdirSync, statSync, renameSync } = require('fs');
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      tsMoveDir(srcPath, destPath);
    } else {
      renameSync(srcPath, destPath);
    }
  }
  // 清理空目录（使用 fs 的 rmdirSync）
  try {
    const { rmdirSync } = require('fs');
    const entries = readdirSync(src);
    if (entries.length === 0) rmdirSync(src);
    else {
      // 递归清理子目录
      for (const e of entries) {
        const p = join(src, e);
        if (statSync(p).isDirectory()) {
          tsCleanDir(p);
        }
      }
      rmdirSync(src);
    }
  } catch { /* ignore */ }
}

function tsCleanDir(dir: string): void {
  const { readdirSync, statSync, rmdirSync, unlinkSync } = require('fs');
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) { tsCleanDir(p); }
    else { unlinkSync(p); }
  }
  rmdirSync(dir);
}
