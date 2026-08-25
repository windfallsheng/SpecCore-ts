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
export function getTaskPath(iteration: string, taskId: string, cwd?: string): string {
  const base = cwd || process.cwd();
  return join(base, `Iteration-${iteration}`, TASKS_DIR, taskId);
}

/** 获取指定迭代中 030-tasks/ 目录路径 */
export function getTasksRoot(iteration: string, cwd?: string): string {
  const base = cwd || process.cwd();
  return join(base, `Iteration-${iteration}`, TASKS_DIR);
}

/** 获取 Task 在迭代目录中的相对路径 */
export function getTaskRelativePath(taskId: string): string {
  return `${TASKS_DIR}/${taskId}`;
}

/**
 * 在 030-tasks/ 下递归查找 Task 目录（兼容新旧布局 + 子任务目录）
 * 旧布局: 030-tasks/Task-001/
 * 新布局: 030-tasks/feature/Task-001-slug/
 * 子任务: 030-tasks/feature/Task-001/{platform}/Task-001-platform/
 */
export async function findTaskDir(tasksRoot: string, taskId: string): Promise<string | null> {
  if (!(await pathExists(tasksRoot))) return null;

  // 1. 先查旧布局: 030-tasks/Task-NNN/
  const legacyPath = join(tasksRoot, taskId);
  if (await pathExists(legacyPath)) return legacyPath;

  // 2. 查新布局: 030-tasks/{type}/Task-NNN*/
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

  // 3. v8.3.8+: 查子任务目录（如 Task-001-booking-service）
  // 提取父任务 ID：Task-001-booking-service → Task-001
  if (taskId.startsWith('Task-')) {
    const parts = taskId.split('-');
    if (parts.length >= 3) {
      const parentTaskId = `${parts[0]}-${parts[1]}`;
      for (const type of TASK_TYPES) {
        const typeDir = join(tasksRoot, type);
        if (!(await pathExists(typeDir))) continue;

        const parentPath = join(typeDir, parentTaskId);
        if (await pathExists(parentPath)) {
          // 在父任务目录下的端目录中查找子任务
          const platformEntries = await readdir(parentPath, { withFileTypes: true }).catch(() => []);
          for (const pe of platformEntries) {
            if (!pe.isDirectory() || pe.name.startsWith('.') || pe.name.startsWith('_') || pe.name.startsWith('0')) continue;
            const subtaskPath = join(parentPath, pe.name, taskId);
            if (await pathExists(subtaskPath)) return subtaskPath;
          }
        }
      }
    }
  }

  return null;
}
