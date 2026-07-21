/**
 * global-counters — 全局计数器，保证期次/任务 ID 自增唯一
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

export async function nextIterationId(name: string): Promise<{ id: string; num: number }> {
  const c = await getCounters();
  c.iterations++;
  await save(c);
  const padded = String(c.iterations).padStart(3, '0');
  return { id: `期次-${padded}-${name}`, num: c.iterations };
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
