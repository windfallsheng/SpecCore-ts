/**
 * Shared Task Utils — 跨命令共享的工具函数
 *
 * 消除 goal/bugfix/research/new-task 中的重复代码
 */

import { existsSync, readFileSync } from 'fs';
import { rename, pathExists } from 'fs-extra';
import { join } from 'path';

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

/**
 * 写入前自动备份：旧文件按时间戳重命名，永不覆盖
 * 返回备份文件路径（无旧文件则返回 null）
 */
export async function backupWithTimestamp(filePath: string): Promise<string | null> {
  if (await pathExists(filePath)) {
    const ext = filePath.match(/\.[^.]+$/)?.[0] || '';
    const base = filePath.slice(0, filePath.length - ext.length);
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const backupPath = `${base}-${ts}${ext}`;
    await rename(filePath, backupPath);
    return backupPath;
  }
  return null;
}

/**
 * 目录备份：旧目录按时间戳重命名，永不覆盖
 * 返回备份目录路径（无旧目录则返回 null）
 */
export async function backupDirWithTimestamp(dirPath: string): Promise<string | null> {
  if (await pathExists(dirPath)) {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const backupPath = `${dirPath}-${ts}`;
    await rename(dirPath, backupPath);
    return backupPath;
  }
  return null;
}

/**
 * 判断文件名是否为时间戳备份文件（如 ANALYSIS-20260813021034.md）
 */
export function isTimestampBackup(filename: string): boolean {
  return /-\d{14}\./.test(filename);
}

/**
 * 写入前智能决策：交互模式询问用户，自动模式静默备份
 * @returns true = 可以继续写入，false = 用户取消
 */
export async function shouldOverwrite(
  filePath: string,
  interactive: boolean
): Promise<boolean> {
  if (!(await pathExists(filePath))) return true;

  if (interactive) {
    const { createInterface } = require('readline');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer: string = await new Promise(resolve => {
      rl.question(`   ⚠️  ${filePath.split('/').pop()} 已存在，是否覆盖？(y/N) `, resolve);
    });
    rl.close();
    return answer.trim().toLowerCase() === 'y';
  }

  // 自动模式：静默备份
  return true;
}
