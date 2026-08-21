/**
 * Code Knowledge Graph — 统一导出
 * v6.90.0
 */
export * from './types';
export { parseProject } from './parser';
export { buildCodeGraph } from './builder';
export { explainNode, findPath, queryGraph } from './query';
export { generateGraphReport } from './reporter';
export { buildCodeGraphHtml } from './visualizer';
// v6.94.0+: 增量构建
export { buildCodeKnowledgeGraphIncremental } from './incremental-build';
// v6.94.0+: 需求↔代码联动
export { linkRequirementsToCode } from './requirement-linker';

import { join } from 'path';
import { ensureDir, writeFile, pathExists } from 'fs-extra';
import { glob } from 'glob';
import { logger } from '../../utils/logger';
import { parseProject } from './parser';
import { buildCodeGraph } from './builder';
import { generateGraphReport } from './reporter';
import { buildCodeGraphHtml } from './visualizer';
import { extractMultimodalNodes } from './multimodal';
import type { CodeGraph } from './types';

const GRAPH_DIR = '.speccore/code-graph';

export interface BuildGraphOptions {
  scope?: string;
  projectRoot?: string;
  projectName?: string;
}

/**
 * 一键构建代码知识图谱，输出三产物
 */
export async function buildCodeKnowledgeGraph(options: BuildGraphOptions = {}): Promise<CodeGraph> {
  const projectRoot = options.projectRoot || process.cwd();
  const projectName = options.projectName || 'Project';
  const scope = options.scope || 'src';

  const scopePath = join(projectRoot, scope);

  // 1. 扫描文件
  logger.info(`🔍 扫描代码文件: ${scope}`);
  const pattern = join(scopePath, '**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}');
  const files = await glob(pattern, { absolute: true });
  logger.info(`   发现 ${files.length} 个文件`);

  // 2. AST 解析
  logger.info(`🌳 AST 解析中...`);
  const { nodes, edges, fileCount } = await parseProject(files, projectRoot);
  logger.info(`   提取 ${nodes.length} 个节点, ${edges.length} 条边`);

  // 2.5. v6.91.0+: 多模态节点（API Contract + SQL Schema）
  logger.info(`🌐 扫描 API Contract & SQL Schema...`);
  const { nodes: mmNodes, edges: mmEdges } = await extractMultimodalNodes(projectRoot, nodes);
  if (mmNodes.length > 0) {
    logger.info(`   发现 ${mmNodes.length} 个多模态节点, ${mmEdges.length} 条关联边`);
    nodes.push(...mmNodes);
    edges.push(...mmEdges);
  }

  // 3. 构建图谱
  const graph = buildCodeGraph(nodes, edges, projectName, projectRoot, fileCount);
  logger.info(`   社区: ${graph.communities.length} 个 | God nodes: ${graph.godNodes.length} 个`);

  // 4. 输出产物
  const outDir = join(projectRoot, GRAPH_DIR);
  await ensureDir(outDir);

  // graph.json
  const jsonPath = join(outDir, 'graph.json');
  await writeFile(jsonPath, JSON.stringify(graph, null, 2));
  logger.info(`   ✅ graph.json`);

  // GRAPH_REPORT.md
  const reportPath = join(outDir, 'GRAPH_REPORT.md');
  await writeFile(reportPath, generateGraphReport(graph));
  logger.info(`   ✅ GRAPH_REPORT.md`);

  // graph.html
  const htmlPath = join(outDir, 'graph.html');
  await writeFile(htmlPath, buildCodeGraphHtml(graph));
  logger.info(`   ✅ graph.html`);

  // v6.91.0+: MODULE_MAP.json — 社区检测结果映射
  const moduleMapPath = join(outDir, 'MODULE_MAP.json');
  const moduleMap = buildModuleMap(graph);
  await writeFile(moduleMapPath, JSON.stringify(moduleMap, null, 2));
  logger.info(`   ✅ MODULE_MAP.json`);

  logger.info('');
  logger.info(`📊 代码知识图谱已生成: ${outDir}`);
  logger.info(`   打开 ${join(GRAPH_DIR, 'graph.html')} 查看可视化`);

  return graph;
}

/**
 * 从社区检测结果构建 MODULE_MAP
 * v6.91.0+
 */
function buildModuleMap(graph: CodeGraph) {
  const communities = graph.communities.map(comm => {
    const nodeDetails = comm.nodes
      .map(id => graph.nodes.find(n => n.id === id))
      .filter(Boolean);
    const filePaths = [...new Set(nodeDetails.map(n => n!.filePath))];
    // 该社区内的 god nodes
    const commGodNodes = comm.nodes.filter(id => graph.godNodes.includes(id));
    // 该社区的桥梁节点（连接到其他社区的节点）
    const bridgeNodes = new Set<string>();
    for (const e of graph.edges) {
      if (e.source === e.target) continue;
      const s = graph.nodes.find(n => n.id === e.source);
      const t = graph.nodes.find(n => n.id === e.target);
      if (s && t && s.community !== t.community) {
        if (s.community === comm.id) bridgeNodes.add(s.id);
        if (t.community === comm.id) bridgeNodes.add(t.id);
      }
    }
    return {
      id: comm.id,
      label: comm.label,
      nodeCount: comm.nodes.length,
      filePaths,
      density: Math.round(comm.density * 100) / 100,
      godNodes: commGodNodes,
      bridges: [...bridgeNodes],
    };
  });

  const crossCommunityEdges = graph.edges.filter(e => {
    const s = graph.nodes.find(n => n.id === e.source);
    const t = graph.nodes.find(n => n.id === e.target);
    return s && t && s.community !== t.community;
  }).map(e => ({
    source: e.source,
    target: e.target,
    type: e.type,
    confidence: e.confidence,
  }));

  return {
    generatedAt: new Date().toISOString(),
    projectName: graph.metadata.projectName,
    summary: {
      totalCommunities: communities.length,
      totalNodes: graph.metadata.totalNodes,
      totalEdges: graph.metadata.totalEdges,
      crossCommunityEdges: crossCommunityEdges.length,
    },
    communities,
    crossCommunityEdges: crossCommunityEdges.slice(0, 50),
  };
}

/**
 * 加载已存在的 graph.json
 */
export async function loadCodeGraph(projectRoot?: string): Promise<CodeGraph | null> {
  const root = projectRoot || process.cwd();
  const jsonPath = join(root, GRAPH_DIR, 'graph.json');
  if (!(await pathExists(jsonPath))) return null;
  try {
    const { readFile } = await import('fs-extra');
    const raw = await readFile(jsonPath, 'utf-8');
    return JSON.parse(raw) as CodeGraph;
  } catch {
    return null;
  }
}
