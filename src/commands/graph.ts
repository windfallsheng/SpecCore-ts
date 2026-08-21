/**
 * graph — 统一图谱查询命令
 * v7.0.0: 支持知识图谱(KnowledgeGraph) + 代码图谱(CodeGraph) 统一查询
 *
 * 用法:
 *   speccore graph query <question>      自然语言查询两种图谱
 *   speccore graph entity <id>           查询特定实体详情
 *   speccore graph related <id>          查询关联实体(一阶邻居)
 *   speccore graph stats                 输出两种图谱统计
 *   speccore graph path <from> <to>      查找两实体间最短路径
 */
import { logger } from '../utils/logger';
import { writeFile } from 'fs-extra';
import { join, basename, extname, dirname } from 'path';
import {
  loadKnowledgeGraph,
  type KnowledgeGraph,
  type GraphEntity,
  type GraphRelation,
} from '../core/knowledge-graph';
import { loadCodeGraph, queryGraph, explainNode, findPath } from '../core/code-graph';
import type { CodeGraph, CodeNode, CodeEdge } from '../core/code-graph/types';
import { expandQuerySemantically, semanticRank } from '../core/graph-semantic';
import { renderMmdFile, renderFromMarkdown, renderAllMmdInDir, renderAllMarkdownInDir } from '../utils/mermaid-render';

interface GraphQueryOptions {
  iteration?: string;
  type?: 'all' | 'knowledge' | 'code';
  limit?: number;
  /** v7.0.0+: 启用 LLM 语义增强（默认 true） */
  smart?: boolean;
}

// ═══════════════════════════════════════════════════════════
// 知识图谱查询引擎
// ═══════════════════════════════════════════════════════════

/** 在知识图谱中搜索实体（关键词匹配 + 语义标签匹配） */
function searchKnowledgeEntities(
  graph: KnowledgeGraph,
  keywords: string[],
  limit: number = 10,
): { entity: GraphEntity; score: number }[] {
  const results: { entity: GraphEntity; score: number }[] = [];

  for (const entity of Object.values(graph.entities)) {
    const text = `${entity.title} ${entity.type} ${entity.tags?.join(' ') || ''} ${entity.semanticTags?.join(' ') || ''} ${entity.description || ''} ${entity.businessRole || ''}`.toLowerCase();
    let score = 0;

    for (const kw of keywords) {
      const lowerKw = kw.toLowerCase();
      // 标题匹配权重最高
      if (entity.title.toLowerCase().includes(lowerKw)) score += 5;
      // ID 精确匹配
      else if (entity.id.toLowerCase().includes(lowerKw)) score += 4;
      // 语义标签匹配（v7.0.0+）
      else if (entity.semanticTags?.some(t => t.toLowerCase().includes(lowerKw))) score += 3;
      // 业务角色匹配（v7.0.0+）
      else if (entity.businessRole?.toLowerCase().includes(lowerKw)) score += 3;
      // 类型匹配
      else if (entity.type.toLowerCase().includes(lowerKw)) score += 2;
      // 通用文本匹配
      else if (text.includes(lowerKw)) score += 1;
    }

    if (score > 0) {
      results.push({ entity, score });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** 获取实体的关联实体（一阶邻居） */
function getRelatedEntities(
  graph: KnowledgeGraph,
  entityId: string,
): { entity: GraphEntity; relation: GraphRelation }[] {
  const results: { entity: GraphEntity; relation: GraphRelation }[] = [];

  for (const rel of graph.relations) {
    if (rel.from === entityId) {
      const target = graph.entities[rel.to];
      if (target) results.push({ entity: target, relation: rel });
    } else if (rel.to === entityId) {
      const source = graph.entities[rel.from];
      if (source) results.push({ entity: source, relation: rel });
    }
  }

  return results;
}

/** 查找知识图谱中两实体间的路径（BFS） */
function findKnowledgePath(
  graph: KnowledgeGraph,
  fromId: string,
  toId: string,
  maxDepth: number = 5,
): { path: GraphEntity[]; relations: GraphRelation[] } | null {
  const queue: { id: string; path: GraphEntity[]; rels: GraphRelation[] }[] = [
    { id: fromId, path: [graph.entities[fromId]], rels: [] },
  ];
  const visited = new Set<string>([fromId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.path.length > maxDepth) continue;

    if (current.id === toId && current.path.length > 1) {
      return { path: current.path, relations: current.rels };
    }

    for (const rel of graph.relations) {
      let nextId: string | undefined;
      if (rel.from === current.id) nextId = rel.to;
      else if (rel.to === current.id) nextId = rel.from;

      if (nextId && !visited.has(nextId)) {
        visited.add(nextId);
        const nextEntity = graph.entities[nextId];
        if (nextEntity) {
          queue.push({
            id: nextId,
            path: [...current.path, nextEntity],
            rels: [...current.rels, rel],
          });
        }
      }
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════
// 统一查询：融合知识图谱 + 代码图谱
// ═══════════════════════════════════════════════════════════

/** 统一查询两种图谱 */
async function unifiedQuery(
  question: string,
  options: GraphQueryOptions,
): Promise<void> {
  const type = options.type || 'all';
  const limit = options.limit || 10;
  const smart = options.smart !== false; // 默认启用语义增强
  const cwd = process.cwd();

  logger.info(`\n🔍 查询: "${question}"`);
  logger.info(`   范围: ${type}${smart ? ' | 模式: 语义增强 (LLM)' : ' | 模式: 快速匹配'}`);

  // v7.0.0+: 语义扩展查询词
  let keywords: string[] = [];
  let semanticInfo: { intent?: string; domain?: string; queryType?: string } = {};

  if (smart) {
    try {
      const expansion = await expandQuerySemantically(question, { useLlm: true });
      keywords = expansion.keywords;
      semanticInfo = {
        intent: expansion.intent,
        domain: expansion.domain,
        queryType: expansion.queryType,
      };
      logger.info(`   语义扩展: ${keywords.slice(0, 8).join(', ')}${keywords.length > 8 ? `... (${keywords.length} 个)` : ''}`);
      if (expansion.domain) logger.info(`   业务域: ${expansion.domain}`);
      if (expansion.queryType) logger.info(`   查询类型: ${expansion.queryType}`);
    } catch {
      // 降级到原始关键词
      keywords = extractRawKeywords(question);
      logger.info(`   关键词: ${keywords.join(', ')} (本地提取)`);
    }
  } else {
    keywords = extractRawKeywords(question);
    logger.info(`   关键词: ${keywords.join(', ')}`);
  }

  if (keywords.length === 0) {
    logger.error('查询词太短，请提供更具体的关键词');
    return;
  }

  logger.info('');
  let hasResults = false;

  // 1. 查询知识图谱（含语义排序）
  if (type === 'all' || type === 'knowledge') {
    const kg = await loadKnowledgeGraph(cwd);
    if (kg) {
      const kgLocalResults = searchKnowledgeEntities(kg, keywords, limit * 3); // 先取更多候选

      if (kgLocalResults.length > 0 && smart) {
        // LLM 语义排序
        const candidates = kgLocalResults.map(r => ({ entity: r.entity, localScore: r.score }));
        const ranked = await semanticRank(question, candidates, { topK: limit * 2, useLlm: true });
        const finalResults = ranked.slice(0, limit);

        if (finalResults.length > 0) {
          hasResults = true;
          logger.info(`📚 知识图谱匹配 (${finalResults.length} 个实体，语义排序):`);
          logger.info('─'.repeat(60));
          for (const { entity, localScore, semanticScore, finalScore, reason } of finalResults) {
            const tags = entity.tags?.join(', ') || '';
            const semantic = entity.semanticTags?.join(', ') || '';
            const status = entity.status ? `[${entity.status}]` : '';
            logger.info(`   [综合:${finalScore.toFixed(1)} 本地:${localScore.toFixed(1)} 语义:${semanticScore.toFixed(1)}] ${entity.id}`);
            logger.info(`       类型: ${entity.type} ${status}`);
            logger.info(`       标题: ${entity.title}`);
            if (tags) logger.info(`       标签: ${tags}`);
            if (semantic) logger.info(`       语义: ${semantic}`);
            if (entity.businessRole) logger.info(`       职责: ${entity.businessRole}`);
            if (reason) logger.info(`       匹配理由: ${reason}`);
            if (entity.file) logger.info(`       文件: ${entity.file}`);
            logger.info('');
          }
        }
      } else if (kgLocalResults.length > 0) {
        hasResults = true;
        logger.info(`📚 知识图谱匹配 (${kgLocalResults.length} 个实体):`);
        logger.info('─'.repeat(60));
        for (const { entity, score } of kgLocalResults.slice(0, limit)) {
          const tags = entity.tags?.join(', ') || '';
          const semantic = entity.semanticTags?.join(', ') || '';
          const status = entity.status ? `[${entity.status}]` : '';
          logger.info(`   [${score.toFixed(1)}] ${entity.id}`);
          logger.info(`       类型: ${entity.type} ${status}`);
          logger.info(`       标题: ${entity.title}`);
          if (tags) logger.info(`       标签: ${tags}`);
          if (semantic) logger.info(`       语义: ${semantic}`);
          if (entity.businessRole) logger.info(`       职责: ${entity.businessRole}`);
          if (entity.file) logger.info(`       文件: ${entity.file}`);
          logger.info('');
        }
      }
    }
  }

  // 2. 查询代码图谱
  if (type === 'all' || type === 'code') {
    const cg = await loadCodeGraph(cwd);
    if (cg) {
      const cgResult = queryGraph(cg, question);
      if (cgResult.nodes.length > 0) {
        hasResults = true;
        logger.info(`💻 代码图谱匹配 (${cgResult.nodes.length} 个节点):`);
        logger.info('─'.repeat(60));
        for (const node of cgResult.nodes.slice(0, limit)) {
          logger.info(`   • ${node.name} (${node.type})`);
          logger.info(`       文件: ${node.filePath}:${node.line}`);
          if (node.snippet) {
            const snippet = node.snippet.length > 100
              ? node.snippet.slice(0, 100) + '...'
              : node.snippet;
            logger.info(`       片段: ${snippet}`);
          }
          logger.info('');
        }
        if (cgResult.nodes.length > limit) {
          logger.info(`   ... 及其他 ${cgResult.nodes.length - limit} 个节点`);
        }
      }
    }
  }

  if (!hasResults) {
    logger.info('\n⚠️  未在图谱中找到匹配结果，建议:');
    logger.info('   1. 先运行 speccore knowledge 构建知识图谱');
    logger.info('   2. 先运行 speccore code-index --graph 构建代码图谱');
    logger.info('   3. 使用更具体的关键词重试');
    if (!smart) {
      logger.info('   4. 尝试使用 --smart 模式启用语义增强查询');
    }
  }
}

/** 提取原始关键词 */
function extractRawKeywords(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);
}

// ═══════════════════════════════════════════════════════════
// 子命令实现
// ═══════════════════════════════════════════════════════════

/** graph query — 自然语言查询 */
export async function graphQueryCommand(question: string, options: GraphQueryOptions): Promise<void> {
  await unifiedQuery(question, options);
}

/** graph render — 渲染 Mermaid 图表 */
export async function graphRenderCommand(
  filePath: string | undefined,
  options: { all?: boolean; extract?: boolean; output?: string },
): Promise<void> {
  const cwd = process.cwd();
  const outputDir = options.output ? join(cwd, options.output) : undefined;

  // 模式1: 批量渲染 diagrams/ 目录下所有 .mmd
  if (options.all) {
    const diagramsDir = join(cwd, '.speccore', 'GLOBAL', 'diagrams');
    logger.info(`\n🎨 批量渲染 Mermaid 图表: ${diagramsDir}\n`);

    const mmdResults = await renderAllMmdInDir(diagramsDir, { outputDir });
    if (mmdResults.length === 0) {
      logger.info('  未找到 .mmd 文件');
    } else {
      logger.info(`\n  共渲染 ${mmdResults.length} 个 .mmd 文件`);
    }
    return;
  }

  // 模式2: 从 Markdown 提取并渲染
  if (options.extract && filePath) {
    const fullPath = filePath.startsWith('/') ? filePath : join(cwd, filePath);
    logger.info(`\n🎨 从 Markdown 提取 Mermaid: ${fullPath}\n`);

    const html = await renderFromMarkdown(fullPath, { outputDir });
    if (html) {
      const outputName = basename(filePath, extname(filePath)) + '-diagrams.html';
      const outputPath = outputDir ? join(outputDir, outputName) : join(dirname(fullPath), outputName);
      await writeFile(outputPath, html, 'utf-8');
      logger.info(`  ✓ 已生成: ${outputPath}`);
    }
    return;
  }

  // 模式3: 渲染单个 .mmd 文件
  if (filePath) {
    const fullPath = filePath.startsWith('/') ? filePath : join(cwd, filePath);
    logger.info(`\n🎨 渲染 Mermaid: ${fullPath}\n`);

    const html = await renderMmdFile(fullPath, { outputDir });
    if (html) {
      const outputName = basename(filePath, extname(filePath)) + '.html';
      const outputPath = outputDir ? join(outputDir, outputName) : join(dirname(fullPath), outputName);
      await writeFile(outputPath, html, 'utf-8');
      logger.info(`  ✓ 已生成: ${outputPath}`);
    }
    return;
  }

  logger.error('请提供文件路径，或使用 --all 批量渲染');
  logger.info('用法:');
  logger.info('  speccore graph render <file.mmd>');
  logger.info('  speccore graph render --all');
  logger.info('  speccore graph render --extract <file.md>');
}

/** graph entity — 查询特定实体 */
export async function graphEntityCommand(entityId: string, options: GraphQueryOptions): Promise<void> {
  const cwd = process.cwd();
  const type = options.type || 'all';

  logger.info(`\n📍 实体详情: ${entityId}\n`);

  // 知识图谱
  if (type === 'all' || type === 'knowledge') {
    const kg = await loadKnowledgeGraph(cwd);
    if (kg && kg.entities[entityId]) {
      const e = kg.entities[entityId];
      logger.info('📚 知识图谱实体:');
      logger.info('─'.repeat(50));
      logger.info(`   ID: ${e.id}`);
      logger.info(`   类型: ${e.type}`);
      logger.info(`   标题: ${e.title}`);
      if (e.status) logger.info(`   状态: ${e.status}`);
      if (e.platform) logger.info(`   端: ${e.platform}`);
      if (e.tags?.length) logger.info(`   标签: ${e.tags.join(', ')}`);
      if (e.semanticTags?.length) logger.info(`   语义标签: ${e.semanticTags.join(', ')}`);
      if (e.businessRole) logger.info(`   业务职责: ${e.businessRole}`);
      if (e.description) logger.info(`   描述: ${e.description}`);
      if (e.file) logger.info(`   文件: ${e.file}`);

      // 关联实体
      const related = getRelatedEntities(kg, entityId);
      if (related.length > 0) {
        logger.info(`\n   🔗 关联实体 (${related.length} 个):`);
        for (const { entity, relation } of related) {
          const dir = relation.from === entityId ? '-->' : '<--';
          logger.info(`      ${dir} ${entity.id} [${relation.type}]`);
        }
      }
      logger.info('');
      return;
    }
  }

  // 代码图谱
  if (type === 'all' || type === 'code') {
    const cg = await loadCodeGraph(cwd);
    if (cg) {
      const result = explainNode(cg, entityId);
      if (result.nodes.length > 0) {
        const target = result.nodes.find(n => n.id === entityId || n.name === entityId);
        logger.info('💻 代码图谱节点:');
        logger.info('─'.repeat(50));
        logger.info(`   名称: ${target?.name || entityId}`);
        logger.info(`   类型: ${target?.type}`);
        logger.info(`   文件: ${target?.filePath}:${target?.line}`);
        if (target?.snippet) logger.info(`   片段: ${target.snippet.slice(0, 150)}...`);
        logger.info(`   度数: ${target?.degree || 'N/A'}`);
        logger.info(`   社区: ${target?.community || 'N/A'}`);

        if (result.edges.length > 0) {
          logger.info(`\n   🔗 连接 (${result.edges.length} 条):`);
          for (const edge of result.edges.slice(0, 15)) {
            const other = edge.source === target?.id
              ? result.nodes.find(n => n.id === edge.target)
              : result.nodes.find(n => n.id === edge.source);
            const dir = edge.source === target?.id ? '-->' : '<--';
            logger.info(`      ${dir} ${other?.name || '...'} [${edge.type}] (${edge.confidence})`);
          }
        }
        logger.info('');
        return;
      }
    }
  }

  logger.error(`未找到实体: ${entityId}`);
  logger.info('提示: 使用 speccore graph query <关键词> 搜索实体 ID');
}

/** graph related — 查询关联实体 */
export async function graphRelatedCommand(entityId: string, options: GraphQueryOptions): Promise<void> {
  const cwd = process.cwd();
  const kg = await loadKnowledgeGraph(cwd);

  if (!kg || !kg.entities[entityId]) {
    logger.error(`知识图谱中未找到实体: ${entityId}`);
    return;
  }

  const related = getRelatedEntities(kg, entityId);
  if (related.length === 0) {
    logger.info(`实体 ${entityId} 没有关联实体`);
    return;
  }

  logger.info(`\n🔗 ${entityId} 的关联实体 (${related.length} 个):\n`);

  // 按关系类型分组
  const byType = new Map<string, typeof related>();
  for (const item of related) {
    const list = byType.get(item.relation.type) || [];
    list.push(item);
    byType.set(item.relation.type, list);
  }

  for (const [relType, items] of byType) {
    logger.info(`   [${relType}] (${items.length} 个):`);
    for (const { entity } of items) {
      logger.info(`      • ${entity.id} — ${entity.title}`);
      if (entity.semanticTags?.length) {
        logger.info(`        语义: ${entity.semanticTags.join(', ')}`);
      }
    }
    logger.info('');
  }
}

/** graph stats — 图谱统计 */
export async function graphStatsCommand(options: GraphQueryOptions): Promise<void> {
  const cwd = process.cwd();
  const type = options.type || 'all';

  logger.info('\n📊 知识图谱统计\n');
  logger.info('─'.repeat(50));

  if (type === 'all' || type === 'knowledge') {
    const kg = await loadKnowledgeGraph(cwd);
    if (kg) {
      const entityCount = Object.keys(kg.entities).length;
      const withSemantic = Object.values(kg.entities).filter(e => e.semanticTags && e.semanticTags.length > 0).length;
      const withDesc = Object.values(kg.entities).filter(e => e.description).length;

      logger.info('📚 知识图谱 (Knowledge Graph):');
      logger.info(`   实体总数: ${entityCount}`);
      logger.info(`   关系总数: ${kg.relations.length}`);
      logger.info(`   迭代: ${kg.iteration}`);
      logger.info(`   生成时间: ${kg.generated}`);
      logger.info(`   需求: ${kg.stats.requirements}`);
      logger.info(`   规格: ${kg.stats.specs}`);
      logger.info(`   任务: ${kg.stats.tasks}`);
      logger.info(`   子任务: ${kg.stats.subtasks}`);
      logger.info(`   源码文件: ${kg.stats.sourceFiles}`);
      logger.info(`   全局文档: ${kg.stats.globalDocs}`);
      logger.info(`   业务模块: ${kg.stats.businessModules}`);
      logger.info(`   含语义标签: ${withSemantic} (${Math.round(withSemantic / entityCount * 100)}%)`);
      logger.info(`   含描述: ${withDesc} (${Math.round(withDesc / entityCount * 100)}%)`);
    } else {
      logger.info('📚 知识图谱: 未构建 (运行 speccore knowledge)');
    }
  }

  if (type === 'all' || type === 'code') {
    const cg = await loadCodeGraph(cwd);
    if (cg) {
      logger.info('\n💻 代码图谱 (Code Graph):');
      logger.info(`   节点总数: ${cg.metadata.totalNodes}`);
      logger.info(`   边总数: ${cg.metadata.totalEdges}`);
      logger.info(`   扫描文件: ${cg.metadata.scannedFiles}`);
      logger.info(`   社区数: ${cg.communities.length}`);
      logger.info(`   God 节点: ${cg.godNodes.length}`);
      logger.info(`   生成时间: ${cg.metadata.generatedAt}`);
    } else {
      logger.info('\n💻 代码图谱: 未构建 (运行 speccore code-index --graph)');
    }
  }

  logger.info('');
}

/** graph path — 查找两实体间路径 */
export async function graphPathCommand(from: string, to: string, options: GraphQueryOptions): Promise<void> {
  const cwd = process.cwd();
  const type = options.type || 'all';

  logger.info(`\n🛤️  路径查询: ${from} → ${to}\n`);

  // 优先查知识图谱
  if (type === 'all' || type === 'knowledge') {
    const kg = await loadKnowledgeGraph(cwd);
    if (kg) {
      const result = findKnowledgePath(kg, from, to);
      if (result) {
        logger.info('📚 知识图谱路径:');
        logger.info('─'.repeat(50));
        for (let i = 0; i < result.path.length; i++) {
          const entity = result.path[i];
          logger.info(`   ${i + 1}. ${entity.id} (${entity.type})`);
          logger.info(`      ${entity.title}`);
          if (i < result.path.length - 1) {
            const rel = result.relations[i];
            logger.info(`      [${rel.type}]${rel.metadata ? ` {${Object.entries(rel.metadata).map(([k, v]) => `${k}=${v}`).join(', ')}}` : ''}`);
          }
        }
        logger.info(`\n   总步数: ${result.path.length - 1}\n`);
        return;
      }
    }
  }

  // 回退到代码图谱
  if (type === 'all' || type === 'code') {
    const cg = await loadCodeGraph(cwd);
    if (cg) {
      const result = findPath(cg, from, to);
      if (result.path && result.path.length > 0) {
        logger.info('💻 代码图谱路径:');
        logger.info('─'.repeat(50));
        for (let i = 0; i < result.path.length; i++) {
          const node = result.nodes.find(n => n.id === result.path![i]);
          logger.info(`   ${i + 1}. ${node?.name || result.path[i]} (${node?.type})`);
          if (i < result.path.length - 1 && result.edges[i]) {
            logger.info(`      [${result.edges[i].type}] (${result.edges[i].confidence})`);
          }
        }
        logger.info(`\n   总步数: ${result.path.length - 1}\n`);
        return;
      }
    }
  }

  logger.error(`未找到从 ${from} 到 ${to} 的路径`);
}
