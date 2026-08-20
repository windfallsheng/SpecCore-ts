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

import { join } from 'path';
import { ensureDir, writeFile, pathExists } from 'fs-extra';
import { glob } from 'glob';
import { logger } from '../../utils/logger';
import { parseProject } from './parser';
import { buildCodeGraph } from './builder';
import { generateGraphReport } from './reporter';
import { buildCodeGraphHtml } from './visualizer';
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

  logger.info('');
  logger.info(`📊 代码知识图谱已生成: ${outDir}`);
  logger.info(`   打开 ${join(GRAPH_DIR, 'graph.html')} 查看可视化`);

  return graph;
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
