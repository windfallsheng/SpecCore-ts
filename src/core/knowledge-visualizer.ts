/**
 * knowledge-visualizer — 知识图谱交互式可视化 HTML 生成
 *
 * 数据源：KnowledgeGraph + DecayReport + ContextMarkdown
 * 渲染：vis-network（CDN）+ SpecCore 统一 UI 风格
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

  const decayStats = {
    total: decayItems.length,
    contentChanged: decayItems.filter(d => d.type === 'content_changed').length,
    downstreamStale: decayItems.filter(d => d.type === 'downstream_stale').length,
    orphaned: decayItems.filter(d => d.type === 'orphaned').length,
    codeAhead: decayItems.filter(d => d.type === 'code_ahead_of_spec').length,
  };

  const visNodes = buildVisNodes(entities, decayItems);
  const visEdges = buildVisEdges(graph.relations, graph.entities);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SpecCore 知识图谱 — ${projectName || 'Project'}</title>
<script src="https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js"><\/script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=JetBrains+Mono:wght@400;600;700&display=swap');
[data-theme="cyber"]{--cyan:#00f0ff;--blue:#3b82f6;--green:#00ff88;--purple:#a78bfa;--orange:#f59e0b;--bg:#060b14;--card:rgba(8,16,32,.85);--border:rgba(0,240,255,.12);--text:#c4d5e7;--muted:#4a5568;--surface:rgba(17,25,40,.7);--hover:rgba(0,240,255,.02)}
[data-theme="light"]{--cyan:#2563eb;--blue:#3b82f6;--green:#059669;--purple:#7c3aed;--orange:#d97706;--bg:#f8fafc;--card:rgba(255,255,255,.95);--border:rgba(0,0,0,.08);--text:#1e293b;--muted:#94a3b8;--surface:rgba(255,255,255,.95);--hover:rgba(37,99,235,.02)}
[data-theme="github"]{--cyan:#2da44e;--blue:#0969da;--green:#1a7f37;--purple:#8250df;--orange:#cf222e;--bg:#0d1117;--card:#161b22;--border:#30363d;--text:#c9d1d9;--muted:#8b949e;--surface:#161b22;--hover:rgba(45,164,78,.05)}
[data-theme="synth"]{--cyan:#f92aad;--blue:#ff7edb;--green:#36f9f6;--purple:#b381f9;--orange:#ffb86c;--bg:#1a0024;--card:rgba(30,0,50,.9);--border:rgba(249,42,173,.2);--text:#f8f8f2;--muted:#6b3e7a;--surface:rgba(30,0,50,.9);--hover:rgba(249,42,173,.05)}
[data-theme="ocean"]{--cyan:#0ea5e9;--blue:#0284c7;--green:#14b8a6;--purple:#6366f1;--orange:#f97316;--bg:#0b1929;--card:rgba(13,31,56,.9);--border:rgba(14,165,233,.15);--text:#bae6fd;--muted:#5b7fa5;--surface:rgba(13,31,56,.9);--hover:rgba(14,165,233,.05)}
[data-theme="sakura"]{--cyan:#f472b6;--blue:#c084fc;--green:#a3e635;--purple:#e879f9;--orange:#fb923c;--bg:#1a0a14;--card:rgba(30,10,20,.9);--border:rgba(244,114,182,.2);--text:#fce7f3;--muted:#9d4a6d;--surface:rgba(30,10,20,.9);--hover:rgba(244,114,182,.05)}
[data-theme="forest"]{--cyan:#059669;--blue:#0284c7;--green:#22c55e;--purple:#6366f1;--orange:#ca8a04;--bg:#0a140a;--card:rgba(12,24,12,.9);--border:rgba(5,150,105,.15);--text:#d1fae5;--muted:#3b6b4e;--surface:rgba(12,24,12,.9);--hover:rgba(5,150,105,.05)}
[data-theme="amber"]{--cyan:#ffb000;--blue:#ff8c00;--green:#32cd32;--purple:#da70d6;--orange:#ff6347;--bg:#0c0c0c;--card:#1a1a1a;--border:#333;--text:#ffb000;--muted:#666;--surface:#1a1a1a;--hover:rgba(255,176,0,.05)}
[data-theme="mono"]{--cyan:#64748b;--blue:#475569;--green:#334155;--purple:#1e293b;--orange:#94a3b8;--bg:#0f172a;--card:#1e293b;--border:#334155;--text:#e2e8f0;--muted:#64748b;--surface:#1e293b;--hover:rgba(100,116,139,.05)}
*,*::after,*::before{box-sizing:border-box;margin:0;padding:0}
body{font-family:'JetBrains Mono',monospace;background:var(--bg);color:var(--text);min-height:100vh;overflow-x:hidden}
.scanlines{position:fixed;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,240,255,.015) 2px,rgba(0,240,255,.015) 4px);pointer-events:none;z-index:999}
.stars{position:fixed;inset:0;background:radial-gradient(1px 1px at 10% 20%,rgba(255,255,255,.4),transparent),radial-gradient(1px 1px at 25% 65%,rgba(255,255,255,.3),transparent),radial-gradient(1.5px 1.5px at 50% 30%,rgba(0,240,255,.5),transparent),radial-gradient(1px 1px at 70% 55%,rgba(255,255,255,.35),transparent),radial-gradient(1px 1px at 85% 15%,rgba(168,85,247,.4),transparent),radial-gradient(1.5px 1.5px at 15% 80%,rgba(0,240,255,.45),transparent),radial-gradient(1px 1px at 60% 85%,rgba(255,255,255,.3),transparent),radial-gradient(1px 1px at 90% 75%,rgba(0,255,136,.4),transparent);pointer-events:none;z-index:0}
.grid-pattern{position:fixed;inset:0;background-image:linear-gradient(rgba(0,240,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,240,255,.03) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:0}
/* ── Ctrl Panel ── */
.ctrl-panel{position:fixed;top:120px;right:16px;z-index:100;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.ctrl-toggle{width:48px;height:48px;border-radius:50%;border:1px solid var(--border);cursor:pointer;font-size:32px;display:flex;align-items:center;justify-content:center;line-height:0;padding:0;user-select:none;background:var(--surface);color:var(--muted);backdrop-filter:blur(10px);transition:all .3s}
.ctrl-toggle:hover{color:var(--cyan);border-color:var(--cyan);transform:rotate(90deg);transform-origin:center}
.ctrl-toggle.open{color:var(--cyan);border-color:var(--cyan);transform:rotate(90deg);transform-origin:center}
.ctrl-body{max-height:0;overflow:hidden;display:flex;flex-direction:column;gap:6px;align-items:flex-end;transition:max-height .4s ease,opacity .3s ease;opacity:0}
.ctrl-panel.open .ctrl-body{max-height:320px;opacity:1}
.theme-sw{display:flex;gap:6px;background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:4px;backdrop-filter:blur(10px)}
.theme-sw button{width:32px;height:32px;border-radius:16px;border:none;cursor:pointer;transition:all .2s;font-size:14px;display:flex;align-items:center;justify-content:center;background:transparent}
.theme-sw button:hover{transform:scale(1.1)}
.theme-sw button.active{box-shadow:0 0 0 2px var(--cyan);background:rgba(0,240,255,.15)}
.font-sw{display:flex;gap:4px;background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:4px;backdrop-filter:blur(10px)}
.font-sw button{padding:4px 10px;border-radius:12px;border:1px solid var(--border);cursor:pointer;font-size:11px;font-family:'JetBrains Mono',monospace;background:transparent;color:var(--muted)}
.font-sw button:hover{color:var(--text)}
.font-sw button.active{color:var(--cyan);border-color:var(--cyan);background:rgba(0,240,255,.1)}
.fs-sw{display:flex;gap:4px;background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:4px;backdrop-filter:blur(10px)}
.fs-sw button{padding:4px 10px;border-radius:12px;border:1px solid var(--border);cursor:pointer;font-size:11px;font-family:'JetBrains Mono',monospace;background:transparent;color:var(--muted)}
.fs-sw button:hover{color:var(--text)}
.fs-sw button.active{color:var(--cyan);border-color:var(--cyan);background:rgba(0,240,255,.1)}
/* ── Font classes ── */
html{font-size:16px}html.fs-sm{font-size:13px}html.fs-md{font-size:16px}html.fs-lg{font-size:19px}html.fs-xl{font-size:22px}
body{font-family:'JetBrains Mono',monospace!important}
.font-orbitron body,.font-orbitron h1,.font-orbitron .header-left h1,.font-orbitron .stat-card .value,.font-orbitron .header-stat .num{font-family:'Orbitron',sans-serif!important}
.font-hybrid body,.font-hybrid html{font-family:'JetBrains Mono',monospace!important}
.font-hybrid h1,.font-hybrid .header-left h1,.font-hybrid .stat-card .value,.font-hybrid .header-stat .num,.font-hybrid .panel-tab{font-family:'Orbitron',sans-serif!important}
main{position:relative;z-index:1;max-width:calc(100vw - 90px);margin:0 45px;padding:40px 32px}
/* ── Header ── */
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:28px;padding:24px 32px;background:var(--card);border:1px solid var(--border);border-radius:12px;backdrop-filter:blur(20px);position:relative;overflow:hidden}
.header::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX 3s linear infinite}
.header::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX-rev 3s linear infinite}
.header .vline{position:absolute;top:0;width:1px;bottom:0;pointer-events:none;z-index:2}
.header .vline.l{left:0;background:linear-gradient(180deg,transparent,var(--cyan),transparent);animation:scanY-rev 3s linear infinite}
.header .vline.r{right:0;background:linear-gradient(180deg,transparent,var(--cyan),transparent);animation:scanY 3s linear infinite}
.header .card-bg{position:absolute;inset:0;pointer-events:none;z-index:0;background:radial-gradient(ellipse at 30% 10%,rgba(14,165,233,.2) 0%,transparent 70%);animation:cardGlow 3s ease-in-out infinite;transform-origin:top center}
@keyframes scanX{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
@keyframes scanX-rev{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}
@keyframes scanY{0%{transform:translateY(-100%)}100%{transform:translateY(100%)}}
@keyframes scanY-rev{0%{transform:translateY(100%)}100%{transform:translateY(-100%)}}
@keyframes titleGlow{0%,100%{filter:drop-shadow(0 0 20px rgba(0,240,255,.4))}50%{filter:drop-shadow(0 0 30px rgba(0,240,255,.7))}}
.header-left h1{font-family:'Orbitron',sans-serif;font-size:24px;font-weight:900;background:linear-gradient(135deg,var(--cyan),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:2px;animation:titleGlow 3s ease-in-out infinite;position:relative;z-index:1}
.header-left .subtitle{color:var(--muted);font-size:12px;margin-top:4px;letter-spacing:1px;position:relative;z-index:1}
.header-right{display:flex;gap:16px;align-items:center;position:relative;z-index:1}
.header-stat{text-align:center;padding:0 16px;border-left:1px solid rgba(0,240,255,.1)}
.header-stat .num{font-family:'Orbitron',sans-serif;font-size:20px;font-weight:700;color:var(--cyan);text-shadow:0 0 20px rgba(0,240,255,.4)}
.header-stat .label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px}
/* ── Stats Cards ── */
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin-bottom:28px}
.stat-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;backdrop-filter:blur(20px);position:relative;overflow:hidden;transition:all .3s}
.stat-card:hover{border-color:rgba(0,240,255,.25);box-shadow:0 0 30px rgba(0,240,255,.08),inset 0 0 30px rgba(0,240,255,.02)}
.stat-card .card-bg{position:absolute;inset:0;pointer-events:none;z-index:0;background:radial-gradient(ellipse at 25% 10%,rgba(14,165,233,.15) 0%,transparent 70%);animation:cardGlow 3s ease-in-out infinite;transform-origin:top center}
@keyframes cardGlow{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.6)}}
.stat-card .label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;position:relative;z-index:1}
.stat-card .value{font-family:'Orbitron',sans-serif;font-size:32px;font-weight:900;margin-top:4px;position:relative;z-index:1}
.stat-card .value.cyan{color:var(--cyan);text-shadow:0 0 30px rgba(0,240,255,.3)}
.stat-card .value.green{color:var(--green);text-shadow:0 0 30px rgba(0,255,136,.3)}
.stat-card .value.yellow{color:var(--orange);text-shadow:0 0 30px rgba(245,158,11,.3)}
.stat-card .value.red{color:#ef4444;text-shadow:0 0 30px rgba(239,68,68,.3)}
.stat-card .value.purple{color:var(--purple);text-shadow:0 0 30px rgba(168,85,247,.3)}
.stat-card .value.pink{color:#ec4899;text-shadow:0 0 30px rgba(236,72,153,.3)}
/* ── Main Layout ── */
.main-panel{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:0;backdrop-filter:blur(20px);position:relative;overflow:hidden;margin-bottom:28px;display:flex;height:calc(100vh - 320px);min-height:600px}
.main-panel.fullscreen{position:fixed;inset:0;z-index:1000;border-radius:0;margin:0;height:100vh;min-height:100vh}
.graph-panel{flex:1;position:relative;border-right:1px solid var(--border);overflow:hidden;min-width:0}
#graph{width:100%;height:100%}
.graph-toolbar{position:absolute;top:12px;left:12px;display:flex;gap:6px;z-index:10;flex-wrap:wrap}
.fullscreen-btn{position:absolute;top:12px;right:12px;z-index:10;width:36px;height:36px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:all .2s}
.fullscreen-btn:hover{border-color:var(--cyan);color:var(--cyan);box-shadow:0 0 12px rgba(0,240,255,.15)}
.filter-btn{padding:5px 14px;font-size:11px;font-family:'JetBrains Mono',monospace;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--muted);cursor:pointer;transition:all .2s;letter-spacing:.5px}
.filter-btn:hover{border-color:rgba(0,240,255,.3);color:var(--text)}
.filter-btn.active{border-color:var(--cyan);color:var(--cyan);background:rgba(0,240,255,.05);box-shadow:0 0 12px rgba(0,240,255,.15)}
/* ── Side Panel ── */
.side-panel{width:380px;flex-shrink:0;display:flex;flex-direction:column;overflow:hidden}
.panel-tabs{display:flex;border-bottom:1px solid var(--border)}
.panel-tab{flex:1;padding:14px 8px;font-size:11px;font-family:'JetBrains Mono',monospace;text-align:center;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;transition:all .2s;letter-spacing:.5px;text-transform:uppercase}
.panel-tab:hover{color:var(--text)}
.panel-tab.active{color:var(--cyan);border-bottom-color:var(--cyan)}
.panel-content{flex:1;overflow-y:auto;padding:16px}
.panel-content::-webkit-scrollbar{width:4px}
.panel-content::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}
/* ── Search ── */
.search-box{width:100%;padding:10px 14px;font-size:12px;font-family:'JetBrains Mono',monospace;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);outline:none;margin-bottom:14px;transition:border-color .2s}
.search-box:focus{border-color:var(--cyan);box-shadow:0 0 12px rgba(0,240,255,.1)}
.search-box::placeholder{color:var(--muted)}
/* ── Entity List ── */
.entity-list{display:flex;flex-direction:column;gap:6px}
.entity-item{padding:12px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:all .15s}
.entity-item:hover{border-color:rgba(0,240,255,.25);background:var(--hover);box-shadow:0 0 15px rgba(0,240,255,.05)}
.entity-item .name{font-size:13px;font-weight:500;color:var(--text)}
.entity-item .meta{font-size:11px;color:var(--muted);margin-top:4px;display:flex;gap:8px;align-items:center}
.entity-item .type-badge{display:inline-block;padding:2px 8px;font-size:10px;border-radius:4px;font-weight:600;letter-spacing:.5px}
.type-requirement{background:rgba(0,240,255,.1);color:var(--cyan)}
.type-spec{background:rgba(168,85,247,.1);color:var(--purple)}
.type-task{background:rgba(0,255,136,.1);color:var(--green)}
.type-subtask{background:rgba(236,72,153,.1);color:#ec4899}
.type-user-file{background:rgba(245,158,11,.1);color:var(--orange)}
.type-source-file{background:rgba(59,130,246,.1);color:#60a5fa}
.type-global-doc{background:rgba(249,115,22,.1);color:#f97316}
.type-task-spec{background:rgba(20,184,166,.1);color:#14b8a6}
/* ── Decay List ── */
.decay-item{padding:12px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:6px}
.decay-item .title{font-size:13px;font-weight:500}
.decay-item .detail{font-size:11px;color:var(--muted);margin-top:4px}
.decay-item .severity{display:inline-block;padding:2px 8px;font-size:10px;border-radius:4px;margin-left:6px;font-weight:600}
.severity-critical{background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.2)}
.severity-warning{background:rgba(245,158,11,.15);color:var(--orange);border:1px solid rgba(245,158,11,.2)}
.severity-info{background:rgba(0,255,136,.15);color:var(--green);border:1px solid rgba(0,255,136,.2)}
/* ── Context Preview ── */
.context-preview{font-size:13px;line-height:1.7;color:var(--text)}
.context-preview h1,.context-preview h2,.context-preview h3{color:var(--text);margin:16px 0 8px;font-family:'Orbitron',sans-serif;letter-spacing:1px}
.context-preview h1{font-size:18px;color:var(--cyan)}
.context-preview h2{font-size:15px}
.context-preview h3{font-size:13px}
.context-preview table{width:100%;border-collapse:collapse;margin:8px 0;font-size:12px}
.context-preview th,.context-preview td{padding:8px 10px;border:1px solid var(--border);text-align:left}
.context-preview th{background:var(--surface);color:var(--muted);font-weight:600;letter-spacing:.5px}
.context-preview code{background:var(--surface);padding:2px 6px;border-radius:4px;font-size:12px}
/* ── Footer ── */
.footer{display:flex;justify-content:space-between;align-items:center;padding:16px 0;border-top:1px solid rgba(0,240,255,.06);color:var(--muted);font-size:11px;letter-spacing:1px}
/* ── Responsive ── */
@media(max-width:900px){.main-panel{flex-direction:column;height:auto}.graph-panel{border-right:none;border-bottom:1px solid var(--border);height:400px}.side-panel{width:100%}.stats-grid{grid-template-columns:repeat(auto-fit,minmax(120px,1fr))}}
</style>
</head>
<body>

<div class="ctrl-panel" id="ctrl-panel">
  <button class="ctrl-toggle" id="ctrl-toggle" onclick="toggleCtrl()" title="设置">⚙</button>
  <div class="ctrl-body">
    <div class="theme-sw">
      <button onclick="setTheme('ocean')" title="Ocean Blue">🌊</button>
      <button onclick="setTheme('cyber')" title="Cyber Dark">🌙</button>
      <button onclick="setTheme('light')" title="Light Studio">☀️</button>
      <button onclick="setTheme('mono')" title="Mono Tech">⬛</button>
      <button onclick="setTheme('github')" title="GitHub Dark">🐙</button>
      <button onclick="setTheme('synth')" title="SynthWave">💜</button>
      <button onclick="setTheme('amber')" title="Amber Terminal">🟡</button>
      <button onclick="setTheme('sakura')" title="Cherry Sakura">🌸</button>
      <button onclick="setTheme('forest')" title="Midnight Forest">🌲</button>
    </div>
    <div class="font-sw">
      <button onclick="setFont('jetbrains')" data-font="jetbrains">JetBrains</button>
      <button onclick="setFont('orbitron')" data-font="orbitron">Orbitron</button>
      <button onclick="setFont('hybrid')" data-font="hybrid">Hybrid</button>
    </div>
    <div class="fs-sw">
      <button onclick="setFontSize('sm')" data-fs="sm">A⁻</button>
      <button onclick="setFontSize('md')" data-fs="md">A</button>
      <button onclick="setFontSize('lg')" data-fs="lg">A⁺</button>
      <button onclick="setFontSize('xl')" data-fs="xl">A⁺⁺</button>
    </div>
  </div>
</div>
<div class="grid-pattern"></div>
<div class="stars"></div>
<div class="scanlines"></div>

<main>
  <!-- Header -->
  <div class="header">
    <div class="card-bg"></div>
    <div class="vline l"></div>
    <div class="vline r"></div>
    <div class="header-left">
      <h1>SPECCORE — KNOWLEDGE GRAPH</h1>
      <div class="subtitle">${projectName || 'Project'} · 迭代 ${iterationName || 'N/A'}</div>
    </div>
    <div class="header-right">
      <div class="header-stat"><div class="num">${Object.keys(graph.entities).length}</div><div class="label">实体</div></div>
      <div class="header-stat"><div class="num">${graph.relations.length}</div><div class="label">关系</div></div>
      <div class="header-stat"><div class="num" style="${decayStats.total > 0 ? 'color:#ef4444;text-shadow:0 0 20px rgba(239,68,68,.4)' : ''}">${decayStats.total}</div><div class="label">衰减</div></div>
    </div>
  </div>

  <!-- Stats -->
  <div class="stats-grid">
    <div class="stat-card"><div class="card-bg"></div><div class="label">需求</div><div class="value cyan">${stats.requirements}</div></div>
    <div class="stat-card"><div class="card-bg"></div><div class="label">规格</div><div class="value purple">${stats.specs}</div></div>
    <div class="stat-card"><div class="card-bg"></div><div class="label">功能模块</div><div class="value green">${stats.tasks}</div></div>
    <div class="stat-card"><div class="card-bg"></div><div class="label">任务</div><div class="value pink">${stats.subtasks}</div></div>
    <div class="stat-card"><div class="card-bg"></div><div class="label">源码文件</div><div class="value yellow">${stats.sourceFiles || stats.userFiles}</div></div>
    <div class="stat-card"><div class="card-bg"></div><div class="label">全局文档</div><div class="value" style="color:#f97316;text-shadow:0 0 30px rgba(249,115,22,.3)">${stats.globalDocs || 0}</div></div>
    <div class="stat-card"><div class="card-bg"></div><div class="label">任务规格</div><div class="value" style="color:#14b8a6;text-shadow:0 0 30px rgba(20,184,166,.3)">${stats.taskSpecs || 0}</div></div>
    <div class="stat-card"><div class="card-bg"></div><div class="label">关系</div><div class="value cyan">${stats.relations}</div></div>
    <div class="stat-card"><div class="card-bg"></div><div class="label">衰减告警</div><div class="value ${decayStats.total > 0 ? 'red' : 'green'}">${decayStats.total}</div></div>
  </div>

  <!-- Main Graph + Side Panel -->
  <div class="main-panel">
    <div class="graph-panel">
      <div class="graph-toolbar">
        <button class="filter-btn active" data-filter="all">全部</button>
        <button class="filter-btn" data-filter="requirement">需求</button>
        <button class="filter-btn" data-filter="spec">规格</button>
        <button class="filter-btn" data-filter="task">功能模块</button>
        <button class="filter-btn" data-filter="subtask">任务</button>
        <button class="filter-btn" data-filter="user-file">用户文件</button>
        <button class="filter-btn" data-filter="source-file">源码</button>
        <button class="filter-btn" data-filter="global-doc">全局</button>
        <button class="filter-btn" data-filter="task-spec">任务规格</button>
      </div>
      <button class="fullscreen-btn" id="fullscreen-btn" title="全屏">⛶</button>
      <div id="graph"></div>
    </div>
    <div class="side-panel">
      <div class="panel-tabs">
        <div class="panel-tab active" data-panel="entities">实体列表</div>
        <div class="panel-tab" data-panel="decay">衰减检测</div>
        <div class="panel-tab" data-panel="context">RAG 上下文</div>
      </div>
      <div class="panel-content" id="panel-entities">
        <input class="search-box" id="entity-search" placeholder="搜索实体名称..." />
        <div class="entity-list" id="entity-list">
          ${entities.map(e => renderEntityItem(e)).join('')}
        </div>
      </div>
      <div class="panel-content" id="panel-decay" style="display:none">
        ${decayItems.length === 0
          ? '<div style="text-align:center;color:var(--muted);padding:40px 0">✅ 无衰减告警，所有文件健康</div>'
          : decayItems.map(d => renderDecayItem(d)).join('')
        }
      </div>
      <div class="panel-content" id="panel-context" style="display:none">
        <div class="context-preview">${contextMarkdown ? renderMarkdownPreview(contextMarkdown) : '<div style="text-align:center;color:var(--muted);padding:40px 0">暂无上下文数据<br/>运行 speccore analyze 生成</div>'}</div>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <div class="footer">
    <span>SPECCORE · KNOWLEDGE VISUALIZER · ${new Date().getFullYear()}</span>
    <span>GENERATED: ${formatDate(data.generatedAt || new Date().toISOString())}</span>
  </div>
</main>

<script>
// ── Theme ──
var THEMES=['ocean','cyber','light','mono','github','synth','amber','sakura','forest'];
(function(){var t=localStorage.getItem('speccore-theme')||'ocean';document.documentElement.setAttribute('data-theme',t)})();
function setTheme(t){document.documentElement.setAttribute('data-theme',t);localStorage.setItem('speccore-theme',t);updateThemeActive();}
function updateThemeActive(){var cur=localStorage.getItem('speccore-theme')||'ocean';document.querySelectorAll('.theme-sw button').forEach(function(b,i){b.classList.toggle('active',THEMES[i]===cur)});}
updateThemeActive();

// ── Font Family ──
function setFont(f){document.body.classList.remove('font-jetbrains','font-orbitron','font-hybrid');document.body.classList.add('font-'+f);localStorage.setItem('speccore-font',f);updateFontActive();}
function updateFontActive(){var cur=localStorage.getItem('speccore-font')||'jetbrains';document.querySelectorAll('.font-sw button').forEach(function(b){b.classList.toggle('active',b.dataset.font===cur)});}
(function(){var f=localStorage.getItem('speccore-font')||'jetbrains';setFont(f)})();

// ── Font Size ──
function setFontSize(s){document.documentElement.classList.remove('fs-sm','fs-md','fs-lg','fs-xl');if(s!=='md')document.documentElement.classList.add('fs-'+s);localStorage.setItem('speccore-fs',s);updateFsActive();}
function updateFsActive(){var cur=localStorage.getItem('speccore-fs')||'md';document.querySelectorAll('.fs-sw button').forEach(function(b){b.classList.toggle('active',b.dataset.fs===cur)});}
(function(){var s=localStorage.getItem('speccore-fs')||'md';setFontSize(s)})();

// ── Ctrl Panel Toggle ──
function toggleCtrl(){var p=document.getElementById('ctrl-panel');p.classList.toggle('open');document.getElementById('ctrl-toggle').classList.toggle('open',p.classList.contains('open'));}

// ── Data ──
var nodes = new vis.DataSet(${JSON.stringify(visNodes)});
var edges = new vis.DataSet(${JSON.stringify(visEdges)});
var allEntities = ${JSON.stringify(entities.map(e => ({ id: e.id, type: e.type, title: e.title, file: e.file, status: e.status || '' })))};

// ── Graph ──
var container = document.getElementById('graph');
var network = new vis.Network(container, { nodes: nodes, edges: edges }, {
  nodes: { shape: 'dot', size: 24, font: { size: 13, color: '#c4d5e7', face: 'JetBrains Mono' }, borderWidth: 2, chosen: true },
  edges: { width: 1.5, color: { color: 'rgba(0,240,255,0.3)', highlight: '#00f0ff' }, arrows: { to: { enabled: true, scaleFactor: 0.5 } }, smooth: { type: 'continuous', roundness: 0.2 } },
  physics: { solver: 'forceAtlas2Based', forceAtlas2Based: { gravitationalConstant: -70, centralGravity: 0.005, springLength: 180, springConstant: 0.012 }, stabilization: { iterations: 250 } },
  interaction: { hover: true, tooltipDelay: 200, zoomView: true, dragView: true },
  layout: { randomSeed: 42, improvedLayout: true },
});

// ── Filter ──
document.querySelectorAll('.filter-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.filter-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    var filter = btn.dataset.filter;
    if (filter === 'all') {
      nodes.forEach(function(n) { nodes.update({ id: n.id, hidden: false }); });
    } else {
      nodes.forEach(function(n) { nodes.update({ id: n.id, hidden: n.entityType !== filter }); });
    }
  });
});

// ── Panel Tabs ──
document.querySelectorAll('.panel-tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    document.querySelectorAll('.panel-tab').forEach(function(t) { t.classList.remove('active'); });
    tab.classList.add('active');
    document.querySelectorAll('.panel-content').forEach(function(p) { p.style.display = 'none'; });
    document.getElementById('panel-' + tab.dataset.panel).style.display = 'block';
  });
});

// ── Search ──
document.getElementById('entity-search').addEventListener('input', function(e) {
  var q = e.target.value.toLowerCase();
  var list = document.getElementById('entity-list');
  list.innerHTML = allEntities
    .filter(function(ent) { return !q || ent.title.toLowerCase().includes(q) || ent.id.toLowerCase().includes(q); })
    .map(function(ent) { return entityItemHtml(ent); })
    .join('');
});

// ── Node Click ──
network.on('click', function(params) {
  if (params.nodes.length > 0) {
    var nodeId = params.nodes[0];
    var connected = network.getConnectedNodes(nodeId);
    var connectedSet = new Set([nodeId].concat(connected));
    nodes.forEach(function(n) { nodes.update({ id: n.id, opacity: connectedSet.has(n.id) ? 1 : 0.15 }); });
    setTimeout(function() { nodes.forEach(function(n) { nodes.update({ id: n.id, opacity: 1 }); }); }, 3000);
  }
});

function entityItemHtml(ent) {
  var typeClass = 'type-' + ent.type.replace('_', '-');
  var typeLabel = { requirement: '需求', spec: '规格', task: '功能模块', subtask: '任务', 'user-file': '用户文件', 'source-file': '源码', 'global-doc': '全局', 'task-spec': '任务规格' }[ent.type] || ent.type;
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

// ── Fullscreen ──
var fsBtn = document.getElementById('fullscreen-btn');
var mainPanel = document.querySelector('.main-panel');
fsBtn.addEventListener('click', function() {
  mainPanel.classList.toggle('fullscreen');
  fsBtn.textContent = mainPanel.classList.contains('fullscreen') ? '⛶' : '⛶';
  fsBtn.title = mainPanel.classList.contains('fullscreen') ? '退出全屏' : '全屏查看';
  setTimeout(function() { network.fit({ animation: { duration: 300 } }); }, 100);
});
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && mainPanel.classList.contains('fullscreen')) {
    mainPanel.classList.remove('fullscreen');
    setTimeout(function() { network.fit({ animation: { duration: 300 } }); }, 100);
  }
});
<\/script>
</body>
</html>`;
}

// ═══════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════

const TYPE_COLORS: Record<string, string> = {
  requirement: '#00f0ff',
  spec: '#a78bfa',
  task: '#00ff88',
  subtask: '#ec4899',
  'user-file': '#f59e0b',
  'source-file': '#60a5fa',
  'global-doc': '#f97316',
  'task-spec': '#14b8a6',
};

const TYPE_SHAPES: Record<string, string> = {
  requirement: 'diamond',
  spec: 'database',
  task: 'square',
  subtask: 'triangle',
  'user-file': 'ellipse',
  'source-file': 'hexagon',
  'global-doc': 'star',
  'task-spec': 'box',
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
      size: e.type === 'requirement' ? 30 : e.type === 'task' ? 26 : e.type === 'global-doc' ? 28 : e.type === 'spec' ? 24 : e.type === 'source-file' ? 18 : 20,
      borderWidth,
      font: { color: '#c4d5e7', size: 13 },
      entityType: e.type,
    };
  });
}

function buildVisEdges(relations: GraphRelation[], entities: Record<string, GraphEntity>): any[] {
  const EDGE_COLORS: Record<string, string> = {
    implements: '#00ff88',
    specifies: '#a78bfa',
    subtask_of: '#ec4899',
    depends_on: '#f59e0b',
    references: '#6b7280',
    imports: '#60a5fa',
    module_depends: '#0ea5e9',
    co_changes: '#f97316',
    governs: '#f97316',
    elaborates: '#14b8a6',
  };

  return relations.map(r => ({
    from: r.from,
    to: r.to,
    title: r.type,
    color: { color: EDGE_COLORS[r.type] || '#6b7280' + '60' },
    label: r.type,
    font: { size: 11, color: '#4a5568', align: 'middle', strokeWidth: 0 },
  }));
}

function renderEntityItem(e: GraphEntity): string {
  const typeClass = `type-${e.type.replace('_', '-')}`;
  const typeLabel: Record<string, string> = {
    requirement: '需求', spec: '规格', task: '功能模块', subtask: '任务', 'user-file': '用户文件', 'source-file': '源码', 'global-doc': '全局', 'task-spec': '任务规格'
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
  const severityClass = `severity-${d.severity}`;
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

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return iso;
  }
}
