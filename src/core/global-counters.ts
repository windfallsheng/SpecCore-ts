/**
 * global-counters — 全局计数器，保证迭代/任务 ID 自增唯一
 * 防护机制：读取时扫描实际目录，确保计数器不低于已有最大编号
 * 即使 counters.json 被删除或损坏，也不会产生重复 ID
 */
import { readFile, writeFile, pathExists, readdir, ensureDir } from 'fs-extra';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { getProjectRoot } from '../utils/task-utils';
import { pinyin } from 'pinyin-pro';

interface Counters {
  iterations: number;
  tasks: number;
  plans: number;
}

function path(): string {
  return join(getProjectRoot(), '.speccore', 'local', 'counters.json');
}

export async function getCounters(): Promise<Counters> {
  const p = path();
  let stored: Partial<Counters> = {};
  if (await pathExists(p)) {
    const raw = await readFile(p, 'utf-8');
    stored = JSON.parse(raw);
  }
  // 扫描实际目录，确保计数器不低于已有最大编号（防 counters.json 丢失/损坏）
  const scanned = await scanMaxIds();
  return {
    iterations: Math.max(stored.iterations ?? 0, scanned.iterations),
    tasks: Math.max(stored.tasks ?? 0, scanned.tasks),
    plans: Math.max(stored.plans ?? 0, scanned.plans),
  };
}

/** 扫描工作区目录，提取各实体已有的最大编号 */
async function scanMaxIds(): Promise<Counters> {
  const cwd = process.cwd();
  let iterations = 0, tasks = 0, plans = 0;
  try {
    const entries = await readdir(cwd);
    for (const name of entries) {
      // Iteration-001-xxx
      const iterMatch = name.match(/^Iteration-(\d+)/);
      if (iterMatch) iterations = Math.max(iterations, parseInt(iterMatch[1], 10));
    }
    // 扫描所有迭代下的 tasks 和 plans
    for (const name of (await readdir(cwd)).filter(n => n.startsWith('Iteration-'))) {
      const iterDir = join(cwd, name);
      try {
        const subEntries = await readdir(iterDir);
        // 030-tasks/{type}/Task-NNN* （新布局）
        const tasksDir = join(iterDir, '030-tasks');
        if (subEntries.includes('030-tasks')) {
          const taskEntries = await readdir(tasksDir);
          for (const t of taskEntries) {
            const m = t.match(/^Task-(\d+)/);
            if (m) tasks = Math.max(tasks, parseInt(m[1], 10));
            // 递归扫描类型子目录（feature/bugfix/refactor/research）
            try {
              const subPath = join(tasksDir, t);
              const stat = await require('fs-extra').stat(subPath);
              if (stat.isDirectory()) {
                const subTasks = await readdir(subPath);
                for (const st of subTasks) {
                  const sm = st.match(/^Task-(\d+)/);
                  if (sm) tasks = Math.max(tasks, parseInt(sm[1], 10));
                }
              }
            } catch {}
          }
        }
        // 迭代根目录下的 Task-NNN
        for (const t of subEntries) {
          const m = t.match(/^Task-(\d+)/);
          if (m) tasks = Math.max(tasks, parseInt(m[1], 10));
        }
        // 000-overview/plans/Plan-NNN
        const plansDir = join(iterDir, '000-overview', 'plans');
        if (subEntries.includes('000-overview')) {
          try {
            const planEntries = await readdir(plansDir);
            for (const p of planEntries) {
              const m = p.match(/^Plan-(\d+)/);
              if (m) plans = Math.max(plans, parseInt(m[1], 10));
            }
          } catch { /* plans 目录可能不存在 */ }
        }
      } catch { /* 忽略单个迭代目录的读取错误 */ }
    }
  } catch { /* 工作区不可读时返回 0 */ }
  return { iterations, tasks, plans };
}

/** 中英文名称转 slug（保留英文/数字，纯中文时拼音兜底）。
 * v8.3.294+: 导出供 taskify 拼接 bugfix 复合目录名（模块名 AI 英译 + 拼音兜底）。 */
export function toSlug(name: string): string {
  // 去掉 Iteration- 前缀
  const clean = name.replace(/^Iteration-/, '');
  // 优先提取连续的英文/数字片段（如 "User管理" → "User"）
  const latinMatches = clean.match(/[a-zA-Z0-9]+/g);
  if (latinMatches && latinMatches.length > 0) {
    return latinMatches.join('-').toLowerCase().slice(0, 40);
  }
  // 纯中文且无英文 → 拼音兜底（v8.3.286+：替代无语义 hash 乱码「iter-cl0w」，
  // 同一输入拼音稳定，幂等性不变）
  // v8.3.289+: 去掉 iter- 前缀——toSlug 被 nextTaskId/nextPlanId 复用，
  // 「iter-」混进任务目录名产生 Task-001-iter-zhifuxiugai 噪音；
  // 迭代 ID 本身已带 Iteration- 前缀，无需二次标记
  if (/[\u4e00-\u9fff]/.test(clean)) {
    return (pinyin(clean, { toneType: 'none', type: 'array' }) as string[])
      .map((s) => s.replace(/[^a-z0-9]/gi, ''))
      .filter(Boolean)
      .join('-')
      .toLowerCase()
      .slice(0, 24);
  }
  return 'project';
}

export async function nextIterationId(name: string, topic?: string): Promise<{ id: string; num: number }> {
  const c = await getCounters();
  const slug = toSlug(topic || name);
  // v8.3.372: 用户明确指定纯数字名（如 261115）→ 以用户为准作迭代序号，
  // 不再被全局计数器覆盖；与已有目录重名时拼内容 hash 兜底（同输入同 hash，幂等）。
  // 自定义序号不推进计数器：scanMaxIds 会扫描目录取最大编号，下次自动编号自然对齐防撞。
  const raw = (name || '').trim();
  if (/^\d+$/.test(raw)) {
    const base = `Iteration-${raw}-${slug}`;
    let id = base;
    if (await pathExists(id)) {
      const hash = createHash('md5').update(`${raw}:${slug}`).digest('hex').slice(0, 6);
      id = `${base}-${hash}`;
    }
    return { id, num: parseInt(raw, 10) };
  }
  c.iterations++;
  await save(c);
  const padded = String(c.iterations).padStart(3, '0');
  return { id: `Iteration-${padded}-${slug}`, num: c.iterations };
}

export async function nextTaskId(name?: string, topic?: string): Promise<{ id: string; num: number }> {
  const c = await getCounters();
  c.tasks++;
  await save(c);
  const padded = String(c.tasks).padStart(3, '0');
  const keyword = topic || name;
  // v8.3.289+: 上限 20→40，与 toSlug 拉丁片段上限对齐——
  // LLM 英译 slug 2~5 词可达 30+ 字符（booking-order-status-not-synced），
  // 20 字符截断会吃掉词尾造成语义残片
  const suffix = keyword ? `-${toSlug(keyword).slice(0, 40)}` : '';
  return { id: `Task-${padded}${suffix}`, num: c.tasks };
}

export async function nextPlanId(name?: string, topic?: string): Promise<{ id: string; num: number }> {
  const c = await getCounters();
  c.plans++;
  await save(c);
  const padded = String(c.plans).padStart(3, '0');
  const keyword = topic || name;
  const suffix = keyword ? `-${toSlug(keyword).slice(0, 40)}` : '';
  return { id: `Plan-${padded}${suffix}`, num: c.plans };
}

export async function initCounters(): Promise<void> {
  const p = path();
  await ensureDir(dirname(p));
  await writeFile(p, JSON.stringify({ iterations: 0, tasks: 0, plans: 0 }), 'utf-8');
}

async function save(c: Counters): Promise<void> {
  const p = path();
  // 防护：.speccore/local/ 可能尚未创建（如未初始化或部分初始化的项目），
  // 直接 writeFile 会抛 ENOENT 导致任务/迭代 ID 生成失败
  await ensureDir(dirname(p));
  await writeFile(p, JSON.stringify(c, null, 2), 'utf-8');
}
