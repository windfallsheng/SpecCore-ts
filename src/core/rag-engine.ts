/**
 * RAG Engine — 轻量级检索增强生成
 *
 * 设计目标：不引入向量数据库，用规则分块 + 关键词匹配实现文档检索
 * 适用场景：SpecCore CLI 在构建 Prompt 时，从长文档中提取最相关的片段
 *
 * 流程：
 *   分析阶段: 读取文档 → 按标题分块 → 提取摘要/关键词 → 存入 rag-index.json
 *   执行阶段: 根据 task/需求关键词 → 检索相关块 → 按分数排序 → 组装进 Prompt
 */

import { readFile, pathExists, writeFile, ensureDir, stat, readdir } from 'fs-extra';
import { join, basename } from 'path';
import { createHash } from 'crypto';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface DocumentChunk {
  /** 唯一标识: hash(文件路径 + 标题) */
  id: string;
  /** 源文件路径 */
  filePath: string;
  /** 源文件名称 */
  fileName: string;
  /** 块标题 */
  title: string;
  /** 标题级别 (2=##, 3=###, 4=####) */
  level: number;
  /** 块原始内容 */
  content: string;
  /** 自动提取的摘要 */
  summary: string;
  /** 关键词标签 */
  keywords: string[];
  /** 字数 */
  charCount: number;
  /** 相关性分数（检索时动态计算） */
  relevanceScore?: number;
}

export interface RagIndex {
  version: string;
  updatedAt: string;
  /** 索引来源的迭代/任务标识 */
  scope: string;
  /** 所有分块 */
  chunks: DocumentChunk[];
  /** 文件摘要映射: filePath → 文件级摘要 */
  fileSummaries: Record<string, string>;
  /** 源文件修改时间: filePath → mtimeMs */
  fileMtimes: Record<string, number>;
}

export interface RetrievalOptions {
  /** 查询语句（task名称/需求关键词） */
  query: string;
  /** 最多返回几块 */
  topK?: number;
  /** 相关性分数阈值（0~1） */
  minScore?: number;
  /** 单块字数上限 */
  maxChunkChars?: number;
  /** 总字数上限 */
  maxTotalChars?: number;
}

// ═══════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════

const RAG_INDEX_PATH = join('.speccore', 'cache', 'rag-index.json');
const RAG_VERSION = '1.0';

/** 停用词 */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use',
  '功能', '实现', '需要', '进行', '根据', '通过', '可以', '如下', '包括', '相关', '对应', '采用', '基于', '完成', '确保', '提供', '支持', '包含', '用于', '其中', '以下', '上述', '所示', '为例',
]);

/** 语义映射（轻量版，可扩展） */
const SEMANTIC_MAP: Record<string, string[]> = {
  login: ['auth', 'session', 'token', 'signin', 'authenticate'],
  auth: ['login', 'session', 'token', 'permission', 'authenticate'],
  permission: ['rbac', 'acl', 'role', 'authorize', 'access'],
  rbac: ['permission', 'role', 'access', 'authorize'],
  user: ['account', 'member', 'profile', 'person'],
  order: ['purchase', 'transaction', 'payment', 'buy'],
  payment: ['pay', 'order', 'transaction', 'checkout', 'alipay', 'wechat'],
  登录: ['认证', '鉴权', '会话', 'token', '密码'],
  权限: ['RBAC', '角色', '访问控制', '授权'],
  订单: ['购买', '交易', '支付', '下单'],
  支付: ['付款', '订单', '交易', '收银台'],
};

// ═══════════════════════════════════════════════════════════
// 1. 文档分块（按 Markdown 标题）
// ═══════════════════════════════════════════════════════════

/**
 * 按 Markdown 标题层级分块
 * 规则：## / ### / #### 作为分块边界，一级标题 # 作为文档开头（不切分）
 */
export function chunkByHeaders(content: string, filePath: string): DocumentChunk[] {
  const lines = content.split('\n');
  const chunks: DocumentChunk[] = [];
  let current: { title: string; level: number; lines: string[] } | null = null;
  const fileName = basename(filePath);

  // 文档开头（# 标题之前的内容）作为第一个隐式块
  let preambleLines: string[] = [];
  let foundFirstHeader = false;

  for (const line of lines) {
    const match = line.match(/^(#{2,4})\s+(.+)$/);
    if (match) {
      foundFirstHeader = true;
      // 保存上一个块
      if (current) {
        chunks.push(finalizeChunk(current, filePath, fileName));
      } else if (preambleLines.length > 0) {
        // 保存序言块
        const preamble = preambleLines.join('\n').trim();
        if (preamble.length > 20) {
          chunks.push(createChunk(filePath, fileName, '文档概述', 1, preamble));
        }
      }
      // 开始新块
      current = { title: match[2].trim(), level: match[1].length, lines: [] };
    } else {
      if (!foundFirstHeader) {
        preambleLines.push(line);
      } else if (current) {
        current.lines.push(line);
      }
    }
  }

  // 保存最后一个块
  if (current) {
    chunks.push(finalizeChunk(current, filePath, fileName));
  }

  return chunks;
}

function finalizeChunk(
  current: { title: string; level: number; lines: string[] },
  filePath: string,
  fileName: string,
): DocumentChunk {
  const content = current.lines.join('\n').trim();
  const summary = extractSummary(content);
  const keywords = extractKeywords(current.title + ' ' + content);
  return createChunk(filePath, fileName, current.title, current.level, content, summary, keywords);
}

function createChunk(
  filePath: string,
  fileName: string,
  title: string,
  level: number,
  content: string,
  summary?: string,
  keywords?: string[],
): DocumentChunk {
  const id = createHash('md5').update(`${filePath}::${title}`).digest('hex').slice(0, 12);
  return {
    id,
    filePath,
    fileName,
    title,
    level,
    content,
    summary: summary || extractSummary(content),
    keywords: keywords || extractKeywords(title + ' ' + content),
    charCount: content.length,
  };
}

// ═══════════════════════════════════════════════════════════
// 2. 摘要提取（规则驱动）
// ═══════════════════════════════════════════════════════════

/**
 * 从块内容中提取结构化摘要
 * - 表格 → 提取表头 + 前 3 行
 * - 列表 → 提取前 5 项
 * - 段落 → 提取前 2 句
 * - 代码块 → 提取第一行注释或函数签名
 */
function extractSummary(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length === 0) return '';
  if (trimmed.length < 150) return trimmed; // 短内容直接保留

  // 尝试提取表格（用 RegExp 构造函数避免换行符解析问题）
  const tablePattern = new RegExp('(\\|[^\\n]+\\|\\n\\|[-:| ]+\\|\\n(?:\\|[^\\n]+\\|\\n?){1,3})');
  const tableMatch = trimmed.match(tablePattern);
  if (tableMatch) {
    return `【表格】\n${tableMatch[0]}`;
  }

  // 尝试提取列表
  const listMatch = trimmed.match(/^([-*]\s+.+\n?){1,5}/m);
  if (listMatch) {
    return `【要点】\n${listMatch[0].trim()}`;
  }

  // 尝试提取代码块签名
  const codeMatch = trimmed.match(/```\w*\n([^\n]+)/);
  if (codeMatch) {
    return `【代码】${codeMatch[1].slice(0, 80)}`;
  }

  // 默认：提取前 2 句（中文按句号，英文按句点+空格）
  const sentences = trimmed.split(/(?<=[。！？.!?])\s+/);
  if (sentences.length >= 2) {
    return sentences.slice(0, 2).join(' ').slice(0, 200);
  }

  return trimmed.slice(0, 200);
}

// ═══════════════════════════════════════════════════════════
// 3. 关键词提取（复用 code-scanner 逻辑）
// ═══════════════════════════════════════════════════════════

function extractKeywords(text: string): string[] {
  const keywords: string[] = [];

  // 中文关键词（2-4 字）
  const cn = text.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
  keywords.push(...cn);

  // 英文标识符（3+ 字母）
  const en = text.match(/\b[a-zA-Z]{3,}\b/g) || [];
  keywords.push(...en);

  // CamelCase / PascalCase 拆分
  const camel = text.match(/\b[a-z]+[A-Z][a-zA-Z]+\b/g) || [];
  for (const c of camel) {
    const parts = c.split(/(?=[A-Z])/);
    keywords.push(...parts.filter(p => p.length >= 3));
  }

  // 去重 + 停用词过滤
  const filtered = [...new Set(keywords)].filter(k => !STOP_WORDS.has(k.toLowerCase()));

  // 语义扩展
  const expanded = expandKeywords(filtered);

  return expanded.slice(0, 15);
}

function expandKeywords(keywords: string[]): string[] {
  const expanded = new Set(keywords);
  for (const kw of keywords) {
    const lower = kw.toLowerCase();
    if (SEMANTIC_MAP[lower]) {
      for (const syn of SEMANTIC_MAP[lower]) expanded.add(syn);
    }
    // 反向查找
    for (const [key, syns] of Object.entries(SEMANTIC_MAP)) {
      if (syns.includes(lower) && !expanded.has(key)) expanded.add(key);
    }
  }
  return [...expanded];
}

// ═══════════════════════════════════════════════════════════
// 4. 索引构建与存取
// ═══════════════════════════════════════════════════════════

/**
 * 为多个文档构建 RAG 索引
 */
export async function buildRagIndex(
  documents: { filePath: string; content: string; mtime?: number }[],
  scope: string,
): Promise<RagIndex> {
  const chunks: DocumentChunk[] = [];
  const fileSummaries: Record<string, string> = {};
  const fileMtimes: Record<string, number> = {};

  for (const doc of documents) {
    const docChunks = chunkByHeaders(doc.content, doc.filePath);
    chunks.push(...docChunks);

    // 文件级摘要：取前 3 个最高级别块的摘要
    const topLevelChunks = docChunks
      .filter(c => c.level <= 3)
      .sort((a, b) => a.level - b.level || b.charCount - a.charCount)
      .slice(0, 3);
    fileSummaries[doc.filePath] = topLevelChunks.map(c => `• ${c.title}: ${c.summary.slice(0, 80)}`).join('\n');

    // 记录文件修改时间
    if (doc.mtime) {
      fileMtimes[doc.filePath] = doc.mtime;
    }
  }

  return {
    version: RAG_VERSION,
    updatedAt: new Date().toISOString(),
    scope,
    chunks,
    fileSummaries,
    fileMtimes,
  };
}

/**
 * 获取 RAG 索引文件路径
 * 支持按 scope 分文件存储，避免 task/iteration/global 互相覆盖
 */
export function getRagIndexPath(cwd: string, fileName: string = 'rag-index.json'): string {
  return join(cwd, '.speccore', 'cache', fileName);
}

export async function saveRagIndex(cwd: string, index: RagIndex, fileName?: string): Promise<void> {
  const filePath = getRagIndexPath(cwd, fileName);
  await ensureDir(join(cwd, '.speccore', 'cache'));
  await writeFile(filePath, JSON.stringify(index, null, 2));
}

export async function loadRagIndex(cwd: string, fileName?: string): Promise<RagIndex | null> {
  const filePath = getRagIndexPath(cwd, fileName);
  if (!(await pathExists(filePath))) return null;
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as RagIndex;
  } catch {
    return null;
  }
}

/**
 * 检查索引是否匹配当前 scope（迭代/任务变更后需重建）
 */
export function isRagIndexStale(index: RagIndex, currentScope: string): boolean {
  return index.scope !== currentScope;
}

// ═══════════════════════════════════════════════════════════
// 5. 相关性检索
// ═══════════════════════════════════════════════════════════

/**
 * 根据查询语句检索最相关的文档块
 *
 * 评分逻辑：
 * - 标题关键词命中：+3 分/词
 * - 内容关键词命中：+1 分/词
 * - 摘要关键词命中：+2 分/词
 * - 高级别标题（##）bonus：+0.5 分
 * - 文件路径关键词命中：+1 分/词
 */
export function retrieveRelevantChunks(
  index: RagIndex,
  options: RetrievalOptions,
): DocumentChunk[] {
  const { query, topK = 5, minScore = 0.5, maxChunkChars = 1500, maxTotalChars = 6000 } = options;

  const queryKeywords = extractKeywords(query);
  if (queryKeywords.length === 0) {
    // 无关键词时返回最高级别的块
    return index.chunks
      .filter(c => c.level <= 3)
      .sort((a, b) => a.level - b.level || b.charCount - a.charCount)
      .slice(0, topK);
  }

  const scored = index.chunks.map(chunk => {
    let score = 0;

    // 标题匹配（权重最高）
    for (const kw of queryKeywords) {
      const lowerKw = kw.toLowerCase();
      if (chunk.title.toLowerCase().includes(lowerKw)) score += 3;
    }

    // 内容匹配
    for (const kw of queryKeywords) {
      const lowerKw = kw.toLowerCase();
      if (chunk.content.toLowerCase().includes(lowerKw)) score += 1;
    }

    // 摘要匹配
    for (const kw of queryKeywords) {
      const lowerKw = kw.toLowerCase();
      if (chunk.summary.toLowerCase().includes(lowerKw)) score += 2;
    }

    // 预提取关键词匹配
    for (const kw of queryKeywords) {
      const lowerKw = kw.toLowerCase();
      if (chunk.keywords.some(k => k.toLowerCase() === lowerKw)) score += 2.5;
    }

    // 文件路径匹配
    for (const kw of queryKeywords) {
      const lowerKw = kw.toLowerCase();
      if (chunk.filePath.toLowerCase().includes(lowerKw)) score += 1;
    }

    // 高级别标题 bonus
    if (chunk.level === 2) score += 0.5;

    // 归一化到 0~1（假设最大可能分约 20）
    const normalizedScore = Math.min(score / 10, 1);

    return { ...chunk, relevanceScore: normalizedScore };
  });

  // 过滤 + 排序
  const filtered = scored
    .filter(c => (c.relevanceScore || 0) >= minScore)
    .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

  // 按 topK + maxTotalChars 截断
  const result: DocumentChunk[] = [];
  let totalChars = 0;
  for (const chunk of filtered) {
    if (result.length >= topK) break;
    const chunkText = formatChunkForPrompt(chunk, maxChunkChars);
    if (totalChars + chunkText.length > maxTotalChars) {
      // 尝试用更短的摘要版本
      const slimText = formatChunkForPrompt({ ...chunk, content: chunk.summary }, maxChunkChars);
      if (totalChars + slimText.length <= maxTotalChars) {
        result.push({ ...chunk, content: chunk.summary });
        totalChars += slimText.length;
      }
      break;
    }
    result.push(chunk);
    totalChars += chunkText.length;
  }

  return result;
}

// ═══════════════════════════════════════════════════════════
// 6. Prompt 组装
// ═══════════════════════════════════════════════════════════

/**
 * 将 chunk 格式化为 Prompt 可用的文本
 */
function formatChunkForPrompt(chunk: DocumentChunk, maxChars: number): string {
  const content = chunk.content.length > maxChars
    ? chunk.content.slice(0, maxChars) + '\n> ... (已截断)'
    : chunk.content;
  return `### ${chunk.title}（${chunk.fileName}）\n\n${content}\n\n`;
}

/**
 * 将检索结果组装为 extraSpecs 格式（兼容现有 prompt-builder 接口）
 */
export function assembleChunksForPrompt(
  chunks: DocumentChunk[],
  options?: { maxCharsPerChunk?: number; maxTotalChars?: number },
): { name: string; path: string; content: string }[] {
  const maxChunk = options?.maxCharsPerChunk ?? 1500;
  const maxTotal = options?.maxTotalChars ?? 6000;

  const result: { name: string; path: string; content: string }[] = [];
  let totalChars = 0;

  for (const chunk of chunks) {
    let content = chunk.content;
    if (content.length > maxChunk) {
      content = content.slice(0, maxChunk) + `\n\n> ... (已截断，原块 ${chunk.content.length} 字)`;
    }
    const text = `## ${chunk.title}\n\n${content}`;
    if (totalChars + text.length > maxTotal && result.length > 0) break;

    result.push({
      name: `${chunk.fileName} › ${chunk.title}`,
      path: chunk.filePath,
      content: text,
    });
    totalChars += text.length;
  }

  return result;
}

/**
 * 获取文件级摘要（用于快速了解文档全貌）
 */
export function getFileSummaries(index: RagIndex): string {
  const lines: string[] = ['## 参考文档概览\n'];
  for (const [filePath, summary] of Object.entries(index.fileSummaries)) {
    lines.push(`**${basename(filePath)}**`);
    lines.push(summary);
    lines.push('');
  }
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════
// 7. 便捷函数：一键为任务目录构建索引
// ═══════════════════════════════════════════════════════════

/**
 * 扫描任务目录下的所有参考文档，构建 RAG 索引
 */
export async function indexTaskDocuments(
  cwd: string,
  taskDir: string,
  iteration?: string,
  platform?: string,
  fileName?: string,
): Promise<RagIndex> {
  const filesToIndex: { filePath: string; content: string; mtime: number }[] = [];

  const candidates = [
    join(cwd, taskDir, '_shared', 'TECH.md'),
    join(cwd, taskDir, '_shared', 'REQ.md'),
    join(cwd, taskDir, '_shared', 'SCHEMA.md'),
    join(cwd, taskDir, '_shared', 'API_CONTRACT.yaml'),
    join(cwd, taskDir, '00-specs', 'TECH.md'),
    join(cwd, taskDir, '00-specs', 'TASK.md'),
    join(cwd, taskDir, '99-artifacts', 'TEST.md'),
    join(cwd, taskDir, '99-artifacts', 'REVIEW.md'),
    join(cwd, taskDir, '99-artifacts', 'RISK.md'),
    join(cwd, taskDir, '.issues.md'),
  ];

  if (platform) {
    candidates.push(
      join(cwd, taskDir, `${platform}`, 'TASK.md'),
      join(cwd, taskDir, `${platform}`, 'COMPONENT_TREE.md'),
      join(cwd, taskDir, `${platform}`, 'ROUTES.md'),
      join(cwd, taskDir, `${platform}`, 'STATE.md'),
    );
  }

  if (iteration) {
    candidates.push(join(cwd, `Iteration-${iteration}`, '020-specs', 'DESIGN.md'));
    if (platform) {
      candidates.push(join(cwd, `Iteration-${iteration}`, '020-specs', 'platforms', platform, 'SPEC.md'));
    }
  }

  for (const fp of candidates) {
    if (await pathExists(fp)) {
      const [content, st] = await Promise.all([
        readFile(fp, 'utf-8'),
        stat(fp),
      ]);
      if (content.trim().length > 50 && !content.trim().match(/^#+\s*待填充|^<!--\s*AI-FILL\s*-->$/m)) {
        filesToIndex.push({ filePath: fp, content, mtime: st.mtimeMs });
      }
    }
  }

  const scope = `${iteration || 'global'}_${taskDir.replace(/\//g, '_')}_${platform || 'all'}`;
  const index = await buildRagIndex(filesToIndex, scope);
  await saveRagIndex(cwd, index, fileName);
  return index;
}

/**
 * 检查 RAG 索引是否新鲜（对比源文件 mtime）
 * 返回: { fresh: boolean; staleFiles: string[] }
 */
export async function checkRagIndexFreshness(
  cwd: string,
  fileName?: string,
): Promise<{ fresh: boolean; staleFiles: string[]; newFiles: string[] }> {
  const index = await loadRagIndex(cwd, fileName);
  if (!index) return { fresh: false, staleFiles: [], newFiles: [] };

  const staleFiles: string[] = [];
  const indexedPaths = new Set(Object.keys(index.fileMtimes));

  for (const [filePath, cachedMtime] of Object.entries(index.fileMtimes)) {
    try {
      const st = await stat(filePath);
      if (st.mtimeMs > cachedMtime + 1000) { // 1秒容差
        staleFiles.push(filePath);
      }
    } catch {
      // 文件被删除也算过期
      staleFiles.push(filePath);
    }
  }

  // 检测新增文件：扫描索引目录中未记录的文件
  const newFiles: string[] = [];
  try {
    const scopeDir = index.scope.includes('_030-tasks_')
      ? join(cwd, index.scope.split('_').slice(1, -1).join('/').replace(/_/g, '/'))
      : null;
    if (scopeDir && await pathExists(scopeDir)) {
      await scanForNewFiles(scopeDir, indexedPaths, newFiles);
    }
  } catch {
    // 非关键，忽略
  }

  return {
    fresh: staleFiles.length === 0 && newFiles.length === 0,
    staleFiles,
    newFiles,
  };
}

/** 递归扫描目录，找出未在索引中的新增 .md 文件 */
async function scanForNewFiles(
  dir: string,
  indexedPaths: Set<string>,
  newFiles: string[],
): Promise<void> {
  const items = await readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = join(dir, item.name);
    if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
      await scanForNewFiles(fullPath, indexedPaths, newFiles);
    } else if (item.isFile() && item.name.endsWith('.md') && !indexedPaths.has(fullPath)) {
      newFiles.push(fullPath);
    }
  }
}

/**
 * 为任意目录构建 RAG 索引（通用版本，不限于任务目录）
 * 扫描目录下所有 .md 文件，自动分块建索引
 */
export async function indexDirectoryDocuments(
  cwd: string,
  dirPath: string,
  scope: string,
  fileName?: string,
): Promise<RagIndex> {
  const filesToIndex: { filePath: string; content: string; mtime: number }[] = [];

  async function scanDir(dir: string) {
    if (!(await pathExists(dir))) return;
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = join(dir, item.name);
      if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
        await scanDir(fullPath);
      } else if (item.isFile() && item.name.endsWith('.md') && !item.name.startsWith('README')) {
        const [content, st] = await Promise.all([
          readFile(fullPath, 'utf-8'),
          stat(fullPath),
        ]);
        if (content.trim().length > 50 && !content.trim().match(/^#+\s*待填充|^<!--\s*AI-FILL\s*-->$/m)) {
          filesToIndex.push({ filePath: fullPath, content, mtime: st.mtimeMs });
        }
      }
    }
  }

  await scanDir(dirPath);

  const index = await buildRagIndex(filesToIndex, scope);
  await saveRagIndex(cwd, index, fileName);
  return index;
}

/**
 * 增量刷新 RAG 索引：只重建有变更的文件
 */
export async function refreshRagIndex(
  cwd: string,
  taskDir: string,
  iteration?: string,
  platform?: string,
  fileName?: string,
): Promise<RagIndex> {
  const existing = await loadRagIndex(cwd, fileName);
  if (!existing) {
    return indexTaskDocuments(cwd, taskDir, iteration, platform, fileName);
  }

  const { staleFiles, newFiles } = await checkRagIndexFreshness(cwd, fileName);
  if (staleFiles.length === 0 && newFiles.length === 0) {
    return existing;
  }

  // 保留未变更的 chunk，替换变更文件的 chunk
  const freshChunks = existing.chunks.filter(c => !staleFiles.includes(c.filePath));
  const freshSummaries = { ...existing.fileSummaries };

  for (const fp of staleFiles) {
    if (await pathExists(fp)) {
      const content = await readFile(fp, 'utf-8');
      const docChunks = chunkByHeaders(content, fp);
      freshChunks.push(...docChunks);

      const topLevel = docChunks
        .filter(c => c.level <= 3)
        .sort((a, b) => a.level - b.level || b.charCount - a.charCount)
        .slice(0, 3);
      freshSummaries[fp] = topLevel.map(c => `• ${c.title}: ${c.summary.slice(0, 80)}`).join('\n');
    } else {
      delete freshSummaries[fp];
    }
  }

  // 更新 mtime
  const freshMtimes = { ...existing.fileMtimes };
  for (const fp of staleFiles) {
    if (await pathExists(fp)) {
      const st = await stat(fp);
      freshMtimes[fp] = st.mtimeMs;
    } else {
      delete freshMtimes[fp];
    }
  }

  const scope = `${iteration || 'global'}_${taskDir.replace(/\//g, '_')}_${platform || 'all'}`;
  const refreshed: RagIndex = {
    ...existing,
    updatedAt: new Date().toISOString(),
    scope,
    chunks: freshChunks,
    fileSummaries: freshSummaries,
    fileMtimes: freshMtimes,
  };

  await saveRagIndex(cwd, refreshed, fileName);
  return refreshed;
}
