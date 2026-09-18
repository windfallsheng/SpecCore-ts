/**
 * global-retrieval.ts — 全局层聚合检索入口（RAG + 知识图谱）
 *
 * 把「RAG 关键词检索」和「知识图谱实体匹配」结合起来，提供全局层文档的
 * 统一检索入口：
 *   1. 图谱匹配：用查询关键词在知识图谱中定位实体（title/semanticTags/businessRole）
 *   2. 邻居扩展：收集一阶关联实体，扩大上下文
 *   3. RAG 检索：在全局索引中检索相关 chunk
 *   4. 图谱加分重排：与图谱实体相关的 chunk 获得加分
 *
 * 复用 rag-engine.retrieveWithGraphContext（其 KGLiteGraph 与 KnowledgeGraph 结构兼容）。
 * 检索失败时降级为纯 RAG 检索（retrieveRelevantChunks），保证可用。
 *
 * v8.3.184+
 */

import { loadRagIndex, retrieveWithGraphContext, retrieveRelevantChunks, type DocumentChunk, type RagIndex } from './rag-engine';
import { loadKnowledgeGraph, type KnowledgeGraph } from './knowledge-graph';

export interface GlobalSearchOptions {
  /** 查询语句（需求关键词 / 实体名 / 模块名） */
  query: string;
  /** 最多返回几块，默认 5 */
  topK?: number;
  /** 按端过滤（如 ['backend','admin']） */
  platforms?: string[];
  /** 是否启用图谱加分，默认 true */
  graphBoost?: boolean;
  /** RAG 索引文件名，默认 rag-index-global.json */
  fileName?: string;
}

export interface GlobalSearchResult {
  query: string;
  chunks: DocumentChunk[];
  /** 匹配到的图谱实体标题（供追溯） */
  matchedEntities: string[];
  graphBoosted: boolean;
  totalFound: number;
}

export async function searchGlobalKnowledge(options: GlobalSearchOptions): Promise<GlobalSearchResult> {
  const { query, topK = 5, platforms, graphBoost = true, fileName = 'rag-index-global.json' } = options;
  const cwd = process.cwd();

  // 1. 加载全局 RAG 索引
  let index: RagIndex | null = null;
  try {
    index = await loadRagIndex(cwd, fileName);
  } catch { /* 索引不存在或损坏 */ }

  if (!index || index.chunks.length === 0) {
    return { query, chunks: [], matchedEntities: [], graphBoosted: false, totalFound: 0 };
  }

  // 2. 加载知识图谱（可选）
  let graph: KnowledgeGraph | null = null;
  if (graphBoost) {
    try {
      graph = await loadKnowledgeGraph(cwd);
    } catch { /* 图谱不存在或损坏 */ }
  }

  // 3. 检索（图谱加分优先，降级纯 RAG）
  const retrOpts = { query, topK, platforms } as const;
  let chunks: DocumentChunk[];
  let matchedEntities: string[] = [];

  if (graph && graph.entities && Object.keys(graph.entities).length > 0) {
    matchedEntities = matchEntities(query, graph);
    // retrieveWithGraphContext 期望 KGLiteGraph（结构兼容 KnowledgeGraph），类型断言
    chunks = retrieveWithGraphContext(index, graph as unknown as Parameters<typeof retrieveWithGraphContext>[1], retrOpts as Parameters<typeof retrieveWithGraphContext>[2]);
  } else {
    chunks = retrieveRelevantChunks(index, retrOpts as Parameters<typeof retrieveRelevantChunks>[1]);
  }

  return {
    query,
    chunks,
    matchedEntities,
    graphBoosted: !!(graph && Object.keys(graph.entities).length > 0),
    totalFound: chunks.length,
  };
}

/** 用查询关键词匹配图谱实体（返回实体标题） */
function matchEntities(query: string, graph: KnowledgeGraph): string[] {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return [];

  const matched: { title: string; score: number }[] = [];
  for (const entity of Object.values(graph.entities)) {
    const haystack = `${entity.title} ${entity.semanticTags?.join(' ') || ''} ${entity.businessRole || ''} ${entity.description || ''}`.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      const lk = kw.toLowerCase();
      if (entity.title.toLowerCase().includes(lk)) score += 3;
      else if (entity.semanticTags?.some((t: string) => t.toLowerCase().includes(lk))) score += 2;
      else if (haystack.includes(lk)) score += 1;
    }
    if (score > 0) matched.push({ title: entity.title, score });
  }
  return matched.sort((a, b) => b.score - a.score).slice(0, 10).map(m => m.title);
}

/** 简单关键词提取（英文分词 + 中文 2 字窗口） */
function extractKeywords(text: string): string[] {
  const result = new Set<string>();
  const cleaned = text.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, ' ').trim();
  for (const p of cleaned.split(/\s+/)) {
    if (p.length >= 2) result.add(p);
  }
  // 中文无空格时做 2 字滑动窗口
  const chinese = text.replace(/[^\u4e00-\u9fa5]+/g, '');
  if (chinese.length >= 2 && !/\s/.test(text)) {
    for (let i = 0; i < chinese.length - 1; i++) result.add(chinese.slice(i, i + 2));
  }
  return [...result];
}
