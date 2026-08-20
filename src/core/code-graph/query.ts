/**
 * Code Knowledge Graph — 查询引擎
 * v6.90.0
 *
 * 支持 explain / path / query 三种查询模式
 */
import type { CodeGraph, CodeNode, CodeEdge, GraphQueryResult } from './types';

/** 根据名称或 id 查找节点 */
function findNode(graph: CodeGraph, nameOrId: string): CodeNode | undefined {
  return graph.nodes.find(n => n.id === nameOrId || n.name === nameOrId);
}

/** explain: 解释一个节点及其直接连接 */
export function explainNode(graph: CodeGraph, nameOrId: string): GraphQueryResult {
  const target = findNode(graph, nameOrId);
  if (!target) {
    return { nodes: [], edges: [] };
  }

  const relatedEdges = graph.edges.filter(
    e => e.source === target.id || e.target === target.id
  );

  const relatedNodeIds = new Set<string>([target.id]);
  for (const e of relatedEdges) {
    relatedNodeIds.add(e.source);
    relatedNodeIds.add(e.target);
  }

  return {
    nodes: graph.nodes.filter(n => relatedNodeIds.has(n.id)),
    edges: relatedEdges,
  };
}

/** path: BFS 最短路径 */
export function findPath(graph: CodeGraph, from: string, to: string): GraphQueryResult {
  const start = findNode(graph, from);
  const end = findNode(graph, to);
  if (!start || !end) {
    return { nodes: [], edges: [] };
  }

  // BFS
  const queue: string[] = [start.id];
  const visited = new Set<string>([start.id]);
  const parent = new Map<string, { node: string; edge: CodeEdge }>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === end.id) break;

    for (const edge of graph.edges) {
      let neighbor: string | undefined;
      if (edge.source === current) neighbor = edge.target;
      else if (edge.target === current) neighbor = edge.source;

      if (neighbor && !visited.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, { node: current, edge });
        queue.push(neighbor);
      }
    }
  }

  if (!parent.has(end.id) && start.id !== end.id) {
    return { nodes: [start, end], edges: [] };
  }

  // Reconstruct path
  const pathNodes: string[] = [];
  const pathEdges: CodeEdge[] = [];
  let curr: string = end.id;

  while (curr !== start.id) {
    pathNodes.unshift(curr);
    const p = parent.get(curr);
    if (!p) break;
    pathEdges.unshift(p.edge);
    curr = p.node;
  }
  pathNodes.unshift(start.id);

  const nodeSet = new Set(pathNodes);
  return {
    nodes: graph.nodes.filter(n => nodeSet.has(n.id)),
    edges: pathEdges,
    path: pathNodes,
  };
}

/** query: 关键词匹配返回子图（简化版） */
export function queryGraph(graph: CodeGraph, question: string): GraphQueryResult {
  const keywords = question.toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);

  if (keywords.length === 0) {
    return { nodes: [], edges: [] };
  }

  const scoredNodes = graph.nodes.map(n => {
    const text = `${n.name} ${n.type} ${n.filePath} ${n.snippet || ''}`.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (n.name.toLowerCase().includes(kw)) score += 5;
      else if (text.includes(kw)) score += 1;
    }
    return { node: n, score };
  }).filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  const matchedIds = new Set(scoredNodes.map(s => s.node.id));

  // 包含匹配节点的一阶邻居
  const relatedEdges = graph.edges.filter(
    e => matchedIds.has(e.source) || matchedIds.has(e.target)
  );
  for (const e of relatedEdges) {
    matchedIds.add(e.source);
    matchedIds.add(e.target);
  }

  return {
    nodes: graph.nodes.filter(n => matchedIds.has(n.id)),
    edges: relatedEdges,
  };
}
