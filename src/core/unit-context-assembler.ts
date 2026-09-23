/**
 * Unit Context Assembler — 功能单元智能上下文组装引擎
 *
 * 核心设计：三层上下文模型 + Token 预算控制
 *   1. 核心层(40%): 当前功能单元完整需求
 *   2. 关联层(40%): 上下游单元摘要 + 相关源码 Top5
 *   3. 全局层(20%): 术语表 + 接口契约 + 数据模型
 *
 * 目标：给 AI 提供"全面且不漂移"的上下文
 *
 * v8.2.0+
 */

import { readFile, pathExists, readdir } from 'fs-extra';
import { join, basename } from 'path';
import { findRelevantCode } from './code-scanner';
import { loadFreshKnowledgeGraph } from './knowledge-graph';
import { unifiedSearch } from './unified-retrieval';
import { GLOBAL_SPECS_DIR } from './spec-paths';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface UnitRef {
  id: string;
  name: string;
  content: string;
}

export interface UnitContextOptions {
  /** 总 Token 预算，默认 6000 */
  maxTokens?: number;
  /** 核心层占比，默认 0.4 */
  coreRatio?: number;
  /** 关联层占比，默认 0.4 */
  relatedRatio?: number;
  /** 全局层占比，默认 0.2 */
  globalRatio?: number;
  /** 最多几个上下游单元，默认 3 */
  maxRelatedUnits?: number;
  /** 最多几个源码文件，默认 5 */
  maxCodeFiles?: number;
  /** 每个源码文件取多少字符，默认 800 */
  codeCharsPerFile?: number;
  /** 是否使用知识图谱增强关联 */
  useKnowledgeGraph?: boolean;
}

export interface UnitContextResult {
  context: string;
  stats: {
    coreChars: number;
    relatedUnitChars: number;
    codeChars: number;
    globalChars: number;
    totalChars: number;
    estimatedTokens: number;
    relatedUnits: string[];
    codeFiles: string[];
  };
}

// ═══════════════════════════════════════════════════════════
// 主入口：组装功能单元上下文
// ═══════════════════════════════════════════════════════════

export async function assembleUnitContext(
  iterDir: string,
  iteration: string,
  unit: UnitRef,
  allUnits: UnitRef[],
  options?: UnitContextOptions,
): Promise<UnitContextResult> {
  const opts = {
    maxTokens: 6000,
    coreRatio: 0.4,
    relatedRatio: 0.4,
    globalRatio: 0.2,
    maxRelatedUnits: 3,
    maxCodeFiles: 5,
    codeCharsPerFile: 800,
    useKnowledgeGraph: true,
    ...options,
  };

  // Token → 字符预算（中文字 ≈ 1.5 tokens/字，取保守值 1.2）
  const charsPerToken = 1.2;
  const totalBudget = Math.floor(opts.maxTokens * charsPerToken);
  const coreBudget = Math.floor(totalBudget * opts.coreRatio);
  const relatedBudget = Math.floor(totalBudget * opts.relatedRatio);
  const globalBudget = Math.floor(totalBudget * opts.globalRatio);

  const lines: string[] = [];
  let coreChars = 0;
  let relatedUnitChars = 0;
  let codeChars = 0;
  let globalChars = 0;

  // ── 1. 核心层：当前功能单元完整需求 ──
  lines.push(`# 功能单元: ${unit.id} ${unit.name}`);
  lines.push('');
  lines.push('## 需求描述');
  lines.push('');
  const coreContent = unit.content;
  lines.push(coreContent);
  lines.push('');
  coreChars = coreContent.length;

  // ── 2. 关联层：上下游单元 + 相关源码 ──
  lines.push('---');
  lines.push('');

  // 2a. 上下游单元摘要（Jaccard + 知识图谱双重关联）
  const relatedUnits = await findRelatedUnits(unit, allUnits, opts.maxRelatedUnits, opts.useKnowledgeGraph);
  if (relatedUnits.length > 0) {
    lines.push('## 关联功能单元（上下游）');
    lines.push('> 以下功能单元与当前单元有直接业务关联，分析时请保持逻辑一致性');
    lines.push('');
    for (const ru of relatedUnits) {
      const summary = ru.content.split('\n').slice(0, 5).join('\n');
      const section = `### ${ru.id} ${ru.name}\n${summary}\n`;
      lines.push(section);
      relatedUnitChars += section.length;
    }
    lines.push('');
  }

  // 2b. 相关源码文件（知识图谱 + 语义关键词双重关联）
  const codeFiles = await findRelatedCodeForUnit(unit, iterDir, iteration, opts.maxCodeFiles, opts.codeCharsPerFile, opts.useKnowledgeGraph);
  if (codeFiles.length > 0) {
    lines.push('## 相关源码文件');
    lines.push('> 以下源码文件与当前功能单元相关，分析时请参考实现细节');
    lines.push('');
    for (const cf of codeFiles) {
      const section = `### ${cf.path}\n\`\`\`${cf.language || 'ts'}\n${cf.content}\n\`\`\`\n`;
      lines.push(section);
      codeChars += section.length;
    }
    lines.push('');
  }

  // 2c. RAG 检索补充（相关文档片段）
  if (opts.useKnowledgeGraph) {
    try {
      const ragResult = await unifiedSearch(process.cwd(), {
        query: unit.name,
        iteration,
      });
      if (ragResult.documentChunks.length > 0) {
        lines.push('## 相关文档片段（RAG 检索）');
        lines.push('> 以下片段来自项目文档库，可能与当前功能单元相关');
        lines.push('');
        for (const chunk of ragResult.documentChunks.slice(0, 2)) {
          const section = `### ${chunk.title}（${chunk.fileName}）\n${chunk.content.slice(0, 500)}\n`;
          lines.push(section);
          relatedUnitChars += section.length;
        }
        lines.push('');
      }
    } catch (e) {
      logger.debug('RAG 检索补充失败:', e);
    }
  }

  // ── 3. 全局层：术语表 + 接口契约 + 数据模型 ──
  lines.push('---');
  lines.push('');

  const globals = await extractGlobalConstraints(iterDir, globalBudget);
  if (globals.terminology) {
    lines.push('## 术语表（全局共享）');
    lines.push(globals.terminology);
    lines.push('');
    globalChars += globals.terminology.length;
  }
  if (globals.apiContract) {
    lines.push('## 接口契约（全局共享）');
    lines.push(globals.apiContract);
    lines.push('');
    globalChars += globals.apiContract.length;
  }
  if (globals.dataModel) {
    lines.push('## 数据模型（全局共享）');
    lines.push(globals.dataModel);
    lines.push('');
    globalChars += globals.dataModel.length;
  }

  // ── 4. Token 预算检查与截断 ──
  let context = lines.join('\n');
  let totalChars = context.length;
  let estimatedTokens = Math.ceil(totalChars / charsPerToken);

  if (estimatedTokens > opts.maxTokens) {
    logger.debug(`单元上下文超出预算: ${estimatedTokens}/${opts.maxTokens} tokens，执行截断`);
    context = truncateByBudget(context, unit, relatedUnits, codeFiles, globals, opts, charsPerToken);
    totalChars = context.length;
    estimatedTokens = Math.ceil(totalChars / charsPerToken);
  }

  return {
    context,
    stats: {
      coreChars,
      relatedUnitChars,
      codeChars,
      globalChars,
      totalChars,
      estimatedTokens,
      relatedUnits: relatedUnits.map(u => `${u.id} ${u.name}`),
      codeFiles: codeFiles.map(f => f.path),
    },
  };
}

// ═══════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════

/**
 * 基于标题关键词重叠度 + 知识图谱增强找上下游相关单元
 *
 * 双重关联策略：
 * 1. Jaccard 相似度：标题关键词重叠
 * 2. 知识图谱增强：通过 requirement 实体的 refers/implements 关系扩展
 */
async function findRelatedUnits(
  unit: UnitRef,
  allUnits: UnitRef[],
  maxCount: number,
  useKG: boolean,
): Promise<UnitRef[]> {
  const unitWords = extractKeywords(unit.name);
  const scores = new Map<string, number>();

  // 1. 基础 Jaccard 得分
  for (const u of allUnits) {
    if (u.id === unit.id) continue;
    const otherWords = extractKeywords(u.name);
    const overlap = unitWords.filter(w => otherWords.includes(w)).length;
    const union = new Set([...unitWords, ...otherWords]).size;
    const jaccard = union > 0 ? overlap / union : 0;
    if (jaccard > 0) scores.set(u.id, jaccard);
  }

  // 2. 知识图谱增强（通过 requirement 实体的关系链扩展关联）
  if (useKG) {
    try {
      const graph = await loadFreshKnowledgeGraph(process.cwd());
      if (graph) {
        const unitNameLower = unit.name.toLowerCase();
        const matchedReqIds = new Set<string>();

        // 找匹配当前单元名称的 requirement 实体
        for (const entity of Object.values(graph.entities)) {
          if (entity.type !== 'requirement') continue;
          const titleLower = entity.title.toLowerCase();
          // 双向包含匹配
          if (titleLower.includes(unitNameLower) || unitNameLower.includes(titleLower)) {
            matchedReqIds.add(entity.id);
          }
        }

        // 通过关系链找邻居 requirement 实体
        for (const rel of graph.relations) {
          if (!matchedReqIds.has(rel.from) && !matchedReqIds.has(rel.to)) continue;

          const neighborId = matchedReqIds.has(rel.from) ? rel.to : rel.from;
          const neighbor = graph.entities[neighborId];
          if (!neighbor || neighbor.type !== 'requirement') continue;

          // 将邻居 requirement 映射回功能单元（标题模糊匹配）
          for (const u of allUnits) {
            if (u.id === unit.id) continue;
            const uNameLower = u.name.toLowerCase();
            const neighborTitle = neighbor.title.toLowerCase();
            if (uNameLower.includes(neighborTitle) || neighborTitle.includes(uNameLower)) {
              scores.set(u.id, (scores.get(u.id) || 0) + 0.4); // KG 关联加分
            }
          }
        }
      }
    } catch (e) {
      logger.debug('知识图谱关联单元失败:', e);
    }
  }

  // 排序取 top
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxCount)
    .map(([id]) => allUnits.find(u => u.id === id)!)
    .filter(Boolean);
}

/** 提取关键词（≥2 字符的中文/英文词） */
function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);
}

/**
 * 查找与功能单元相关的源码文件
 *
 * 双重关联策略：
 * 1. 知识图谱直接关联：通过 requirement → source-file 关系链
 * 2. findRelevantCode：语义关键词匹配 + 知识图谱增强评分
 */
async function findRelatedCodeForUnit(
  unit: UnitRef,
  iterDir: string,
  iteration: string,
  maxFiles: number,
  charsPerFile: number,
  useKG: boolean,
): Promise<{ path: string; language: string; content: string }[]> {
  const results: { path: string; language: string; content: string }[] = [];
  const addedPaths = new Set<string>();

  // 1. 知识图谱直接关联（优先）
  if (useKG) {
    try {
      const graph = await loadFreshKnowledgeGraph(process.cwd());
      if (graph) {
        const unitNameLower = unit.name.toLowerCase();
        const matchedReqIds = new Set<string>();

        // 找匹配当前单元名称的 requirement 实体
        for (const entity of Object.values(graph.entities)) {
          if (entity.type !== 'requirement') continue;
          const titleLower = entity.title.toLowerCase();
          if (titleLower.includes(unitNameLower) || unitNameLower.includes(titleLower)) {
            matchedReqIds.add(entity.id);
          }
        }

        // 通过关系链找关联的 source-file 实体
        for (const rel of graph.relations) {
          if (!matchedReqIds.has(rel.from) && !matchedReqIds.has(rel.to)) continue;

          const neighborId = matchedReqIds.has(rel.from) ? rel.to : rel.from;
          const neighbor = graph.entities[neighborId];
          if (!neighbor || neighbor.type !== 'source-file' || !neighbor.file) continue;

          const fp = neighbor.file;
          if (addedPaths.has(fp) || addedPaths.size >= maxFiles) continue;
          if (!await pathExists(fp)) continue;

          const content = await readFile(fp, 'utf-8');
          const truncated = truncateCodeFile(content, charsPerFile);
          results.push({ path: fp, language: detectLang(fp), content: truncated });
          addedPaths.add(fp);
        }
      }
    } catch (e) {
      logger.debug('知识图谱关联源码失败:', e);
    }
  }

  // 2. findRelevantCode 补充（语义关键词匹配）
  try {
    const matches = await findRelevantCode(unit.name, maxFiles * 2, undefined, iteration);
    for (const match of matches) {
      const fp = match.file;
      if (addedPaths.has(fp) || addedPaths.size >= maxFiles) continue;
      if (!await pathExists(fp)) continue;

      const content = await readFile(fp, 'utf-8');
      const truncated = truncateCodeFile(content, charsPerFile);
      results.push({ path: fp, language: detectLang(fp), content: truncated });
      addedPaths.add(fp);
    }
  } catch (e) {
    logger.debug('语义关联源码失败:', e);
  }

  return results;
}

/** 根据文件扩展名检测语言 */
function detectLang(fp: string): string {
  const ext = fp.split('.').pop() || 'ts';
  return ext === 'ts' || ext === 'tsx' ? 'typescript'
    : ext === 'js' || ext === 'jsx' ? 'javascript'
    : ext === 'vue' ? 'vue'
    : ext === 'py' ? 'python'
    : ext === 'go' ? 'go'
    : ext === 'java' ? 'java'
    : 'text';
}

/** 截断源码文件：保留文件头注释 + 前 N 个 export + 截断标记 */
function truncateCodeFile(content: string, maxChars: number): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let chars = 0;
  let exportCount = 0;

  for (const line of lines) {
    if (chars + line.length > maxChars && exportCount >= 2) {
      result.push('// ... (截断)');
      break;
    }
    if (/^(export |class |function |interface |const |let |type |enum )/.test(line)) {
      exportCount++;
    }
    result.push(line);
    chars += line.length + 1;
  }

  return result.join('\n');
}

/** 提取全局约束：术语表、接口契约、数据模型 */
async function extractGlobalConstraints(
  iterDir: string,
  budget: number,
): Promise<{ terminology?: string; apiContract?: string; dataModel?: string }> {
  const result: { terminology?: string; apiContract?: string; dataModel?: string } = {};
  let usedBudget = 0;

  // 1. 术语表：从黄金需求目录 + 新路径两级 CLARIFY.md 中提取
  // v8.3.223+: 适配新路径澄清产物——用两级澄清产出的项目黄金目录为空，
  // 旧逻辑只读 requirements/ 导致术语表提取不到
  // v8.3.263: GLOBAL_CONTEXT-*.md 也纳入来源——unitize 过滤出的「名词约定」
  // 章节此前无任何下游读取（断链），clarify/analyze 两链路均取不到术语表
  const clarifyCandidates: string[] = [];
  const goldenDir = join(iterDir, '020-specs', 'requirements');
  if (await pathExists(goldenDir)) {
    try {
      const files = await readdir(goldenDir);
      for (const f of files.filter(f => f.endsWith('.md'))) {
        clarifyCandidates.push(join(goldenDir, f));
      }
    } catch { /* ignore */ }
  }
  const globalCtxDir = join(iterDir, '010-requirements', 'overview');
  if (await pathExists(globalCtxDir)) {
    try {
      const gf = await readdir(globalCtxDir);
      for (const f of gf.filter(f => f.startsWith('GLOBAL_CONTEXT-') && f.endsWith('.md'))) {
        clarifyCandidates.push(join(globalCtxDir, f));
      }
    } catch { /* ignore */ }
  }
  const specsDir = join(iterDir, '020-specs');
  const ovClarify = join(specsDir, 'overview', 'CLARIFY.md');
  if (await pathExists(ovClarify)) clarifyCandidates.push(ovClarify);
  try {
    const specEntries = await readdir(specsDir, { withFileTypes: true });
    for (const se of specEntries) {
      if (!se.isDirectory() || se.name === 'overview' || se.name === 'requirements') continue;
      const c = join(specsDir, se.name, 'overview', 'CLARIFY.md');
      if (await pathExists(c)) clarifyCandidates.push(c);
    }
  } catch { /* ignore */ }

  for (const fp of clarifyCandidates) {
    try {
      const content = await readFile(fp, 'utf-8');
      const glossaryMatch = content.match(/#{2,3}\s+(术语表|名词约定|名词定义|术语约定)[\s\S]*?(?=\n#{2,3}|$)/i);
      if (glossaryMatch) {
        const text = glossaryMatch[0].trim();
        if (usedBudget + text.length < budget * 0.5) {
          result.terminology = (result.terminology || '') + '\n' + text;
          usedBudget += text.length;
        }
      }
    } catch { /* ignore */ }
  }

  // 2. 接口契约（需求核心，保留更多内容）
  const contractPath = join(iterDir, '030-tasks', '_shared', 'API_CONTRACT.yaml');
  if (await pathExists(contractPath)) {
    try {
      const content = await readFile(contractPath, 'utf-8');
      result.apiContract = content.slice(0, 4000);
      usedBudget += result.apiContract.length;
    } catch { /* ignore */ }
  }

  // 3. 数据模型（需求核心，保留更多内容）
  const schemaPath = join(iterDir, '020-specs', 'SCHEMA.md');
  if (await pathExists(schemaPath)) {
    try {
      const content = await readFile(schemaPath, 'utf-8');
      result.dataModel = content.slice(0, 4000);
    } catch { /* ignore */ }
  }

  return result;
}

/** 按 Token 预算截断上下文 */
function truncateByBudget(
  fullContext: string,
  unit: UnitRef,
  relatedUnits: UnitRef[],
  codeFiles: { path: string; language: string; content: string }[],
  globals: { terminology?: string; apiContract?: string; dataModel?: string },
  opts: Required<UnitContextOptions>,
  charsPerToken: number,
): string {
  const lines: string[] = [];
  const maxChars = Math.floor(opts.maxTokens * charsPerToken);
  let usedChars = 0;

  // 优先级 1：核心层（当前单元）— 必须保留
  const coreHeader = `# 功能单元: ${unit.id} ${unit.name}\n\n## 需求描述\n\n`;
  const coreContent = unit.content;
  const coreTotal = coreHeader.length + coreContent.length;

  if (coreTotal > maxChars * 0.6) {
    // 核心层本身就超了，只保留核心层的前 60%
    lines.push(coreHeader);
    lines.push(coreContent.slice(0, Math.floor(maxChars * 0.6) - coreHeader.length));
    lines.push('\n\n> ⚠️ 需求内容过长，已截断。如需完整内容请阅读原文档。');
    return lines.join('');
  }

  lines.push(coreHeader);
  lines.push(coreContent);
  usedChars += coreTotal;

  // 优先级 2：关联层 — 保留上下游单元，源码按预算截断
  if (relatedUnits.length > 0 && usedChars < maxChars * 0.8) {
    lines.push('\n---\n\n## 关联功能单元（上下游）\n> 以下功能单元与当前单元有直接业务关联\n\n');
    usedChars += lines[lines.length - 1].length;

    for (const ru of relatedUnits) {
      if (usedChars >= maxChars * 0.85) break;
      const summary = ru.content.split('\n').slice(0, 3).join('\n');
      const section = `### ${ru.id} ${ru.name}\n${summary}\n\n`;
      lines.push(section);
      usedChars += section.length;
    }
  }

  // 源码文件：按预算逐个添加
  if (codeFiles.length > 0 && usedChars < maxChars * 0.9) {
    lines.push('\n## 相关源码文件\n> 以下源码文件与当前功能单元相关\n\n');
    usedChars += lines[lines.length - 1].length;

    for (const cf of codeFiles) {
      if (usedChars >= maxChars * 0.95) break;
      const remaining = maxChars - usedChars - 100; // 预留 100 字符缓冲
      const codeContent = remaining < cf.content.length
        ? cf.content.slice(0, remaining) + '\n// ... (截断)\n'
        : cf.content;
      const section = `### ${cf.path}\n\`\`\`${cf.language}\n${codeContent}\n\`\`\`\n\n`;
      lines.push(section);
      usedChars += section.length;
    }
  }

  // 优先级 3：全局层 — 术语表 > 接口契约 > 数据模型（需求核心，尽量保留）
  const globalParts = [
    { label: '术语表（全局共享）', content: globals.terminology },
    { label: '接口契约（全局共享）', content: globals.apiContract },
    { label: '数据模型（全局共享）', content: globals.dataModel },
  ];
  for (const gp of globalParts) {
    if (!gp.content) continue;
    if (usedChars >= maxChars) break;
    const remaining = maxChars - usedChars - 50;
    if (remaining <= 0) break;
    lines.push(`\n---\n\n## ${gp.label}\n`);
    lines.push(gp.content.slice(0, remaining));
    usedChars += gp.label.length + gp.content.slice(0, remaining).length;
  }

  return lines.join('');
}

// ═══════════════════════════════════════════════════════════
// v8.3.223+: 概览文档关键词提取（原 split.ts 本地 assembleUnitContext 副本，已收敛至此）
// 与 assembleUnitContext 的职责区分：
//   - assembleUnitContext：单元内容 + 关联单元 + 源码三层组装（analyze 链路）
//   - extractOverviewContext：从 020-specs 概览文档按关键词提取片段（taskify 链路）
// 此前两套实现并存、已漂移，现已统一到本模块维护。
// ═══════════════════════════════════════════════════════════

/** 将名称转为目录安全的短 slug（2-4 词）——与 split.ts 原实现一致 */
function slugify(name: string): string {
  const latinMatches = name.match(/[a-zA-Z0-9]+/g);
  if (latinMatches && latinMatches.length > 0) {
    return latinMatches.slice(0, 3).join('-').toLowerCase();
  }
  const hash = Math.abs(name.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7)).toString(36);
  return hash.slice(0, 6);
}

/**
 * v7.4.2+: 按功能单元从各分析文档中精准提取相关上下文
 * CLI 做计算（提取），AI 做内容（填充）
 */
export async function extractOverviewContext(
  iterationDir: string,
  unitName: string,
  platforms: string[],
): Promise<string> {
  const specsBase = join(iterationDir, '020-specs');
  const overviewDir = join(specsBase, GLOBAL_SPECS_DIR);
  const ctx: string[] = [];
  // 关键词拆分：将功能单元名拆成多个搜索词（如「预订管理」→「预订」「管理」）
  const keywords = unitName.split(/(?<=[\u4e00-\u9fff])(?=[\u4e00-\u9fff])/).filter(k => k.length >= 1);
  // 也加入英文关键词（如 booking、checkin）
  const slugKeywords = slugify(unitName).split('-').filter(k => k.length >= 3);
  const allKeywords = [...keywords, ...slugKeywords];

  const matchLine = (line: string) => allKeywords.some(k => line.includes(k));

  // 1. 从 overview/REQUIREMENT.md 提取相关章节
  const reqPath = join(overviewDir, 'REQUIREMENT.md');
  if (await pathExists(reqPath)) {
    try {
      const content = await readFile(reqPath, 'utf-8');
      const lines = content.split(/\r?\n/);
      const relevant: string[] = [];
      let inRelevantSection = false;
      for (const line of lines) {
        if (line.startsWith('## ') || line.startsWith('### ')) {
          inRelevantSection = matchLine(line);
        }
        if (inRelevantSection || (line.startsWith('|') && matchLine(line))) {
          relevant.push(line);
        }
      }
      if (relevant.length > 0) {
        ctx.push(`### 📋 需求规格（REQUIREMENT.md 相关片段）\n\`\`\`\n${relevant.slice(0, 60).join('\n')}\n\`\`\``);
      }
    } catch {}
  }

  // 2. 从 platforms/_shared/_MODULES.md 提取相关模块
  const modulesPath = join(specsBase, 'platforms', '_shared', '_MODULES.md');
  if (await pathExists(modulesPath)) {
    try {
      const content = await readFile(modulesPath, 'utf-8');
      const lines = content.split(/\r?\n/);
      const relevant: string[] = [];
      let inRelevantBlock = false;
      let blockLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith('## ')) {
          // 保存上一个块
          if (inRelevantBlock && blockLines.length > 0) {
            relevant.push(...blockLines);
          }
          inRelevantBlock = matchLine(line);
          blockLines = [line];
        } else if (inRelevantBlock) {
          blockLines.push(line);
        } else if (line.startsWith('|') && matchLine(line)) {
          relevant.push(line);
        }
      }
      if (inRelevantBlock && blockLines.length > 0) relevant.push(...blockLines);
      if (relevant.length > 0) {
        ctx.push(`### 🧩 功能模块（_MODULES.md 相关片段）\n\`\`\`\n${relevant.slice(0, 50).join('\n')}\n\`\`\``);
      }
    } catch {}
  }

  // 3. 从各端 _INDEX.md 提取相关接口/页面
  for (const platform of platforms) {
    const indexPath = join(specsBase, 'platforms', platform, '_INDEX.md');
    if (await pathExists(indexPath)) {
      try {
        const content = await readFile(indexPath, 'utf-8');
        const lines = content.split(/\r?\n/);
        const relevant: string[] = [];
        let inRelevantSection = false;
        for (const line of lines) {
          if (line.startsWith('## ') || line.startsWith('### ')) {
            inRelevantSection = matchLine(line);
          }
          if (inRelevantSection || (line.startsWith('|') && matchLine(line))) {
            relevant.push(line);
          }
        }
        if (relevant.length > 0) {
          ctx.push(`### 🖥️ ${platform} 端相关（_INDEX.md 片段）\n\`\`\`\n${relevant.slice(0, 40).join('\n')}\n\`\`\``);
        }
      } catch {}
    }
  }

  // 4. 从 overview/FUNCTION_MAP.md 提取本单元行 + 依赖单元
  const funcMapPath = join(overviewDir, 'FUNCTION_MAP.md');
  if (await pathExists(funcMapPath)) {
    try {
      const content = await readFile(funcMapPath, 'utf-8');
      const lines = content.split(/\r?\n/);
      const matchedRows = lines.filter(l => l.startsWith('|') && matchLine(l));
      if (matchedRows.length > 0) {
        ctx.push(`### 🗺️ 功能映射（FUNCTION_MAP.md）\n\`\`\`\n${matchedRows.join('\n')}\n\`\`\``);
      }
    } catch {}
  }

  // 5. 从 overview/TECH.md 提取相关架构信息
  const techPath = join(overviewDir, 'TECH.md');
  if (await pathExists(techPath)) {
    try {
      const content = await readFile(techPath, 'utf-8');
      const lines = content.split(/\r?\n/);
      const relevant: string[] = [];
      let inRelevantSection = false;
      for (const line of lines) {
        if (line.startsWith('## ') || line.startsWith('### ')) {
          inRelevantSection = matchLine(line);
        }
        if (inRelevantSection) relevant.push(line);
      }
      if (relevant.length > 0) {
        ctx.push(`### 🏗️ 技术架构相关（TECH.md 片段）\n\`\`\`\n${relevant.slice(0, 40).join('\n')}\n\`\`\``);
      }
    } catch {}
  }

  // v8.2.0+: 知识图谱 + 源码关联增强
  // v8.3.125+: 自动检查过期并刷新
  try {
    const graph = await loadFreshKnowledgeGraph(process.cwd());
    if (graph) {
      const unitNameLower = unitName.toLowerCase();
      const matchedReqIds = new Set<string>();
      const codeFiles: string[] = [];

      // 找匹配当前功能单元的 requirement 实体
      for (const entity of Object.values(graph.entities)) {
        if (entity.type !== 'requirement') continue;
        const titleLower = entity.title.toLowerCase();
        if (titleLower.includes(unitNameLower) || unitNameLower.includes(titleLower)) {
          matchedReqIds.add(entity.id);
        }
      }

      // 通过关系链找关联的 source-file 实体
      for (const rel of graph.relations) {
        if (!matchedReqIds.has(rel.from) && !matchedReqIds.has(rel.to)) continue;
        const neighborId = matchedReqIds.has(rel.from) ? rel.to : rel.from;
        const neighbor = graph.entities[neighborId];
        if (neighbor && neighbor.type === 'source-file' && neighbor.file) {
          codeFiles.push(neighbor.file);
        }
      }

      if (codeFiles.length > 0) {
        ctx.push(`### 💻 相关源码文件（知识图谱关联）\n${codeFiles.slice(0, 5).map(f => `- \`${f}\``).join('\n')}`);
      }
    }
  } catch { /* ignore */ }

  // v8.2.0+: findRelevantCode 语义关联补充
  try {
    const matches = await findRelevantCode(unitName, 5);
    if (matches.length > 0) {
      const files = matches.map(m => `- \`${m.file}\` (相关度: ${m.score.toFixed(2)})`);
      ctx.push(`### 🔍 语义关联源码文件\n${files.join('\n')}`);
    }
  } catch { /* ignore */ }

  if (ctx.length === 0) {
    return `> 功能单元「${unitName}」未在分析文档中找到直接相关内容，请根据全局文档推断。`;
  }
  return ctx.join('\n\n');
}
