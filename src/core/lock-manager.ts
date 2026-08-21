/**
 * Lock Manager — 并发保护
 * v6.95.0: 基于文件的轻量级锁，防止多用户/多进程同时操作同一迭代
 */
import { join } from 'path';
import { writeFile, readFile, pathExists, unlink } from 'fs-extra';
import { getCurrentUser } from './user-context';
import { logger } from '../utils/logger';

const LOCKS_DIR = '.speccore/local/locks';

export interface LockInfo {
  holder: string;
  acquiredAt: string;
  task?: string;
  iteration?: string;
  pid: number;
}

export interface LockResult {
  success: boolean;
  existing?: LockInfo;
  message: string;
}

function getLockPath(cwd: string, lockName: string): string {
  return join(cwd, LOCKS_DIR, `${lockName}.lock`);
}

/**
 * 尝试获取锁
 */
export async function acquireLock(
  cwd: string,
  lockName: string,
  options: {
    task?: string;
    iteration?: string;
    force?: boolean;
  } = {}
): Promise<LockResult> {
  const lockPath = getLockPath(cwd, lockName);

  // 检查现有锁
  if (await pathExists(lockPath)) {
    try {
      const raw = await readFile(lockPath, 'utf-8');
      const existing: LockInfo = JSON.parse(raw);

      // 检查是否是同一进程（可能是崩溃后重启）
      if (existing.pid === process.pid) {
        return { success: true, message: '当前进程已持有此锁' };
      }

      // 检查锁是否过期（超过 30 分钟视为死锁）
      const acquiredTime = new Date(existing.acquiredAt).getTime();
      const now = Date.now();
      const EXPIRE_MS = 30 * 60 * 1000;
      if (now - acquiredTime > EXPIRE_MS) {
        logger.warn(`检测到过期锁 (${Math.round((now - acquiredTime) / 60000)} 分钟前)，自动清理`);
        await unlink(lockPath);
      } else if (!options.force) {
        return {
          success: false,
          existing,
          message: `锁已被 ${existing.holder} 持有（任务: ${existing.task || 'unknown'}，${existing.acquiredAt}）`,
        };
      } else {
        logger.warn(`强制获取锁（原持有者: ${existing.holder}）`);
        await unlink(lockPath);
      }
    } catch {
      // 锁文件损坏，直接覆盖
      await unlink(lockPath).catch(() => {});
    }
  }

  // 创建锁
  const info: LockInfo = {
    holder: getCurrentUser(),
    acquiredAt: new Date().toISOString(),
    task: options.task,
    iteration: options.iteration,
    pid: process.pid,
  };

  await writeFile(lockPath, JSON.stringify(info, null, 2));
  return { success: true, message: '锁获取成功' };
}

/**
 * 释放锁
 */
export async function releaseLock(cwd: string, lockName: string): Promise<void> {
  const lockPath = getLockPath(cwd, lockName);
  if (await pathExists(lockPath)) {
    await unlink(lockPath).catch(() => {});
  }
}

/**
 * 检查锁状态
 */
export async function checkLock(cwd: string, lockName: string): Promise<LockInfo | null> {
  const lockPath = getLockPath(cwd, lockName);
  if (!(await pathExists(lockPath))) return null;
  try {
    const raw = await readFile(lockPath, 'utf-8');
    return JSON.parse(raw) as LockInfo;
  } catch {
    return null;
  }
}

/**
 * 清理所有锁（管理员用）
 */
export async function clearAllLocks(cwd: string): Promise<number> {
  const { readdir } = await import('fs-extra');
  const locksDir = join(cwd, LOCKS_DIR);
  if (!(await pathExists(locksDir))) return 0;

  const files = await readdir(locksDir);
  let count = 0;
  for (const f of files) {
    if (f.endsWith('.lock')) {
      await unlink(join(locksDir, f)).catch(() => {});
      count++;
    }
  }
  return count;
}
