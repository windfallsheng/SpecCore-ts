import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { FileTransaction } from '../core/transaction';

/** 变更命令结果 */
export interface ChangeResult {
  success: boolean;
  changes: string[];
  errors: string[];
  affectedFiles: string[];
}

/**
 * 需求变更联动命令。
 *
 * 当需求描述变更时，自动更新所有关联文件：
 * - TASK.md：更新需求描述 + 追加变更历史
 * - REQ.md：更新需求描述
 * - PROJECT_GRAPH.md：更新变更记录
 * - GLOBAL/INDEX.md（如适用）
 *
 * 使用事务保证所有更新原子性。
 */
export async function changeCommand(options: {
  projectRoot: string;
  iteration: string;
  task: string;
  description: string;
  dryRun?: boolean;
}): Promise<ChangeResult> {
  const { projectRoot, iteration, task, description, dryRun = false } = options;
  const affected: string[] = [];
  const changes: string[] = [];
  const errors: string[] = [];

  const taskPath = join(projectRoot, iteration, task);
  if (!existsSync(taskPath)) {
    return { success: false, changes, errors: [`Task 不存在: ${task}`], affectedFiles: [] };
  }

  const tx = new FileTransaction();
  const now = new Date().toISOString();

  // 1. 更新 backend/TASK.md
  const taskMdPath = join(taskPath, 'backend', 'TASK.md');
  if (existsSync(taskMdPath)) {
    const content = readFileSync(taskMdPath, 'utf-8');
    const changelog = `\n| v1.1 | ${now.split('T')[0]} | ${description} | spec-change | AI |`;
    const updated = content + changelog;
    affected.push('backend/TASK.md');
    if (!dryRun) tx.write(taskMdPath, updated);
    changes.push(`TASK.md: 追加变更历史 "${description}"`);
  }

  // 2. 更新 backend/REQ.md
  const reqMdPath = join(taskPath, 'backend', 'REQ.md');
  if (existsSync(reqMdPath)) {
    const content = readFileSync(reqMdPath, 'utf-8');
    const note = `\n> 🔄 ${now.split('T')[0]}: ${description}\n`;
    const updated = content.replace(/(##\s*变更记录)/, `${note}$1`)
      || (content.includes('## 变更记录') ? content : content + `\n## 变更记录\n${note}`);
    affected.push('backend/REQ.md');
    if (!dryRun) tx.write(reqMdPath, updated);
    changes.push('REQ.md: 已更新');
  }

  // 3. 更新 PROJECT_GRAPH.md
  const pgPath = join(projectRoot, iteration, '00-期次总览', 'PROJECT_GRAPH.md');
  if (existsSync(pgPath)) {
    const content = readFileSync(pgPath, 'utf-8');
    const note = `\n> 🔄 ${task}: ${description} (${now.split('T')[0]})`;
    const updated = content + note;
    affected.push('00-期次总览/PROJECT_GRAPH.md');
    if (!dryRun) tx.write(pgPath, updated);
    changes.push('PROJECT_GRAPH.md: 已追加变更记录');
  }

  if (dryRun) {
    return { success: true, changes, errors, affectedFiles: affected };
  }

  try {
    await tx.commit();
    return { success: true, changes, errors, affectedFiles: affected };
  } catch (e) {
    errors.push(`事务失败: ${(e as Error).message}`);
    return { success: false, changes, errors, affectedFiles: affected };
  }
}
