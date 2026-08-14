/**
 * knowledge-visualizer — 知识图谱交互式可视化 HTML 生成
 *
 * 数据源：KnowledgeGraph + DecayReport + ContextMarkdown
 * 渲染：vis-network（CDN）+ 原生 HTML/CSS/JS
 */
import { KnowledgeGraph, GraphEntity, GraphRelation, GraphStats } from './knowledge-graph';
import { DecayReport, DecayItem } from './decay-detector';

export interface KnowledgeVisualizationData {
  graph: KnowledgeGraph;
  decay?: DecayReport;
  contextMarkdown?: string;
  projectName?: string;
  iterationName?: string;
  generatedAt?: string;
}

/** 生成完整的交互式 HTML 页面 */
export function buildKnowledgeHtml(data: KnowledgeVisualizationData): string {
  const { graph, decay, contextMarkdown, projectName, iterationName } = data;
  const entities = Object.values(graph.entities);
  const stats = graph.stats;
  const decayItems = decay?.decayedFiles || [];

  // 计算衰减统计
  const decayStats = {
    total: decayItems.length,
    contentChanged: decayItems.filter(d => d.type === 'content_changed').length,
    downstreamStale: decayItems.filter(d => d.type === 'downstream_stale').length,
    orphaned: decayItems.filter(d => d.type === 'orphaned').length,
    codeAhead: decayItems.filter(d => d.type === 'code_ahead_of_spec').length,
  };

  // 构建 vis-network 节点和边
  const visNodes = buildVisNodes(entities, decayItems);
  const visEdges = buildVisEdges(graph.relations, graph.entities);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SpecCore 知识图谱 — ${projectName || 'Project'}</title>
<script src="https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js"></script>
<style>
  :root {
    --bg: #0a0e17;
    --surface: #111827;
    --surface-2: #1a2332;
    --border: rgba(0, 240, 255, 0.08);
    --border-hover: rgba(0, 240, 255, 0.2);
    --cyan: #00f0ff;
    --green: #10b981;
    --yellow: #f59e0b;
    --red: #ef4444;
    --purple: #8b5cf6;
    --pink: #ec4899;
    --muted: #6b7280;
    --text: #e5e7eb;
    --text-bright: #f9fafb;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    overflow-x: hidden;
  }
  /* ── Header ── */
  .header {
    padding: 24px 32px;
    border-bottom: 1px solid var(--border);
    background: linear-gradient(180deg, rgba(0,240,255,0.02) 0%, transparent 100%);
  }
  .header h1 {
    font-size: 20px;
    font-weight: 600;
    color: var(--text-bright);
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .header h1 .icon { font-size: 24px; }
  .header .subtitle {
    font-size: 12px;
    color: var(--muted);
    margin-top: 4px;
  }
  /* ── Stats Cards ── */
  .stats-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
    padding: 20px 32px;
  }
  .stat-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px;
    transition: border-color 0.2s;
  }
  .stat-card:hover { border-color: var(--border-hover); }
  .stat-card .label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
  .stat-card .value { font-size: 28px; font-weight: 700; margin-top: 4px; }
  .stat-card .value.cyan { color: var(--cyan); }
  .stat-card .value.green { color: var(--green); }
  .stat-card .value.yellow { color: var(--yellow); }
  .stat-card .value.red { color: var(--red); }
  .stat-card .value.purple { color: var(--purple); }
  .stat-card .value.pink { color: var(--pink); }
  /* ── Layout ── */
  .main-grid {
    display: grid;
    grid-template-columns: 1fr 380px;
    gap: 0;
    min-height: calc(100vh - 200px);
  }
  /* ── Graph Panel ── */
  .graph-panel {
    position: relative;
    border-right: 1px solid var(--border);
  }
  #graph { width: 100%; height: 500px; }
  .graph-toolbar {
    position: absolute;
    top: 12px;
    left: 12px;
    display: flex;
    gap: 6px;
    z-index: 10;
  }
  .filter-btn {
    padding: 5px 12px;
    font-size: 11px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface);
    color: var(--muted);
    cursor: pointer;
    transition: all 0.2s;
  }
  .filter-btn:hover { border-color: var(--border-hover); color: var(--text); }
  .filter-btn.active { border-color: var(--cyan); color: var(--cyan); background: rgba(0,240,255,0.05); }
  /* ── Side Panel ── */
  .side-panel {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .panel-tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
  }
  .panel-tab {
    flex: 1;
    padding: 12px 8px;
    font-size: 12px;
    text-align: center;
    color: var(--muted);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
  }
  .panel-tab:hover { color: var(--text); }
  .panel-tab.active { color: var(--cyan); border-bottom-color: var(--cyan); }
  .panel-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }
  .panel-content::-webkit-scrollbar { width: 4px; }
  .panel-content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
  /* ── Entity Table ── */
  .search-box {
    width: 100%;
    padding: 8px 12px;
    font-size: 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    outline: none;
    margin-bottom: 12px;
  }
  .search-box:focus { border-color: var(--cyan); }
  .entity-list { display: flex; flex-direction: column; gap: 6px; }
  .entity-item {
    padding: 10px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .entity-item:hover { border-color: var(--border-hover); background: var(--surface-2); }
  .entity-item .name { font-size: 13px; font-weight: 500; color: var(--text-bright); }
  .entity-item .meta { font-size: 11px; color: var(--muted); margin-top: 3px; display: flex; gap: 8px; align-items: center; }
  .entity-item .type-badge {
    display: inline-block;
    padding: 1px 6px;
    font-size: 10px;
    border-radius: 4px;
    font-weight: 500;
  }
  .type-requirement { background: rgba(0,240,255,0.1); color: var(--cyan); }
  .type-spec { background: rgba(139,92,246,0.1); color: var(--purple); }
  .type-task { background: rgba(16,185,129,0.1); color: var(--green); }
  .type-subtask { background: rgba(236,72,153,0.1); color: var(--pink); }
  .type-user-file { background: rgba(245,158,11,0.1); color: var(--yellow); }
  /* ── Decay List ── */
  .decay-item {
    padding: 10px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    margin-bottom: 6px;
  }
  .decay-item .title { font-size: 13px; font-weight: 500; }
  .decay-item .detail { font-size: 11px; color: var(--muted); margin-top: 3px; }
  .decay-item .severity {
    display: inline-block;
    padding: 1px 6px;
    font-size: 10px;
    border-radius: 4px;
    margin-left: 6px;
  }
  .severity-high { background: rgba(239,68,68,0.15); color: var(--red); }
  .severity-medium { background: rgba(245,158,11,0.15); color: var(--yellow); }
  .severity-low { background: rgba(16,185,129,0.15); color: var(--green); }
  /* ── Context Panel ── */
  .context-preview {
    font-size: 13px;
    line-height: 1.6;
    color: var(--text);
  }
  .context-preview h1, .context-preview h2, .context-preview h3 {
    color: var(--text-bright);
    margin: 16px 0 8px;
  }
  .context-preview h1 { font-size: 18px; }
  .context-preview h2 { font-size: 15px; }
  .context-preview h3 { font-size: 13px; }
  .context-preview table {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0;
    font-size: 12px;
  }
  .context-preview th, .context-preview td {
    padding: 6px 8px;
    border: 1px solid var(--border);
    text-align: left;
  }
  .context-preview th { background: var(--surface-2); color: var(--muted); font-weight: 500; }
  .context-preview code {
    background: var(--surface-2);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 12px;
  }
  /* ── Relations Panel ── */
  .relation-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }
  .relation-arrow { color: var(--cyan); font-size: 14px; }
  .relation-type {
    padding: 1px 6px;
    font-size: 10px;
    border-radius: 4px;
    background: rgba(0,240,255,0.08);
    color: var(--cyan);
  }
  /* ── Footer ── */
  .footer {
    padding: 16px 32px;
    border-top: 1px solid var(--border);
    font-size: 11px;
    color: var(--muted);
    text-align: center;
  }
  /* ── Responsive ── */
  @media (max-width: 900px) {
    .main-grid { grid-template-columns: 1fr; }
    .graph-panel { border-right: none; border-bottom: 1px solid var(--border); }
  }
</style>
</head>
<body>

<div class="header">
  <h1><span class="icon">🧠</span> SpecCore 知识图谱</h1>
  <div class="subtitle">${projectName || 'Project'} · 迭代 ${iterationName || 'N/A'} · 生成于 ${data.generatedAt || new Date().toISOString().slice(0, 16).replace('T', ' ')}</div>
</div>

<!-- Stats -->
<div class="stats-row">
  <div class="stat-card">
    <div class="label">需求</div>
    <div class="value cyan">${stats.requirements}</div>
  </div>
  <div class="stat-card">
    <div class="label">规格</div>
    <div class="value purple">${stats.specs}</div>
  </div>
  <div class="stat-card">
    <div class="label">任务</div>
    <div class="value green">${stats.tasks}</div>
  </div>
  <div class="stat-card">
    <div class="label">子任务</div>
    <div class="value pink">${stats.subtasks}</div>
  </div>
  <div class="stat-card">
    <div class="label">源码文件</div>
    <div class="value yellow">${stats.userFiles}</div>
  </div>
  <div class="stat-card">
    <div class="label">关系</div>
    <div class="value cyan">${stats.relations}</div>
  </div>
  <div class="stat-card">
    <div class="label">衰减告警</div>
    <div class="value ${decayStats.total > 0 ? 'red' : 'green'}">${decayStats.total}</div>
  </div>
</div>

<!-- Main -->
<div class="main-grid">
  <!-- Graph -->
  <div class="graph-panel">
    <div class="graph-toolbar">
      <button class="filter-btn active" data-filter="all">全部</button>
      <button class="filter-btn" data-filter="requirement">需求</button>
      <button class="filter-btn" data-filter="spec">规格</button>
      <button class="filter-btn" data-filter="task">任务</button>
      <button class="filter-btn" data-filter="subtask">子任务</button>
      <button class="filter-btn" data-filter="user-file">源码</button>
    </div>
    <div id="graph"></div>
  </div>

  <!-- Side Panel -->
  <div class="side-panel">
    <div class="panel-tabs">
      <div class="panel-tab active" data-panel="entities">实体列表</div>
      <div class="panel-tab" data-panel="decay">衰减检测</div>
      <div class="panel-tab" data-panel="context">RAG 上下文</div>
    </div>
    <div class="panel-content" id="panel-entities">
      <input class="search-box" id="entity-search" placeholder="搜索实体名称..." />
      <div class="entity-list" id="entity-list">
        ${entities.map(e => renderEntityItem(e)).join('\n')}
      </div>
    </div>
    <div class="panel-content" id="panel-decay" style="display:none">
      ${decayItems.length === 0
        ? '<div style="text-align:center;color:var(--muted);padding:40px 0">✅ 无衰减告警，所有文件健康</div>'
        : decayItems.map(d => renderDecayItem(d)).join('\n')
      }
    </div>
    <div class="panel-content" id="panel-context" style="display:none">
      <div class="context-preview">${contextMarkdown ? renderMarkdownPreview(contextMarkdown) : '<div style="text-align:center;color:var(--muted);padding:40px 0">暂无上下文数据<br/>运行 speccore analyze 生成</div>'}</div>
    </div>
  </div>
</div>

<div class="footer">
  SpecCore Knowledge Visualizer · ${new Date().getFullYear()} · Generated by speccore knowledge
</div>

<script>
// ── Data ──
const nodes = new vis.DataSet(${JSON.stringify(visNodes)});
const edges = new vis.DataSet(${JSON.stringify(visEdges)});
const allEntities = ${JSON.stringify(entities.map(e => ({ id: e.id, type: e.type, title: e.title, file: e.file, status: e.status || '' })))};

// ── Graph ──
const container = document.getElementById('graph');
const network = new vis.Network(container, { nodes, edges }, {
  nodes: {
    shape: 'dot',
    size: 16,
    font: { size: 11, color: '#e5e7eb', face: 'system-ui' },
    borderWidth: 2,
  },
  edges: {
    width: 1.5,
    color: { color: 'rgba(0,240,255,0.3)', highlight: '#00f0ff' },
    arrows: { to: { enabled: true, scaleFactor: 0.5 } },
    smooth: { type: 'continuous' },
  },
  physics: {
    solver: 'forceAtlas2Based',
    forceAtlas2Based: { gravitationalConstant: -40, centralGravity: 0.008, springLength: 120 },
    stabilization: { iterations: 150 },
  },
  interaction: { hover: true, tooltipDelay: 200 },
  layout: { randomSeed: 42 },
});

// ── Filter ──
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const filter = btn.dataset.filter;
    if (filter === 'all') {
      nodes.forEach(n => nodes.update({ id: n.id, hidden: false }));
    } else {
      nodes.forEach(n => nodes.update({ id: n.id, hidden: n.entityType !== filter }));
    }
  });
});

// ── Panel Tabs ──
document.querySelectorAll('.panel-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.panel-content').forEach(p => p.style.display = 'none');
    document.getElementById('panel-' + tab.dataset.panel).style.display = 'block';
  });
});

// ── Search ──
document.getElementById('entity-search').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  const list = document.getElementById('entity-list');
  list.innerHTML = allEntities
    .filter(ent => !q || ent.title.toLowerCase().includes(q) || ent.id.toLowerCase().includes(q))
    .map(ent => entityItemHtml(ent))
    .join('');
});

// ── Node Click → highlight ──
network.on('click', (params) => {
  if (params.nodes.length > 0) {
    const nodeId = params.nodes[0];
    const connected = network.getConnectedNodes(nodeId);
    const connectedSet = new Set([nodeId, ...connected]);
    nodes.forEach(n => {
      nodes.update({ id: n.id, opacity: connectedSet.has(n.id) ? 1 : 0.15 });
    });
    setTimeout(() => nodes.forEach(n => nodes.update({ id: n.id, opacity: 1 })), 3000);
  }
});

function entityItemHtml(ent) {
  const typeClass = 'type-' + ent.type.replace('_', '-');
  const typeLabel = { requirement: '需求', spec: '规格', task: '任务', subtask: '子任务', 'user-file': '源码' }[ent.type] || ent.type;
  return '<div class="entity-item" onclick="focusNode(\\'' + ent.id + '\\')">' +
    '<div class="name">' + ent.title + '</div>' +
    '<div class="meta"><span class="type-badge ' + typeClass + '">' + typeLabel + '</span>' +
    (ent.status ? '<span>' + ent.status + '</span>' : '') +
    '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px">' + ent.file + '</span></div></div>';
}

function focusNode(id) {
  network.focusNode(id, { scale: 1.2, animation: { duration: 300 } });
  network.selectNodes([id]);
}
</script>
</body>
</html>`;
}

// ═══════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════

const TYPE_COLORS: Record<string, string> = {
  requirement: '#00f0ff',
  spec: '#8b5cf6',
  task: '#10b981',
  subtask: '#ec4899',
  'user-file': '#f59e0b',
};

const TYPE_SHAPES: Record<string, string> = {
  requirement: 'diamond',
  spec: 'dot',
  task: 'square',
  subtask: 'triangle',
  'user-file': 'dot',
};

function buildVisNodes(entities: GraphEntity[], decayItems: DecayItem[]): any[] {
  const decayMap = new Map(decayItems.map(d => [d.entityId, d]));

  return entities.map(e => {
    const color = TYPE_COLORS[e.type] || '#6b7280';
    const shape = TYPE_SHAPES[e.type] || 'dot';
    const decay = decayMap.get(e.id);
    let borderColor = color;
    let borderWidth = 2;

    if (decay) {
      if (decay.severity === 'critical') { borderColor = '#ef4444'; borderWidth = 3; }
      else if (decay.severity === 'warning') { borderColor = '#f59e0b'; borderWidth = 3; }
    }

    return {
      id: e.id,
      label: e.title.length > 20 ? e.title.slice(0, 18) + '…' : e.title,
      title: `${e.title}\n${e.file}\n类型: ${e.type}${e.status ? '\n状态: ' + e.status : ''}`,
      color: {
        background: color + '20',
        border: borderColor,
        highlight: { background: color + '40', border: borderColor },
      },
      shape,
      size: e.type === 'requirement' ? 22 : e.type === 'task' ? 18 : 14,
      borderWidth,
      font: { color: '#e5e7eb', size: 11 },
      entityType: e.type,
    };
  });
}

function buildVisEdges(relations: GraphRelation[], entities: Record<string, GraphEntity>): any[] {
  const EDGE_COLORS: Record<string, string> = {
    implements: '#10b981',
    specifies: '#8b5cf6',
    subtask_of: '#ec4899',
    depends_on: '#f59e0b',
    references: '#6b7280',
  };

  return relations.map(r => ({
    from: r.from,
    to: r.to,
    title: r.type,
    color: { color: EDGE_COLORS[r.type] || '#6b7280' + '60' },
    label: r.type,
    font: { size: 9, color: '#6b7280', align: 'middle', strokeWidth: 0 },
  }));
}

function renderEntityItem(e: GraphEntity): string {
  const typeClass = `type-${e.type.replace('_', '-')}`;
  const typeLabel: Record<string, string> = {
    requirement: '需求', spec: '规格', task: '任务', subtask: '子任务', 'user-file': '源码'
  };
  return `<div class="entity-item" onclick="focusNode('${e.id}')">
    <div class="name">${escapeHtml(e.title)}</div>
    <div class="meta">
      <span class="type-badge ${typeClass}">${typeLabel[e.type] || e.type}</span>
      ${e.status ? `<span>${e.status}</span>` : ''}
      <span title="${escapeHtml(e.file)}">${escapeHtml(e.file.split('/').pop() || e.file)}</span>
    </div>
  </div>`;
}

function renderDecayItem(d: DecayItem): string {
  const severityClass = d.severity === 'critical' ? 'severity-high' : d.severity === 'warning' ? 'severity-medium' : 'severity-low';
  const typeLabel: Record<string, string> = {
    content_changed: '内容变更',
    downstream_stale: '下游过期',
    orphaned: '文件丢失',
    code_ahead_of_spec: '代码超前',
  };
  const downstream = d.affectedDownstream?.length ? ` · 影响: ${d.affectedDownstream.join(', ')}` : '';
  return `<div class="decay-item">
    <div class="title">${escapeHtml(d.title)}<span class="severity ${severityClass}">${d.severity}</span></div>
    <div class="detail">${typeLabel[d.type] || d.type} · ${escapeHtml(d.file)}${downstream}</div>
  </div>`;
}

function renderMarkdownPreview(md: string): string {
  // 简单 Markdown → HTML（表格、标题、列表）
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '• $1<br/>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\|(.+)\|/g, (match) => {
      const cells = match.split('|').filter(Boolean).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) return '';
      const isHeader = cells.some(c => c.includes('**'));
      const tag = isHeader ? 'th' : 'td';
      return '<tr>' + cells.map(c => `<${tag}>${c.replace(/\*\*/g, '')}</${tag}}`).join('') + '</tr>';
    });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
