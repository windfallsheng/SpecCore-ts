/**
 * global-counters — 全局计数器，保证迭代/任务 ID 自增唯一
 */
import { readFile, writeFile, pathExists } from 'fs-extra';
import { join } from 'path';

interface Counters {
  iterations: number;
  tasks: number;
}

function path(): string {
  return join(process.cwd(), '.speccore', 'local', 'counters.json');
}

export async function getCounters(): Promise<Counters> {
  const p = path();
  if (await pathExists(p)) {
    const raw = await readFile(p, 'utf-8');
    return JSON.parse(raw);
  }
  return { iterations: 0, tasks: 0 };
}

/** 中英文名称转 slug（保留英文/数字，中文转拼音首字母缩写） */
function toSlug(name: string): string {
  // 去掉 Iteration- 前缀
  const clean = name.replace(/^Iteration-/, '');
  // 提取英文/数字部分
  const latin = clean.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (latin.length > 0) return latin.toLowerCase().slice(0, 30);
  // 全是中文 → 用迭代编号作为回退
  if (/[\u4e00-\u9fff]/.test(clean)) {
    return 'project'; // nextIterationId 会拼上编号
  }
  return 'project'; // 兜底
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

export async function initCounters(): Promise<void> {
  await writeFile(path(), JSON.stringify({ iterations: 0, tasks: 0 }), 'utf-8');
}

async function save(c: Counters): Promise<void> {
  await writeFile(path(), JSON.stringify(c, null, 2), 'utf-8');
}
