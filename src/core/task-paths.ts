/**
 * 统一 Task 路径管理 — 所有 Task 现在位于 030-tasks/ 子目录下
 *
 * 旧: Iteration-001/Task-001/
 * 新: Iteration-001/030-tasks/Task-001/
 */

import { join } from 'path';

export const TASKS_DIR = '030-tasks';

/** 获取指定迭代中某个 Task 的完整目录路径 */
export function getTaskPath(iteration: string, taskId: string): string {
  return join(process.cwd(), `Iteration-${iteration}`, TASKS_DIR, taskId);
}

/** 获取指定迭代中 030-tasks/ 目录路径 */
export function getTasksRoot(iteration: string): string {
  return join(process.cwd(), `Iteration-${iteration}`, TASKS_DIR);
}

/** 获取 Task 在迭代目录中的相对路径 (030-tasks/Task-NNN) */
export function getTaskRelativePath(taskId: string): string {
  return `${TASKS_DIR}/${taskId}`;
}
