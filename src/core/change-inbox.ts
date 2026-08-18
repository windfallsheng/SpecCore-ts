/**
 * change-inbox — 变更需求收件箱
 * 管理 .speccore/changes/ 目录：扫描变更文件、追踪处理状态、归档清理
 *
 * 与 .speccore/inbox/（需求收件箱）的区别：
 * - inbox/     : 原始 PRD/需求文档，analyze 阶段使用，文件永久保留
 * - changes/   : 变更/新增需求，change 阶段使用，处理后归档/删除
 */
import { join } from 'path';
import { readdir, readFile, writeFile, pathExists, stat, ensureDir, rename } from 'fs-extra';
import { logger } from '../utils/logger';

// ── 类型定义 ──

/** 变更文件条目 */
export interface ChangeInboxFileEntry {
  name: string;
  path: string;
  size: number;
  mtime: string;
  type: 'text' | 'excel' | 'image' | 'other';
  content: string;
}

/** 变更收件箱扫描结果 */
export interface ChangeInboxScanResult {
  newFiles: ChangeInboxFileEntry[];
  modifiedFiles: ChangeInboxFileEntry[];
  skippedFiles: string[];
  allFiles: ChangeInboxFileEntry[];
}

/** 变更清单中的单个条目 */
export interface ChangeManifestEntry {
  status: 'pending' | 'processing' | 'processed' | 'failed';
  addedAt: string;
  mtime: string;
  processedAt?: string;
  archivedAt?: string;
  changeId?: string;
  linkedTo: string[];
  action: 'change' | 'new' | 'unknown';
  iteration?: string;
  error?: string;
}

/** 变更清单 */
export interface ChangeInboxManifest {
  files: Record<string, ChangeManifestEntry>;
  lastScan: string;
}

/** 归档策略 */
export type ArchiveStrategy = 'archive' | 'delete' | 'keep';

// ── 常量 ──

const CHANGES_DIR = '.speccore/changes';
const PENDING_DIR = 'pending';
const PROCESSED_DIR = 'processed';
const MANIFEST_FILE = 'manifest.json';

// ── 路径工具 ──

function getChangesDir(): string {
  return join(process.cwd(), CHANGES_DIR);
}

function getPendingDir(): string {
  return join(getChangesDir(), PENDING_DIR);
}

function getProcessedDir(): string {
  return join(getChangesDir(), PROCESSED_DIR);
}

// ── 核心函数 ──

/**
 * 确保变更收件箱目录结构存在
 */
export async function ensureChangeInboxDir(): Promise<void> {
  await ensureDir(getPendingDir());
  await ensureDir(getProcessedDir());
}

/**
 * 读取变更清单
 */
export async function readChangeManifest(): Promise<ChangeInboxManifest> {
  const manifestPath = join(getChangesDir(), MANIFEST_FILE);
  if (await pathExists(manifestPath)) {
    try {
      const content = await readFile(manifestPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return { files: {}, lastScan: '' };
    }
  }
  return { files: {}, lastScan: '' };
}

/**
 * 写入变更清单
 */
export async function writeChangeManifest(manifest: ChangeInboxManifest): Promise<void> {
  const manifestPath = join(getChangesDir(), MANIFEST_FILE);
  manifest.lastScan = new Date().toISOString();
  await ensureDir(getChangesDir());
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

/**
 * 检测文件类型
 */
function detectFileType(name: string): ChangeInboxFileEntry['type'] {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['md', 'txt', 'markdown', 'json', 'yaml', 'yml', 'csv'].includes(ext)) return 'text';
  if (['xlsx', 'xls'].includes(ext)) return 'excel';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  return 'other';
}

/**
 * 读取单个文件内容
 */
async function readChangeFile(filePath: string, fileType: ChangeInboxFileEntry['type']): Promise<string> {
  switch (fileType) {
    case 'text':
      return readFile(filePath, 'utf-8');

    case 'excel':
      try {
        const XLSX = require('xlsx');
        const wb = XLSX.readFile(filePath);
        const sheets: string[] = [];
        for (const name of wb.SheetNames) {
          const ws = wb.Sheets[name];
          const csv: string = XLSX.utils.sheet_to_csv(ws);
          sheets.push(`## Sheet: ${name}\n${csv}`);
        }
        return sheets.join('\n\n');
      } catch (e) {
        return `[Excel 解析失败: ${filePath}]`;
      }

    case 'image':
      return `[图片文件: ${filePath}]`;

    case 'other':
      try {
        return await readFile(filePath, 'utf-8');
      } catch {
        return `[无法读取: ${filePath}]`;
      }
  }
}

/**
 * 扫描变更收件箱 pending/ 目录
 */
export async function scanChangeInbox(options: { reprocess?: boolean } = {}): Promise<ChangeInboxScanResult> {
  const pendingDir = getPendingDir();

  if (!await pathExists(pendingDir)) {
    return { newFiles: [], modifiedFiles: [], skippedFiles: [], allFiles: [] };
  }

  const manifest = await readChangeManifest();
  const entries = await readdir(pendingDir, { withFileTypes: true });

  const result: ChangeInboxScanResult = { newFiles: [], modifiedFiles: [], skippedFiles: [], allFiles: [] };

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;

    const filePath = join(pendingDir, entry.name);
    const fileType = detectFileType(entry.name);
    const fileStat = await stat(filePath);
    const mtime = fileStat.mtime.toISOString();

    const fileEntry: ChangeInboxFileEntry = {
      name: entry.name,
      path: filePath,
      size: fileStat.size,
      mtime,
      type: fileType,
      content: '',
    };

    const manifestEntry = manifest.files[entry.name];

    if (options.reprocess || !manifestEntry) {
      fileEntry.content = await readChangeFile(filePath, fileType);
      if (manifestEntry) {
        result.modifiedFiles.push(fileEntry);
      } else {
        result.newFiles.push(fileEntry);
      }
    } else if (manifestEntry.status === 'pending' || manifestEntry.status === 'failed') {
      // 之前处理失败或未处理的，重新读取
      fileEntry.content = await readChangeFile(filePath, fileType);
      result.modifiedFiles.push(fileEntry);
    } else if (manifestEntry.mtime !== mtime) {
      fileEntry.content = await readChangeFile(filePath, fileType);
      result.modifiedFiles.push(fileEntry);
    } else {
      result.skippedFiles.push(entry.name);
    }

    result.allFiles.push(fileEntry);
  }

  return result;
}

/**
 * 标记文件已处理
 */
export async function markChangeProcessed(
  files: ChangeInboxFileEntry[],
  action: 'change' | 'new',
  linkedTo: string[],
  changeId?: string
): Promise<void> {
  const manifest = await readChangeManifest();

  for (const file of files) {
    manifest.files[file.name] = {
      status: 'processed',
      addedAt: manifest.files[file.name]?.addedAt || new Date().toISOString(),
      mtime: file.mtime,
      processedAt: new Date().toISOString(),
      changeId,
      linkedTo,
      action,
    };
  }

  await writeChangeManifest(manifest);
}

/**
 * 标记文件处理失败
 */
export async function markChangeFailed(
  fileName: string,
  error: string
): Promise<void> {
  const manifest = await readChangeManifest();

  const existing = manifest.files[fileName] || {
    status: 'pending' as const,
    addedAt: new Date().toISOString(),
    mtime: new Date().toISOString(),
    linkedTo: [],
    action: 'unknown' as const,
  };

  manifest.files[fileName] = {
    ...existing,
    status: 'failed',
    error,
  };

  await writeChangeManifest(manifest);
}

/**
 * 归档已处理的文件
 * @param strategy 'archive' | 'delete' | 'keep'
 */
export async function archiveProcessedFiles(
  files: ChangeInboxFileEntry[],
  strategy: ArchiveStrategy = 'archive'
): Promise<void> {
  if (strategy === 'keep') return;

  const pendingDir = getPendingDir();

  for (const file of files) {
    const sourcePath = join(pendingDir, file.name);
    if (!await pathExists(sourcePath)) continue;

    if (strategy === 'delete') {
      const { unlink } = await import('fs-extra');
      await unlink(sourcePath);
      logger.debug(`已删除: ${file.name}`);
    } else {
      // archive: 移动到 processed/YYYY-MM-DD/
      const today = new Date().toISOString().split('T')[0];
      const archiveDir = join(getProcessedDir(), today);
      await ensureDir(archiveDir);
      const targetPath = join(archiveDir, file.name);
      await rename(sourcePath, targetPath);

      // 更新 manifest 中的 archivedAt
      const manifest = await readChangeManifest();
      if (manifest.files[file.name]) {
        manifest.files[file.name].archivedAt = new Date().toISOString();
        await writeChangeManifest(manifest);
      }

      logger.debug(`已归档: ${file.name} → processed/${today}/`);
    }
  }
}

/**
 * 从指定目录加载变更文件（--dir 模式）
 */
export async function loadChangeFilesFromDir(dirPath: string): Promise<ChangeInboxFileEntry[]> {
  const absPath = join(process.cwd(), dirPath);
  if (!await pathExists(absPath)) {
    logger.warn(`目录不存在: ${dirPath}`);
    return [];
  }

  const entries = await readdir(absPath, { withFileTypes: true });
  const files: ChangeInboxFileEntry[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;

    const filePath = join(absPath, entry.name);
    const fileType = detectFileType(entry.name);
    const fileStat = await stat(filePath);

    const content = await readChangeFile(filePath, fileType);
    files.push({
      name: entry.name,
      path: filePath,
      size: fileStat.size,
      mtime: fileStat.mtime.toISOString(),
      type: fileType,
      content,
    });
  }

  return files;
}

/**
 * 从指定文件加载变更需求（--file 模式）
 */
export async function loadChangeFile(filePath: string): Promise<ChangeInboxFileEntry | null> {
  const absPath = join(process.cwd(), filePath);
  if (!await pathExists(absPath)) {
    logger.warn(`文件不存在: ${filePath}`);
    return null;
  }

  const fileType = detectFileType(absPath);
  const fileStat = await stat(absPath);
  const content = await readChangeFile(absPath, fileType);

  return {
    name: absPath.split('/').pop() || filePath,
    path: absPath,
    size: fileStat.size,
    mtime: fileStat.mtime.toISOString(),
    type: fileType,
    content,
  };
}

/**
 * 格式化扫描结果为终端输出
 */
export function logChangeInboxScan(result: ChangeInboxScanResult): void {
  const total = result.newFiles.length + result.modifiedFiles.length + result.skippedFiles.length;

  if (total === 0) {
    logger.info('📭 变更收件箱: 暂无待处理文件');
    logger.info('   提示: 将变更需求文件放入 .speccore/changes/pending/');
    return;
  }

  logger.info('📥 变更收件箱扫描:');

  for (const f of result.newFiles) {
    const size = f.size > 1024 ? `${(f.size / 1024).toFixed(1)}KB` : `${f.size}B`;
    logger.info(`   🆕 ${f.name} (新文件, ${size})`);
  }

  for (const f of result.modifiedFiles) {
    const size = f.size > 1024 ? `${(f.size / 1024).toFixed(1)}KB` : `${f.size}B`;
    logger.info(`   🔄 ${f.name} (已修改/待处理, ${size})`);
  }

  for (const name of result.skippedFiles) {
    logger.info(`   ✅ ${name} (已处理 → 跳过)`);
  }

  const actionable = result.newFiles.length + result.modifiedFiles.length;
  if (actionable === 0) {
    logger.info('');
    logger.info('   所有文件已处理。');
  }
}

