/**
 * resolver.ts — 统一智能匹配模块
 *
 * 所有命令共用此模块解析迭代名和任务名。
 * 匹配策略：精确匹配 → 前缀匹配 → 关键词搜索（任务名 + REQ.md）
 * 多匹配时返回候选列表，由调用方决定交互方式。
 */

import { join } from 'path';
import { pathExists, readFile } from 'fs-extra';
import { scanTasks, TaskState } from './state';
import { getIterationDir } from './context';

// ============================================================
// 类型定义
// ============================================================

export interface ResolveResult<T> {
  /** 是否唯一匹配 */
  exact: boolean;
  /** 匹配到的结果（唯一匹配时填充） */
  value?: T;
  /** 多个候选 */
  candidates: T[];
  /** 匹配方式说明 */
  matchType: 'exact' | 'prefix' | 'keyword' | 'none';
  /** 提示信息（多候选或无匹配时） */
  hint?: string;
}

// ============================================================
// 迭代名解析
// ============================================================

/**
 * 解析迭代名。支持以下输入格式：
 * - 完整名: "Iteration-001-ecommerce-test"
 * - 短名:   "ecommerce-test"
 * - 编号:   "001"
 * - 关键词: "ecommerce"（模糊匹配）
 * - 空:     返回当前活跃迭代
 */
export async function resolveIteration(input?: string): Promise<ResolveResult<string>> {
  const { readdir } = await import('fs-extra');

  // 空输入 → 当前活跃迭代
  if (!input) {
    const { detectActiveIteration } = await import('./context');
    const active = await detectActiveIteration();
    if (active) {
      return { exact: true, value: active, candidates: [active], matchType: 'exact' };
    }
    return { exact: false, candidates: [], matchType: 'none', hint: '未找到活跃迭代。请用 speccore context --set --iteration <name> 设置' };
  }

  // 扫描所有迭代目录
  const root = process.cwd();
  let entries: string[] = [];
  try {
    const dirEntries = await readdir(root, { withFileTypes: true });
    entries = dirEntries
      .filter(e => e.isDirectory() && e.name.startsWith('Iteration-'))
      .map(e => e.name);
  } catch {
    return { exact: false, candidates: [], matchType: 'none', hint: '未找到任何迭代目录' };
  }

  if (entries.length === 0) {
    return { exact: false, candidates: [], matchType: 'none', hint: '未找到任何迭代目录' };
  }

  const normalizedInput = input.replace(/^Iteration-/, '').toLowerCase();

  // 1. 精确匹配（完整名或短名）
  const exactMatch = entries.find(e => {
    const name = e.replace(/^Iteration-/, '').toLowerCase();
    return name === normalizedInput || e.toLowerCase() === input.toLowerCase();
  });
  if (exactMatch) {
    return { exact: true, value: exactMatch.replace(/^Iteration-/, ''), candidates: [exactMatch.replace(/^Iteration-/, '')], matchType: 'exact' };
  }

  // 2. 后缀匹配（如 "ecommerce-test" 匹配 "Iteration-001-ecommerce-test"）
  const suffixMatches = entries.filter(e => {
    const name = e.replace(/^Iteration-/, '').toLowerCase();
    return name.endsWith(`-${normalizedInput}`) || name === normalizedInput;
  });
  if (suffixMatches.length === 1) {
    const val = suffixMatches[0].replace(/^Iteration-/, '');
    return { exact: true, value: val, candidates: [val], matchType: 'prefix' };
  }

  // 3. 编号匹配（如 "001" 匹配 "Iteration-001-xxx"）
  const numMatch = entries.filter(e => e.match(/^Iteration-(\d+)/)?.[1] === normalizedInput.replace(/^0+/, '') || e.startsWith(`Iteration-${input}`));
  if (numMatch.length === 1) {
    const val = numMatch[0].replace(/^Iteration-/, '');
    return { exact: true, value: val, candidates: [val], matchType: 'prefix' };
  }

  // 4. 关键词模糊匹配（在迭代名中搜索关键词）
  const keywordMatches = entries.filter(e => {
    const name = e.replace(/^Iteration-/, '').toLowerCase();
    // 拆词匹配：输入 "ecommerce" 匹配 "001-ecommerce-test"
    return name.includes(normalizedInput);
  });

  if (keywordMatches.length === 1) {
    const val = keywordMatches[0].replace(/^Iteration-/, '');
    return { exact: true, value: val, candidates: [val], matchType: 'keyword' };
  }

  if (keywordMatches.length > 1) {
    const candidates = keywordMatches.map(e => e.replace(/^Iteration-/, ''));
    return {
      exact: false,
      candidates,
      matchType: 'keyword',
      hint: `找到 ${candidates.length} 个匹配迭代:\n${candidates.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}\n请指定更精确的名称`,
    };
  }

  // 无匹配
  return {
    exact: false,
    candidates: [],
    matchType: 'none',
    hint: `未找到匹配 "${input}" 的迭代。可用迭代:\n${entries.map(e => `  - ${e.replace(/^Iteration-/, '')}`).join('\n')}`,
  };
}

// ============================================================
// 任务名解析
// ============================================================

/**
 * 解析任务名。支持以下输入格式：
 * - 完整 ID:  "Task-001-订单管理"
 * - 短 ID:    "Task-001"
 * - 编号:     "001"
 * - 关键词:   "订单"（搜索任务名 + REQ.md 内容）
 */
export async function resolveTask(input: string, iteration: string): Promise<ResolveResult<TaskState>> {
  const tasks = await scanTasks(iteration);

  if (tasks.length === 0) {
    return { exact: false, candidates: [], matchType: 'none', hint: '当前迭代没有任务' };
  }

  // 1. 精确匹配 ID
  const exactId = tasks.find(t => t.id === input);
  if (exactId) {
    return { exact: true, value: exactId, candidates: [exactId], matchType: 'exact' };
  }

  // 2. 前缀匹配（Task-001 → Task-001-订单管理）
  const prefixMatches = tasks.filter(t => t.id.startsWith(input));
  if (prefixMatches.length === 1) {
    return { exact: true, value: prefixMatches[0], candidates: prefixMatches, matchType: 'prefix' };
  }

  // 3. 编号匹配（"001" → "Task-001"）
  const numInput = input.replace(/^0+/, '');
  const numMatches = tasks.filter(t => {
    const num = t.id.match(/Task-(\d+)/)?.[1]?.replace(/^0+/, '');
    return num === numInput;
  });
  if (numMatches.length === 1) {
    return { exact: true, value: numMatches[0], candidates: numMatches, matchType: 'prefix' };
  }

  // 4. 关键词搜索（任务名 + REQ.md 内容）
  const keyword = input.toLowerCase();
  const keywordMatches: TaskState[] = [];

  for (const t of tasks) {
    // 任务名匹配
    if (t.name.toLowerCase().includes(keyword) || t.id.toLowerCase().includes(keyword)) {
      if (!keywordMatches.includes(t)) keywordMatches.push(t);
      continue;
    }

    // REQ.md 内容匹配
    const iterDir = await getIterationDir(iteration);
    const reqPath1 = join(iterDir, '030-tasks', t.id, '00-specs', 'REQ.md');
    const reqPath2 = join(iterDir, t.id, '00-specs', 'REQ.md');
    const reqPath3 = join(iterDir, '030-tasks', t.id, 'REQ.md');
    const reqPath = (await pathExists(reqPath1)) ? reqPath1 : (await pathExists(reqPath2)) ? reqPath2 : (await pathExists(reqPath3)) ? reqPath3 : null;

    if (reqPath) {
      const content = await readFile(reqPath, 'utf-8');
      if (content.toLowerCase().includes(keyword)) {
        keywordMatches.push(t);
      }
    }
  }

  if (keywordMatches.length === 1) {
    return { exact: true, value: keywordMatches[0], candidates: keywordMatches, matchType: 'keyword' };
  }

  if (keywordMatches.length > 1) {
    return {
      exact: false,
      candidates: keywordMatches,
      matchType: 'keyword',
      hint: `找到 ${keywordMatches.length} 个匹配任务:\n${keywordMatches.map((t, i) => `  ${i + 1}. ${t.id} — ${t.name}`).join('\n')}\n请指定更精确的名称`,
    };
  }

  // 无匹配
  return {
    exact: false,
    candidates: [],
    matchType: 'none',
    hint: `未找到匹配 "${input}" 的任务。可用任务:\n${tasks.map(t => `  - ${t.id} ${t.name}`).join('\n')}`,
  };
}

// ============================================================
// 批量任务解析（支持逗号分隔）
// ============================================================

/**
 * 解析多个任务。支持逗号分隔输入：
 * - "Task-001,Task-003"
 * - "001,003"
 * - "订单,支付"（关键词）
 */
export async function resolveTasks(input: string, iteration: string): Promise<{ resolved: TaskState[]; failed: string[] }> {
  const parts = input.split(',').map(s => s.trim()).filter(Boolean);
  const resolved: TaskState[] = [];
  const failed: string[] = [];

  for (const part of parts) {
    const result = await resolveTask(part, iteration);
    if (result.exact && result.value) {
      resolved.push(result.value);
    } else if (result.candidates.length > 0) {
      // 多候选时取第一个（调用方应提前处理交互）
      resolved.push(result.candidates[0]);
    } else {
      failed.push(part);
    }
  }

  return { resolved, failed };
}

// ============================================================
// 格式化输出
// ============================================================

/**
 * 格式化匹配结果为可读字符串
 */
export function formatResolveResult(result: ResolveResult<any>, label: string): string {
  if (result.exact && result.value) {
    if (result.matchType === 'exact') return '';
    return `📎 ${label} 匹配: ${result.value}`;
  }
  return result.hint || '';
}
