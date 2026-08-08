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
  // 如果全是中文，取拼音首字母或直接用短hash
  if (/[\u4e00-\u9fff]/.test(clean)) {
    const hash = Math.abs(clean.split('').reduce((a, c) => a + c.charCodeAt(0), 0)).toString(36).slice(0, 4);
    return 'iter-' + hash;
  }
  return 'unknown';
}

export async function nextIterationId(name: string, topic?: string): Promise<{ id: string; num: number }> {
  const c = await getCounters();
  c.iterations++;
  await save(c);
  const padded = String(c.iterations).padStart(3, '0');
  const slug = toSlug(topic || name);
  return { id: `Iteration-${padded}-${slug}`, num: c.iterations };
}

export async function nextTaskId(name?: string): Promise<{ id: string; num: number }> {
  const c = await getCounters();
  c.tasks++;
  await save(c);
  const padded = String(c.tasks).padStart(3, '0');
  const suffix = name ? `-${name.slice(0, 20)}` : '';
  return { id: `Task-${padded}${suffix}`, num: c.tasks };
}

export async function initCounters(): Promise<void> {
  await writeFile(path(), JSON.stringify({ iterations: 0, tasks: 0 }), 'utf-8');
}

async function save(c: Counters): Promise<void> {
  await writeFile(path(), JSON.stringify(c, null, 2), 'utf-8');
}
