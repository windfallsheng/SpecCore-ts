/**
 * Operation Log — 操作日志记录
 *
 * 记录所有关键操作到 .speccore/logs/YYYY-MM-DD.log
 * 格式: [时间] 用户 命令 参数
 */

import { ensureFileSync, appendFileSync } from 'fs-extra';
import { join } from 'path';
import * as os from 'os';

const getLogDir = () => join(process.cwd(), '.speccore', 'logs');

/**
 * 记录操作日志
 */
export function logOperation(command: string, detail?: string): void {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const user = getUserName();
  const logDir = getLogDir();
  const logFile = join(logDir, `${now.substring(0, 10)}.log`);

  try {
    ensureFileSync(logFile);
    const line = `[${now}] ${user} ${command}${detail ? ` | ${detail}` : ''}`;
    appendFileSync(logFile, line + '\n');
  } catch {
    // 日志写入失败不影响主流程
  }
}

/**
 * 获取用户名（git config 优先）
 */
function getUserName(): string {
  try {
    const { execSync } = require('child_process');
    return execSync('git config user.name', { encoding: 'utf-8' }).trim() || 'unknown';
  } catch {
    try {
      return os.userInfo().username || 'unknown';
    } catch {
      return 'unknown';
    }
  }
}

/**
 * 记录命令执行（不带详情）
 */
export function logCommand(command: string[]): void {
  logOperation(command.join(' '));
}
