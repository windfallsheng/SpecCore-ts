/**
 * Code Knowledge Graph — graph.html 可视化生成器
 * v8.3.356: vis-network 单层全量渲染（节点过万成毛线球）
 * v8.3.358: 双层视图重构 —— 社区总览（30 节点秒开）→ 双击钻入成员层；
 *           需求↔代码联动侧栏 + 边类型/God 开关 + 节点详情面板；
 *           连续色相调色板（30 社区各归其色，修复 %10 同色）；
 *           边字段压缩（f/t/ty/c）瘦身 + 桥接聚合边（跨社区边按社区对合并）。
 */
import { readFile, pathExists, writeFile } from 'fs-extra';
import { join } from 'path';
import type { CodeGraph, CodeNode } from './types';
import type { ReqCodeLink } from './requirement-linker';

/** 边类型缩写（压缩体积） */
type EdgeKind = 'EXTRACTED' | 'INFERRED';

/**
 * v8.3.360+: 把 vis-network UMD 落地到 .speccore/code-graph/（离线可开）。
 * 本地缺失时尝试从 unpkg 下载一次（8s 超时），失败静默回退 CDN 引用。
 */
async function ensureVisNetworkLocal(root: string): Promise<boolean> {
  const localJs = join(root, '.speccore', 'code-graph', 'vis-network.min.js');
  if (await pathExists(localJs)) return true;
  try {
    const res = await fetch('https://unpkg.com/vis-network/standalone/umd/vis-network.min.js', {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    await writeFile(localJs, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch { /* 无网络时回退 CDN */ return false; }
}

export async function buildCodeGraphHtml(graph: CodeGraph, projectRoot?: string): Promise<string> {
  const root = projectRoot || process.cwd();
  await ensureVisNetworkLocal(root);
  const idToNode = new Map(graph.nodes.map(n => [n.id, n]));
  const godSet = new Set(graph.godNodes);

  // ── 1. 连续色相调色板（30 社区各归其色，v8.3.358 修复 %10 同色）──
  const orphanNodes = graph.nodes.filter(n => n.community === undefined);
  const commCount = Math.max(graph.communities.length + (orphanNodes.length > 0 ? 1 : 0), 1);
  const colorOf = (i: number) => `hsl(${(i * 360) / commCount + 15 % 360}, 65%, 55%)`;

  // ── 2. 社区总览层：社区节点 + 桥接聚合边 ──
  const communities = graph.communities.map((c, i) => {
    const members = c.nodes
      .map(id => idToNode.get(id))
      .filter((n): n is CodeNode => Boolean(n));
    const godCount = c.nodes.filter(id => godSet.has(id)).length;
    return {
      id: c.id,
      label: c.label,
      memberCount: c.nodes.length,
      godCount,
      color: colorOf(i),
      topMembers: members
        .sort((a, b) => (b.degree || 0) - (a.degree || 0))
        .slice(0, 5)
        .map(n => n.name),
    };
  });
  // 无社区节点（社区检测只聚类边连通节点，孤立节点 community 为 undefined）
  // 归入「未分类」社区，保证成员层全量覆盖（v8.3.358）
  if (orphanNodes.length > 0) {
    communities.push({
      id: -1,
      label: '未分类',
      memberCount: orphanNodes.length,
      godCount: orphanNodes.filter(n => godSet.has(n.id)).length,
      color: '#64748b',
      topMembers: orphanNodes
        .sort((a, b) => (b.degree || 0) - (a.degree || 0))
        .slice(0, 5)
        .map(n => n.name),
    });
  }

  // 桥接聚合边：跨社区边按社区对合并（from/to 用社区 id，count 计边数）
  // v8.3.358: community 为 undefined 的一端按「未分类(-1)」参与聚合
  const commOf = (n: CodeNode) => n.community ?? -1;
  const bridgeAgg = new Map<string, { from: number; to: number; count: number; extracted: number }>();
  for (const e of graph.edges) {
    const s = idToNode.get(e.source);
    const t = idToNode.get(e.target);
    if (!s || !t) continue;
    const sc = commOf(s);
    const tc = commOf(t);
    if (sc === tc) continue;
    const key = sc < tc ? `${sc}-${tc}` : `${tc}-${sc}`;
    const agg = bridgeAgg.get(key) || { from: Math.min(sc, tc), to: Math.max(sc, tc), count: 0, extracted: 0 };
    agg.count++;
    if (e.confidence === 'EXTRACTED') agg.extracted++;
    bridgeAgg.set(key, agg);
  }
  const bridgeEdges = [...bridgeAgg.values()].map(b => ({ ...b, type: b.extracted === b.count ? 'EXTRACTED' : 'MIXED' }));

  // ── 3. 成员层：按社区分组节点与边（字段压缩）──
  const nodeCommunity = new Map<string, number>();
  const members: Record<string, {
    nodes: { i: string; l: string; ty: string; d: number; f: string; ln: number; g: boolean }[];
    internalEdges: { f: string; t: string; ty: string; c: EdgeKind }[];
    crossEdges: { f: string; t: string; ty: string; c: EdgeKind }[];
  }> = {};
  for (const n of graph.nodes) {
    const c = commOf(n);
    nodeCommunity.set(n.id, c);
    const key = String(c);
    if (!members[key]) members[key] = { nodes: [], internalEdges: [], crossEdges: [] };
    members[key].nodes.push({
      i: n.id,
      l: n.name,
      ty: n.type,
      d: n.degree || 1,
      f: n.filePath,
      ln: n.line,
      g: godSet.has(n.id),
    });
  }
  for (const e of graph.edges) {
    const s = idToNode.get(e.source);
    const t = idToNode.get(e.target);
    if (!s || !t) continue;
    const sc = commOf(s);
    const tc = commOf(t);
    const slim = { f: e.source, t: e.target, ty: e.type, c: e.confidence as EdgeKind };
    if (sc === tc) {
      members[String(sc)]?.internalEdges.push(slim);
    } else {
      // 跨边两端进各自社区的 crossEdges，target 改指向对方社区节点
      members[String(sc)]?.crossEdges.push({ ...slim, t: `comm-${tc}` });
      members[String(tc)]?.crossEdges.push({ ...slim, f: `comm-${sc}` });
    }
  }

  // ── 4. 需求↔代码联动（v8.3.358+: REQ_CODE_LINK 侧栏数据）──
  const reqLinks: { req: string; nodeIds: string[] }[] = [];
  try {
    const linkPath = join(root, '.speccore', 'code-graph', 'REQ_CODE_LINK.json');
    if (await pathExists(linkPath)) {
      const report = JSON.parse(await readFile(linkPath, 'utf-8'));
      for (const l of (report.links || []) as ReqCodeLink[]) {
        if (l.linkedNodeIds && l.linkedNodeIds.length > 0) {
          reqLinks.push({ req: l.requirement, nodeIds: l.linkedNodeIds });
        }
      }
    }
  } catch { /* 联动数据缺失时侧栏为空 */ }
  // 节点 → 需求 反向索引（详情面板用）
  const nodeReqs = new Map<string, string[]>();
  for (const l of reqLinks) {
    for (const id of l.nodeIds) {
      const arr = nodeReqs.get(id) || [];
      if (arr.length < 3) arr.push(l.req);
      nodeReqs.set(id, arr);
    }
  }

  const meta = graph.metadata;

  // ── 5. HTML 渲染 ──
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${meta.projectName} — Code Graph</title>
<script src="vis-network.min.js"></script>
<script>
// v8.3.360+: 优先本地 UMD（离线可开），本地缺失时回退 unpkg CDN
// '<scr'+'ipt' 拆写避免解析器进入 double-escaped 状态，尾串转义为 '<\\/script>' 防闭合标签提前终止（注释也避字面序列）
if (!window.vis) document.write('<scr' + 'ipt src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"><\\/script>');
</script>
<style>
body{margin:0;font-family:'Segoe UI',system-ui,sans-serif;background:#0b1929;color:#bae6fd;overflow:hidden}
#graph{position:fixed;inset:0}
.panel{position:fixed;top:12px;left:12px;background:rgba(13,31,56,.95);border:1px solid rgba(14,165,233,.2);border-radius:10px;padding:14px;max-width:260px;z-index:10;font-size:12px}
.panel h2{margin:0 0 8px;font-size:14px;color:#0ea5e9}
.panel .stat{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.panel .stat span{color:#5b7fa5}
.panel .legend{margin-top:10px}
.panel .legend-item{display:flex;align-items:center;gap:6px;margin:4px 0}
.panel .dot{width:10px;height:10px;border-radius:50%}
.panel .line{width:20px;height:2px}
.panel label{display:flex;align-items:center;gap:6px;margin-top:6px;cursor:pointer}
.search{position:fixed;top:12px;right:12px;z-index:10;display:flex;gap:6px}
.search input{background:rgba(13,31,56,.95);border:1px solid rgba(14,165,233,.2);border-radius:6px;padding:6px 10px;color:#bae6fd;font-size:12px;outline:none;width:180px}
.search input::placeholder{color:#5b7fa5}
.search button{background:#0ea5e9;border:none;border-radius:6px;padding:6px 12px;color:#fff;font-size:12px;cursor:pointer}
.breadcrumb{position:fixed;bottom:12px;left:12px;z-index:10;display:none}
.breadcrumb button{background:rgba(13,31,56,.95);border:1px solid rgba(14,165,233,.4);border-radius:6px;padding:6px 12px;color:#0ea5e9;font-size:12px;cursor:pointer}
.detail{position:fixed;top:48px;right:12px;z-index:10;background:rgba(13,31,56,.97);border:1px solid rgba(14,165,233,.3);border-radius:10px;padding:12px;max-width:300px;font-size:12px;display:none}
.detail h3{margin:0 0 6px;font-size:13px;color:#0ea5e9;word-break:break-all}
.detail div{margin:2px 0;color:#7dd3fc}
.detail .req{color:#fbbf24}
.reqpanel{position:fixed;bottom:12px;right:12px;z-index:10;background:rgba(13,31,56,.95);border:1px solid rgba(14,165,233,.3);border-radius:10px;padding:10px;max-width:320px;max-height:45vh;overflow:auto;font-size:12px;display:none}
.reqpanel h3{margin:0 0 6px;font-size:13px;color:#0ea5e9}
.reqpanel input{background:rgba(13,31,56,.95);border:1px solid rgba(14,165,233,.2);border-radius:4px;padding:4px 8px;color:#bae6fd;font-size:11px;width:100%;box-sizing:border-box;margin-bottom:6px}
.reqpanel .req-item{padding:3px 6px;border-radius:4px;cursor:pointer;color:#7dd3fc}
.reqpanel .req-item:hover{background:rgba(14,165,233,.15)}
.reqpanel .req-item b{color:#fbbf24}
.req-toggle{position:fixed;bottom:12px;right:12px;z-index:11;background:#0ea5e9;border:none;border-radius:6px;padding:6px 12px;color:#fff;font-size:12px;cursor:pointer}
</style>
</head>
<body>
<div id="graph"></div>
<div class="panel">
<h2>${meta.projectName}</h2>
<div class="stat">Files <span>${meta.scannedFiles}</span></div>
<div class="stat">Nodes <span>${meta.totalNodes}</span></div>
<div class="stat">Edges <span>${meta.totalEdges}</span></div>
<div class="stat">Communities <span>${graph.communities.length}</span></div>
<div class="stat">需求联动 <span>${reqLinks.length}</span></div>
<div class="legend">
<div class="legend-item"><span class="dot" style="background:${colorOf(0)}"></span> 社区（双击钻入成员）</div>
<div class="legend-item"><span class="line" style="background:#0ea5e9"></span> EXTRACTED 边</div>
<div class="legend-item"><span class="line" style="background:#94a3b8;border-top:2px dashed #94a3b8"></span> INFERRED 边</div>
<div class="legend-item"><span class="line" style="background:#f59e0b"></span> MIXED 桥接边（总览层）</div>
<div class="legend-item"><span class="dot" style="background:#fff;border:2px solid #f97316"></span> God node / God 社区</div>
</div>
<label><input type="checkbox" id="showExtracted" checked> EXTRACTED 边</label>
<label><input type="checkbox" id="showInferred"> INFERRED 边</label>
<label><input type="checkbox" id="showGod" checked> God 高亮</label>
</div>
<div class="search">
<input type="text" id="searchInput" placeholder="搜索节点 / 社区...">
<button onclick="doSearch()">Find</button>
</div>
<div class="detail" id="detail"></div>
<div class="breadcrumb" id="breadcrumb"><button onclick="exitCommunity()">← 返回社区总览</button></div>
<button class="req-toggle" onclick="toggleReqPanel()">📋 需求联动 (${reqLinks.length})</button>
<div class="reqpanel" id="reqpanel">
<h3>需求 ↔ 代码联动</h3>
<input type="text" id="reqFilter" placeholder="过滤需求..." oninput="renderReqList()">
<div id="reqList"></div>
</div>
<script>
const LAYERS = {
  communities: ${JSON.stringify(communities)},
  bridgeEdges: ${JSON.stringify(bridgeEdges)},
  members: ${JSON.stringify(members)},
  reqLinks: ${JSON.stringify(reqLinks)},
  nodeReqs: ${JSON.stringify([...nodeReqs])},
  nodeCommunity: ${JSON.stringify([...nodeCommunity])},
};

const commNodes = new vis.DataSet(LAYERS.communities.map(c => ({
  id: 'comm-' + c.id,
  label: c.label,
  group: 'comm',
  title: '<b>' + c.label + '</b><br>成员: ' + c.memberCount + '<br>God nodes: ' + c.godCount + '<br>代表: ' + c.topMembers.slice(0,3).join(', '),
  value: Math.max(8, Math.min(40, Math.sqrt(c.memberCount) * 1.2)),
  // v8.3.360+: vis-network 绘制边框读 color.border（顶层 borderColor 被忽略），God 社区橙边星标须走 color 对象
  color: c.godCount > 0 ? { background: c.color, border: '#f97316' } : c.color,
  shape: 'box',
  font: { color: '#e0f2fe', size: 14 },
  borderWidth: c.godCount > 0 ? 2 : 1,
})));
const allEdges = LAYERS.bridgeEdges.map(b => ({
  id: 'be-' + b.from + '-' + b.to,
  from: 'comm-' + b.from,
  to: 'comm-' + b.to,
  title: '跨社区边: ' + b.count + ' 条',
  label: String(b.count),
  width: Math.max(1, Math.min(6, b.count / 15)),
  color: b.type === 'EXTRACTED' ? { color: '#0ea5e9', opacity: 0.7 } : { color: '#f59e0b', opacity: 0.7 },
  arrows: { to: { enabled: true, scaleFactor: 0.6 } },
  // 初始态与开关一致：EXTRACTED 显示（默认勾选），MIXED 隐藏（showInferred 默认未勾选）
  hidden: b.type === 'MIXED',
}));

const nodes = new vis.DataSet(commNodes.get());
const edges = new vis.DataSet(allEdges);
const container = document.getElementById('graph');
const network = new vis.Network(container, { nodes, edges }, {
  nodes: { shape: 'dot', font: { color: '#bae6fd', size: 12 }, borderWidth: 1, borderWidthSelected: 2 },
  edges: { width: 1, smooth: { type: 'continuous' }, font: { color: '#7dd3fc', size: 10 } },
  physics: {
    barnesHut: { gravitationalConstant: -6000, springConstant: 0.04, springLength: 130, avoidOverlap: 0.6 },
    // v8.3.358+: 限定稳定化迭代次数，完成后关闭物理引擎（否则节点永远漂移）
    stabilization: { iterations: 250, updateInterval: 25 },
  },
  interaction: { hover: true, tooltipDelay: 150, hideEdgesOnDrag: true },
});
// stabilize 完成回调统一管理（初始 250 迭代 + 钻入局部布局共用），避免连续钻入时监听堆积
let stabilizeDone = null;
function bindStabilizeDone(fn) {
  if (stabilizeDone) network.off('stabilizationIterationsDone', stabilizeDone);
  stabilizeDone = fn;
  network.once('stabilizationIterationsDone', fn);
}
bindStabilizeDone(function () {
  network.setOptions({ physics: { enabled: false } });
});

let activeComm = null;

// —— 双层视图：社区总览 → 双击钻入成员层 ——
network.on('doubleClick', function (params) {
  if (params.nodes.length === 0) return;
  const id = params.nodes[0];
  if (id.startsWith('comm-')) enterCommunity(id);
});

// —— 点击：社区→更新详情，成员→详情面板 ——
network.on('click', function (params) {
  if (params.nodes.length === 0) { hideDetail(); return; }
  const id = params.nodes[0];
  if (id.startsWith('comm-')) { showCommDetail(id); return; }
  showNodeDetail(id);
});

function enterCommunity(commId) {
  if (activeComm) exitCommunity(true);
  const cid = commId.replace('comm-', '');
  const layer = LAYERS.members[cid];
  if (!layer || layer.nodes.length === 0) return;
  activeComm = commId;
  const pos = network.getPosition(commId);
  const baseColor = LAYERS.communities.find(c => 'comm-' + c.id === commId)?.color || '#94a3b8';
  const add = layer.nodes.map(n => {
    const nd = {
      id: n.i,
      label: n.l,
      title: n.l + ' (' + n.ty + ')\\n' + n.f + ':' + n.ln + '\\ndegree: ' + n.d,
      value: Math.max(3, Math.min(18, Math.sqrt(n.d) * 1.5)),
      // God node 橙边星标（vis-network 读 color.border，顶层 borderColor 无效）
      color: n.g ? { background: baseColor, border: '#f97316' } : baseColor,
      x: pos.x + (Math.random() - 0.5) * 300,
      y: pos.y + (Math.random() - 0.5) * 300,
      font: { color: '#bae6fd', size: n.g ? 14 : 10 },
      borderWidth: n.g ? 2 : 1,
    };
    return nd;
  });
  const existingIds = new Set(nodes.getIds());
  const fresh = add.filter(n => !existingIds.has(n.id));
  const shown = add.filter(n => existingIds.has(n.id));
  nodes.add(fresh);
  if (shown.length) nodes.update(shown.map(n => ({ id: n.id, hidden: false })));
  const inner = layer.internalEdges.map((e, i) => ({
    id: 'ie-' + cid + '-' + i, from: e.f, to: e.t, title: e.ty + ' (' + e.c + ')',
    dashes: e.c === 'INFERRED', color: e.c === 'EXTRACTED' ? { color: '#0ea5e9', opacity: 0.5 } : { color: '#94a3b8', opacity: 0.3 },
    hidden: !edgeVisible(e.c),
  }));
  const cross = layer.crossEdges.map((e, i) => ({
    id: 'ce-' + cid + '-' + i, from: e.f, to: e.t, title: e.ty + ' (' + e.c + ') → 跨社区',
    dashes: e.c === 'INFERRED', color: { color: '#f59e0b', opacity: 0.55 },
    hidden: !edgeVisible(e.c),
  }));
  const existingEdgeIds = new Set(edges.getIds());
  const freshEdges = [...inner, ...cross].filter(e => !existingEdgeIds.has(e.id));
  const shownEdges = [...inner, ...cross].filter(e => existingEdgeIds.has(e.id));
  edges.add(freshEdges);
  if (shownEdges.length) edges.update(shownEdges.map(e => ({ id: e.id, hidden: e.hidden })));
  document.getElementById('breadcrumb').style.display = 'block';
  network.focus(commId, { scale: 1.1, animation: true });
  // v8.3.360+: 钻入后局部布局一轮（固定社区节点，仅新成员参与 stabilize，避免成员随机散布重叠）
  stabilizeMembers(commId, layer.nodes.map(n => n.i));
}

function stabilizeMembers(commId, newIds) {
  const existing = nodes.getIds().filter(id => !newIds.includes(id));
  nodes.update(existing.map(id => ({ id, fixed: { x: true, y: true } })));
  network.setOptions({
    physics: {
      enabled: true,
      barnesHut: { gravitationalConstant: -6000, springConstant: 0.04, springLength: 130, avoidOverlap: 0.6 },
      stabilization: { enabled: true, iterations: 150, fit: false },
    },
  });
  bindStabilizeDone(function () {
    network.setOptions({ physics: { enabled: false } });
    nodes.update(existing.map(id => ({ id, fixed: { x: false, y: false } })));
    nodes.update(newIds.map(id => ({ id, fixed: { x: false, y: false } })));
    network.focus(commId, { scale: 1.1, animation: true });
  });
}

function exitCommunity(silent) {
  if (!activeComm) return;
  const cid = activeComm.replace('comm-', '');
  const layer = LAYERS.members[cid];
  if (layer) {
    // v8.3.360+: 不 remove 而是 hidden——remove 成员节点会触发 vis-network 10.x 节点层渲染损坏
    // （退出后社区方块颜色丢失），hidden 保留数据与样式，重新钻入时 update 恢复即可
    nodes.update(layer.nodes.map(n => ({ id: n.i, hidden: true })));
    const ids = layer.internalEdges.map((e, i) => 'ie-' + cid + '-' + i).concat(layer.crossEdges.map((e, i) => 'ce-' + cid + '-' + i));
    edges.update(ids.map(id => ({ id, hidden: true })));
  }
  activeComm = null;
  document.getElementById('breadcrumb').style.display = 'none';
  hideDetail();
  // v8.3.360+: 终止挂起的局部 stabilize（成员已隐藏，残留完成回调的 focus 会造成视角跳动）
  if (stabilizeDone) { network.off('stabilizationIterationsDone', stabilizeDone); stabilizeDone = null; }
  // 解除 fixed 残留并关闭物理
  network.setOptions({ physics: { enabled: false } });
  nodes.update(nodes.getIds().map(id => ({ id, fixed: { x: false, y: false } })));
  if (!silent) network.fit();
}

function edgeVisible(conf) {
  if (conf === 'EXTRACTED') return document.getElementById('showExtracted').checked;
  return document.getElementById('showInferred').checked;
}

// —— 边/God 开关 ——
document.getElementById('showExtracted').addEventListener('change', refreshEdges);
document.getElementById('showInferred').addEventListener('change', refreshEdges);
document.getElementById('showGod').addEventListener('change', function () {
  const on = this.checked;
  // 总览层：God 社区橙边星标（color.border 驱动）
  for (const c of LAYERS.communities) {
    nodes.update({ id: 'comm-' + c.id, color: (c.godCount > 0 && on) ? { background: c.color, border: '#f97316' } : c.color, borderWidth: (c.godCount > 0 && on) ? 2 : 1 });
  }
  // 成员层：God node 高亮
  if (!activeComm) return;
  const cid = activeComm.replace('comm-', '');
  const layer = LAYERS.members[cid];
  if (!layer) return;
  const base = LAYERS.communities.find(c => 'comm-' + c.id === cid)?.color || '#94a3b8';
  for (const n of layer.nodes) {
    nodes.update({ id: n.i, font: { color: '#bae6fd', size: (n.g && on) ? 14 : 10 }, color: (n.g && on) ? { background: base, border: '#f97316' } : base, borderWidth: (n.g && on) ? 2 : 1 });
  }
});
function refreshEdges() {
  if (!activeComm) {
    // 总览层：桥接边按类型过滤（EXTRACTED ↔ showExtracted，MIXED ↔ showInferred）
    for (const b of LAYERS.bridgeEdges) {
      const on = b.type === 'EXTRACTED' ? document.getElementById('showExtracted').checked : document.getElementById('showInferred').checked;
      edges.update({ id: 'be-' + b.from + '-' + b.to, hidden: !on });
    }
    return;
  }
  const cid = activeComm.replace('comm-', '');
  const layer = LAYERS.members[cid];
  if (!layer) return;
  layer.internalEdges.forEach((e, i) => edges.update({ id: 'ie-' + cid + '-' + i, hidden: !edgeVisible(e.c) }));
  layer.crossEdges.forEach((e, i) => edges.update({ id: 'ce-' + cid + '-' + i, hidden: !edgeVisible(e.c) }));
}

// —— 详情面板 ——
function showCommDetail(commId) {
  const c = LAYERS.communities.find(x => 'comm-' + x.id === commId);
  if (!c) return;
  const el = document.getElementById('detail');
  el.style.display = 'block';
  el.innerHTML = '<h3>' + c.label + '</h3><div>成员节点: ' + c.memberCount + '</div><div>God nodes: ' + c.godCount + '</div><div>代表: ' + c.topMembers.join(', ') + '</div><div class="req">双击钻入成员层</div>';
}
function showNodeDetail(id) {
  const nc = LAYERS.nodeCommunity.find(x => x[0] === id);
  const commId = nc ? nc[1] : null;
  const layer = commId !== null && commId !== undefined ? LAYERS.members[String(commId)] : null;
  const node = layer ? layer.nodes.find(n => n.i === id) : null;
  const el = document.getElementById('detail');
  el.style.display = 'block';
  const reqs = (LAYERS.nodeReqs.find(x => x[0] === id) || [])[1] || [];
  if (node) {
    el.innerHTML = '<h3>' + node.l + '</h3><div>类型: ' + node.ty + '</div><div>位置: ' + node.f + ':' + node.ln + '</div><div>度: ' + node.d + '</div>' + (node.g ? '<div class="req">⭐ God node</div>' : '') + (reqs.length ? '<div class="req">关联需求: ' + reqs.join('; ') + '</div>' : '');
  } else {
    el.innerHTML = '<h3>' + id + '</h3>';
  }
}
function hideDetail() { document.getElementById('detail').style.display = 'none'; }

// —— 搜索：当前层成员 → 社区标签 → 未展开社区成员（自动钻入）——
function doSearch() {
  const v = document.getElementById('searchInput').value.trim().toLowerCase();
  if (!v) return;
  // 1) 当前展开社区的成员
  if (activeComm) {
    const cid = activeComm.replace('comm-', '');
    const layer = LAYERS.members[cid];
    const hit = layer && layer.nodes.find(n => n.l.toLowerCase().includes(v));
    if (hit) { selectNode(hit.i); return; }
  }
  // 2) 社区标签
  const chit = LAYERS.communities.find(c => c.label.toLowerCase().includes(v));
  if (chit) { network.focus('comm-' + chit.id, { scale: 1.2, animation: true }); network.selectNodes(['comm-' + chit.id]); return; }
  // 3) 全量成员（自动钻入所在社区）
  for (const cid of Object.keys(LAYERS.members)) {
    const hit = LAYERS.members[cid].nodes.find(n => n.l.toLowerCase().includes(v));
    if (hit) { enterCommunity('comm-' + cid); selectNode(hit.i); return; }
  }
}
function selectNode(id) {
  network.selectNodes([id]);
  network.focus(id, { scale: 1.2, animation: true });
  showNodeDetail(id);
}
document.getElementById('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

// —— 需求侧栏 ——
let reqPanelOpen = false;
function toggleReqPanel() {
  reqPanelOpen = !reqPanelOpen;
  document.getElementById('reqpanel').style.display = reqPanelOpen ? 'block' : 'none';
  if (reqPanelOpen) renderReqList();
}
function renderReqList() {
  const f = document.getElementById('reqFilter').value.trim().toLowerCase();
  const list = LAYERS.reqLinks.filter(r => !f || r.req.toLowerCase().includes(f));
  const el = document.getElementById('reqList');
  el.innerHTML = list.slice(0, 100).map((r, idx) => {
    const original = LAYERS.reqLinks.findIndex(x => x === r);
    return '<div class="req-item" onclick="focusReq(' + original + ')"><b>' + (original + 1) + '.</b> ' + r.req + ' <span style="color:#5b7fa5">(' + r.nodeIds.length + ')</span></div>';
  }).join('') || '<div style="color:#5b7fa5">无匹配需求</div>';
}
function focusReq(idx) {
  const r = LAYERS.reqLinks[idx];
  if (!r || r.nodeIds.length === 0) return;
  const target = r.nodeIds[0];
  const nc = LAYERS.nodeCommunity.find(x => x[0] === target);
  if (nc) {
    enterCommunity('comm-' + nc[1]);
    selectNode(target);
    // 高亮该需求的全部关联节点
    const sel = r.nodeIds.filter(id => nodes.get(id));
    network.selectNodes(sel);
  }
}
</script>
</body>
</html>`;
}
