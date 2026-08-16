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

/** 全局文档文件名列表（仅纯全局文档，不含可分端的文档）
 * v6.48.0+：TECH/RISK/REVIEW/MONITOR 支持按端分目录，不再强制写入 global/
 */
export const GLOBAL_SPEC_FILES = [
  'REQUIREMENT.md', 'ANALYSIS.md', 'DEPS.md',
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
  let platformColIdx = -1; // 端名列索引（动态查找）
  const platforms = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // 检测章节标题
    if (line.match(/^##\s+.*\u7aef\u5217\u8868/) || line.match(/^##\s+.*\u5e73\u53f0\u5217\u8868/)) {
      inPlatformSection = true;
      platformColIdx = -1; // 重置，每个章节重新找表头
      continue;
    }
    // 遇到下一个 ## 章节就停止
    if (inPlatformSection && line.match(/^##\s/)) break;
    if (!inPlatformSection) continue;
    // 解析表格行
    if (!line.startsWith('|')) continue;
    // 分隔行跳过
    if (line.match(/^\|\s*[-:]/)) continue;
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    // 表头行：动态查找端名列索引
    if (platformColIdx === -1 && cells.length > 0) {
      // 匹配表头中的端名列：端名 / 平台名 / 工程标识 / 工程ID
      platformColIdx = cells.findIndex(h =>
        h === '端名' || h === '平台名' || h === '工程标识' || h === '工程ID' ||
        h.includes('端名') || h.includes('平台名') || h.includes('工程标识')
      );
      if (platformColIdx < 0) platformColIdx = 0; // 兜底：取第 1 列
      continue; // 表头行本身不是数据
    }
    // 数据行：取端名列
    if (cells.length > platformColIdx) {
      const platformName = cells[platformColIdx].trim();
      if (platformName) {
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
    const colIdx = headers.findIndex(h => h.includes('对应需求端') || h.includes('对应端'));
    if (colIdx >= 0) {
      for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.startsWith('|') || line.match(/^\|\s*[-:]/)) continue;
        const cells = line.split('|').map(c => c.trim()).filter(Boolean);
        if (cells[colIdx]) {
          cells[colIdx].split(',').forEach((p: string) => {
            const trimmed = p.trim();
            if (trimmed && !trimmed.startsWith('>')) platforms.add(trimmed);
          });
        }
      }
    }
  }
  return [...platforms];
}

/**
 * 从 CONSTITUTION.md 解析各端的工程类型（v6.49.0+）
 * 返回 Map<端名, 工程类型>
 */
export async function parsePlatformTypes(): Promise<Map<string, string>> {
  const constitutionPath = join('.speccore', 'CONSTITUTION.md');
  if (!(await pathExists(constitutionPath))) return new Map();
  const content = await readFile(constitutionPath, 'utf-8');
  const lines = content.split('\n');

  let inPlatformSection = false;
  let platformColIdx = -1;
  let typeColIdx = -1;
  const result = new Map<string, string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // 检测章节标题
    if (line.match(/^##\s+.*\u7aef\u5217\u8868/) || line.match(/^##\s+.*\u5e73\u53f0\u5217\u8868/)) {
      inPlatformSection = true;
      platformColIdx = -1;
      typeColIdx = -1;
      continue;
    }
    if (inPlatformSection && line.match(/^##\s/)) break;
    if (!inPlatformSection) continue;
    if (!line.startsWith('|')) continue;
    if (line.match(/^\|\s*[-:]/)) continue;

    const cells = line.split('|').map(c => c.trim()).filter(Boolean);

    // 表头行：动态查找列索引
    if (platformColIdx === -1 && cells.length > 0) {
      platformColIdx = cells.findIndex(h =>
        h === '端名' || h === '平台名' || h === '工程标识' || h === '工程ID' ||
        h.includes('端名') || h.includes('平台名') || h.includes('工程标识')
      );
      if (platformColIdx < 0) platformColIdx = 0;

      // 查找工程类型列：工程类型 / 类型 / 技术类型
      typeColIdx = cells.findIndex(h =>
        h === '工程类型' || h === '类型' || h === '技术类型' ||
        h.includes('工程类型') || h.includes('技术类型')
      );
      if (typeColIdx < 0) typeColIdx = -1; // 没有工程类型列
      continue;
    }

    // 数据行：提取端名和工程类型
    if (cells.length > platformColIdx) {
      const platformName = cells[platformColIdx].trim();
      if (platformName && typeColIdx >= 0 && cells.length > typeColIdx) {
        const platformType = cells[typeColIdx].trim();
        if (platformType) {
          result.set(platformName, platformType);
        }
      }
    }
  }

  return result;
}

/**
 * 从 CONSTITUTION.md 解析项目信息表（v6.49.6+）
 * 返回 Map<工程标识, { projectType, projectName, srcPath, gitRepo, branch, platform }>
 * 用于 execute 命令确定代码输出位置
 */
export interface ProjectInfo {
  projectIdentifier: string;
  projectType: string;      // 工程类型（Java服务/H5移动端/Web管理后台等）
  projectName: string;
  srcPath: string;
  gitRepo: string;
  branch: string;
  platform: string;
}

export async function parseProjectInfo(): Promise<Map<string, ProjectInfo>> {
  const constitutionPath = join('.speccore', 'CONSTITUTION.md');
  if (!(await pathExists(constitutionPath))) return new Map();
  const content = await readFile(constitutionPath, 'utf-8');
  const lines = content.split('\n');

  let inProjectSection = false;
  let headerParsed = false;
  let identifierColIdx = -1;
  let typeColIdx = -1;
  let nameColIdx = -1;
  let pathColIdx = -1;
  let gitColIdx = -1;
  let branchColIdx = -1;
  let platformColIdx = -1;
  const result = new Map<string, ProjectInfo>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // 检测「项目信息」章节开始
    if (line.match(/^##\s+.*项目信息/)) {
      inProjectSection = true;
      continue;
    }
    // 检测下一个章节开始，退出项目信息
    if (inProjectSection && line.match(/^##\s/)) break;
    if (!inProjectSection) continue;
    if (!line.startsWith('|')) continue;
    if (line.match(/^\|\s*[-:]/)) continue;

    const cells = line.split('|').map(c => c.trim()).filter(Boolean);

    // 表头行：动态查找列索引
    if (!headerParsed && cells.length > 0) {
      identifierColIdx = cells.findIndex(h =>
        h === '工程标识' || h === '工程' || h === '工程名' ||
        h.includes('工程标识') || h.includes('工程名')
      );
      typeColIdx = cells.findIndex(h =>
        h === '工程类型' || h === '类型' || h.includes('工程类型')
      );
      nameColIdx = cells.findIndex(h =>
        h === '项目名称' || h === '项目名' || h.includes('项目名称')
      );
      pathColIdx = cells.findIndex(h =>
        h === '源码路径' || h === '工程路径' || h.includes('源码路径') || h.includes('工程路径')
      );
      gitColIdx = cells.findIndex(h =>
        h === 'Git 仓库' || h === 'Git' || h.includes('Git')
      );
      branchColIdx = cells.findIndex(h =>
        h === '默认分支' || h === '分支' || h.includes('分支')
      );
      platformColIdx = cells.findIndex(h =>
        h === '对应端' || h === '对应需求端' || h.includes('对应端')
      );
      // 兜底：如果没找到工程标识列，取第 1 列
      if (identifierColIdx < 0) identifierColIdx = 0;
      headerParsed = true;
      continue;
    }

    // 数据行：提取项目信息
    if (headerParsed && cells.length > identifierColIdx) {
      const projectIdentifier = cells[identifierColIdx]?.trim();
      if (projectIdentifier) {
        const info: ProjectInfo = {
          projectIdentifier,
          projectType: typeColIdx >= 0 && cells.length > typeColIdx ? cells[typeColIdx].trim() : '',
          projectName: nameColIdx >= 0 && cells.length > nameColIdx ? cells[nameColIdx].trim() : '',
          srcPath: pathColIdx >= 0 && cells.length > pathColIdx ? cells[pathColIdx].replace(/`/g, '').trim() : '',
          gitRepo: gitColIdx >= 0 && cells.length > gitColIdx ? cells[gitColIdx].trim() : '',
          branch: branchColIdx >= 0 && cells.length > branchColIdx ? cells[branchColIdx].trim() : 'main',
          platform: platformColIdx >= 0 && cells.length > platformColIdx ? cells[platformColIdx].trim() : '',
        };
        result.set(projectIdentifier, info);
      }
    }
  }

  return result;
}

/**
 * 根据端名获取实际的工程路径（v6.49.6+）
 * 用于 execute 命令确定代码输出位置
 */
export async function getProjectPathForPlatform(platform: string): Promise<string | null> {
  const projectInfoMap = await parseProjectInfo();
  // 先精确匹配工程标识
  if (projectInfoMap.has(platform)) {
    return projectInfoMap.get(platform)!.srcPath || null;
  }
  // 再匹配「对应端」列
  for (const [, info] of projectInfoMap) {
    if (info.platform === platform || info.platform.split(',').map(p => p.trim()).includes(platform)) {
      return info.srcPath || null;
    }
  }
  return null;
}
