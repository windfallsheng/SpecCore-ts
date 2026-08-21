/**
 * Code Knowledge Graph — 增量构建引擎
 * v6.94.0: 基于文件 mtime 的增量更新，避免全量重扫
 */
import { join, relative } from 'path';
import { readFile, writeFile, pathExists, stat, ensureDir } from 'fs-extra';
import { glob } from 'glob';
import { createHash } from 'crypto';
import { logger } from '../../utils/logger';
import { parseProject } from './parser';
import { buildCodeGraph } from './builder';
import { extractMultimodalNodes } from './multimodal';
import { generateGraphReport } from './reporter';
import { buildCodeGraphHtml } from './visualizer';
import type { CodeGraph, CodeNode, CodeEdge } from './types';

const GRAPH_DIR = '.speccore/code-graph';
const STATE_FILE = '.graph-state.json';

interface FileState {
  mtime: number;
  hash: string;
}

interface GraphState {
  version: number;
  lastBuildAt: string;
  files: Record<string, FileState>;
}

async function computeFileHash(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('md5').update(content).digest('hex');
}

async function loadGraphState(projectRoot: string): Promise<GraphState | null> {
  const statePath = join(projectRoot, GRAPH_DIR, STATE_FILE);
  if (!(await pathExists(statePath))) return null;
  try {
    const raw = await readFile(statePath, 'utf-8');
    return JSON.parse(raw) as GraphState;
  } catch {
    return null;
  }
}

async function saveGraphState(projectRoot: string, state: GraphState): Promise<void> {
  const statePath = join(projectRoot, GRAPH_DIR, STATE_FILE);
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

/**
 * 计算文件变更集合
 * @returns changedFiles, unchangedFiles, deletedFiles
 */
async function computeFileChanges(
  projectRoot: string,
  scope: string,
  previousState: GraphState | null
): Promise<{
  changedFiles: string[];
  unchangedFiles: string[];
  deletedFiles: string[];
  currentFiles: Record<string, FileState>;
}> {
  const scopePath = join(projectRoot, scope);
  const pattern = join(scopePath, '**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}');
  const allFiles = await glob(pattern, { absolute: true });

  const currentFiles: Record<string, FileState> = {};
  const changedFiles: string[] = [];
  const unchangedFiles: string[] = [];

  for (const filePath of allFiles) {
    const rel = relative(projectRoot, filePath);
    const s = await stat(filePath);
    const mtime = s.mtimeMs;

    let hash = '';
    const prev = previousState?.files[rel];
    if (prev && prev.mtime === mtime) {
      // mtime 未变，认为未变化（快速路径）
      hash = prev.hash;
      unchangedFiles.push(filePath);
    } else {
      hash = await computeFileHash(filePath);
      if (prev && prev.hash === hash) {
        // hash 相同，仅 mtime 变化（如 git checkout）
        unchangedFiles.push(filePath);
      } else {
        changedFiles.push(filePath);
      }
    }
    currentFiles[rel] = { mtime, hash };
  }

  // 检测删除的文件
  const deletedFiles: string[] = [];
  if (previousState) {
    for (const rel of Object.keys(previousState.files)) {
      if (!currentFiles[rel]) {
        deletedFiles.push(join(projectRoot, rel));
      }
    }
  }

  return { changedFiles, unchangedFiles, deletedFiles, currentFiles };
}

/**
 * 从已有 graph.json 中过滤出未变化文件的节点和边
 */
function filterUnchangedGraph(
  existingGraph: CodeGraph,
  changedFiles: string[],
  deletedFiles: string[],
  projectRoot: string
): { nodes: CodeNode[]; edges: CodeEdge[] } {
  const changedSet = new Set(changedFiles.map(f => relative(projectRoot, f)));
  const deletedSet = new Set(deletedFiles.map(f => relative(projectRoot, f)));

  const keepNodes = existingGraph.nodes.filter(n => {
    const relPath = relative(projectRoot, n.filePath);
    return !changedSet.has(relPath) && !deletedSet.has(relPath);
  });

  const keepNodeIds = new Set(keepNodes.map(n => n.id));
  const keepEdges = existingGraph.edges.filter(e => {
    // 保留两端都在未变化文件中的边
    const sourceNode = existingGraph.nodes.find(n => n.id === e.source);
    const targetNode = existingGraph.nodes.find(n => n.id === e.target);
    if (!sourceNode || !targetNode) return false;
    const sRel = relative(projectRoot, sourceNode.filePath);
    const tRel = relative(projectRoot, targetNode.filePath);
    return !changedSet.has(sRel) && !deletedSet.has(sRel) &&
           !changedSet.has(tRel) && !deletedSet.has(tRel);
  });

  return { nodes: keepNodes, edges: keepEdges };
}

export interface IncrementalBuildOptions {
  scope?: string;
  projectRoot?: string;
  projectName?: string;
}

/**
 * 增量构建代码知识图谱
 */
export async function buildCodeKnowledgeGraphIncremental(
  options: IncrementalBuildOptions = {}
): Promise<CodeGraph> {
  const projectRoot = options.projectRoot || process.cwd();
  const projectName = options.projectName || 'Project';
  const scope = options.scope || 'src';

  const previousState = await loadGraphState(projectRoot);
  const existingGraph = previousState ? await loadExistingGraph(projectRoot) : null;

  const { changedFiles, unchangedFiles, deletedFiles, currentFiles } =
    await computeFileChanges(projectRoot, scope, previousState);

  logger.info(`🔍 增量扫描: ${scope}`);
  logger.info(`   变化文件: ${changedFiles.length} | 未变: ${unchangedFiles.length} | 删除: ${deletedFiles.length}`);

  if (changedFiles.length === 0 && deletedFiles.length === 0 && existingGraph) {
    logger.info('   无文件变化，跳过构建');
    return existingGraph;
  }

  // 解析变化文件
  let newNodes: CodeNode[] = [];
  let newEdges: CodeEdge[] = [];

  if (changedFiles.length > 0) {
    logger.info(`🌳 AST 解析变化文件...`);
    const { nodes, edges, fileCount } = await parseProject(changedFiles, projectRoot);
    newNodes = nodes;
    newEdges = edges;
    logger.info(`   提取 ${nodes.length} 节点, ${edges.length} 边 (来自 ${fileCount} 文件)`);
  }

  // 多模态节点（增量：只扫描变化文件所在目录）
  logger.info(`🌐 扫描 API Contract & SQL Schema...`);
  const allNodesForMultimodal = existingGraph ? [...existingGraph.nodes, ...newNodes] : newNodes;
  const { nodes: mmNodes, edges: mmEdges } = await extractMultimodalNodes(projectRoot, allNodesForMultimodal);
  if (mmNodes.length > 0) {
    logger.info(`   发现 ${mmNodes.length} 多模态节点, ${mmEdges.length} 关联边`);
  }

  // 合并：保留未变 + 新增
  let mergedNodes: CodeNode[];
  let mergedEdges: CodeEdge[];

  if (existingGraph) {
    const { nodes: keepNodes, edges: keepEdges } = filterUnchangedGraph(
      existingGraph, changedFiles, deletedFiles, projectRoot
    );
    mergedNodes = [...keepNodes, ...newNodes, ...mmNodes];
    mergedEdges = [...keepEdges, ...newEdges, ...mmEdges];
    // 去重（基于节点 id）
    const nodeIdSet = new Set<string>();
    mergedNodes = mergedNodes.filter(n => {
      if (nodeIdSet.has(n.id)) return false;
      nodeIdSet.add(n.id);
      return true;
    });
    // 边去重（基于 source+target+type）
    const edgeKeySet = new Set<string>();
    mergedEdges = mergedEdges.filter(e => {
      const key = `${e.source}|${e.target}|${e.type}`;
      if (edgeKeySet.has(key)) return false;
      edgeKeySet.add(key);
      return true;
    });
  } else {
    mergedNodes = [...newNodes, ...mmNodes];
    mergedEdges = [...newEdges, ...mmEdges];
  }

  // 构建图谱（重新计算 degree、communities、godNodes）
  const totalScannedFiles = changedFiles.length + unchangedFiles.length;
  const graph = buildCodeGraph(mergedNodes, mergedEdges, projectName, projectRoot, totalScannedFiles);

  logger.info(`   社区: ${graph.communities.length} | God nodes: ${graph.godNodes.length}`);

  // 输出产物
  const outDir = join(projectRoot, GRAPH_DIR);
  await ensureDir(outDir);

  await writeFile(join(outDir, 'graph.json'), JSON.stringify(graph, null, 2));
  logger.info('   ✅ graph.json');

  await writeFile(join(outDir, 'GRAPH_REPORT.md'), generateGraphReport(graph));
  logger.info('   ✅ GRAPH_REPORT.md');

  await writeFile(join(outDir, 'graph.html'), buildCodeGraphHtml(graph));
  logger.info('   ✅ graph.html');

  // 保存状态
  const newState: GraphState = {
    version: 1,
    lastBuildAt: new Date().toISOString(),
    files: currentFiles,
  };
  await saveGraphState(projectRoot, newState);

  logger.info('');
  logger.info(`📊 代码知识图谱已增量更新: ${outDir}`);

  return graph;
}

async function loadExistingGraph(projectRoot: string): Promise<CodeGraph | null> {
  const jsonPath = join(projectRoot, GRAPH_DIR, 'graph.json');
  if (!(await pathExists(jsonPath))) return null;
  try {
    const raw = await readFile(jsonPath, 'utf-8');
    return JSON.parse(raw) as CodeGraph;
  } catch {
    return null;
  }
}

