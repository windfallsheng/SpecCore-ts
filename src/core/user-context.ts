/**
 * User Context — 多用户支持
 * v6.95.0: 识别当前操作者，记录操作日志
 */
import { execSync } from 'child_process';

let cachedUser: string | undefined;

/** 获取当前用户标识（git config → 环境变量 → 系统用户名） */
export function getCurrentUser(): string {
  if (cachedUser) return cachedUser;

  // 1. 环境变量
  const envUser = process.env.SPECCORE_USER;
  if (envUser) {
    cachedUser = envUser;
    return envUser;
  }

  // 2. git config user.name
  try {
    const gitName = execSync('git config user.name', { encoding: 'utf-8', timeout: 3000 }).trim();
    if (gitName) {
      cachedUser = gitName;
      return gitName;
    }
  } catch { /* 忽略 */ }

  // 3. 系统用户名
  const sysUser = process.env.USER || process.env.USERNAME || 'unknown';
  cachedUser = sysUser;
  return sysUser;
}

/** 设置当前用户（覆盖缓存） */
export function setCurrentUser(user: string): void {
  cachedUser = user;
}

/** 清除缓存（用于测试） */
export function clearUserCache(): void {
  cachedUser = undefined;
}

/** 获取用户标识的简短形式（用于文件名等） */
export function getUserSlug(): string {
  const user = getCurrentUser();
  return user
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
