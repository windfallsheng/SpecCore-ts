/**
 * knowledge — 知识图谱可视化：生成交互式 HTML 页面
 *
 * 展示：知识图谱（vis-network 力导向图）+ 衰减检测 + RAG 上下文预览
 * 用法：speccore knowledge [--export <path>] [-I <iteration>]
 */
import { join } from 'path';
import { readFile, writeFile, pathExists, ensureDir } from 'fs-extra';
import { logger } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { buildKnowledgeGraph } from '../core/knowledge-graph';
import { detectDecay } from '../core/decay-detector';
import { buildContextMarkdown } from '../core/context-builder';
import { buildKnowledgeHtml } from '../core/knowledge-visualizer';
import { loadCodeGraph, explainNode, findPath, queryGraph } from '../core/code-graph';

export interface KnowledgeOptions {
  iteration?: string;
  export?: string;
}

export async function knowledgeCommand(options: KnowledgeOptions): Promise<void> {
  const iteration = await getDefaultIteration(options.iteration);
  if (!iteration) {
    logger.error('未找到活跃迭代，请先创建迭代: speccore iteration create');
    return;
  }

  const iterDir = `Iteration-${iteration}`;
  if (!(await pathExists(iterDir))) {
    logger.error(`迭代目录不存在: ${iterDir}`);
    return;
  }

  logger.info(`🧠 正在构建知识图谱: ${iteration}`);

  // 1. 构建知识图谱
  const cwd = process.cwd();
  const graph = await buildKnowledgeGraph(cwd, iteration);
  logger.info(`   ✅ 实体: ${Object.keys(graph.entities).length} 个, 关系: ${graph.relations.length} 条`);

  // 2. 衰减检测
  let decay;
  try {
    decay = await detectDecay(cwd, graph);
    logger.info(`   ✅ 衰减检测: ${decay.decayedFiles.length} 个告警`);
  } catch (e) {
    logger.debug('衰减检测失败（非关键）:', e);
  }

  // 3. 构建 RAG 上下文
  let contextMarkdown: string | undefined;
  try {
    contextMarkdown = buildContextMarkdown(graph, decay);
    logger.info(`   ✅ RAG 上下文: ${contextMarkdown.length} 字符`);
  } catch (e) {
    logger.debug('上下文构建失败（非关键）:', e);
  }

  // 4. 读取项目名（多源兜底：project.json → package.json → 目录名）
  let projectName = 'Project';
  const configPath = join(cwd, '.speccore', 'config', 'project.json');
  if (await pathExists(configPath)) {
    try {
      const config = JSON.parse(await readFile(configPath, 'utf-8'));
      projectName = config.name || projectName;
    } catch {}
  }
  // 兜底：从 package.json 取
  if (projectName === 'Project') {
    const pkgPath = join(cwd, 'package.json');
    if (await pathExists(pkgPath)) {
      try {
        const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
        projectName = pkg.name || projectName;
      } catch {}
    }
  }
  // 兜底：用当前目录名
  if (projectName === 'Project') {
    projectName = cwd.split('/').pop() || 'Project';
  }

  // 5. 生成 HTML
  const html = buildKnowledgeHtml({
    graph,
    decay,
    contextMarkdown,
    projectName,
    iterationName: iteration,
  });

  // 6. 输出
  const outPath = options.export
    ? (options.export.endsWith('.html') ? options.export : options.export + '.html')
    : join(cwd, 'outputs', `knowledge-graph-${iteration}.html`);

  await ensureDir(join(cwd, 'outputs'));
  await writeFile(outPath, html, 'utf-8');
  logger.success(`\n✅ 知识图谱可视化页面已生成: ${outPath}`);
  logger.info(`\n[SPECCORE_KNOWLEDGE: ${outPath}]`);
}

/**
 * knowledge explain — 解释代码图谱中的节点
 */
export async function knowledgeExplainCommand(nodeName: string): Promise<void> {
  const graph = await loadCodeGraph();
  if (!graph) {
    logger.error('代码知识图谱不存在，请先运行: speccore code-index --graph');
    return;
  }

  const result = explainNode(graph, nodeName);
  if (result.nodes.length === 0) {
    logger.error(`未找到节点: ${nodeName}`);
    return;
  }

  const target = result.nodes.find(n => n.name === nodeName || n.id === nodeName);
  logger.info(`\n📍 ${target?.name} (${target?.type})`);
  logger.info(`   file: ${target?.filePath}:${target?.line}`);
  logger.info(`   degree: ${target?.degree} | community: ${target?.community}`);
  logger.info(`   snippet: ${target?.snippet?.slice(0, 120)}...`);
  logger.info('\n🔗 Connections:');
  for (const e of result.edges.slice(0, 20)) {
    const other = e.source === target?.id
      ? result.nodes.find(n => n.id === e.target)
      : result.nodes.find(n => n.id === e.source);
    const otherLabel = other?.name || (e.source === target?.id ? e.target : e.source);
    const dir = e.source === target?.id ? '-->' : '<--';
    logger.info(`   ${dir} ${otherLabel} [${e.type}] (${e.confidence})`);
  }
}

/**
 * knowledge path — 查找两个节点之间的最短路径
 */
export async function knowledgePathCommand(source: string, target: string): Promise<void> {
  const graph = await loadCodeGraph();
  if (!graph) {
    logger.error('代码知识图谱不存在，请先运行: speccore code-index --graph');
    return;
  }

  const result = findPath(graph, source, target);
  if (!result.path || result.path.length === 0) {
    logger.error(`未找到从 ${source} 到 ${target} 的路径`);
    return;
  }

  logger.info(`\n🛤️  Shortest path (${result.path.length} hops):`);
  for (let i = 0; i < result.path.length; i++) {
    const node = result.nodes.find(n => n.id === result.path![i]);
    logger.info(`   ${i + 1}. ${node?.name} (${node?.type})`);
    if (i < result.path.length - 1) {
      const edge = result.edges[i];
      logger.info(`      [${edge.type}] (${edge.confidence})`);
    }
  }
}

/**
 * knowledge query — 自然语言查询代码图谱
 */
export async function knowledgeQueryCommand(question: string): Promise<void> {
  const graph = await loadCodeGraph();
  if (!graph) {
    logger.error('代码知识图谱不存在，请先运行: speccore code-index --graph');
    return;
  }

  const result = queryGraph(graph, question);
  if (result.nodes.length === 0) {
    logger.info('未找到匹配结果，尝试更具体的关键词');
    return;
  }

  logger.info(`\n🔍 Query: "${question}"`);
  logger.info(`   匹配 ${result.nodes.length} 个节点, ${result.edges.length} 条边\n`);

  for (const n of result.nodes.slice(0, 15)) {
    logger.info(`   • ${n.name} (${n.type}) — ${n.filePath}:${n.line}`);
  }
  if (result.nodes.length > 15) {
    logger.info(`   ... 及其他 ${result.nodes.length - 15} 个节点`);
  }
}
