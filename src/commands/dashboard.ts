/**
 * dashboard - 生成可视化仪表盘命令
 * 基于全量层数据生成静态 HTML 仪表盘，含 Chart.js 图表
 */

import { logger, Spinner } from '../utils/logger';
import { readGlobalIndex } from '../core/global-layer';
import { writeFile } from 'fs-extra';
import { join } from 'path';

export interface DashboardOptions {
  output?: string;
}

export async function dashboardCommand(options: DashboardOptions): Promise<void> {
  const spinner = new Spinner('采集全量层数据...');
  spinner.start();

  try {
    const index = await readGlobalIndex();

    if (index.projects.length === 0 && index.reqs.length === 0) {
      spinner.fail('全量层为空，无法生成仪表盘。请先导入项目。');
      return;
    }

    spinner.stop('数据采集完成，正在生成仪表盘...');

    // 统计数据
    const totalReqs = index.reqs.length;
    const implemented = index.reqs.filter((r) =>
      r.status === '✅ 已实现' || r.status === '📦 已有实现'
    ).length;
    const inProgress = index.reqs.filter((r) => r.status === '🔄 进行中').length;
    const pending = totalReqs - implemented - inProgress;
    const completionRate = totalReqs > 0 ? Math.round((implemented / totalReqs) * 100) : 0;

    // 项目分布数据
    const projectLabels = index.projects.map((p) => p.name);
    const projectReqs = index.projects.map((p) => p.reqCount);

    // ── 新增：迭代活跃度 ──
    const activeIterations = index.iterations.filter(i => i.status === 'active' || i.status === '进行中');
    const iterationLabels = index.iterations.map(i => i.name).slice(0, 8);
    const iterationReqCounts = index.iterations.map(i => i.reqs.length).slice(0, 8);

    // ── 新增：期次完成统计 ──
    const iterStats = index.iterations.map(it => {
      const iterReqs = index.reqs.filter(r => it.reqs.includes(r.id));
      const done = iterReqs.filter(r => r.status.includes('✅') || r.status.includes('已实现')).length;
      return { name: it.name, total: it.reqs.length, done, pct: it.reqs.length > 0 ? Math.round(done / it.reqs.length * 100) : 0 };
    });

    // ── 新增：健康度评分 ──
    const projectHealth = index.projects.map(p => ({
      name: p.name,
      reqCount: p.reqCount,
      doneCount: index.reqs.filter(r => r.project === p.name && (r.status.includes('✅') || r.status.includes('已实现'))).length,
    })).map(p => ({ ...p, pct: p.reqCount > 0 ? Math.round(p.doneCount / p.reqCount * 100) : 0 }))
      .sort((a, b) => b.pct - a.pct);

    // 生成 HTML
    const html = generateDashboardHtml(
      index.projects.length,
      totalReqs, implemented, inProgress, pending, completionRate,
      projectLabels, projectReqs,
      iterationLabels, iterationReqCounts,
      iterStats, projectHealth, activeIterations.length,
      index
    );
      totalReqs,
      implemented,
      inProgress,
      pending,
      completionRate,
      projectLabels,
      projectReqs,
      index
    );

    const outputPath = options.output || join(process.cwd(), 'speccore-dashboard.html');
    await writeFile(outputPath, html);

    logger.info('');
    logger.success('✅ 仪表盘已生成！');
    logger.info('');
    logger.info(`📁 输出文件: ${outputPath}`);
    logger.info('');
    logger.info('📊 包含内容:');
    logger.info('   - 统计卡片：总需求、已实现、进行中、待开发');
    logger.info('   - 需求状态分布（饼图）');
    logger.info('   - 项目需求分布（柱状图）');
    logger.info('   - 项目详细列表');
    logger.info('   - 期次关联状态');
    logger.info('');
    logger.info('💡 在浏览器中打开即可查看。支持移动端自适应布局。');
  } catch (error) {
    spinner.fail(`生成仪表盘失败: ${error}`);
    throw error;
  }
}

export function generateDashboardHtml(
  projectCount: number,
  totalReqs: number,
  implemented: number,
  inProgress: number,
  pending: number,
  completionRate: number,
  projectLabels: string[],
  projectReqs: number[],
  iterationLabels: string[],
  iterationReqCounts: number[],
  iterStats: { name: string; total: number; done: number; pct: number }[],
  projectHealth: { name: string; reqCount: number; doneCount: number; pct: number }[],
  activeIterCount: number,
  index: Awaited<ReturnType<typeof readGlobalIndex>>
): string {
  const now = new Date().toISOString().split('T')[0];

  // 生成项目表格行（按需求数降序）
  let projectRows = '';
  const sortedProjects = [...index.projects].sort((a, b) => b.reqCount - a.reqCount);
  for (const proj of sortedProjects) {
    projectRows += `<tr><td>${proj.name}</td><td><span class="badge badge-${proj.type}">${proj.type}</span></td><td>${proj.reqCount}</td><td>${proj.lastImport}</td></tr>`;
  }

  // 生成需求表格行（按期次倒序：Q3→Q2→Q1，无期次排最后）
  let reqRows = '';
  const sortIter = (a: string, b: string) => {
    const na = parseInt(a.replace(/[^0-9]/g, '')) || 0;
    const nb = parseInt(b.replace(/[^0-9]/g, '')) || 0;
    if (!na && !nb) return 0;
    if (!na) return 1;
    if (!nb) return -1;
    return nb - na;
  };
  const sortedReqs = [...index.reqs].sort((a, b) => {
    const ia = sortIter(a.iteration || '', b.iteration || '');
    if (ia !== 0) return ia;
    // 同期次内按状态排：已实现 > 进行中 > 待开发
    const order: Record<string, number> = { '✅': 1, '🔄': 2, '🔲': 3 };
    return (order[a.status.charAt(0)] || 99) - (order[b.status.charAt(0)] || 99);
  });
  for (const req of sortedReqs.slice(0, 30)) {
    const statusClass = req.status.includes('✅') ? 'done' : req.status.includes('🔄') ? 'progress' : 'pending';
    reqRows += `<tr><td>${req.id}</td><td>${req.name}</td><td>${req.project}</td><td><span class="badge badge-${statusClass}">${req.status}</span></td><td>${req.iteration || '-'}</td></tr>`;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="cyber" data-fs="md">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SpecCore — 全量仪表盘</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
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
[data-fs="sm"]{font-size:13px}[data-fs="md"]{font-size:15px}[data-fs="lg"]{font-size:17px}[data-fs="xl"]{font-size:20px}
*,*::after,*::before{box-sizing:border-box;margin:0;padding:0}
.theme-sw{position:fixed;top:16px;right:16px;z-index:100;display:flex;gap:6px;background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:4px;backdrop-filter:blur(10px)}.theme-sw button{width:32px;height:32px;border-radius:16px;border:none;cursor:pointer;transition:all .2s;font-size:14px;display:flex;align-items:center;justify-content:center;background:transparent}.theme-sw button:hover{transform:scale(1.1)}.theme-sw button.active{box-shadow:0 0 0 2px var(--cyan)}
.settings-toggle{position:fixed;top:16px;right:60px;z-index:100;width:36px;height:36px;border-radius:18px;background:var(--surface);border:1px solid var(--border);color:var(--muted);cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;transition:all .2s;backdrop-filter:blur(10px)}
.settings-toggle:hover{color:var(--cyan);border-color:var(--cyan);transform:rotate(30deg)}
.settings-toggle.active{color:var(--cyan);border-color:var(--cyan);background:rgba(0,240,255,.05)}
.settings-panel{position:fixed;top:60px;right:60px;z-index:99;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;backdrop-filter:blur(20px);display:none;min-width:220px;box-shadow:0 8px 32px rgba(0,0,0,.4)}
.settings-panel.open{display:block;animation:fadeIn .2s ease}
.settings-section{margin-bottom:16px}.settings-section:last-child{margin-bottom:0}
.settings-label{font-size:9px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:8px}
.settings-row{display:flex;gap:6px;flex-wrap:wrap}
.settings-row button{padding:4px 12px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;font-size:11px;font-family:'JetBrains Mono',monospace;transition:all .2s}
.settings-row button:hover{color:var(--cyan);border-color:var(--cyan)}
.settings-row button.active{color:var(--cyan);border-color:var(--cyan);background:rgba(0,240,255,.05)}
body{font-family:'JetBrains Mono',monospace;background:var(--bg);color:var(--text);min-height:100vh;overflow-x:hidden}
.scanlines{position:fixed;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,240,255,.015) 2px,rgba(0,240,255,.015) 4px);pointer-events:none;z-index:999}
.stars{position:fixed;inset:0;background:radial-gradient(1px 1px at 10% 20%,rgba(255,255,255,.4),transparent),radial-gradient(1px 1px at 25% 65%,rgba(255,255,255,.3),transparent),radial-gradient(1.5px 1.5px at 50% 30%,rgba(0,240,255,.5),transparent),radial-gradient(1px 1px at 70% 55%,rgba(255,255,255,.35),transparent),radial-gradient(1px 1px at 85% 15%,rgba(168,85,247,.4),transparent),radial-gradient(1.5px 1.5px at 15% 80%,rgba(0,240,255,.45),transparent),radial-gradient(1px 1px at 60% 85%,rgba(255,255,255,.3),transparent),radial-gradient(1px 1px at 90% 75%,rgba(0,255,136,.4),transparent);pointer-events:none;z-index:0}
.grid-pattern{position:fixed;inset:0;background-image:linear-gradient(rgba(0,240,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,240,255,.03) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:0}
main{position:relative;z-index:1;max-width:1400px;margin:0 auto;padding:40px 32px}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:36px;padding:24px 32px;background:var(--card);border:1px solid var(--border);border-radius:12px;backdrop-filter:blur(20px);position:relative;overflow:hidden}
.header::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scan 3s linear infinite}
@keyframes scan{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
.header-left h1{font-family:'Orbitron',sans-serif;font-size:26px;font-weight:900;background:linear-gradient(135deg,var(--cyan),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:2px;text-shadow:0 0 40px rgba(0,240,255,.3)}
.header-left .subtitle{color:var(--muted);font-size:12px;margin-top:4px;letter-spacing:1px}
.header-right{display:flex;gap:16px;align-items:center}
.header-stat{text-align:center;padding:0 20px;border-left:1px solid rgba(0,240,255,.1)}
.header-stat .num{font-family:'Orbitron',sans-serif;font-size:22px;font-weight:700;color:var(--cyan);text-shadow:0 0 20px rgba(0,240,255,.4)}
.header-stat .label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px}
.phase-indicator{display:flex;align-items:center;gap:8px;padding:8px 20px;border:1px solid rgba(0,240,255,.2);border-radius:20px;background:rgba(0,240,255,.05)}
.phase-indicator .dot{width:8px;height:8px;border-radius:50%;background:var(--cyan);box-shadow:0 0 12px var(--cyan);animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 12px var(--cyan)}50%{box-shadow:0 0 24px var(--cyan),0 0 48px rgba(0,240,255,.3)}}
.phase-indicator span{font-size:12px;color:var(--cyan);letter-spacing:1px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:28px}
.stat-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:24px;backdrop-filter:blur(20px);text-align:center;transition:all .3s;position:relative;overflow:hidden}
.stat-card:hover{border-color:rgba(0,240,255,.25);box-shadow:0 0 30px rgba(0,240,255,.08)}
.stat-card .label{font-size:12px;color:var(--muted);margin-bottom:12px;font-weight:500;text-transform:uppercase;letter-spacing:1px}
.stat-card .value{font-family:'Orbitron',sans-serif;font-size:38px;font-weight:900;letter-spacing:-1px}
.stat-card .value.c-cyan{color:var(--cyan);text-shadow:0 0 30px rgba(0,240,255,.3)}
.stat-card .value.c-green{color:var(--green);text-shadow:0 0 30px rgba(0,255,136,.3)}
.stat-card .value.c-orange{color:var(--orange);text-shadow:0 0 20px rgba(245,158,11,.3)}
.stat-card .value.c-muted{color:var(--muted)}
.stat-card .sub{font-size:11px;color:var(--muted);margin-top:6px}
.data-stream{position:absolute;bottom:0;left:0;right:0;height:24px;background:linear-gradient(transparent,rgba(0,240,255,.02));overflow:hidden;border-radius:0 0 12px 12px}
.data-stream span{position:absolute;color:rgba(0,240,255,.12);font-family:'JetBrains Mono',monospace;font-size:10px;white-space:nowrap;animation:stream 25s linear infinite}
@keyframes stream{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}
.charts{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:28px}
@media(max-width:768px){.charts{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}}
.chart-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:24px;backdrop-filter:blur(20px);position:relative}
.chart-card h3{font-size:14px;font-weight:600;margin-bottom:16px;color:var(--text);letter-spacing:.5px;text-transform:uppercase}
.chart-card canvas{max-height:300px}
.panel{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:28px;backdrop-filter:blur(20px);margin-bottom:28px;position:relative}
.panel-title{font-family:'Orbitron',sans-serif;font-size:14px;font-weight:700;color:var(--cyan);letter-spacing:2px;margin-bottom:20px;display:flex;align-items:center;gap:10px}
.panel-title::before{content:'◆';font-size:10px;color:var(--cyan);text-shadow:0 0 8px var(--cyan)}
table{width:100%;border-collapse:collapse;font-size:13px}
th{padding:14px 16px;font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;border-bottom:1px solid rgba(0,240,255,.08);text-align:left}
td{padding:14px 16px;border-bottom:1px solid rgba(0,240,255,.03);color:var(--text);transition:all .2s}
tr:hover td{background:var(--hover)}
.badge{display:inline-block;padding:3px 12px;border-radius:12px;font-size:11px;font-weight:500;letter-spacing:.5px}
.badge-backend{background:rgba(59,130,246,.15);color:var(--blue)}
.badge-web{background:rgba(0,255,136,.1);color:var(--green)}
.badge-h5{background:rgba(245,158,11,.1);color:var(--orange)}
.badge-miniapp{background:rgba(168,85,247,.15);color:var(--purple)}
.badge-done{background:rgba(0,255,136,.1);color:var(--green)}
.badge-progress{background:rgba(59,130,246,.1);color:var(--blue)}
.badge-pending{background:rgba(255,255,255,.03);color:var(--muted)}
.footer{display:flex;justify-content:space-between;align-items:center;margin-top:28px;padding:16px 0;border-top:1px solid rgba(0,240,255,.06);color:var(--muted);font-size:11px;letter-spacing:1px}
.fs-btn{position:absolute;top:10px;right:10px;width:28px;height:28px;border-radius:6px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);color:var(--muted);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .2s;z-index:10;opacity:0}
.stat-card:hover .fs-btn,.chart-card:hover .fs-btn,.panel:hover .fs-btn{opacity:1}
.fs-btn:hover{background:rgba(0,240,255,.1);border-color:rgba(0,240,255,.3);color:var(--cyan)}
.fs-fullscreen{position:fixed!important;inset:0!important;z-index:1000!important;border-radius:0!important;overflow-y:auto!important;background:var(--bg)!important;backdrop-filter:none!important;padding:40px!important;width:100vw!important;height:100vh!important;max-width:none!important}
.fs-fullscreen canvas{max-height:60vh!important}
.fs-tip{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,240,255,.1);border:1px solid rgba(0,240,255,.2);padding:8px 20px;border-radius:20px;font-size:11px;color:var(--cyan);z-index:1001;letter-spacing:1px;animation:fadeIn .3s ease;pointer-events:none}
@keyframes fadeIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
</style>
</head>
<body>
<div class="theme-sw">
  <button onclick="setTheme('ocean')" title="Ocean Blue">🌊</button><button onclick="setTheme('cyber')" title="Cyber Dark">🌙</button>
  <button onclick="setTheme('light')" title="Light Studio">☀️</button><button onclick="setTheme('mono')" title="Mono Tech">⬛</button>
  <button onclick="setTheme('github')" title="GitHub Dark">🐙</button><button onclick="setTheme('synth')" title="SynthWave">💜</button>
  <button onclick="setTheme('amber')" title="Amber Terminal">🟡</button><button onclick="setTheme('sakura')" title="Cherry Sakura">🌸</button>
  <button onclick="setTheme('forest')" title="Midnight Forest">🌲</button>
</div>
<div class="settings-toggle" onclick="toggleSettings()" title="设置">⚙️</div>
<div class="settings-panel" id="settingsPanel">
  <div class="settings-section">
    <div class="settings-label">LANGUAGE</div>
    <div class="settings-row">
      <button data-lang="zh" class="active" onclick="setLang('zh')">中文</button>
      <button data-lang="en" onclick="setLang('en')">EN</button>
    </div>
  </div>
  <div class="settings-section">
    <div class="settings-label">FONT SIZE</div>
    <div class="settings-row">
      <button data-fs="sm" onclick="setFs('sm')">A-</button>
      <button data-fs="md" class="active" onclick="setFs('md')">A</button>
      <button data-fs="lg" onclick="setFs('lg')">A+</button>
      <button data-fs="xl" onclick="setFs('xl')">A++</button>
    </div>
  </div>
  <div class="settings-section">
    <div class="settings-label">EXPORT</div>
    <div class="settings-row">
      <button onclick="exportJSON()">📋 JSON</button>
      <button onclick="exportCSV()">📊 CSV</button>
      <button onclick="location.reload()">🔄 刷新</button>
    </div>
  </div>
</div>
<div class="scanlines"></div><div class="stars"></div><div class="grid-pattern"></div>
<main>
<div class="header">
  <div class="header-left">
    <h1>📊 SPECCORE</h1>
    <div class="subtitle">GLOBAL DASHBOARD · ${projectCount} PROJECTS · ${totalReqs} REQUIREMENTS</div>
  </div>
  <div class="header-right">
    <div class="header-stat"><div class="num">${projectCount}</div><div class="label">项目</div></div>
    <div class="header-stat"><div class="num">${totalReqs}</div><div class="label">需求</div></div>
    <div class="header-stat"><div class="num">${completionRate}%</div><div class="label">完成</div></div>
    <div class="phase-indicator"><div class="dot"></div><span>LIVE</span></div>
  </div>
</div>

<div class="stats">
  <div class="stat-card">
    <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
    <div class="label">📋 总需求数</div>
    <div class="value c-cyan">${totalReqs}</div>
    <div class="sub">${projectCount} 个项目</div>
    <div class="data-stream"><span>SPECCORE · TOTAL REQUIREMENTS · ${now} · V${index.version || '1.0'}</span></div>
  </div>
  <div class="stat-card">
    <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
    <div class="label">✅ 已完成</div>
    <div class="value c-green">${implemented}</div>
    <div class="sub">完成率 ${completionRate}%</div>
    <div class="data-stream"><span>DONE · ${completionRate}% COMPLETION · ${implemented} IMPLEMENTED</span></div>
  </div>
  <div class="stat-card">
    <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
    <div class="label">🔄 进行中</div>
    <div class="value c-orange">${inProgress}</div>
    <div class="sub">${Math.round((inProgress/(totalReqs||1))*100)}%</div>
    <div class="data-stream"><span>IN PROGRESS · ${inProgress} ACTIVE · ITERATIONS ACTIVE</span></div>
  </div>
  <div class="stat-card">
    <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
    <div class="label">🔲 待开发</div>
    <div class="value c-muted">${pending}</div>
    <div class="sub">${Math.round((pending/(totalReqs||1))*100)}%</div>
    <div class="data-stream"><span>PENDING · ${pending} BACKLOG · AWAITING SPRINT</span></div>
  </div>
</div>

<div class="charts">
  <div class="chart-card">
    <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
    <h3>📊 需求状态分布</h3>
    <canvas id="statusChart"></canvas>
  </div>
  <div class="chart-card">
    <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
    <h3>📈 项目需求分布</h3>
    <canvas id="projectChart"></canvas>
  </div>
</div>

<div class="panel">
  <div class="panel-title">PROJECT HEALTH</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px">
    ${projectHealth.map(p => `
    <div style="background:var(--surface);border-radius:8px;padding:14px 16px;display:flex;align-items:center;gap:14px">
      <div style="font-family:Orbitron;font-size:24px;font-weight:900;color:${p.pct >= 80 ? 'var(--green)' : p.pct >= 40 ? 'var(--orange)' : 'var(--muted)'};min-width:50px">${p.pct}%</div>
      <div style="flex:1">
        <div style="font-weight:600;margin-bottom:4px">${p.name}</div>
        <div style="height:4px;background:rgba(255,255,255,.04);border-radius:2px;overflow:hidden">
          <div style="width:${p.pct}%;height:100%;background:linear-gradient(90deg,var(--cyan),var(--green));border-radius:2px"></div>
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:4px">${p.doneCount}/${p.reqCount} 完成</div>
      </div>
    </div>
    `).join('')}
  </div>
</div>

<div class="charts">
  <div class="chart-card">
    <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
    <h3>⚡ Created vs Resolved</h3>
    <canvas id="resolvedChart"></canvas>
  </div>
  <div class="chart-card">
    <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
    <h3>📅 期次进度</h3>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px;max-height:280px;overflow-y:auto">
      ${iterStats.map(it => `
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-family:Orbitron;font-size:11px;color:var(--cyan);min-width:50px">${it.name}</span>
        <div style="flex:1;height:6px;background:rgba(255,255,255,.04);border-radius:3px;overflow:hidden">
          <div style="width:${it.pct}%;height:100%;background:linear-gradient(90deg,var(--cyan),var(--green));border-radius:3px;transition:width 1s"></div>
        </div>
        <span style="font-size:10px;color:var(--muted);min-width:55px;text-align:right">${it.done}/${it.total}</span>
      </div>
      `).join('')}
      ${iterStats.length === 0 ? '<div style="color:var(--muted);text-align:center;padding:20px">暂无期次数据</div>' : ''}
    </div>
  </div>
</div>

<div class="stats">
  <div class="stat-card">
    <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
    <div class="label">🏥 项目健康度</div>
    <div class="value c-cyan">${projectHealth.filter(p => p.pct >= 80).length}/${projectHealth.length}</div>
    <div class="sub">健康项目 / 全部</div>
    <div class="data-stream"><span>HEALTH · ${projectHealth.filter(p=>p.pct>=80).length} GREEN · ${projectHealth.filter(p=>p.pct<40).length} AT RISK</span></div>
  </div>
  <div class="stat-card">
    <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
    <div class="label">📅 活跃期次</div>
    <div class="value c-green">${activeIterCount}</div>
    <div class="sub">共 ${index.iterations.length} 个期次</div>
    <div class="data-stream"><span>ITERATIONS · ${activeIterCount} ACTIVE · ${index.iterations.length} TOTAL</span></div>
  </div>
  <div class="stat-card">
    <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
    <div class="label">📈 交付速率</div>
    <div class="value c-orange">${completionRate}%</div>
    <div class="sub">已完成 / 总需求</div>
    <div class="data-stream"><span>VELOCITY · ${implemented} DONE · ${totalReqs} TOTAL · ${completionRate}%</span></div>
  </div>
</div>

<div class="panel">
  <h3>📋 项目列表</h3>
  <table>
    <thead><tr><th>项目名称</th><th>类型</th><th>需求数</th><th>最后导入</th></tr></thead>
    <tbody>${projectRows || '<tr><td colspan="4">暂无项目</td></tr>'}</tbody>
  </table>
</div>

<div class="table-card">
  <h3>📝 需求详情</h3>
  <table>
    <thead><tr><th>需求 ID</th><th>名称</th><th>项目</th><th>状态</th><th>关联期次</th></tr></thead>
    <tbody>${reqRows || '<tr><td colspan="5">暂无需求</td></tr>'}</tbody>
  </table>
</div>

<div class="footer">Powered by SpecCore | Generated ${now}</div>
</main>

<script>
let fsEl = null;

// Fullscreen toggle
function toggleFS(el) {
  if (fsEl === el) { el.classList.remove('fs-fullscreen'); fsEl = null; document.body.style.overflow = ''; return; }
  if (fsEl) { fsEl.classList.remove('fs-fullscreen'); }
  fsEl = el; el.classList.add('fs-fullscreen');
  document.body.style.overflow = 'hidden';
  const tip = document.createElement('div'); tip.className = 'fs-tip'; tip.textContent = '按 ESC 退出全屏 · 滚动查看详情';
  document.body.appendChild(tip);
  setTimeout(() => tip.remove(), 2500);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && fsEl) { fsEl.classList.remove('fs-fullscreen'); document.body.style.overflow = ''; fsEl = null; } });

// Export functions
function exportJSON() {
  const data = { projects: ${JSON.stringify(index.projects.map(p=>({name:p.name,type:p.type,reqCount:p.reqCount,lastImport:p.lastImport})))} };
  download(JSON.stringify(data, null, 2), 'dashboard-data.json', 'application/json');
}
function exportCSV() {
  const rows = [['需求ID','项目','名称','状态','版本','期次'].join(',')];
  ${JSON.stringify(index.reqs)}.forEach(r => rows.push([r.id,r.project,r.name,r.status,r.version,r.iteration||'-'].join(',')));
  download(rows.join('\\n'), 'dashboard-data.csv', 'text/csv');
}
function download(content, name, type) {
  const b = new Blob([content], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click();
}

// Theme switcher
(function(){
  const saved = localStorage.getItem('speccore-theme') || 'cyber';
  document.documentElement.setAttribute('data-theme', saved);
  document.querySelectorAll('.theme-sw button').forEach(b => {
    const onclick = b.getAttribute('onclick') || '';
    if(onclick.includes('setTheme') && onclick.includes(saved)) b.classList.add('active');
  });
})();
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('speccore-theme', t);
  document.querySelectorAll('.theme-sw button').forEach(b => {
    const onclick = b.getAttribute('onclick') || '';
    b.classList.toggle('active', onclick.includes('setTheme') && onclick.includes(t));
  });
  const light = t === 'light';
  const tc = light ? '#64748b' : '#4a5568';
  const gc = light ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.06)';
  if(typeof statusChart !== 'undefined') {
    statusChart.options.plugins.legend.labels.color = tc;
    projectChart.options.scales.x.ticks.color = tc; projectChart.options.scales.y.ticks.color = tc;
    projectChart.options.scales.x.grid.color = gc; projectChart.options.scales.y.grid.color = gc;
    statusChart.update(); projectChart.update();
  }
}

// Settings toggle
function toggleSettings() {
  const p = document.getElementById('settingsPanel');
  const t = document.querySelector('.settings-toggle');
  p.classList.toggle('open');
  t.classList.toggle('active');
}
document.addEventListener('click', e => {
  const p = document.getElementById('settingsPanel');
  if(p.classList.contains('open') && !e.target.closest('.settings-panel') && !e.target.closest('.settings-toggle')) {
    p.classList.remove('open'); document.querySelector('.settings-toggle').classList.remove('active');
  }
});

// Lang switch
function setLang(l) {
  document.querySelectorAll('.settings-row button[data-lang]').forEach(b => b.classList.toggle('active', b.dataset.lang === l));
  localStorage.setItem('speccore-lang', l);
}
(function() {
  const l = localStorage.getItem('speccore-lang') || (navigator.language.startsWith('zh') ? 'zh' : 'en');
  setLang(l);
})();

// Font size
function setFs(s) {
  document.documentElement.setAttribute('data-fs', s);
  document.querySelectorAll('.settings-row button[data-fs]').forEach(b => b.classList.toggle('active', b.dataset.fs === s));
  localStorage.setItem('speccore-fs', s);
}
(function() {
  const s = localStorage.getItem('speccore-fs') || 'md';
  setFs(s);
})();

// Charts
const isLight = document.documentElement.getAttribute('data-theme') === 'light';
const gridColor = isLight ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.06)';
const textColor = isLight ? '#64748b' : '#4a5568';

const statusChart = new Chart(document.getElementById('statusChart'), {
  type: 'doughnut',
  data: {
    labels: ['已完成', '进行中', '待开发'],
    datasets: [{
      data: [${implemented}, ${inProgress}, ${pending}],
      backgroundColor: ['#00ff88', '#00f0ff', 'rgba(255,255,255,.05)'],
      borderWidth: 2,
      borderColor: 'var(--bg)'
    }]
  },
  options: {
    responsive: true,
    cutout: '60%',
    plugins: {
      legend: { position: 'bottom', labels: { color: textColor, font: { family: 'JetBrains Mono', size: 11 }, padding: 16 } }
    }
  }
});

const projectChart = new Chart(document.getElementById('projectChart'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(projectLabels)},
    datasets: [{
      label: '需求数',
      data: ${JSON.stringify(projectReqs)},
      backgroundColor: '#00f0ff',
      borderRadius: 6
    }]
  },
  options: {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } },
      y: { beginAtZero: true, ticks: { stepSize: 1, color: textColor, font: { size: 10 } }, grid: { color: gridColor } }
    }
  }
});

const resolvedChart = new Chart(document.getElementById('resolvedChart'), {
  type: 'bar',
  data: {
    labels: ['已实现', '进行中', '待开发'],
    datasets: [{
      data: [${implemented}, ${inProgress}, ${pending}],
      backgroundColor: ['rgba(0,255,136,.6)', 'rgba(0,240,255,.6)', 'rgba(255,255,255,.06)'],
      borderRadius: 4
    }]
  },
  options: {
    responsive: true, indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } },
      y: { ticks: { color: textColor, font: { size: 10 } }, grid: { display: false } }
    }
  }
});
</script>
</body>
</html>`;
}
