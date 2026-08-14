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
  /** 归一化后的输入（用于语义级缓存命中） */
  normalizedInput: string;
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
const CACHE_VERSION = '1.1'; // 升级到 1.1 支持 normalizedInput
const MAX_ENTRIES = 200;
const FUZZY_THRESHOLD = 2; // 编辑距离阈值

/** 停用词表 */
const NORMALIZE_STOP_WORDS = new Set([
  '的', '与', '和', '及', '在', '中', '对', '为', '是', '有', '从', '到',
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'for', 'on', 'with', 'by',
  '请', '帮我', '给我', '一下', '一个', '这个', '那个',
]);

/** 将输入归一化为语义键（去停用词 + 排序） */
function normalizeInput(input: string): string {
  const tokens = input
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !NORMALIZE_STOP_WORDS.has(t))
    .sort();
  return tokens.slice(0, 6).join('|'); // 取前6个关键词，用 | 分隔
}

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
 * 查询缓存：精确 → 归一化语义 → 编辑距离模糊
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

  // 2. 归一化语义匹配（"分析一下登录" ≈ "分析登录功能"）
  const normalized = normalizeInput(input);
  if (normalized) {
    for (const entry of Object.values(cache.entries)) {
      if (entry.normalizedInput === normalized) {
        entry.hitCount++;
        entry.lastUsed = new Date().toISOString();
        await saveCache(cache);
        logger.info(`💾 意图缓存命中(语义): "${input.slice(0, 30)}..." ≈ "${entry.input.slice(0, 30)}..."`);
        return entry.result;
      }
    }
  }

  // 3. 模糊匹配（编辑距离 ≤ 2，且长度比例合理）
  // 防止短字符串误匹配：如"补充测试"匹配"补充分析"（编辑距离 2 但语义完全不同）
  for (const [cachedInput, entry] of Object.entries(cache.entries)) {
    const dist = levenshtein(input, cachedInput);
    const maxLen = Math.max(input.length, cachedInput.length);
    const minLen = Math.min(input.length, cachedInput.length);
    // 长度比例保护：编辑距离 ≤ 2 时，要求较短串长度 ≥ 6（避免 4 字中文短句误匹配）
    // 且编辑距离占较长串比例 ≤ 30%（避免长串被短串误匹配）
    if (dist <= FUZZY_THRESHOLD && minLen >= 6 && dist / maxLen <= 0.3) {
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
    normalizedInput: normalizeInput(input),
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
