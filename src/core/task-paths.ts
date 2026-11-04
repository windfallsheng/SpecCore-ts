/**
 * 统一 Task 路径管理 — 所有 Task 位于 030-tasks/{type}/ 子目录下
 *
 * 旧: Iteration-001/Task-001/
 * 中: Iteration-001/030-tasks/Task-001/
 * 新: Iteration-001/030-tasks/feature/Task-001-slug/
 */

import { join } from 'path';
import { pathExists, readdir } from 'fs-extra';
import { existsSync } from 'fs';

export const TASKS_DIR = '030-tasks';
export const TASK_TYPES = ['feature', 'bugfix', 'refactor', 'research'] as const;

/**
 * 任务模块目录名判断（v8.3.337+）
 * - 旧格式兼容：Task-NNN-*（存量迭代）
 * - 新格式：功能单元目录名（小写字母开头含连字符，如 admin-web-01-yudingguanli）
 * 排除：隐藏目录（.backup）、数字开头（00-specs）、下划线开头（_shared）
 */
export function isTaskModuleDirName(name: string): boolean {
  if (name.startsWith('Task-')) return true;
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(name);
}

/**
 * 任务模块目录判断（带路径精确版，v8.3.337+）：
 * 目录名符合模块命名 + 目录内存在 .meta/ 或 00-specs/ 结构
 */
export function isTaskModuleDir(dirPath: string): boolean {
  try {
    return isTaskModuleDirName(dirPath.split(/[\/\\]/).pop() || '')
      && (existsSync(join(dirPath, '.meta')) || existsSync(join(dirPath, '00-specs')));
  } catch {
    return false;
  }
}

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
 * 在 030-tasks/ 下递归查找 Task 目录（支持子任务目录）
 * 布局: 030-tasks/Task-001/
 * 新布局: 030-tasks/feature/Task-001-slug/
 * 子任务: 030-tasks/feature/Task-001/{platform}/Task-001-platform/
 */
export async function findTaskDir(tasksRoot: string, taskId: string): Promise<string | null> {
  if (!(await pathExists(tasksRoot))) return null;

  // 1. 先查布局: 030-tasks/Task-NNN/
  const legacyPath = join(tasksRoot, taskId);
  if (await pathExists(legacyPath)) return legacyPath;

  // 2. v8.3.8+: 查子任务目录（如 Task-001-booking-service）
  // v8.3.269: 父任务 ID 推断修复——任务组名可为多段（Task-{seq}-{端}-{序号}，v8.3.268 起），
  // 原实现只截取前两段（Task-{seq}），对多段任务组名必然解析失败。
  // 改为从最长前缀逐段递减尝试匹配（Task-222-admin-web-02-admin-web →
  // 依次尝试父组 Task-222-admin-web-02-admin-web / Task-222-admin-web-02 / Task-222）。
  // v8.3.337+: 新命名的父模块目录不带 Task- 前缀（Task-{模块名} → 父目录 = 模块名），
  // 优先直接匹配；同时保持旧格式逐段递减兼容。
  // v8.3.384+: 子任务查找提前到模块前缀匹配之前，并把 taskId 自身纳入模块候选——
  // 旧存量模块目录名 = 子任务 ID（带 Task- 前缀）时，模块目录与子任务目录同名，
  // 若先走前缀匹配会命中模块目录而非子任务目录。
  if (taskId.startsWith('Task-')) {
    const moduleCandidates = [taskId, taskId.slice(5)]; // 自身（旧存量模块名=子任务 ID）+ 去前缀（v8.3.337 新格式）
    const parts = taskId.split('-');
    for (let k = parts.length - 1; k >= 2; k--) {
      moduleCandidates.push(parts.slice(0, k).join('-'));
    }
    for (const parentTaskId of moduleCandidates) {
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

  // 3. 查新布局: 030-tasks/{type}/Task-NNN*/
  // v8.3.316+: 前缀匹配加边界——Task-033 只命中 Task-033 自身或其 -topic 后缀，
  // 不误命中 Task-0331-xxx（需且仅需下一字符为 '-' 或串尾）
  for (const type of TASK_TYPES) {
    const typeDir = join(tasksRoot, type);
    if (await pathExists(typeDir)) {
      const entries = await readdir(typeDir, { withFileTypes: true });
      for (const e of entries) {
        if (
          e.isDirectory() && e.name.startsWith(taskId) &&
          (e.name.length === taskId.length || e.name[taskId.length] === '-')
        ) {
          return join(typeDir, e.name);
        }
      }
    }
  }

  // 4. v8.3.384+: 兜底——子任务 ID 即目录名（v8.3.340+，用户改名后 ID 随目录名），
  // 第 2 步依赖父目录名推断，遇「只改子任务目录名 / 只改模块目录名 / 都改」
  // 等组合会失败。改为按目录名精确匹配递归查找（深度 3：模块/{端}/{子任务}）。
  if (taskId.startsWith('Task-')) {
    for (const type of TASK_TYPES) {
      const typeDir = join(tasksRoot, type);
      if (!(await pathExists(typeDir))) continue;
      const modules = await readdir(typeDir, { withFileTypes: true });
      for (const m of modules) {
        if (!m.isDirectory() || m.name.startsWith('.') || m.name.startsWith('_') || m.name.startsWith('0')) continue;
        const platformEntries = await readdir(join(typeDir, m.name), { withFileTypes: true }).catch(() => [] as any[]);
        for (const pe of platformEntries) {
          if (!pe.isDirectory() || pe.name.startsWith('.') || pe.name.startsWith('_') || pe.name.startsWith('0')) continue;
          const candidate = join(typeDir, m.name, pe.name, taskId);
          if (await pathExists(candidate)) return candidate;
        }
      }
    }
  }

  return null;
}
