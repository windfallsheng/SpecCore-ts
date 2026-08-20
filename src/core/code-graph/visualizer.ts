/**
 * Code Knowledge Graph — graph.html 可视化生成器
 * v6.90.0
 *
 * 使用 vis-network CDN，与现有 knowledge-visualizer 风格一致
 */
import type { CodeGraph } from './types';

export function buildCodeGraphHtml(graph: CodeGraph): string {
  const palette = [
    '#0ea5e9', '#14b8a6', '#f97316', '#8b5cf6',
    '#ec4899', '#22c55e', '#eab308', '#6366f1',
    '#06b6d4', '#f43f5e',
  ];

  const nodes = graph.nodes.map(n => ({
    id: n.id,
    label: n.name,
    group: n.community ?? -1,
    title: `<b>${n.name}</b><br>type: ${n.type}<br>file: ${n.filePath}<br>line: ${n.line}<br>degree: ${n.degree}`,
    value: n.degree || 1,
    color: n.community !== undefined ? palette[n.community % palette.length] : '#94a3b8',
  }));

  const edges = graph.edges.map((e, i) => ({
    from: e.source,
    to: e.target,
    label: e.type,
    title: `${e.type} (${e.confidence})`,
    dashes: e.confidence === 'INFERRED',
    color: e.confidence === 'EXTRACTED' ? { color: '#0ea5e9', opacity: 0.6 } : { color: '#94a3b8', opacity: 0.4 },
    arrows: { to: { enabled: true, scaleFactor: 0.5 } },
  }));

  const godNodeSet = new Set(graph.godNodes);
  for (const n of nodes) {
    if (godNodeSet.has(n.id)) {
      n.value = (n.value || 1) * 2;
      (n as any).font = { size: 16, bold: true };
    }
  }

  const meta = graph.metadata;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${meta.projectName} — Code Graph</title>
<script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
<style>
body{margin:0;font-family:'Segoe UI',system-ui,sans-serif;background:#0b1929;color:#bae6fd;overflow:hidden}
#graph{position:fixed;inset:0}
.panel{position:fixed;top:12px;left:12px;background:rgba(13,31,56,.95);border:1px solid rgba(14,165,233,.2);border-radius:10px;padding:14px;max-width:280px;z-index:10;font-size:12px}
.panel h2{margin:0 0 8px;font-size:14px;color:#0ea5e9}
.panel .stat{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.panel .stat span{color:#5b7fa5}
.panel .legend{margin-top:10px}
.panel .legend-item{display:flex;align-items:center;gap:6px;margin:4px 0}
.panel .dot{width:10px;height:10px;border-radius:50%}
.panel .line{width:20px;height:2px}
.search{position:fixed;top:12px;right:12px;z-index:10;display:flex;gap:6px}
.search input{background:rgba(13,31,56,.95);border:1px solid rgba(14,165,233,.2);border-radius:6px;padding:6px 10px;color:#bae6fd;font-size:12px;outline:none;width:180px}
.search input::placeholder{color:#5b7fa5}
.search button{background:#0ea5e9;border:none;border-radius:6px;padding:6px 12px;color:#fff;font-size:12px;cursor:pointer}
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
<div class="stat">EXTRACTED <span>${meta.extractedEdges}</span></div>
<div class="stat">INFERRED <span>${meta.inferredEdges}</span></div>
<div class="legend">
<div class="legend-item"><span class="dot" style="background:#0ea5e9"></span> EXTRACTED edge</div>
<div class="legend-item"><span class="line" style="background:#94a3b8;border-top:2px dashed #94a3b8"></span> INFERRED edge</div>
<div class="legend-item"><span class="dot" style="background:#f97316"></span> God node</div>
</div>
</div>
<div class="search">
<input type="text" id="searchInput" placeholder="Search node...">
<button onclick="searchNode()">Find</button>
</div>
<script>
const nodes=new vis.DataSet(${JSON.stringify(nodes)});
const edges=new vis.DataSet(${JSON.stringify(edges)});
const container=document.getElementById('graph');
const data={nodes,edges};
const options={
  nodes:{shape:'dot',font:{color:'#bae6fd',size:12},borderWidth:1,borderWidthSelected:2},
  edges:{width:1,smooth:{type:'continuous'}},
  physics:{stabilization:false,barnesHut:{gravitationalConstant:-3000,springConstant:0.04,springLength:95}},
  interaction:{hover:true,tooltipDelay:200,hideEdgesOnDrag:true}
};
const network=new vis.Network(container,data,options);
function searchNode(){const v=document.getElementById('searchInput').value.toLowerCase();const found=nodes.get({filter:n=>n.label.toLowerCase().includes(v)})[0];if(found){network.focus(found.id,{scale:1.2,animation:true});network.selectNodes([found.id]);}}
document.getElementById('searchInput').addEventListener('keydown',e=>{if(e.key==='Enter')searchNode();});
</script>
</body>
</html>`;
}
