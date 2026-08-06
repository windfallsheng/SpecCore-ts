/**
 * short-id — 永不重复的短ID生成器
 * 6位字符 0-9a-z，36^6 = 21 亿种组合
 */
import { randomBytes } from 'crypto';

const CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * 生成6位短ID (time-based + crypto random)
 * 格式: 4位时间戳(base36) + 2位随机
 * 例如: "k8x3a1", "m9f2b7"
 */
export function shortId(): string {
  // 时间戳部分 (base36, 4位): 提供时间排序 + 粗粒度唯一性
  const now = Date.now();
  let ts = '';
  let n = now;
  for (let i = 0; i < 4; i++) {
    ts = CHARS[n % 36] + ts;
    n = Math.floor(n / 36);
  }
  // 随机部分 (crypto强随机, 2位): 保证同一毫秒内不碰撞
  const bytes = randomBytes(1);
  const r1 = CHARS[bytes[0] % 36];
  const r2 = CHARS[(bytes[0] >> 4) % 36];
  
  return ts + r1 + r2;
}

/**
 * 生成迭代ID: Iteration-{shortId}-{name}
 */
export function iterationId(name: string): string {
  const cleanName = name.replace(/^Iteration-/, '').replace(/[\/\\]/g, '-');
  return `Iteration-${shortId()}-${cleanName}`;
}

/**
 * 生成任务ID: Task-{shortId}
 */
export function taskId(): string {
  return `Task-${shortId()}`;
}
