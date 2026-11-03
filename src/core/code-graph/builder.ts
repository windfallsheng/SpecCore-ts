/**
 * Code Knowledge Graph — 图谱构建器
 * v8.3.356
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

  // 0.5 过滤悬空边（v8.3.358+）：两端均须在节点表；
  // 指向外部符号（如 commander/Math.min）的边无节点可消费，
  // 全量/增量口径统一——增量合并路径本就丢弃悬空边
  const validEdges = edges.filter(e => idSet.has(e.source) && idSet.has(e.target));

  // 0.6 边去重（v8.3.358+）：parser 对同一引用可能重复提取（全量版曾带 7000+ 重复边），
  // 同 key（source|target|type）保留 EXTRACTED 优先，与增量合并口径统一
  const edgeByKey = new Map<string, CodeEdge>();
  for (const e of validEdges) {
    const key = `${e.source}|${e.target}|${e.type}`;
    const prev = edgeByKey.get(key);
    if (!prev || (prev.confidence !== 'EXTRACTED' && e.confidence === 'EXTRACTED')) {
      edgeByKey.set(key, e);
    }
  }
  const dedupEdges = [...edgeByKey.values()];

  // 1. 计算每个节点的度数
  const degreeMap = new Map<string, number>();
  for (const n of nodes) {
    degreeMap.set(n.id, 0);
  }
  for (const e of dedupEdges) {
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

  // 4. 社区检测（目录层级自适应，v8.3.358）
  const communities = detectCommunities(enrichedNodes, dedupEdges);

  // 5. 统计
  const extractedEdges = dedupEdges.filter(e => e.confidence === 'EXTRACTED').length;
  const inferredEdges = dedupEdges.filter(e => e.confidence === 'INFERRED').length;

  return {
    nodes: enrichedNodes,
    edges: dedupEdges,
    communities,
    godNodes,
    metadata: {
      projectName,
      projectRoot,
      scannedFiles,
      totalNodes: nodes.length,
      totalEdges: dedupEdges.length,
      extractedEdges,
      inferredEdges,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * 社区检测：目录层级分组，自适应深度（v8.3.358 替代连通分量）
 * 连通分量算法在大代码库上失效：import 全连通 → 单社区数千节点成毛线球；
 * 且分量之间定义上无边 → 跨社区桥接边恒为 0。
 * 目录层级才是真实模块边界：二段目录前缀起步（如 src/core），
 * 超过 MAX_COMM_SIZE 的社区按更深目录段递归细分，
 * 保证任何社区展开后成员数可控，跨目录引用边自然成为桥接边。
 */
function detectCommunities(nodes: CodeNode[], edges: CodeEdge[]): CodeCommunity[] {
  // 社区成员数上限：超过则按更深一层目录细分（保证双击展开不毛线球）
  const MAX_COMM_SIZE = 500;

  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const segsOf = (filePath: string) =>
    dirname(filePath).replace(/\\/g, '/').split('/').filter(s => s && s !== '.');
  const keyAt = (segs: string[], depth: number) =>
    segs.length === 0 ? '(root)' : segs.slice(0, depth).join('/');

  // Step 1: 二段前缀起步，超阈值社区按更深目录段递归细分；
  // 目录已到底仍超阈值时退化为按文件分组
  const groups = new Map<string, string[]>();
  const assign = (ids: string[], depth: number) => {
    const sub = new Map<string, string[]>();
    for (const id of ids) {
      const segs = segsOf(nodeById.get(id)!.filePath);
      const key = keyAt(segs, depth);
      if (!sub.has(key)) sub.set(key, []);
      sub.get(key)!.push(id);
    }
    for (const [key, members] of sub) {
      if (members.length > MAX_COMM_SIZE) {
        const canSplit = members.some(id => segsOf(nodeById.get(id)!.filePath).length > depth);
        if (canSplit) { assign(members, depth + 1); continue; }
        // 目录已到底：按文件分组（同文件符号归一个社区）
        const byFile = new Map<string, string[]>();
        for (const id of members) {
          const fp = nodeById.get(id)!.filePath;
          if (!byFile.has(fp)) byFile.set(fp, []);
          byFile.get(fp)!.push(id);
        }
        for (const [fp, ms] of byFile) groups.set(fp, ms);
        continue;
      }
      groups.set(key, members);
    }
  };
  assign(nodes.map(n => n.id), 2);

  // Step 2: 按 label 字典序分配社区 id（跨重建稳定）
  const commIdByLabel = new Map<string, number>();
  [...groups.keys()].sort().forEach((label, i) => commIdByLabel.set(label, i));
  const idToKey = new Map<string, string>();
  for (const [label, members] of groups) {
    for (const id of members) idToKey.set(id, label);
  }

  // Step 3: 一次遍历边统计内部边（O(E)；悬空边/未分组端点跳过）
  const internalCount = new Map<number, number>();
  for (const e of edges) {
    const sc = commIdByLabel.get(idToKey.get(e.source) ?? '');
    const tc = commIdByLabel.get(idToKey.get(e.target) ?? '');
    if (sc === undefined || tc === undefined || sc !== tc) continue;
    internalCount.set(sc, (internalCount.get(sc) || 0) + 1);
  }

  // Step 4: 生成社区（density = 内部边 / 总可能对）
  const communities: CodeCommunity[] = [];
  for (const [label, members] of groups) {
    const cid = commIdByLabel.get(label)!;
    const totalPossible = members.length * (members.length - 1) / 2;
    communities.push({
      id: cid,
      label,
      nodes: members,
      density: Math.min(1, totalPossible > 0 ? (internalCount.get(cid) || 0) / totalPossible : 0),
    });
  }

  // Step 5: 附加社区 id（所有节点均有目录归属，无未分类节点）
  for (const n of nodes) {
    const cid = commIdByLabel.get(idToKey.get(n.id) ?? '');
    if (cid !== undefined) n.community = cid;
  }

  return communities.sort((a, b) => b.nodes.length - a.nodes.length);
}
