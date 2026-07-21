/**
 * update — 更新 Task/期次 属性
 *
 * 用法: speccore update --task=Task-001 --status=completed
 *      speccore update --iteration=xxx --assignee=张三
 */

import { pathExists, readFile } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { FileTransaction } from '../core/transaction';
import { logOperation } from '../core/operation-log';

export interface UpdateOptions {
  task?: string;
  iteration?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  type?: string;
  force?: boolean;
}

export async function updateCommand(options: UpdateOptions): Promise<void> {
  const iter = await getDefaultIteration(options.iteration);

  if (!iter) {
    logger.error('No active iteration found. Use --iteration=<name> to specify.');
    return;
  }

  if (options.task) {
    await updateTask(iter, options.task, options);
    logOperation('speccore update', `task=${options.task}`);
  } else {
    logger.warn('Please specify --task=<id>');
    logger.info('Usage: speccore update --task=Task-001 --status=completed');
  }
}

async function updateTask(iteration: string, taskId: string, options: UpdateOptions): Promise<void> {
  const taskDir = join(process.cwd(), iteration, taskId);
  if (!(await pathExists(taskDir))) {
    logger.error(`Task not found: ${taskId}`);
    return;
  }

  const tx = new FileTransaction();
  const now = new Date().toISOString().split('T')[0];

  // Update backend TASK.md
  const taskMdPath = join(taskDir, 'backend', 'TASK.md');
  if (await pathExists(taskMdPath)) {
    let content = await readFile(taskMdPath, 'utf-8');

    if (options.status) {
      const statusMap: Record<string, string> = {
        pending: '🔲 待开发',
        in_progress: '🔄 开发中',
        completed: '✅ 已完成',
        blocked: '🚫 阻塞',
        archived: '📦 已归档',
      };
      const statusIcon = statusMap[options.status] || options.status;
      content = content.replace(/状态:\s.*/, `状态: ${statusIcon}`);
      content = content.replace(/status:\s.*/i, `status: ${options.status}`);
      logger.info(`  Status → ${options.status}`);
    }

    if (options.priority) {
      content = content.replace(/优先级:\s.*/, `优先级: ${options.priority}`);
      logger.info(`  Priority → ${options.priority}`);
    }

    if (options.assignee) {
      content = content.replace(/负责人:\s.*/, `负责人: ${options.assignee}`);
      logger.info(`  Assignee → ${options.assignee}`);
    }

    tx.write(taskMdPath, content);
  }

  // Also update frontend TASK.md files
  const frontendDir = join(taskDir, 'frontend');
  if (await pathExists(frontendDir)) {
    const { readdir } = await import('fs-extra');
    const entries = await readdir(frontendDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        const ftaskPath = join(frontendDir, e.name, 'TASK.md');
        if (await pathExists(ftaskPath)) {
          let content = await readFile(ftaskPath, 'utf-8');

          if (options.status) {
            const statusMap: Record<string, string> = {
              pending: '🔲 待开发',
              in_progress: '🔄 开发中',
              completed: '✅ 已完成',
            };
            const icon = statusMap[options.status] || options.status;
            content = content.replace(/状态:\s.*/, `状态: ${icon}`);
          }

          if (options.priority) {
            content = content.replace(/优先级:\s.*/, `优先级: ${options.priority}`);
          }

          tx.write(ftaskPath, content);
        }
      }
    }
  }

  if (tx.length > 0) {
    await tx.commit();
    logger.success(`Updated ${taskId} (${tx.length} files, transaction protected)`);
  } else {
    logger.warn('No files found to update');
  }
}
