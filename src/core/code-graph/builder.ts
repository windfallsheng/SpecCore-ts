/**
 * Code Knowledge Graph — 图谱构建器
 * v6.90.0
 */
import { dirname } from 'path';
import type { CodeGraph, CodeNode, CodeEdge, CodeCommunity } from './types';

/**
 * 计算节点度数、识别 god nodes、构建完整图谱
 */
export function buildCodeGraph(
  nodes: CodeNode[],
  edges: CodeEdge[],
  projectName: string,
  projectRoot: string,
  scannedFiles: number
): CodeGraph {
  // 0. 构建 name → id 映射，修复跨文件引用的裸名
  const idSet = new Set(nodes.map(n => n.id));
  const nameToIds = new Map<string, string[]>();
  for (const n of nodes) {
    if (!nameToIds.has(n.name)) nameToIds.set(n.name, []);
    nameToIds.get(n.name)!.push(n.id);
  }

  for (const e of edges) {
    if (!idSet.has(e.source) && nameToIds.has(e.source)) {
      e.source = nameToIds.get(e.source)![0];
    }
    if (!idSet.has(e.target) && nameToIds.has(e.target)) {
      e.target = nameToIds.get(e.target)![0];
    }
  }

  // 1. 计算每个节点的度数
  const degreeMap = new Map<string, number>();
  for (const n of nodes) {
    degreeMap.set(n.id, 0);
  }
  for (const e of edges) {
    if (idSet.has(e.source)) degreeMap.set(e.source, (degreeMap.get(e.source) || 0) + 1);
    if (idSet.has(e.target)) degreeMap.set(e.target, (degreeMap.get(e.target) || 0) + 1);
  }

  // 2. 按度数排序，识别 god nodes（前10%）
  const sortedByDegree = Array.from(degreeMap.entries())
    .sort((a, b) => b[1] - a[1]);
  const godNodeThreshold = Math.max(1, Math.floor(nodes.length * 0.1));
  const godNodes = sortedByDegree.slice(0, godNodeThreshold).map(([id]) => id);

  // 3. 给节点附加度数
  const enrichedNodes = nodes.map(n => ({
    ...n,
    degree: degreeMap.get(n.id) || 0,
  }));

  // 4. 社区检测（基于目录路径 + 连通分量）
  const communities = detectCommunities(enrichedNodes, edges);

  // 5. 统计
  const extractedEdges = edges.filter(e => e.confidence === 'EXTRACTED').length;
  const inferredEdges = edges.filter(e => e.confidence === 'INFERRED').length;

  return {
    nodes: enrichedNodes,
    edges,
    communities,
    godNodes,
    metadata: {
      projectName,
      projectRoot,
      scannedFiles,
      totalNodes: nodes.length,
      totalEdges: edges.length,
      extractedEdges,
      inferredEdges,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * 社区检测：基于目录结构 + 简单连通分量
 */
function detectCommunities(nodes: CodeNode[], edges: CodeEdge[]): CodeCommunity[] {
  // Step 1: 按目录路径初步分组
  const dirGroups = new Map<string, string[]>();
  for (const n of nodes) {
    const dir = dirname(n.filePath);
    if (!dirGroups.has(dir)) dirGroups.set(dir, []);
    dirGroups.get(dir)!.push(n.id);
  }

  // Step 2: 用 Union-Find 合并有边连接的组
  const uf = new UnionFind(nodes.map(n => n.id));
  for (const e of edges) {
    uf.union(e.source, e.target);
  }

  // Step 3: 按连通分量 + 目录信息生成社区
  const componentMap = new Map<string, string[]>();
  for (const n of nodes) {
    const root = uf.find(n.id);
    if (!componentMap.has(root)) componentMap.set(root, []);
    componentMap.get(root)!.push(n.id);
  }

  const communities: CodeCommunity[] = [];
  let commId = 0;

  for (const [, members] of componentMap) {
    if (members.length < 2) continue; // 忽略孤立节点

    // 找社区标签：取成员最多的目录名
    const dirCounts = new Map<string, number>();
    for (const id of members) {
      const node = nodes.find(n => n.id === id);
      if (node) {
        const dir = dirname(node.filePath);
        dirCounts.set(dir, (dirCounts.get(dir) || 0) + 1);
      }
    }
    const label = Array.from(dirCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

    // 计算密度：内部边 / 总边
    const memberSet = new Set(members);
    const internalEdges = edges.filter(
      e => memberSet.has(e.source) && memberSet.has(e.target)
    ).length;
    const totalPossible = members.length * (members.length - 1) / 2;
    const density = totalPossible > 0 ? internalEdges / totalPossible : 0;

    communities.push({
      id: commId++,
      label,
      nodes: members,
      density: Math.min(1, density),
    });
  }

  // 给节点附加社区 ID
  for (const comm of communities) {
    for (const id of comm.nodes) {
      const node = nodes.find(n => n.id === id);
      if (node) node.community = comm.id;
    }
  }

  return communities.sort((a, b) => b.nodes.length - a.nodes.length);
}

class UnionFind {
  private parent = new Map<string, string>();

  constructor(ids: string[]) {
    for (const id of ids) this.parent.set(id, id);
  }

  find(x: string): string {
    const p = this.parent.get(x);
    if (!p || p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }

  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}
