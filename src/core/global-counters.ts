/**
 * global-counters — 全局计数器，保证迭代/任务 ID 自增唯一
 * 防护机制：读取时扫描实际目录，确保计数器不低于已有最大编号
 * 即使 counters.json 被删除或损坏，也不会产生重复 ID
 */
import { readFile, writeFile, pathExists, readdir } from 'fs-extra';
import { join } from 'path';

interface Counters {
  iterations: number;
  tasks: number;
  plans: number;
}

function path(): string {
  return join(process.cwd(), '.speccore', 'local', 'counters.json');
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
        // 030-tasks/Task-NNN
        const tasksDir = join(iterDir, '030-tasks');
        if (subEntries.includes('030-tasks')) {
          const taskEntries = await readdir(tasksDir);
          for (const t of taskEntries) {
            const m = t.match(/^Task-(\d+)/);
            if (m) tasks = Math.max(tasks, parseInt(m[1], 10));
          }
        }
        // 兼容旧布局：迭代根目录下的 Task-NNN
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

/** 中英文名称转 slug（保留英文/数字，中文转拼音首字母缩写） */
function toSlug(name: string): string {
  // 去掉 Iteration- 前缀
  const clean = name.replace(/^Iteration-/, '');
  // 提取英文/数字部分
  const latin = clean.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (latin.length > 0) return latin.toLowerCase().slice(0, 30);
  // 纯中文 → hash 回退（如 iter-56g7），有英文 topic 时优先用 topic
  if (/[\u4e00-\u9fff]/.test(clean)) {
    const hash = Math.abs(clean.split('').reduce((a, c) => a + c.charCodeAt(0), 0)).toString(36).slice(0, 4);
    return 'iter-' + hash;
  }
  return 'project';
}

export async function nextIterationId(name: string, topic?: string): Promise<{ id: string; num: number }> {
  const c = await getCounters();
  c.iterations++;
  await save(c);
  const padded = String(c.iterations).padStart(3, '0');
  const slug = toSlug(topic || name);
  return { id: `Iteration-${padded}-${slug}`, num: c.iterations };
}

export async function nextTaskId(name?: string, topic?: string): Promise<{ id: string; num: number }> {
  const c = await getCounters();
  c.tasks++;
  await save(c);
  const padded = String(c.tasks).padStart(3, '0');
  const keyword = topic || name;
  const suffix = keyword ? `-${toSlug(keyword).slice(0, 20)}` : '';
  return { id: `Task-${padded}${suffix}`, num: c.tasks };
}

export async function nextPlanId(name?: string, topic?: string): Promise<{ id: string; num: number }> {
  const c = await getCounters();
  c.plans++;
  await save(c);
  const padded = String(c.plans).padStart(3, '0');
  const keyword = topic || name;
  const suffix = keyword ? `-${toSlug(keyword).slice(0, 20)}` : '';
  return { id: `Plan-${padded}${suffix}`, num: c.plans };
}

export async function initCounters(): Promise<void> {
  await writeFile(path(), JSON.stringify({ iterations: 0, tasks: 0, plans: 0 }), 'utf-8');
}

async function save(c: Counters): Promise<void> {
  await writeFile(path(), JSON.stringify(c, null, 2), 'utf-8');
}
