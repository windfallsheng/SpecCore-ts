/**
 * Notification System — 变更通知
 * v6.95.0: 记录任务状态变更、需求变更等事件，支持未读通知查看
 */
import { join } from 'path';
import { writeFile, readFile, pathExists, readdir, ensureDir } from 'fs-extra';
import { getCurrentUser } from './user-context';
import { logger } from '../utils/logger';

const NOTIFY_DIR = '.speccore/local/notifications';
const READ_MARKER = '.read';

export type NotificationType =
  | 'task_status_changed'
  | 'task_created'
  | 'requirement_updated'
  | 'spec_generated'
  | 'code_executed'
  | 'plan_generated'
  | 'iteration_created';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  actor: string;
  timestamp: string;
  iteration?: string;
  task?: string;
  metadata?: Record<string, unknown>;
}

function getNotifyDir(cwd: string): string {
  return join(cwd, NOTIFY_DIR);
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 发送通知（记录变更事件）
 */
export async function sendNotification(
  cwd: string,
  notification: Omit<Notification, 'id' | 'actor' | 'timestamp'>
): Promise<Notification> {
  const dir = getNotifyDir(cwd);
  await ensureDir(dir);

  const full: Notification = {
    ...notification,
    id: generateId(),
    actor: getCurrentUser(),
    timestamp: new Date().toISOString(),
  };

  const filePath = join(dir, `${full.id}.json`);
  await writeFile(filePath, JSON.stringify(full, null, 2));

  return full;
}

/**
 * 获取所有通知（按时间倒序）
 */
export async function getNotifications(cwd: string, options: { unreadOnly?: boolean } = {}): Promise<Notification[]> {
  const dir = getNotifyDir(cwd);
  if (!(await pathExists(dir))) return [];

  const files = await readdir(dir);
  const notifications: Notification[] = [];

  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const id = f.replace('.json', '');

    // 如果只看未读，检查 read marker
    if (options.unreadOnly) {
      const readPath = join(dir, READ_MARKER, `${id}.read`);
      if (await pathExists(readPath)) continue;
    }

    try {
      const raw = await readFile(join(dir, f), 'utf-8');
      notifications.push(JSON.parse(raw) as Notification);
    } catch { /* 忽略损坏文件 */ }
  }

  return notifications.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

/**
 * 标记通知为已读
 */
export async function markAsRead(cwd: string, notificationId: string): Promise<void> {
  const dir = getNotifyDir(cwd);
  const readDir = join(dir, READ_MARKER);
  await ensureDir(readDir);
  await writeFile(join(readDir, `${notificationId}.read`), '');
}

/**
 * 标记所有通知为已读
 */
export async function markAllAsRead(cwd: string): Promise<number> {
  const notifications = await getNotifications(cwd);
  const dir = getNotifyDir(cwd);
  const readDir = join(dir, READ_MARKER);
  await ensureDir(readDir);

  for (const n of notifications) {
    await writeFile(join(readDir, `${n.id}.read`), '').catch(() => {});
  }

  return notifications.length;
}

/**
 * 清除过期通知（默认保留 30 天）
 */
export async function cleanupOldNotifications(cwd: string, maxAgeDays = 30): Promise<number> {
  const dir = getNotifyDir(cwd);
  if (!(await pathExists(dir))) return 0;

  const files = await readdir(dir);
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let count = 0;

  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = await readFile(join(dir, f), 'utf-8');
      const n = JSON.parse(raw) as Notification;
      if (new Date(n.timestamp).getTime() < cutoff) {
        await unlinkSafe(join(dir, f));
        await unlinkSafe(join(dir, READ_MARKER, `${n.id}.read`));
        count++;
      }
    } catch { /* 忽略 */ }
  }

  return count;
}

async function unlinkSafe(path: string): Promise<void> {
  const { unlink } = await import('fs-extra');
  await unlink(path).catch(() => {});
}

/**
 * 格式化通知为可读文本
 */
export function formatNotification(n: Notification): string {
  const time = new Date(n.timestamp).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const icon = getNotificationIcon(n.type);
  return `${icon} [${time}] ${n.actor}: ${n.title}`;
}

function getNotificationIcon(type: NotificationType): string {
  switch (type) {
    case 'task_status_changed': return '🔄';
    case 'task_created': return '🆕';
    case 'requirement_updated': return '📝';
    case 'spec_generated': return '📐';
    case 'code_executed': return '💻';
    case 'plan_generated': return '📋';
    case 'iteration_created': return '🚀';
    default: return '•';
  }
}
