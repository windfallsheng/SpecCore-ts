/**
 * spec-paths — 020-specs/ 目录路径辅助函数
 * 
 * v6.41.0+ 全局文档迁移到 020-specs/global/ 子目录。
 * 本模块提供统一的路径解析和写入路径生成，支持向后兼容。
 */
import { join } from 'path';
import { pathExists, ensureDir } from 'fs-extra';

/** 全局文档子目录名 */
export const GLOBAL_SPECS_DIR = 'global';

/** 全局文档文件名列表 */
export const GLOBAL_SPEC_FILES = [
  'REQUIREMENT.md', 'ANALYSIS.md', 'RISK.md', 'DEPS.md', 'REVIEW.md', 'MONITOR.md',
];

/**
 * 解析全局 spec 文件路径（优先 global/，回退根目录）
 * 用于读取侧：兼容新旧两种路径
 */
export async function resolveGlobalSpecPath(specDir: string, filename: string): Promise<string | null> {
  const newPath = join(specDir, GLOBAL_SPECS_DIR, filename);
  if (await pathExists(newPath)) return newPath;
  const oldPath = join(specDir, filename);
  if (await pathExists(oldPath)) return oldPath;
  return null;
}

/**
 * 获取全局 spec 文件的写入路径（始终使用新路径 global/）
 * 自动确保 global/ 目录存在
 */
export async function globalSpecWritePath(specDir: string, filename: string): Promise<string> {
  const dir = join(specDir, GLOBAL_SPECS_DIR);
  await ensureDir(dir);
  return join(dir, filename);
}
