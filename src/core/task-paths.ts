/**
 * 统一 Task 路径管理 — 所有 Task 位于 030-tasks/{type}/ 子目录下
 *
 * 旧: Iteration-001/Task-001/
 * 中: Iteration-001/030-tasks/Task-001/
 * 新: Iteration-001/030-tasks/feature/Task-001-slug/
 */

import { join } from 'path';
import { pathExists, readdir } from 'fs-extra';

export const TASKS_DIR = '030-tasks';
export const TASK_TYPES = ['feature', 'bugfix', 'refactor', 'research'] as const;

/** 获取指定迭代中某个 Task 的完整目录路径（新布局：含类型子目录） */
export function getTaskPath(iteration: string, taskId: string): string {
  return join(process.cwd(), `Iteration-${iteration}`, TASKS_DIR, taskId);
}

/** 获取指定迭代中 030-tasks/ 目录路径 */
export function getTasksRoot(iteration: string): string {
  return join(process.cwd(), `Iteration-${iteration}`, TASKS_DIR);
}

/** 获取 Task 在迭代目录中的相对路径 */
export function getTaskRelativePath(taskId: string): string {
  return `${TASKS_DIR}/${taskId}`;
}

/**
 * 在 030-tasks/ 下递归查找 Task 目录（兼容新旧布局）
 * 新布局: 030-tasks/feature/Task-001-slug/
 * 旧布局: 030-tasks/Task-001/
 */
export async function findTaskDir(tasksRoot: string, taskId: string): Promise<string | null> {
  if (!(await pathExists(tasksRoot))) return null;

  // 先查旧布局: 030-tasks/Task-NNN/
  const legacyPath = join(tasksRoot, taskId);
  if (await pathExists(legacyPath)) return legacyPath;

  // 查新布局: 030-tasks/{type}/Task-NNN*/
  for (const type of TASK_TYPES) {
    const typeDir = join(tasksRoot, type);
    if (await pathExists(typeDir)) {
      const entries = await readdir(typeDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && e.name.startsWith(taskId)) {
          return join(typeDir, e.name);
        }
      }
    }
  }
  return null;
}
