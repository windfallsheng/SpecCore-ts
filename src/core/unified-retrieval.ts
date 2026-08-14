/**
 * Unified Retrieval Layer — 统一检索层
 *
 * 整合三个检索源：
 *   1. 文档 RAG     (rag-engine.ts)     → Markdown 分块
 *   2. 代码切片     (本文件)             → 按 export 分块
 *   3. 知识图谱     (knowledge-graph.ts) → 实体关系链
 *
 * 设计目标：一次查询，返回最相关的混合上下文，AI 不需要知道数据来源
 */

import { readFile, pathExists } from 'fs-extra';
import { basename } from 'path';
import { logger } from '../utils/logger';
import {
  loadRagIndex, checkRagIndexFreshness, refreshRagIndex,
  retrieveRelevantChunks, assembleChunksForPrompt, DocumentChunk,
} from './rag-engine';
import { loadFullIndex, CodeIndex, CodeFile, findRelevantCode } from './code-scanner';
import { loadKnowledgeGraph, KnowledgeGraph } from './knowledge-graph';
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

      // 向前找 JSDoc / 注释
      let commentStart = i - 1;
      const comments: string[] = [];
      while (commentStart >= 0) {
        const cl = lines[commentStart].trim();
        if (cl.startsWith('/**') || cl.startsWith('*') || cl.startsWith('//') || cl.startsWith('*')) {
          comments.unshift(cl);
          commentStart--;
          if (cl.startsWith('/**')) break;
        } else if (cl === '') {
          commentStart--;
        } else {
          break;
        }
      }

      // 向后找代码体（到下一个 export 或文件结束，最多 50 行）
      let j = i + 1;
      const bodyLines: string[] = [];
      let braceDepth = 0;
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
        for (const ch of bl) {
          if (inString) {
            if (ch === stringChar && bl[bl.indexOf(ch) - 1] !== '\\') {
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

function scoreCodeSlices(slices: CodeSlice[], query: string): CodeSlice[] {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  if (queryWords.length === 0) return slices.slice(0, 10);

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
  const { query: queryStr, iteration, taskId, platform, taskDir, sourceScope } = query;

  // ── 3.1 文档 RAG 检索 ──
  let documentChunks: DocumentChunk[] = [];
  let docStats = 0;
  try {
    // 检查索引新鲜度，过期则自动刷新
    const { fresh: ragFresh, staleFiles } = await checkRagIndexFreshness(cwd);
    if (!ragFresh && taskDir && staleFiles.length > 0) {
      logger?.info?.(`   🔄 RAG 索引过期 (${staleFiles.length} 个文件)，自动增量刷新...`);
      await refreshRagIndex(cwd, taskDir, iteration, platform);
    }

    const ragIndex = await loadRagIndex(cwd);
    if (ragIndex) {
      const chunks = retrieveRelevantChunks(ragIndex, {
        query: queryStr,
        topK: 5,
        minScore: 0.3,
        maxChunkChars: 1500,
        maxTotalChars: 5000,
      });
      documentChunks = chunks;
      docStats = chunks.length;
    }
  } catch (e) {
    logger?.debug?.('RAG 检索失败:', e);
  }

  // ── 3.2 代码切片检索 ──
  let codeSlices: CodeSlice[] = [];
  let codeStats = 0;
  try {
    // 先用 findRelevantCode 找到相关文件（复用现有能力）
    const codeMatches = await findRelevantCode(queryStr, 8, sourceScope, iteration, taskId);

    // 对相关文件做切片
    const allSlices: CodeSlice[] = [];
    for (const match of codeMatches.slice(0, 5)) { // 最多切 5 个文件
      const fp = match.file;
      if (await pathExists(fp)) {
        const content = await readFile(fp, 'utf-8');
        const slices = sliceCodeFile(content, fp);
        allSlices.push(...slices);
      }
    }

    // 评分排序
    const scored = scoreCodeSlices(allSlices, queryStr);
    codeSlices = scored.slice(0, 8); // 最多取 8 个切片
    codeStats = codeSlices.length;
  } catch (e) {
    logger?.debug?.('代码切片检索失败:', e);
  }

  // ── 3.3 知识图谱上下文 ──
  let graphContext: string | undefined;
  try {
    const graph = await loadKnowledgeGraph(cwd);
    if (graph && taskId) {
      graphContext = buildCompactContext(graph, { taskId, platform });
    }
  } catch (e) {
    logger?.debug?.('知识图谱加载失败:', e);
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
  options?: { maxTotalChars?: number },
): { name: string; path: string; content: string }[] {
  const maxTotal = options?.maxTotalChars ?? 8000;
  const output: { name: string; path: string; content: string }[] = [];
  let totalChars = 0;

  // 先放文档块
  for (const chunk of result.documentChunks) {
    const text = `### ${chunk.title}（${chunk.fileName}）\n\n${chunk.content}`;
    if (totalChars + text.length > maxTotal * 0.6 && output.length > 0) break; // 文档占 60%
    output.push({ name: `📄 ${chunk.fileName} › ${chunk.title}`, path: chunk.filePath, content: text });
    totalChars += text.length;
  }

  // 再放代码切片
  for (const slice of result.codeSlices) {
    const commentBlock = slice.comments ? `${slice.comments}\n` : '';
    const body = slice.body.length > 600 ? slice.body.slice(0, 600) + '\n// ... (截断)' : slice.body;
    const text = `### ${slice.name} (${slice.type}) — ${slice.fileName}:L${slice.lineStart}\n\n\`\`\`typescript\n${commentBlock}${slice.signature}\n${body}\n\`\`\``;

    if (totalChars + text.length > maxTotal && output.length > 0) break;
    output.push({ name: `💻 ${slice.fileName} › ${slice.name}`, path: slice.filePath, content: text });
    totalChars += text.length;
  }

  return output;
}

/**
 * 将统一检索结果序列化为文本（直接注入 Prompt）
 */
export function formatUnifiedContext(result: UnifiedResult): string {
  const lines: string[] = [];

  if (result.documentChunks.length > 0) {
    lines.push('## 相关文档');
    for (const chunk of result.documentChunks) {
      lines.push(`\n### ${chunk.title}（${chunk.fileName}）`);
      lines.push(chunk.content);
    }
  }

  if (result.codeSlices.length > 0) {
    lines.push('\n## 相关代码');
    for (const slice of result.codeSlices) {
      lines.push(`\n### ${slice.name} (${slice.type}) — ${slice.fileName}:${slice.lineStart}`);
      if (slice.comments) lines.push(slice.comments);
      lines.push('```typescript');
      lines.push(slice.signature);
      const body = slice.body.length > 600 ? slice.body.slice(0, 600) + '\n// ... (截断)' : slice.body;
      lines.push(body);
      lines.push('```');
    }
  }

  if (result.graphContext) {
    lines.push('\n## 知识图谱关联');
    lines.push(result.graphContext);
  }

  lines.push(`\n---\n*检索统计: ${result.stats.docChunksFound} 文档块 + ${result.stats.codeSlicesFound} 代码切片 | 估算 ${result.stats.totalTokensEstimate} tokens*`);

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
