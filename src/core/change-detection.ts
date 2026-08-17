/**
 * change-detection — 变更感知模块（v6.69.0+）
 *
 * 通过 Git diff 识别变更范围，将变更文件映射到受影响的端，
 * 支持 Pipeline 的增量分析（仅分析受影响端）。
 */

import { readFile, pathExists } from 'fs-extra';
import { join } from 'path';
import { execSync } from 'child_process';
import { logger } from '../utils/logger';

export interface PlatformChangeInfo {
  platform: string;
  changedFiles: string[];
  changeCount: number;
}

/**
 * 获取 Git 工作区的变更文件列表
 * @param baseRef 对比的基准 ref（默认 HEAD）
 * @returns 相对路径列表
 */
export function getChangedFiles(baseRef: string = 'HEAD'): string[] {
  try {
    const output = execSync(`git diff --name-only ${baseRef}`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
    if (!output) return [];
    return output.split('\n').filter(f => f.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * 获取工作区中未跟踪的新文件
 */
export function getUntrackedFiles(): string[] {
  try {
    const output = execSync('git ls-files --others --exclude-standard', {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
    if (!output) return [];
    return output.split('\n').filter(f => f.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * 读取 CONSTITUTION.md 中的源码路径 → 端映射
 * @returns Map<源码路径, 端名>
 */
export async function loadSourcePathMap(cwd: string): Promise<Map<string, string>> {
  const pathMap = new Map<string, string>();
  const constitutionPath = join(cwd, '.speccore', 'CONSTITUTION.md');

  if (!(await pathExists(constitutionPath))) {
    return pathMap;
  }

  try {
    const content = await readFile(constitutionPath, 'utf-8');
    // 解析「项目信息」表格
    // 格式：| 工程 | 项目名称 | 源码路径 | Git 仓库 | 默认分支 | 对应端 |
    const lines = content.split('\n');
    let inProjectSection = false;

    for (const line of lines) {
      // 检测「项目信息」章节
      if (line.includes('## 项目信息')) {
        inProjectSection = true;
        continue;
      }
      if (inProjectSection && line.startsWith('## ')) {
        inProjectSection = false;
        continue;
      }
      if (!inProjectSection) continue;

      // 跳过表头分隔行
      if (line.match(/^\|[-:\s|]+\|$/)) continue;
      // 跳过空行和提示行
      if (!line.includes('|') || line.includes('工程 | 项目名称')) continue;

      const cells = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length >= 6) {
        const srcPath = cells[2];        // 源码路径列
        const platform = cells[5];       // 对应端列
        if (srcPath && platform && platform !== '待填写') {
          // 标准化路径（去掉开头的 ./）
          const normalized = srcPath.replace(/^\.\//, '');
          pathMap.set(normalized, platform);
        }
      }
    }
  } catch (e) {
    logger.debug('读取 CONSTITUTION.md 失败:', e);
  }

  return pathMap;
}

/**
 * 检测变更影响的端
 *
 * 策略：
 * 1. 需求/规格文件变更（010-requirements/、020-specs/）→ 影响所有端
 * 2. 源码文件变更 → 根据 CONSTITUTION.md 的源码路径映射到对应端
 * 3. 全局配置变更（.speccore/）→ 影响所有端
 * 4. 其他文件变更（CI、文档等）→ 不影响分析
 *
 * @param cwd 工作目录
 * @param changedFiles 可选：预计算的变更文件列表（不传则自动检测）
 * @returns 受影响的端名列表（空数组表示无变更或无法检测）
 */
export async function detectAffectedPlatforms(
  cwd: string,
  changedFiles?: string[]
): Promise<string[]> {
  const files = changedFiles || [...getChangedFiles(), ...getUntrackedFiles()];

  if (files.length === 0) {
    logger.debug('变更感知: 未检测到变更文件');
    return [];
  }

  const pathMap = await loadSourcePathMap(cwd);
  const affected = new Set<string>();
  let hasGlobalChange = false;

  for (const file of files) {
    // 全局变更：需求文档、规格文档、配置
    if (
      file.includes('010-requirements/') ||
      file.includes('020-specs/') ||
      file.includes('.speccore/CONSTITUTION.md') ||
      file.includes('.speccore/PATTERNS/')
    ) {
      hasGlobalChange = true;
      break;
    }

    // 源码路径匹配
    for (const [srcPath, platform] of pathMap) {
      if (file.startsWith(srcPath + '/') || file === srcPath) {
        affected.add(platform);
      }
    }
  }

  // 全局变更 → 返回所有端
  if (hasGlobalChange && pathMap.size > 0) {
    logger.info(`🔄 变更感知: 检测到全局变更（需求/规格/配置），需分析所有 ${pathMap.size} 个端`);
    return Array.from(new Set(pathMap.values()));
  }

  const result = Array.from(affected);
  if (result.length > 0) {
    logger.info(`🔄 变更感知: 检测到 ${files.length} 个变更文件，影响端: ${result.join(', ')}`);
  } else {
    logger.debug(`变更感知: ${files.length} 个变更文件未匹配到任何端`);
  }

  return result;
}

/**
 * 获取详细的变更信息（按端分组）
 */
export async function getPlatformChangeDetails(
  cwd: string,
  changedFiles?: string[]
): Promise<PlatformChangeInfo[]> {
  const files = changedFiles || [...getChangedFiles(), ...getUntrackedFiles()];
  const pathMap = await loadSourcePathMap(cwd);
  const platformFiles = new Map<string, string[]>();

  for (const file of files) {
    for (const [srcPath, platform] of pathMap) {
      if (file.startsWith(srcPath + '/') || file === srcPath) {
        const list = platformFiles.get(platform) || [];
        list.push(file);
        platformFiles.set(platform, list);
      }
    }
  }

  return Array.from(platformFiles.entries()).map(([platform, changedFiles]) => ({
    platform,
    changedFiles,
    changeCount: changedFiles.length,
  }));
}

// ═══════════════════════════════════════════════
// v6.69.0+: 关键路径优先 — 端优先级检测
// ═══════════════════════════════════════════════

/**
 * 检测各端的优先级顺序（关键路径优先排序）
 *
 * 策略：
 * 1. 读取迭代中所有子任务的 TaskState
 * 2. 按 platform 分组，统计各端 high/medium/low 优先级任务数量
 * 3. 按「high 数量降序 → medium 数量降序 → low 数量降序」排序端
 * 4. 如果某端没有任务，赋予最低优先级
 *
 * @param iteration 迭代名
 * @returns 按优先级排序的端名列表（靠前的优先分析）
 */
export async function detectPlatformPriorityOrder(iteration: string): Promise<string[]> {
  const { scanTasks } = await import('./state');
  const tasks = await scanTasks(iteration);

  // 按端分组统计优先级
  const platformStats = new Map<string, { high: number; medium: number; low: number }>();

  for (const task of tasks) {
    const platform = task.platform;
    if (!platform) continue;

    const stats = platformStats.get(platform) || { high: 0, medium: 0, low: 0 };
    if (task.priority === 'high') stats.high++;
    else if (task.priority === 'low') stats.low++;
    else stats.medium++;
    platformStats.set(platform, stats);
  }

  // 排序：high 多 → medium 多 → low 多
  const sorted = Array.from(platformStats.entries()).sort((a, b) => {
    const [pa, sa] = a;
    const [pb, sb] = b;
    if (sa.high !== sb.high) return sb.high - sa.high;
    if (sa.medium !== sb.medium) return sb.medium - sa.medium;
    return sb.low - sa.low;
  });

  const result = sorted.map(([platform]) => platform);
  if (result.length > 0) {
    logger.info(`🎯 关键路径优先: 端优先级排序 → ${result.join(' > ')}`);
  }
  return result;
}
