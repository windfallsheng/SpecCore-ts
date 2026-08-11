/**
 * intent-cache — 意图缓存与自学习引擎
 *
 * 将宿主AI的判定结果缓存到本地，实现：
 *   1. 精确匹配：相同输入直接命中
 *   2. 模糊匹配：编辑距离 ≤ 2 的输入也命中
 *   3. 命中统计：高频意图逐步固化
 *   4. 零LLM成本：纯本地文件读写
 */

import { pathExists, readJson, writeJson, ensureDir } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import type { AskResult } from './ask-engine';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface CachedIntent {
  /** 缓存的输入文本 */
  input: string;
  /** 匹配的 AskResult */
  result: AskResult;
  /** 来源：local / host-ai / llm */
  source: string;
  /** 命中次数 */
  hitCount: number;
  /** 首次缓存时间 */
  createdAt: string;
  /** 最后命中时间 */
  lastUsed: string;
}

export interface IntentCache {
  version: string;
  entries: Record<string, CachedIntent>;
  /** 固化规则：命中次数超过阈值自动生成的本地规则建议 */
  solidified: string[];
}

// ═══════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════

const CACHE_PATH = '.speccore/local/intent-cache.json';
const CACHE_VERSION = '1.0';
const MAX_ENTRIES = 200;
const FUZZY_THRESHOLD = 2; // 编辑距离阈值

// ═══════════════════════════════════════════════════════════
// 缓存读写
// ═══════════════════════════════════════════════════════════

let cacheMemory: IntentCache | null = null;

async function loadCache(): Promise<IntentCache> {
  if (cacheMemory) return cacheMemory;

  if (await pathExists(CACHE_PATH)) {
    try {
      const raw = (await readJson(CACHE_PATH)) as IntentCache;
      if (raw.version === CACHE_VERSION) {
        cacheMemory = raw;
        return raw;
      }
    } catch {
      // 缓存损坏，重建
    }
  }

  cacheMemory = { version: CACHE_VERSION, entries: {}, solidified: [] };
  return cacheMemory;
}

async function saveCache(cache: IntentCache): Promise<void> {
  await ensureDir('.speccore/local');
  await writeJson(CACHE_PATH, cache, { spaces: 2 });
  cacheMemory = cache;
}

// ═══════════════════════════════════════════════════════════
// 公共 API
// ═══════════════════════════════════════════════════════════

/**
 * 查询缓存：先精确匹配，再模糊匹配
 */
export async function getCachedIntent(input: string): Promise<AskResult | null> {
  const cache = await loadCache();

  // 1. 精确匹配
  const exact = cache.entries[input];
  if (exact) {
    exact.hitCount++;
    exact.lastUsed = new Date().toISOString();
    await saveCache(cache);
    logger.info(`💾 意图缓存命中(精确): "${input.slice(0, 30)}..." → ${exact.result.summary.slice(0, 30)}`);
    return exact.result;
  }

  // 2. 模糊匹配（编辑距离 ≤ 2）
  for (const [cachedInput, entry] of Object.entries(cache.entries)) {
    if (levenshtein(input, cachedInput) <= FUZZY_THRESHOLD) {
      entry.hitCount++;
      entry.lastUsed = new Date().toISOString();
      await saveCache(cache);
      logger.info(`💾 意图缓存命中(模糊): "${input.slice(0, 30)}..." ≈ "${cachedInput.slice(0, 30)}..."`);
      return entry.result;
    }
  }

  return null;
}

/**
 * 写入缓存
 */
export async function cacheIntent(input: string, result: AskResult, source: string = 'host-ai'): Promise<void> {
  const cache = await loadCache();

  cache.entries[input] = {
    input,
    result,
    source,
    hitCount: 1,
    createdAt: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
  };

  // 超限清理：保留最近使用的 150 条
  const entriesList = Object.entries(cache.entries);
  if (entriesList.length > MAX_ENTRIES) {
    entriesList.sort((a, b) => new Date(b[1].lastUsed).getTime() - new Date(a[1].lastUsed).getTime());
    cache.entries = Object.fromEntries(entriesList.slice(0, MAX_ENTRIES));
    logger.info(`💾 意图缓存清理：保留最近 ${MAX_ENTRIES} 条`);
  }

  await saveCache(cache);
}

/**
 * 获取可固化的意图列表（命中次数超过阈值）
 */
export async function getSolidifiableIntents(minHits: number): Promise<CachedIntent[]> {
  const cache = await loadCache();
  return Object.values(cache.entries).filter(e => e.hitCount >= minHits && !cache.solidified.includes(e.input));
}

/**
 * 标记意图为已固化
 */
export async function markSolidified(input: string): Promise<void> {
  const cache = await loadCache();
  if (!cache.solidified.includes(input)) {
    cache.solidified.push(input);
    await saveCache(cache);
  }
}

/**
 * 获取缓存统计信息
 */
export async function getCacheStats(): Promise<{ total: number; solidified: number; avgHits: number }> {
  const cache = await loadCache();
  const entries = Object.values(cache.entries);
  const totalHits = entries.reduce((sum, e) => sum + e.hitCount, 0);
  return {
    total: entries.length,
    solidified: cache.solidified.length,
    avgHits: entries.length > 0 ? Math.round(totalHits / entries.length) : 0,
  };
}

// ═══════════════════════════════════════════════════════════
// 编辑距离（Levenshtein）
// ═══════════════════════════════════════════════════════════

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // 使用滚动数组优化空间
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // 删除
        curr[j - 1] + 1,  // 插入
        prev[j - 1] + cost // 替换
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}
