/**
 * Task Lock — 远程协作锁机制
 *
 * 防止多人同时修改同一个 Task
 * 锁文件：.speccore/.locks/{taskId}.lock
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';

interface LockData {
  taskId: string;
  holder: string;
  operation: string;
  acquiredAt: string;
  expiresAt: string;
}

const LOCKS_DIR = '.speccore/.locks';
const LOCK_TIMEOUT_MINUTES = 30;

function getLockPath(taskId: string): string {
  return join(LOCKS_DIR, `${taskId}.lock`);
}

function getUser(): string {
  try {
    const { execSync } = require('child_process');
    return execSync('git config user.name', { encoding: 'utf-8', stdio: 'pipe' }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * 获取锁（如果可用）
 */
export function acquireLock(taskId: string, operation: string): { holder: string; acquiredAt: string } | null {
  ensureLocksDir();
  const lockPath = getLockPath(taskId);

  // 检查已有锁
  if (existsSync(lockPath)) {
    try {
      const existing: LockData = JSON.parse(readFileSync(lockPath, 'utf-8'));
      const expired = Date.now() > new Date(existing.expiresAt).getTime();
      if (!expired) {
        return { holder: existing.holder, acquiredAt: existing.acquiredAt };
      }
      // 过期锁，删除
      unlinkSync(lockPath);
    } catch {
      unlinkSync(lockPath);
    }
  }

  // 创建新锁
  const user = getUser();
  const data: LockData = {
    taskId,
    holder: user,
    operation,
    acquiredAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + LOCK_TIMEOUT_MINUTES * 60 * 1000).toISOString(),
  };

  writeFileSync(lockPath, JSON.stringify(data, null, 2));
  return null; // 锁获取成功，返回 null 表示无冲突
}

/**
 * 释放锁
 */
export function releaseLock(taskId: string): void {
  const lockPath = getLockPath(taskId);
  if (existsSync(lockPath)) {
    unlinkSync(lockPath);
  }
}

/**
 * 检查锁状态
 */
export function checkLock(taskId: string): LockData | null {
  const lockPath = getLockPath(taskId);
  if (!existsSync(lockPath)) return null;

  try {
    const data: LockData = JSON.parse(readFileSync(lockPath, 'utf-8'));
    if (Date.now() > new Date(data.expiresAt).getTime()) {
      unlinkSync(lockPath);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function ensureLocksDir(): void {
  if (!existsSync(LOCKS_DIR)) {
    mkdirSync(LOCKS_DIR, { recursive: true });
  }
}
