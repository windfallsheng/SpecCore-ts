/**
 * backup — 自动备份与恢复
 *
 * 在每次修改前自动创建时间戳备份，支持查看和恢复
 */

import { ensureDir, pathExists, readdir, copy, rmSync } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';

export interface BackupOptions {
  list?: boolean;
  restore?: string;
}

const BACKUP_DIR = '.speccore/backups';

/**
 * 创建一次备份（执行关键操作前调用）
 */
export async function createBackup(label: string): Promise<string | null> {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const backupPath = join(BACKUP_DIR, `${timestamp}-${label}`);
    const speccoreDir = join(process.cwd(), '.speccore');

    if (!(await pathExists(speccoreDir))) return null;

    await ensureDir(backupPath);

    // 备份 context.json
    const ctxSrc = join(speccoreDir, 'local', 'context.json');
    if (await pathExists(ctxSrc)) {
      await ensureDir(join(backupPath, 'local'));
      await copy(ctxSrc, join(backupPath, 'local', 'context.json'));
    }

    // 备份 GLOBAL/INDEX.md
    const idxSrc = join(speccoreDir, 'GLOBAL', 'INDEX.md');
    if (await pathExists(idxSrc)) {
      await ensureDir(join(backupPath, 'GLOBAL'));
      await copy(idxSrc, join(backupPath, 'GLOBAL', 'INDEX.md'));
    }

    return backupPath;
  } catch {
    return null;
  }
}

/**
 * 备份命令入口
 */
export async function backupCommand(options: BackupOptions): Promise<void> {
  if (options.list) {
    await listBackups();
    return;
  }

  if (options.restore) {
    await restoreBackup(options.restore);
    return;
  }

  // 默认：创建备份
  const path = await createBackup('manual');
  if (path) {
    logger.info(`✅ Backup created: ${path}`);
  } else {
    logger.warn('No .speccore/ found, backup skipped');
  }
}

async function listBackups(): Promise<void> {
  if (!(await pathExists(BACKUP_DIR))) {
    logger.info('No backups found');
    return;
  }

  const entries = await readdir(BACKUP_DIR, { withFileTypes: true });
  const backups = entries.filter(e => e.isDirectory()).sort((a, b) => b.name.localeCompare(a.name));

  if (backups.length === 0) {
    logger.info('No backups found');
    return;
  }

  logger.info('');
  logger.info(`📦 Backups (${backups.length}):`);
  for (const b of backups) {
    logger.info(`  ${b.name}`);
  }
}

async function restoreBackup(name: string): Promise<void> {
  const backupPath = join(BACKUP_DIR, name);
  if (!(await pathExists(backupPath))) {
    logger.error(`Backup not found: ${name}`);
    return;
  }

  const speccoreDir = join(process.cwd(), '.speccore');

  // Restore context.json
  const ctxSrc = join(backupPath, 'local', 'context.json');
  if (await pathExists(ctxSrc)) {
    await ensureDir(join(speccoreDir, 'local'));
    await copy(ctxSrc, join(speccoreDir, 'local', 'context.json'));
    logger.info('Restored context.json');
  }

  const idxSrc = join(backupPath, 'GLOBAL', 'INDEX.md');
  if (await pathExists(idxSrc)) {
    await copy(idxSrc, join(speccoreDir, 'GLOBAL', 'INDEX.md'));
    logger.info('Restored GLOBAL/INDEX.md');
  }

  logger.info(`Backup restored: ${name}`);
}
