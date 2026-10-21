/**
 * name-validator — 全局名称唯一性校验
 * 迭代名称全项目唯一，任务名称全项目唯一
 */
import { readdir, pathExists, readFile } from 'fs-extra';
import { join } from 'path';
import { isTaskModuleDirName } from './task-paths';

/**
 * 收集迭代下的任务模块目录（v8.3.337+：兼容 030-tasks 新旧布局）
 * - 030-tasks/Task-*（旧布局直接层）
 * - 030-tasks/{type}/{模块}（新布局：模块名=功能单元名）
 * - Iteration-NNN/Task-* 直接层（历史布局兜底）
 * depth ≤ 1 按功能单元名识别模块后停止深入，避免误收端目录/子任务目录。
 */
async function collectTaskDirs(iterPath: string): Promise<string[]> {
  const dirs: string[] = [];
  const collect = async (dir: string, depth: number) => {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('Task-') || (depth <= 1 && isTaskModuleDirName(entry.name))) {
          dirs.push(join(dir, entry.name));
        } else if (!entry.name.startsWith('.')) {
          await collect(join(dir, entry.name), depth + 1);
        }
      }
    } catch { /* 跳过 */ }
  };
  const tasksDir = join(iterPath, '030-tasks');
  if (await pathExists(tasksDir)) await collect(tasksDir, 0);
  else await collect(iterPath, 0);
  return dirs;
}

/**
 * 扫描所有迭代名称（去Iteration-NNN-前缀，返回原始 name 部分）
 */
export async function getAllIterationNames(): Promise<string[]> {
  const cwd = process.cwd();
  const entries = await readdir(cwd, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory() && e.name.startsWith('Iteration-'))
    .map(e => {
      // Iteration-001-MyName → MyName
      const parts = e.name.split('-');
      return parts.slice(2).join('-');
    })
    .filter(n => n.length > 0);
}

/**
 * 扫描所有任务名称（全项目范围）
 * 任务名称存储在内容文件的第一行 # 标题中
 */
export async function getAllTaskNames(): Promise<string[]> {
  const cwd = process.cwd();
  const iterations = await readdir(cwd, { withFileTypes: true });
  const allTasks: string[] = [];

  for (const iter of iterations) {
    if (!iter.isDirectory() || !iter.name.startsWith('Iteration-')) continue;
    const iterPath = join(cwd, iter.name);
    for (const taskDir of await collectTaskDirs(iterPath)) {
      const name = await readTaskName(taskDir);
      if (name.length > 0) allTasks.push(name);
    }
  }
  return allTasks;
}

/**
 * 从任务目录的内容文件中读取任务名称（第一行 # 标题）
 */
async function readTaskName(taskDir: string): Promise<string> {
  // 尝试多个可能的文件
  const files = ['00-specs/TASK.md', '00-specs/REQ.md'];
  for (const f of files) {
    const filePath = join(taskDir, f);
    if (await pathExists(filePath)) {
      try {
        const content = await readFile(filePath, 'utf-8');
        const firstLine = content.split('\n')[0].trim();
        const match = firstLine.match(/^#\s+(.+)/);
        if (match) return match[1].trim();
      } catch { /* skip bad file */ }
    }
  }
  return '';
}

/**
 * 检查迭代名称是否重复
 * @returns 冲突的迭代列表
 */
export async function checkIterationNameConflict(name: string, excludeName?: string): Promise<string[]> {
  const existing = await getAllIterationNames();
  return existing.filter(n => n === name && n !== excludeName);
}

/**
 * 检查任务名称是否重复（全项目范围）
 * @returns 冲突的任务列表（含所属迭代）
 */
export async function checkTaskNameConflict(name: string, excludeName?: string): Promise<{ name: string; iteration: string }[]> {
  const cwd = process.cwd();
  const iterations = await readdir(cwd, { withFileTypes: true });
  const conflicts: { name: string; iteration: string }[] = [];

  for (const iter of iterations) {
    if (!iter.isDirectory() || !iter.name.startsWith('Iteration-')) continue;
    const iterPath = join(cwd, iter.name);
    for (const taskDir of await collectTaskDirs(iterPath)) {
      const taskName = await readTaskName(taskDir);
      if (taskName === name && taskName !== excludeName) {
        conflicts.push({ name: taskName, iteration: iter.name });
      }
    }
  }
  return conflicts;
}
