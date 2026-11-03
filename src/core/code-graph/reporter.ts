/**
 * Code Knowledge Graph — GRAPH_REPORT.md 生成器
 * v8.3.356
 */
import type { CodeGraph } from './types';

export function generateGraphReport(graph: CodeGraph): string {
  const m = graph.metadata;
  const lines: string[] = [];

  lines.push(`# ${m.projectName} — Code Knowledge Graph Report`);
  lines.push('');
  lines.push(`> Generated at: ${m.generatedAt}`);
  lines.push(`> Scanned: ${m.scannedFiles} files | ${m.totalNodes} nodes | ${m.totalEdges} edges`);
  lines.push(`> Confidence: ${m.extractedEdges} EXTRACTED | ${m.inferredEdges} INFERRED`);
  lines.push('');

  // v8.3.356+: id→节点 Map 索引（原实现逐边/逐成员 nodes.find，
  // 节点数过万时全量过滤再切片浪费百亿次扫描）
  const idToNode = new Map(graph.nodes.map(n => [n.id, n]));

  // 1. God Nodes
  lines.push('## 🔥 God Nodes (Most Connected)');
  lines.push('');
  const godNodeDetails = graph.godNodes
    .map(id => idToNode.get(id))
    .filter(Boolean);
  for (const n of godNodeDetails.slice(0, 15)) {
    lines.push(`- **${n!.name}** (${n!.type}) — degree: ${n!.degree}, file: \`${n!.filePath}\``);
  }
  lines.push('');

  // 2. Communities
  lines.push('## 🏘️ Communities (Auto-detected Subsystems)');
  lines.push('');
  for (const comm of graph.communities.slice(0, 10)) {
    lines.push(`### Community ${comm.id}: ${comm.label}`);
    lines.push(`- Nodes: ${comm.nodes.length} | Density: ${(comm.density * 100).toFixed(1)}%`);
    const sampleNodes = comm.nodes
      .map(id => idToNode.get(id))
      .filter(Boolean)
      .slice(0, 8);
    lines.push(`- Key members: ${sampleNodes.map(n => n!.name).join(', ')}${comm.nodes.length > 8 ? '...' : ''}`);
    lines.push('');
  }

  // 3. Cross-community Bridges
  lines.push('## 🔗 Cross-Community Bridges');
  lines.push('');
  const bridgeEdges: typeof graph.edges = [];
  for (const e of graph.edges) {
    if (bridgeEdges.length >= 15) break; // 只取前 15 条，无需全量过滤
    const s = idToNode.get(e.source);
    const t = idToNode.get(e.target);
    if (s && t && s.community !== undefined && t.community !== undefined && s.community !== t.community) {
      bridgeEdges.push(e);
    }
  }

  if (bridgeEdges.length === 0) {
    lines.push('No significant cross-community bridges detected.');
  } else {
    for (const e of bridgeEdges) {
      const s = idToNode.get(e.source);
      const t = idToNode.get(e.target);
      lines.push(`- \`${s?.name}\` [${e.type}] → \`${t?.name}\` (${e.confidence})`);
    }
  }
  lines.push('');

  // 4. Suggested Questions
  lines.push('## ❓ Suggested Questions');
  lines.push('');
  const topComm = graph.communities[0];
  if (topComm) {
    lines.push(`- "How does \`${topComm.label}\` subsystem interact with other modules?"`);
  }
  if (graph.godNodes[0]) {
    const topGod = idToNode.get(graph.godNodes[0]);
    lines.push(`- "What depends on \`${topGod?.name}\` and why is it a god node?"`);
  }
  const deepestDir = findDeepestDir(graph.nodes);
  if (deepestDir) {
    lines.push(`- "Explain the architecture of \`${deepestDir}\`"`);
  }
  lines.push(`- "Find the shortest path from entry point to database layer"`);
  lines.push('');

  // 5. 索引维护（v8.3.341: knowledge 命令族已移除，统一 reindex）
  lines.push('## 索引维护');
  lines.push('');
  lines.push('图谱索引由 `speccore reindex` 全量重建（analyze 阶段自动增量维护）。');
  lines.push('');

  return lines.join('\n');
}

function findDeepestDir(nodes: { filePath: string }[]): string | null {
  const dirs = new Set(nodes.map(n => n.filePath.split('/').slice(0, -1).join('/')));
  let deepest = '';
  for (const d of dirs) {
    if (d.split('/').length > deepest.split('/').length) deepest = d;
  }
  return deepest || null;
}
