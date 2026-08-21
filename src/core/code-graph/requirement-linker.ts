/**
 * Requirement ↔ Code Graph Linker
 * v6.94.0: 建立需求文档与代码节点之间的关联映射
 */
import { join } from 'path';
import { readFile, writeFile, pathExists, readdir } from 'fs-extra';
import { logger } from '../../utils/logger';
import { loadCodeGraph } from './index';
import type { CodeGraph, CodeNode } from './types';

const GRAPH_DIR = '.speccore/code-graph';

export interface ReqCodeLink {
  /** 需求来源文件 */
  sourceFile: string;
  /** 需求标题/关键词 */
  requirement: string;
  /** 关联的代码节点 ID */
  linkedNodeIds: string[];
  /** 关联强度 0-1 */
  confidence: number;
  /** 匹配的关键词 */
  matchedKeywords: string[];
}

export interface ReqCodeLinkReport {
  generatedAt: string;
  iteration?: string;
  totalRequirements: number;
  totalLinkedNodes: number;
  coverageRatio: number;
  links: ReqCodeLink[];
}

/**
 * 从迭代目录提取需求关键词
 */
async function extractRequirements(projectRoot: string, iteration?: string): Promise<Array<{ file: string; title: string; keywords: string[] }>> {
  const results: Array<{ file: string; title: string; keywords: string[] }> = [];

  // 确定迭代目录
  let iterDir: string | undefined;
  if (iteration) {
    iterDir = join(projectRoot, iteration);
  } else {
    // 尝试从 context.json 读取当前迭代
    try {
      const ctxPath = join(projectRoot, '.speccore', 'local', 'context.json');
      if (await pathExists(ctxPath)) {
        const ctx = JSON.parse(await readFile(ctxPath, 'utf-8'));
        if (ctx.currentIteration) {
          iterDir = join(projectRoot, ctx.currentIteration);
        }
      }
    } catch { /* 忽略 */ }
  }

  if (!iterDir || !(await pathExists(iterDir))) {
    return results;
  }

  // 扫描需求文档目录
  const reqDirs = [
    join(iterDir, '010-requirements', 'features'),
    join(iterDir, '010-requirements', 'converted'),
    join(iterDir, '020-specs'),
  ];

  for (const dir of reqDirs) {
    if (!(await pathExists(dir))) continue;
    const files = await readdir(dir).catch(() => []);
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      const filePath = join(dir, f);
      try {
        const content = await readFile(filePath, 'utf-8');
        const { title, keywords } = parseRequirementDoc(content, f);
        if (keywords.length > 0) {
          results.push({ file: filePath, title, keywords });
        }
      } catch { /* 忽略读取失败 */ }
    }
  }

  return results;
}

/**
 * 解析单个需求文档，提取标题和关键词
 */
function parseRequirementDoc(content: string, filename: string): { title: string; keywords: string[] } {
  const lines = content.split('\n');
  let title = filename.replace('.md', '');
  const keywords = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    // H1/H2 标题作为需求标题
    if (trimmed.startsWith('# ')) {
      title = trimmed.replace(/^#\s+/, '');
    }
    // 提取英文标识符（camelCase / PascalCase / snake_case）
    const identifiers = trimmed.match(/[A-Za-z][A-Za-z0-9_]*[A-Za-z0-9]/g) || [];
    for (const id of identifiers) {
      // 过滤常见停用词
      if (id.length <= 2) continue;
      if (/^(the|and|or|for|with|from|into|this|that|when|then|than|them|they|their|there|where|what|which|while|will|would|should|could|can|may|might|must|shall|use|using|used|get|set|add|new|delete|update|create|remove|list|find|search|filter|sort|order|page|size|limit|offset|count|total|sum|avg|min|max|true|false|null|undefined|const|let|var|function|class|interface|type|enum|return|if|else|switch|case|break|continue|for|while|do|try|catch|finally|throw|async|await|import|export|default|from|as|of|in|instanceof|typeof|void|yield|debugger)$/i.test(id)) {
        continue;
      }
      keywords.add(id);
    }
  }

  return { title, keywords: [...keywords] };
}

/**
 * 计算需求与代码节点的匹配度
 */
interface MatchResult {
  score: number;
  matched: string[];
}

function computeMatchScore(reqKeywords: string[], node: CodeNode): MatchResult {
  const nodeNameLower = node.name.toLowerCase();
  const nodeFileLower = node.filePath.toLowerCase();
  let matches = 0;
  const matched: string[] = [];

  for (const kw of reqKeywords) {
    const kwLower = kw.toLowerCase();
    // 节点名包含关键词
    if (nodeNameLower.includes(kwLower)) {
      matches += 2;
      matched.push(kw);
      continue;
    }
    // 文件名包含关键词
    if (nodeFileLower.includes(kwLower)) {
      matches += 1;
      matched.push(kw);
      continue;
    }
    // snippet 包含关键词
    if (node.snippet && node.snippet.toLowerCase().includes(kwLower)) {
      matches += 0.5;
      matched.push(kw);
    }
  }

  if (matches === 0) return { score: 0, matched: [] };

  // 归一化：匹配分 / (关键词数 * 2)
  const score = Math.min(1, matches / (reqKeywords.length * 2));
  return { score, matched };
}

/**
 * 建立需求与代码的关联映射
 */
export async function linkRequirementsToCode(
  projectRoot?: string,
  iteration?: string
): Promise<ReqCodeLinkReport> {
  const root = projectRoot || process.cwd();
  const graph = await loadCodeGraph(root);

  if (!graph) {
    logger.warn('代码图谱不存在，请先运行 speccore code-index --graph');
    return {
      generatedAt: new Date().toISOString(),
      iteration,
      totalRequirements: 0,
      totalLinkedNodes: 0,
      coverageRatio: 0,
      links: [],
    };
  }

  const requirements = await extractRequirements(root, iteration);
  logger.info(`📋 发现 ${requirements.length} 个需求文档`);

  const links: ReqCodeLink[] = [];
  const allLinkedNodeIds = new Set<string>();

  for (const req of requirements) {
    const nodeScores = new Map<string, { node: CodeNode; score: number; matched: string[] }>();

    for (const node of graph.nodes) {
      const result = computeMatchScore(req.keywords, node);
      if (result.score > 0.3) {
        nodeScores.set(node.id, { node, score: result.score, matched: result.matched });
      }
    }

    // 取 top 10
    const topMatches = Array.from(nodeScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    if (topMatches.length > 0) {
      const linkedNodeIds = topMatches.map(m => m.node.id);
      const avgScore = topMatches.reduce((s, m) => s + m.score, 0) / topMatches.length;
      const allMatched = [...new Set(topMatches.flatMap(m => m.matched))];

      for (const id of linkedNodeIds) {
        allLinkedNodeIds.add(id);
      }

      links.push({
        sourceFile: req.file,
        requirement: req.title,
        linkedNodeIds,
        confidence: Math.round(avgScore * 100) / 100,
        matchedKeywords: allMatched.slice(0, 10),
      });
    }
  }

  // 计算覆盖率：有链接的代码节点 / 总代码节点
  const coverageRatio = graph.nodes.length > 0
    ? Math.round((allLinkedNodeIds.size / graph.nodes.length) * 100) / 100
    : 0;

  const report: ReqCodeLinkReport = {
    generatedAt: new Date().toISOString(),
    iteration: iteration || requirements[0]?.file.split('/').find(s => s.startsWith('Iteration-')),
    totalRequirements: requirements.length,
    totalLinkedNodes: allLinkedNodeIds.size,
    coverageRatio,
    links,
  };

  // 输出 JSON
  const outPath = join(root, GRAPH_DIR, 'REQ_CODE_LINK.json');
  await writeFile(outPath, JSON.stringify(report, null, 2));

  logger.info(`🔗 需求↔代码关联已生成:`);
  logger.info(`   ${links.length} 个需求 ↔ ${allLinkedNodeIds.size} 个代码节点 (覆盖率 ${(coverageRatio * 100).toFixed(0)}%)`);
  logger.info(`   输出: ${outPath}`);

  return report;
}
