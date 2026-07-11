/**
 * Shared Task Utils — 跨命令共享的工具函数
 *
 * 消除 goal/bugfix/research/new-task 中的重复代码
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * 生成下一个 Task ID
 */
export function generateTaskId(iterationDir: string): string {
  try {
    const fs = require('fs');
    const entries = fs.readdirSync(iterationDir, { withFileTypes: true });
    const tasks = entries
      .filter((e: any) => e.isDirectory() && e.name.startsWith('Task-'))
      .map((e: any) => {
        const match = e.name.match(/^Task-(\d{3})/);
        return match ? parseInt(match[1], 10) : 0;
      });

    const maxId = tasks.length > 0 ? Math.max(...tasks) : 0;
    return `Task-${String(maxId + 1).padStart(3, '0')}`;
  } catch {
    return 'Task-001';
  }
}

/**
 * 检测项目根目录（向上查找 .speccore/）
 */
export function findProjectRoot(): string | null {
  let dir = process.cwd();

  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, '.speccore'))) {
      return dir;
    }
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

/**
 * 确保在 SpecCore 项目根目录执行
 */
export function ensureProjectRoot(): string {
  const root = findProjectRoot();
  if (!root) {
    throw new Error('Not a SpecCore project. Run "speccore init" first.');
  }
  return root;
}

/**
 * 获取迭代目录（统一路径解析）
 */
export function getIterationDir(iteration: string): string {
  const root = process.cwd();
  return join(root, iteration);
}

/**
 * 获取任务目录
 */
export function getTaskDir(iteration: string, taskId: string): string {
  return join(getIterationDir(iteration), taskId);
}

/**
 * 扫描迭代中的任务列表
 */
export function scanIterationTasks(iterationDir: string): string[] {
  try {
    const fs = require('fs');
    return fs.readdirSync(iterationDir, { withFileTypes: true })
      .filter((e: any) => e.isDirectory() && e.name.startsWith('Task-'))
      .map((e: any) => e.name);
  } catch {
    return [];
  }
}

/**
 * 读取任务类型文件
 */
export function readTaskType(taskDir: string): string | null {
  try {
    const typePath = join(taskDir, '.task-type');
    if (existsSync(typePath)) {
      return readFileSync(typePath, 'utf-8').trim();
    }
  } catch {}
  return null;
}

/**
 * 获取当前日期 YYYY-MM-DD
 */
export function today(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * 获取当前时间 ISO 字符串
 */
export function now(): string {
  return new Date().toISOString();
}
