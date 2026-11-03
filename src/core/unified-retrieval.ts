/**
 * Unified Retrieval Layer — 统一检索层
 *
 * 整合三个检索源：
 *   1. 文档 RAG     (rag-engine.ts)     → Markdown 分块
 *   2. 代码切片     (本文件)             → 按 export 分块
 *   3. 知识图谱     (knowledge-graph.ts) → 实体关系链
 *
 * 设计目标：一次查询，返回最相关的混合上下文，AI 不需要知道数据来源
 *
 * ── 与相邻机制的边界（v8.3.366 文档化，详见 docs/knowledge-assets-architecture.md）──
 * - 关键词提取唯一真源：code-scanner.extractKeywords（SEMANTIC_MAP + utils/synonyms 中英映射），
 *   rag-engine 直接复用，不得再维护独立词表。
 * - 代码检索唯一入口：code-scanner.findRelevantCode（KG 实体/语义标签/@spec 注释/符号索引多路融合），
 *   本层的 3.2 节先调用它定位文件，再对命中文件做切片评分（切片是 findRelevantCode 的细粒度补充）。
 * - 图谱双轨分工：knowledge-graph（spec 文档图，任务/文档/实体关系）与 code-graph（AST 源码图，
 *   符号/依赖关系）互不替代；本层 graphContext 用前者，插件摘要用后者。
 */

import { readFile, pathExists } from 'fs-extra';
import { basename } from 'path';
import { logger } from '../utils/logger';
import {
  loadRagIndex, checkRagIndexFreshness, refreshRagIndex,
  retrieveRelevantChunks, retrieveWithGraphContext, assembleChunksForPrompt, DocumentChunk,
} from './rag-engine';
import { loadFullIndex, CodeIndex, CodeFile, findRelevantCode } from './code-scanner';
import { loadFreshKnowledgeGraph, loadKnowledgeGraph, KnowledgeGraph } from './knowledge-graph';
import { buildCompactContext } from './context-builder';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface CodeSlice {
  id: string;
  filePath: string;
  fileName: string;
  type: 'function' | 'class' | 'interface' | 'variable' | 'type' | 'enum';
  name: string;
  /** JSDoc/注释 */
  comments: string;
  /** 函数签名 / 类定义头 / 接口定义 */
  signature: string;
  /** 前 N 行实现 */
  body: string;
  /** 提取的关键词 */
  keywords: string[];
  /** 行号范围 */
  lineStart: number;
  lineEnd: number;
  /** 相关性分数 */
  relevanceScore?: number;
}

export interface UnifiedQuery {
  /** 查询语句（task名称/需求关键词） */
  query: string;
  /** 迭代名称 */
  iteration?: string;
  /** 任务ID */
  taskId?: string;
  /** 平台 */
  platform?: string;
  /** 任务目录 */
  taskDir?: string;
  /** 源码范围 */
  sourceScope?: string;
  /** 按端过滤（backend/web/h5/admin/...） */
  platforms?: string[];
}

export interface UnifiedResult {
  /** 文档检索结果 */
  documentChunks: DocumentChunk[];
  /** 代码切片结果 */
  codeSlices: CodeSlice[];
  /** 知识图谱上下文 */
  graphContext?: string;
  /** 统计信息 */
  stats: {
    docChunksFound: number;
    codeSlicesFound: number;
    totalTokensEstimate: number;
  };
}

// ═══════════════════════════════════════════════════════════
// 1. 代码切片（按 export 分块）
// ═══════════════════════════════════════════════════════════

/**
 * 将源代码按 export 语句切分为多个块
 * 支持：export function / class / interface / type / enum / const / let / var
 *
 * 不需要 AST 解析，用正则做轻量级分片：
 * - 匹配 export 语句头
 * - 向后扫描到下一个 export 或文件结束
 * - 提取 JSDoc 注释
 */
export function sliceCodeFile(content: string, filePath: string): CodeSlice[] {
  const lines = content.split('\n');
  const slices: CodeSlice[] = [];
  let i = 0;

  // export 语句正则（支持 async、default、type 等修饰）
  const exportPattern = /^export\s+(?:(?:default\s+)?(?:async\s+)?)?(?:function\s+(\w+)|class\s+(\w+)|interface\s+(\w+)|type\s+(\w+)|enum\s+(\w+)|(?:const|let|var)\s+(\w+))/;

  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(exportPattern);

    if (match) {
      const name = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
      const type = match[1] ? 'function' : match[2] ? 'class' : match[3] ? 'interface' : match[4] ? 'type' : match[5] ? 'enum' : 'variable';
      const lineStart = i + 1;

      // 向前找 JSDoc / 注释（支持前导空格，如 ' * @param'）
      let commentStart = i - 1;
      const comments: string[] = [];
      while (commentStart >= 0) {
        const cl = lines[commentStart];
        const trimmed = cl.trimStart();
        if (trimmed.startsWith('/**') || trimmed.startsWith('*') || trimmed.startsWith('//')) {
          comments.unshift(cl);
          commentStart--;
          if (trimmed.startsWith('/**')) break;
        } else if (cl.trim() === '') {
          commentStart--;
        } else {
          break;
        }
      }

      // 向后找代码体（到下一个 export 或文件结束，最多 50 行）
      let j = i + 1;
      const bodyLines: string[] = [];
      let braceDepth = 0;
      // v8.3.365: 签名行的括号也计入深度——函数/类声明的 `{` 使 body 起点深度为 1，
      // 此前从 0 起计，导致第一个空行或首个闭合块就误判「函数结束」，切片只剩函数头几行
      // （连带影响 RAG 代码切片质量与源码反推的业务切片素材）
      for (let ci = 0; ci < line.length; ci++) {
        const ch = line[ci];
        if (ch === '{' || ch === '(' || ch === '[') braceDepth++;
        else if (ch === '}' || ch === ')' || ch === ']') braceDepth--;
      }
      let inString = false;
      let stringChar = '';

      while (j < lines.length && bodyLines.length < 50) {
        const bl = lines[j];
        const trimmed = bl.trim();

        // 遇到下一个 export（且不在嵌套中），停止
        if (braceDepth === 0 && !inString && exportPattern.test(bl)) {
          break;
        }

        // 简单括号计数（不完美但够用）
        for (let ci = 0; ci < bl.length; ci++) {
          const ch = bl[ci];
          if (inString) {
            if (ch === stringChar && bl[ci - 1] !== '\\') {
              inString = false;
            }
          } else if (ch === '"' || ch === "'" || ch === '`') {
            inString = true;
            stringChar = ch;
          } else if (ch === '{' || ch === '(' || ch === '[') {
            braceDepth++;
          } else if (ch === '}' || ch === ')' || ch === ']') {
            braceDepth--;
          }
        }

        bodyLines.push(bl);
        j++;

        // 类/函数结束（braceDepth 回到 0 且已有内容）
        if (braceDepth <= 0 && bodyLines.length > 1 && (type === 'function' || type === 'class')) {
          break;
        }
      }

      const signature = line.trim();
      const body = bodyLines.join('\n');
      const commentsStr = comments.join('\n');

      slices.push({
        id: `${filePath}::${name}`,
        filePath,
        fileName: basename(filePath),
        type,
        name,
        comments: commentsStr,
        signature,
        body,
        keywords: extractCodeKeywords(name + ' ' + signature + ' ' + commentsStr),
        lineStart,
        lineEnd: j,
      });

      i = j;
    } else {
      i++;
    }
  }

  return slices;
}

/** 从代码中提取关键词 */
function extractCodeKeywords(text: string): string[] {
  const keywords: string[] = [];
  // CamelCase / PascalCase 拆分
  const identifiers = text.match(/\b[a-zA-Z][a-zA-Z0-9]*\b/g) || [];
  for (const id of identifiers) {
    if (id.length >= 3) {
      keywords.push(id);
      // 拆分 CamelCase
      const parts = id.split(/(?=[A-Z])/);
      for (const p of parts) {
        if (p.length >= 3) keywords.push(p.toLowerCase());
      }
    }
  }
  return [...new Set(keywords)].slice(0, 10);
}

// ═══════════════════════════════════════════════════════════
// 2. 代码切片相关性评分
// ═══════════════════════════════════════════════════════════

function scoreCodeSlices(slices: CodeSlice[], query: string, kgTags?: string[]): CodeSlice[] {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  if (queryWords.length === 0) return slices.slice(0, 10);

  const tagSet = new Set((kgTags || []).map(t => t.toLowerCase()));

  return slices
    .map(slice => {
      let score = 0;
      const text = `${slice.name} ${slice.signature} ${slice.comments} ${slice.keywords.join(' ')}`.toLowerCase();

      for (const qw of queryWords) {
        if (slice.name.toLowerCase().includes(qw)) score += 5;
        if (text.includes(qw)) score += 1;
      }

      // 文件路径匹配
      for (const qw of queryWords) {
        if (slice.filePath.toLowerCase().includes(qw)) score += 1;
      }

      // v8.3.123+: 知识图谱语义标签匹配（高权重）
      if (tagSet.size > 0) {
        for (const tag of tagSet) {
          if (slice.name.toLowerCase().includes(tag)) score += 8;
          if (text.includes(tag)) score += 3;
          if (slice.comments.toLowerCase().includes(tag)) score += 5;
        }
      }

      return { ...slice, relevanceScore: Math.min(score / 5, 1) };
    })
    .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
}

// ═══════════════════════════════════════════════════════════
// 3. 统一检索主入口
// ═══════════════════════════════════════════════════════════

/**
 * 统一检索：同时查询文档 RAG、代码索引、知识图谱
 * 返回按相关性排序的混合上下文
 */
export async function unifiedSearch(
  cwd: string,
  query: UnifiedQuery,
): Promise<UnifiedResult> {
  const { query: queryStr, iteration, taskId, platform, taskDir, sourceScope, platforms } = query;

  // ── 3.1 文档 RAG 检索 ──
  let documentChunks: DocumentChunk[] = [];
  let docStats = 0;
  try {
    // 根据查询参数确定要加载的索引文件（避免 scope 间互相覆盖）
    const indexFiles: string[] = [];
    if (taskId && iteration) {
      // task 查询：优先加载 task 级索引，同时加载 iteration 级作为补充
      indexFiles.push('rag-index.json');                    // task 级
      indexFiles.push(`rag-index-${iteration}.json`);       // iteration 级
    } else if (iteration) {
      // iteration 查询：加载 iteration 级 + 全局级
      indexFiles.push(`rag-index-${iteration}.json`);
      indexFiles.push('rag-index-global.json');
    } else {
      // 全局查询：加载全局级
      indexFiles.push('rag-index-global.json');
    }
    // v8.3.123+: 追加知识图谱 RAG 索引（实体关系文档化）
    indexFiles.push('kg-rag-index.json');

    // 逐个加载索引，合并结果
    // v8.3.184+: 全局索引用知识图谱加分检索（图谱实体匹配 → 邻居扩展 → RAG → 加分重排）
    const allChunks: DocumentChunk[] = [];
    let globalGraph: KnowledgeGraph | null = null;
    for (const fileName of indexFiles) {
      const ragIndex = await loadRagIndex(cwd, fileName);
      if (ragIndex) {
        const isGlobalIndex = fileName === 'rag-index-global.json';
        let chunks: DocumentChunk[];
        if (isGlobalIndex) {
          // 全局索引：加载图谱并启用图谱加分（图谱缺失时降级纯 RAG）
          if (!globalGraph) {
            try { globalGraph = await loadKnowledgeGraph(cwd); } catch { /* 图谱缺失 */ }
          }
          if (globalGraph && Object.keys(globalGraph.entities).length > 0) {
            chunks = retrieveWithGraphContext(
              ragIndex,
              globalGraph as unknown as Parameters<typeof retrieveWithGraphContext>[1],
              {
                query: queryStr, topK: 8, minScore: 0.15,
                maxChunkChars: 1500, maxTotalChars: 8000,
                platforms: platforms || (platform ? [platform] : undefined),
              } as Parameters<typeof retrieveWithGraphContext>[2],
            );
          } else {
            chunks = retrieveRelevantChunks(ragIndex, {
              query: queryStr, topK: 8, minScore: 0.15,
              maxChunkChars: 1500, maxTotalChars: 8000,
              platforms: platforms || (platform ? [platform] : undefined),
            });
          }
        } else {
          chunks = retrieveRelevantChunks(ragIndex, {
            query: queryStr, topK: 8, minScore: 0.15,
            maxChunkChars: 1500, maxTotalChars: 8000,
            platforms: platforms || (platform ? [platform] : undefined),
          });
        }
        allChunks.push(...chunks);
      }
    }

    // 去重（按 id）并限制数量
    const seen = new Set<string>();
    documentChunks = allChunks.filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    }).slice(0, 12);
    docStats = documentChunks.length;
  } catch (e) {
    logger?.debug?.('RAG 检索失败:', e);
  }

  // ── 3.2 代码切片检索 ──
  let codeSlices: CodeSlice[] = [];
  let codeStats = 0;

  // v8.3.123+: 提前加载知识图谱，提取语义标签供代码切片评分使用
  let kgTags: string[] = [];
  let graphContext: string | undefined;
  try {
    const graph = await loadFreshKnowledgeGraph(cwd, iteration);
    if (graph) {
      graphContext = buildCompactContext(graph, { taskId, platform });
      // 提取与查询相关的 source-file 语义标签
      const queryWords = queryStr.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
      const tagSet = new Set<string>();
      for (const entity of Object.values(graph.entities)) {
        if (entity.type !== 'source-file') continue;
        const entityText = `${entity.title} ${entity.description || ''} ${entity.businessRole || ''} ${entity.semanticTags?.join(' ') || ''}`.toLowerCase();
        const isRelevant = queryWords.some(qw => entityText.includes(qw));
        if (isRelevant && entity.semanticTags) {
          for (const tag of entity.semanticTags) tagSet.add(tag);
        }
      }
      kgTags = [...tagSet];
    }
  } catch { /* 知识图谱加载失败不阻断 */ }

  try {
    // 先用 findRelevantCode 找到相关文件（复用现有能力）
    const codeMatches = await findRelevantCode(queryStr, 12, sourceScope, iteration, taskId);

    // 对相关文件做切片
    const allSlices: CodeSlice[] = [];
    for (const match of codeMatches.slice(0, 8)) { // 最多切 8 个文件
      const fp = match.file;
      if (await pathExists(fp)) {
        const content = await readFile(fp, 'utf-8');
        const slices = sliceCodeFile(content, fp);
        allSlices.push(...slices);
      }
    }

    // 评分排序（注入知识图谱语义标签）
    const scored = scoreCodeSlices(allSlices, queryStr, kgTags);
    codeSlices = scored.slice(0, 8); // 最多取 8 个切片
    codeStats = codeSlices.length;
  } catch (e) {
    logger?.debug?.('代码切片检索失败:', e);
  }

  // ── 3.4 统计 ──
  const totalTokensEstimate = estimateTokens(documentChunks, codeSlices, graphContext);

  return {
    documentChunks,
    codeSlices,
    graphContext,
    stats: {
      docChunksFound: docStats,
      codeSlicesFound: codeStats,
      totalTokensEstimate,
    },
  };
}

// ═══════════════════════════════════════════════════════════
// 4. 统一组装（输出给 Prompt）
// ═══════════════════════════════════════════════════════════

/**
 * 将统一检索结果组装为 Prompt 可用的格式
 * 输出结构与 extraSpecs 兼容
 */
export function assembleUnifiedContext(
  result: UnifiedResult,
  options?: { maxTotalChars?: number; generous?: boolean },
): { name: string; path: string; content: string }[] {
  const maxTotal = options?.maxTotalChars ?? 8000;
  const generous = options?.generous ?? false;
  const output: { name: string; path: string; content: string }[] = [];
  let totalChars = 0;

  // 先放文档块
  for (const chunk of result.documentChunks) {
    const text = `### ${chunk.title}（${chunk.fileName}）\n\n${chunk.content}`;
    // generous 模式下不限制文档占比
    if (!generous && totalChars + text.length > maxTotal * 0.6 && output.length > 0) break;
    if (totalChars + text.length > maxTotal && output.length > 0) break;
    output.push({ name: `📄 ${chunk.fileName} › ${chunk.title}`, path: chunk.filePath, content: text });
    totalChars += text.length;
  }

  // 再放代码切片（generous 模式下截断阈值从 600 提升到 1500）
  const codeTruncate = generous ? 1500 : 600;
  for (const slice of result.codeSlices) {
    const commentBlock = slice.comments ? `${slice.comments}\n` : '';
    const body = slice.body.length > codeTruncate ? slice.body.slice(0, codeTruncate) + '\n// ... (截断)' : slice.body;
    const text = `### ${slice.name} (${slice.type}) — ${slice.fileName}:L${slice.lineStart}\n\n\`\`\`typescript\n${commentBlock}${slice.signature}\n${body}\n\`\`\``;

    if (totalChars + text.length > maxTotal && output.length > 0) break;
    output.push({ name: `💻 ${slice.fileName} › ${slice.name}`, path: slice.filePath, content: text });
    totalChars += text.length;
  }

  return output;
}

/**
 * 将统一检索结果序列化为文本（直接注入 Prompt）
 * v8.3.160+: 支持 maxChars 限制，防止大项目时 Prompt 溢出
 */
export function formatUnifiedContext(result: UnifiedResult, maxChars?: number): string {
  const lines: string[] = [];
  let totalChars = 0;
  const limit = maxChars || Infinity;

  const push = (text: string) => {
    if (totalChars + text.length > limit && lines.length > 0) return false;
    lines.push(text);
    totalChars += text.length;
    return true;
  };

  if (result.documentChunks.length > 0) {
    push('## 相关文档');
    for (const chunk of result.documentChunks) {
      if (!push(`\n### ${chunk.title}（${chunk.fileName}）`)) break;
      if (!push(chunk.content)) break;
    }
  }

  if (result.codeSlices.length > 0) {
    push('\n## 相关代码');
    for (const slice of result.codeSlices) {
      const header = `\n### ${slice.name} (${slice.type}) — ${slice.fileName}:${slice.lineStart}`;
      if (!push(header)) break;
      if (slice.comments && !push(slice.comments)) break;
      if (!push('```typescript')) break;
      if (!push(slice.signature)) break;
      const body = slice.body.length > 600 ? slice.body.slice(0, 600) + '\n// ... (截断)' : slice.body;
      if (!push(body)) break;
      if (!push('```')) break;
    }
  }

  if (result.graphContext) {
    push('\n## 知识图谱关联');
    const truncated = result.graphContext.length > 2000 ? result.graphContext.slice(0, 2000) + '\n... (截断)' : result.graphContext;
    push(truncated);
  }

  push(`\n---\n*检索统计: ${result.stats.docChunksFound} 文档块 + ${result.stats.codeSlicesFound} 代码切片 | 估算 ${result.stats.totalTokensEstimate} tokens*`);

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════
// 5. Token 估算
// ═══════════════════════════════════════════════════════════

function estimateTokens(
  docChunks: DocumentChunk[],
  codeSlices: CodeSlice[],
  graphContext?: string,
): number {
  let chars = 0;
  for (const c of docChunks) chars += c.content.length;
  for (const s of codeSlices) chars += s.signature.length + s.body.length + s.comments.length;
  if (graphContext) chars += graphContext.length;
  // 中文 ≈ 1.5 tokens/字，英文 ≈ 0.25 tokens/字符
  return Math.ceil(chars * 0.8);
}

// ═══════════════════════════════════════════════════════════
// 6. AI 两步检索闭环（目录摘要 → AI 判断 → CLI 精确读取）
// ═══════════════════════════════════════════════════════════

/**
 * 目录条目（轻量级，用于 AI 判断）
 */
export interface CatalogEntry {
  /** chunk ID */
  id: string;
  /** 块标题 */
  title: string;
  /** 源文件名 */
  fileName: string;
  /** 标题级别 */
  level: number;
  /** 自动摘要（≤100字） */
  summary: string;
  /** 关键词 */
  keywords: string[];
  /** 字数 */
  charCount: number;
  /** 起始行号 */
  startLine?: number;
  /** 结束行号 */
  endLine?: number;
}

/**
 * 构建轻量级目录摘要（给 AI 看的“地图”）
 *
 * 设计目标：
 *   - 只包含 ID + 标题 + 摘要 + 关键词，不包含完整内容
 *   - 总大小控制在 ~2000 字以内
 *   - AI 看完后返回候选 ID 列表，CLI 用这些 ID 做精确读取
 *
 * 用法：
 *   const catalog = await buildDirectoryCatalog(cwd, iteration);
 *   // 注入 Prompt 让 AI 判断
 *   const prompt = `以下是可用的文档块目录：\n${catalog}\n\n请根据用户需求返回最相关的 chunk ID 列表（JSON 数组）`;
 */
export async function buildDirectoryCatalog(
  cwd: string,
  iteration?: string,
  options?: { maxEntries?: number; maxSummaryChars?: number },
): Promise<string> {
  const maxEntries = options?.maxEntries ?? 50;
  const maxSummaryChars = options?.maxSummaryChars ?? 100;

  // 加载所有相关索引
  const indexFiles: string[] = [];
  if (iteration) {
    indexFiles.push(`rag-index-${iteration}.json`);
    indexFiles.push('rag-index-global.json');
  } else {
    indexFiles.push('rag-index-global.json');
  }

  const entries: CatalogEntry[] = [];
  for (const fileName of indexFiles) {
    const index = await loadRagIndex(cwd, fileName);
    if (!index) continue;

    for (const chunk of index.chunks) {
      entries.push({
        id: chunk.id,
        title: chunk.title,
        fileName: chunk.fileName,
        level: chunk.level,
        summary: chunk.summary.slice(0, maxSummaryChars),
        keywords: chunk.keywords.slice(0, 5),
        charCount: chunk.charCount,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
      });
    }
  }

  // 去重（按 id）
  const seen = new Set<string>();
  const unique = entries.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  // 按级别排序（## 优先）并限制数量
  const sorted = unique
    .sort((a, b) => a.level - b.level || b.charCount - a.charCount)
    .slice(0, maxEntries);

  // 格式化为轻量级文本
  const lines: string[] = [
    `📚 文档目录（共 ${sorted.length} 个块，总计 ${unique.reduce((s, e) => s + e.charCount, 0)} 字）`,
    '',
  ];

  for (const entry of sorted) {
    const indent = '  '.repeat(entry.level - 2);
    const lineRange = entry.startLine && entry.endLine
      ? ` L${entry.startLine}-${entry.endLine}`
      : '';
    lines.push(
      `${indent}[${entry.id}] ${entry.fileName} › ${entry.title}${lineRange} (${entry.charCount}字)`,
    );
    if (entry.summary) {
      lines.push(`${indent}  ↳ ${entry.summary}`);
    }
  }

  return lines.join('\n');
}

/**
 * 根据 AI 返回的候选 ID 列表，精确读取对应 chunk 内容
 *
 * 用法：
 *   const candidateIds = ['a1b2c3d4e5f6', 'f6e5d4c3b2a1'];
 *   const chunks = await fetchChunksByIds(cwd, candidateIds, iteration);
 */
export async function fetchChunksByIds(
  cwd: string,
  ids: string[],
  iteration?: string,
): Promise<DocumentChunk[]> {
  const indexFiles: string[] = [];
  if (iteration) {
    indexFiles.push(`rag-index-${iteration}.json`);
    indexFiles.push('rag-index-global.json');
  } else {
    indexFiles.push('rag-index-global.json');
  }

  const idSet = new Set(ids);
  const result: DocumentChunk[] = [];

  for (const fileName of indexFiles) {
    const index = await loadRagIndex(cwd, fileName);
    if (!index) continue;

    for (const chunk of index.chunks) {
      if (idSet.has(chunk.id)) {
        result.push(chunk);
        idSet.delete(chunk.id);
        if (idSet.size === 0) break;
      }
    }
  }

  return result;
}
