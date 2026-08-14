/**
 * platform-registry — 端名注册与解析
 *
 * 三层端名一致性保障:
 *   层级 1: CONSTITUTION.md「对应需求端」列 — 全局权威
 *   层级 2: _shared/PLATFORMS.md — 任务级实际涉及的端
 *   层级 3: 模糊匹配 — 命令层自动纠错
 */

import { readFile, pathExists, writeFile, ensureDir, readdir } from 'fs-extra';
import { join } from 'path';

/** 从 CONSTITUTION.md 解析全局端名列表 */
export async function parseGlobalPlatforms(cwd?: string): Promise<string[]> {
  const base = cwd || process.cwd();
  const constitutionPath = join(base, '.speccore', 'CONSTITUTION.md');
  if (!(await pathExists(constitutionPath))) return [];

  const content = await readFile(constitutionPath, 'utf-8');
  const lines = content.split('\n');

  // 找到「对应需求端」表头
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('对应需求端')) { headerIdx = i; break; }
  }
  if (headerIdx < 0) return [];

  const headers = lines[headerIdx].split('|').map(h => h.trim()).filter(Boolean);
  const platformColIdx = headers.findIndex(h => h.includes('对应需求端'));
  if (platformColIdx < 0) return [];

  const platforms = new Set<string>();
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|') || line.match(/^\|\s*[-:]/)) continue;
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells[platformColIdx]) {
      cells[platformColIdx].split(',').forEach(p => {
        const trimmed = p.trim();
        if (trimmed) platforms.add(trimmed);
      });
    }
  }

  return [...platforms];
}

/** 从任务 _shared/PLATFORMS.md 解析该任务涉及的端列表 */
export async function parseTaskPlatforms(taskDir: string): Promise<string[]> {
  const platformsMd = join(taskDir, '_shared', 'PLATFORMS.md');
  if (!(await pathExists(platformsMd))) return [];

  const content = await readFile(platformsMd, 'utf-8');
  const platforms: string[] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line.startsWith('|') || line.match(/^\|\s*[-:]/) || line.includes('端名')) continue;
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells[0] && !cells[0].startsWith('-')) {
      platforms.push(cells[0]);
    }
  }
  return platforms;
}

/**
 * 模糊匹配端名
 * 优先级: 精确匹配 → 前缀匹配 → 包含匹配
 * 返回匹配结果（含匹配到的端名和是否精确）
 */
export function fuzzyMatchPlatform(input: string, validPlatforms: string[]): { matched: string; exact: boolean } | null {
  if (!input || validPlatforms.length === 0) return null;

  // 精确匹配
  if (validPlatforms.includes(input)) {
    return { matched: input, exact: true };
  }

  const lower = input.toLowerCase();

  // 前缀匹配
  const prefixMatches = validPlatforms.filter(p => p.toLowerCase().startsWith(lower));
  if (prefixMatches.length === 1) {
    return { matched: prefixMatches[0], exact: false };
  }

  // 包含匹配
  const containsMatches = validPlatforms.filter(p => p.toLowerCase().includes(lower));
  if (containsMatches.length === 1) {
    return { matched: containsMatches[0], exact: false };
  }

  // 多候选时返回第一个但不标记为精确
  if (prefixMatches.length > 1) {
    return null; // 多候选，让用户选择
  }

  return null;
}

/**
 * 解析端名参数（全局入口）
 * 1. 从 CONSTITUTION.md 获取全局端列表
 * 2. 模糊匹配用户输入
 * 3. 返回结果或错误信息
 */
export async function resolvePlatform(input: string, cwd?: string): Promise<{
  resolved: string | null;
  exact: boolean;
  candidates: string[];
  error?: string;
}> {
  const globalPlatforms = await parseGlobalPlatforms(cwd);

  if (globalPlatforms.length === 0) {
    return { resolved: input, exact: true, candidates: [] };
  }

  const result = fuzzyMatchPlatform(input, globalPlatforms);
  if (result) {
    return { resolved: result.matched, exact: result.exact, candidates: [] };
  }

  return {
    resolved: null,
    exact: false,
    candidates: globalPlatforms,
    error: `未知端: "${input}"。可用端: ${globalPlatforms.join(', ')}`,
  };
}

/**
 * 生成任务级端注册表 _shared/PLATFORMS.md
 * split 命令创建任务后调用
 */
export async function generatePlatformsRegistry(
  taskDir: string,
  taskId: string,
  platforms: { name: string; subtaskId: string; owner: string }[]
): Promise<void> {
  const sharedDir = join(taskDir, '_shared');
  await ensureDir(sharedDir);

  const lines = [
    `# ${taskId} 端注册表`,
    '',
    '> 来源: CONSTITUTION.md 全局配置 · split 自动生成',
    '',
    '| 端名 | 子任务 ID | 负责人 | 状态 |',
    '| :--- | :--- | :--- | :--- |',
    ...platforms.map(p => `| ${p.name} | \`${p.subtaskId}\` | ${p.owner} | 🔲 待开发 |`),
    '',
    '> 命令参考:',
    `> - 执行全部: speccore execute --task ${taskId}`,
    `> - 执行某端: speccore execute --task ${taskId} --platform <端名>`,
    `> - 按人执行: speccore execute --assignee <负责人>`,
    '',
  ];

  await writeFile(join(sharedDir, 'PLATFORMS.md'), lines.join('\n'), 'utf-8');
}

/**
 * 刷新任务级 PLATFORMS.md 状态（execute 完成后调用）
 * 扫描各端 TASK.md 的实际状态，回写到 PLATFORMS.md 的状态列
 */
export async function refreshPlatformsStatus(taskDir: string): Promise<void> {
  const platformsMd = join(taskDir, '_shared', 'PLATFORMS.md');
  if (!(await pathExists(platformsMd))) return;

  const content = await readFile(platformsMd, 'utf-8');
  const lines = content.split('\n');
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|') || line.match(/^\|\s*[-:]/) || line.includes('端名')) continue;

    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length < 4) continue;

    const platformName = cells[0];
    // 找到对应端的 TASK.md，读取实际状态
    const platformTaskMd = join(taskDir, platformName, 'TASK.md');
    if (!(await pathExists(platformTaskMd))) continue;

    const taskContent = await readFile(platformTaskMd, 'utf-8');
    let newStatus = cells[3]; // 保持原状态

    // 精确读取 TASK.md 中的 **状态** 字段，避免整文件关键词误判
    const statusMatch = taskContent.match(/\*\*状态\*\*\s*[:：]\s*(.+)/m);
    if (statusMatch) {
      const rawStatus = statusMatch[1].trim().toLowerCase();
      if (rawStatus.includes('已完成') || rawStatus.includes('completed') || rawStatus.includes('✅')) {
        newStatus = '✅ 已完成';
      } else if (rawStatus.includes('进行中') || rawStatus.includes('in_progress') || rawStatus.includes('🔄')) {
        newStatus = '🔄 进行中';
      } else if (rawStatus.includes('未开始') || rawStatus.includes('pending') || rawStatus.includes('🔲')) {
        newStatus = '🔲 未开始';
      }
    }

    if (newStatus !== cells[3]) {
      // 替换该行的状态列
      const newCells = [...cells];
      newCells[3] = newStatus;
      lines[i] = '| ' + newCells.join(' | ') + ' |';
      changed = true;
    }
  }

  if (changed) {
    await writeFile(platformsMd, lines.join('\n'), 'utf-8');
  }
}
