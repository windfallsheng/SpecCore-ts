/**
 * spec-paths — 020-specs/ 目录路径辅助函数
 * 
 * v6.41.0+ 全局文档迁移到 020-specs/global/ 子目录。
 * 本模块提供统一的路径解析和写入路径生成，支持向后兼容。
 */
import { join } from 'path';
import { pathExists, ensureDir, readFile } from 'fs-extra';

/** 全局文档子目录名 */
export const GLOBAL_SPECS_DIR = 'global';

/** 全局文档文件名列表（含 TECH.md — 整体技术架构，各端另有专属 TECH.md） */
export const GLOBAL_SPEC_FILES = [
  'REQUIREMENT.md', 'ANALYSIS.md', 'TECH.md', 'RISK.md', 'DEPS.md', 'REVIEW.md', 'MONITOR.md',
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

/**
 * 从 CONSTITUTION.md 解析端列表（v6.46.0+）
 * 优先读取「端列表」章节，回退到「对应需求端」列
 * 返回去重后的端名数组
 */
export async function parsePlatformList(): Promise<string[]> {
  const constitutionPath = join('.speccore', 'CONSTITUTION.md');
  if (!(await pathExists(constitutionPath))) return [];
  const content = await readFile(constitutionPath, 'utf-8');
  const lines = content.split('\n');

  // 1. 优先解析「端列表」章节（v6.46.0+ 显式声明）
  let inPlatformSection = false;
  const platforms = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // 检测章节标题
    if (line.match(/^##\s+.*\u7aef\u5217\u8868/) || line.match(/^##\s+.*\u5e73\u53f0\u5217\u8868/)) {
      inPlatformSection = true;
      continue;
    }
    // 遇到下一个 ## 章节就停止
    if (inPlatformSection && line.match(/^##\s/)) break;
    if (!inPlatformSection) continue;
    // 解析表格行（跳过标题行和分隔行）
    if (!line.startsWith('|') || line.match(/^\|\s*[-:]/)) continue;
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 1) {
      const platformName = cells[0].trim();
      if (platformName && platformName !== '端名' && platformName !== '平台名') {
        platforms.add(platformName);
      }
    }
  }
  if (platforms.size > 0) return [...platforms];

  // 2. 回退：解析「对应需求端」/「对应端」列（旧版格式）
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('对应需求端') || lines[i].includes('对应端')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx >= 0) {
    const headers = lines[headerIdx].split('|').map(h => h.trim()).filter(Boolean);
    const platformColIdx = headers.findIndex(h => h.includes('对应需求端') || h.includes('对应端'));
    if (platformColIdx >= 0) {
      for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.startsWith('|') || line.match(/^\|\s*[-:]/)) continue;
        const cells = line.split('|').map(c => c.trim()).filter(Boolean);
        if (cells[platformColIdx]) {
          cells[platformColIdx].split(',').forEach((p: string) => {
            const trimmed = p.trim();
            if (trimmed && !trimmed.startsWith('>')) platforms.add(trimmed);
          });
        }
      }
    }
  }
  return [...platforms];
}
