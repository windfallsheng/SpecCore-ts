/**
 * notify — 通知管理命令
 * v6.95.0
 */
import { Command } from 'commander';
import { logger } from '../utils/logger';
import {
  getNotifications,
  markAsRead,
  markAllAsRead,
  cleanupOldNotifications,
  formatNotification,
} from '../core/notification';

export interface NotifyOptions {
  all?: boolean;
  clear?: boolean;
  read?: string;
}

export async function notifyCommand(options: NotifyOptions): Promise<void> {
  const cwd = process.cwd();

  // --clear: 清理过期通知
  if (options.clear) {
    const count = await cleanupOldNotifications(cwd);
    logger.success(`已清理 ${count} 条过期通知`);
    return;
  }

  // --read <id>: 标记单条已读
  if (options.read) {
    await markAsRead(cwd, options.read);
    logger.success(`已标记通知 ${options.read} 为已读`);
    return;
  }

  // --all: 标记全部已读
  if (options.all) {
    const count = await markAllAsRead(cwd);
    logger.success(`已标记 ${count} 条通知为已读`);
    return;
  }

  // 默认：列出通知
  const all = await getNotifications(cwd);
  const unread = await getNotifications(cwd, { unreadOnly: true });

  if (all.length === 0) {
    logger.info('📭 暂无通知');
    return;
  }

  logger.info('');
  logger.info(`📬 通知中心 (${unread.length} 未读 / ${all.length} 总计)`);
  logger.info('');

  for (const n of all.slice(0, 20)) {
    const isUnread = unread.some(u => u.id === n.id);
    const mark = isUnread ? '🔴' : '  ';
    logger.info(`${mark} ${formatNotification(n)}`);
    if (n.message && n.message !== n.title) {
      logger.info(`     ${n.message}`);
    }
  }

  if (all.length > 20) {
    logger.info(`   ... 及其他 ${all.length - 20} 条`);
  }

  logger.info('');
  logger.info('💡 操作提示:');
  logger.info('   speccore notify --read <id>  标记单条已读');
  logger.info('   speccore notify --all        标记全部已读');
  logger.info('   speccore notify --clear      清理过期通知');
}

export function registerNotifyCommand(program: Command): void {
  program
    .command('notify')
    .description('查看和管理变更通知')
    .option('--all', '标记所有通知为已读')
    .option('--clear', '清理过期通知（默认保留 30 天）')
    .option('--read <id>', '标记指定通知为已读')
    .action(notifyCommand);
}
