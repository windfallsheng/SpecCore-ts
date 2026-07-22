/**
 * requirement-tracker — 全量层需求追踪：新增/修改/冲突检测
 */
import { readFile, writeFile, pathExists, ensureDir } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';

export interface ReqEntry {
  id: string;          // 需求唯一标识
  title: string;       // 需求标题
  status: 'active' | 'modified' | 'deprecated';
  originIteration: string;      // 首次引入的期次
  lastModifiedIteration?: string; // 最近修改的期次
  changeHistory: { iteration: string; type: '新增' | '修改' | '废弃'; timestamp: string }[];
}

const TRACKER_PATH = join('.speccore', 'GLOBAL', 'REQUIREMENTS', 'tracker.json');

function trackerPath(): string {
  return join(process.cwd(), TRACKER_PATH);
}

export async function loadTracker(): Promise<ReqEntry[]> {
  const p = trackerPath();
  if (await pathExists(p)) {
    return JSON.parse(await readFile(p, 'utf-8'));
  }
  return [];
}

export async function saveTracker(entries: ReqEntry[]): Promise<void> {
  const p = trackerPath();
  await ensureDir(join(p, '..'));
  await writeFile(p, JSON.stringify(entries, null, 2), 'utf-8');
}

/**
 * 注册或更新需求追踪
 * @returns warnings — 跨期次冲突预警
 */
export async function registerRequirement(
  title: string,
  iteration: string,
  changeType: '新增' | '修改' | '废弃'
): Promise<string[]> {
  const entries = await loadTracker();
  const warnings: string[] = [];

  // 按标题模糊匹配已有需求（前 10 字相同视为同一需求）
  const existing = entries.find(e => 
    e.title.slice(0, Math.min(10, e.title.length, title.length)) === 
    title.slice(0, Math.min(10, title.length))
  );

  const now = new Date().toISOString();

  if (existing) {
    if (changeType === '新增') {
      warnings.push(`⚠️ "${title}" 已在 ${existing.originIteration} 中引入，当前标记为「新增」可能重复`);
    }
    if (changeType === '修改') {
      existing.status = 'modified';
      existing.lastModifiedIteration = iteration;
      existing.changeHistory.push({ iteration, type: '修改', timestamp: now });
      
      // 检测：是否有其他期次也在修改同一个需求
      const otherModifiers = existing.changeHistory
        .filter(h => h.type === '修改' && h.iteration !== iteration)
        .map(h => h.iteration);
      
      if (otherModifiers.length > 0) {
        warnings.push(
          `⚠️ "${title}" 曾在以下期次被修改: ${[...new Set(otherModifiers)].join(', ')} — 注意合并冲突`
        );
      }
    }
    if (changeType === '废弃') {
      existing.status = 'deprecated';
      existing.changeHistory.push({ iteration, type: '废弃', timestamp: now });
    }
  } else {
    // 新需求
    entries.push({
      id: `REQ-${String(entries.length + 1).padStart(3, '0')}`,
      title,
      status: changeType === '废弃' ? 'deprecated' : 'active',
      originIteration: iteration,
      changeHistory: [{ iteration, type: '新增', timestamp: now }],
    });
  }

  await saveTracker(entries);
  return warnings;
}

/**
 * 生成全量层需求追踪报告 (Markdown)
 */
export async function generateTrackerReport(): Promise<string> {
  const entries = await loadTracker();
  
  let report = `# 全量需求追踪\n\n`;
  report += `> 自动生成 | ${new Date().toISOString().slice(0, 10)}\n\n`;
  report += `| ID | 需求 | 状态 | 首次期次 | 最近修改 | 变更次数 |\n`;
  report += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;

  for (const e of entries) {
    const statusEmoji = e.status === 'active' ? '🟢' : e.status === 'modified' ? '🟡' : '⚫';
    report += `| ${e.id} | ${e.title} | ${statusEmoji} ${e.status} | ${e.originIteration} | ${e.lastModifiedIteration || '-'} | ${e.changeHistory.length} |\n`;
  }

  return report;
}
