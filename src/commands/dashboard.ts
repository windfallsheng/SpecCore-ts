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

    // ── 新增：迭代完成统计 ──
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
    const projectName = (index as any).projectName || (await import('path')).basename(process.cwd());
    const html = generateDashboardHtml(
      index.projects.length,
      totalReqs, implemented, inProgress, pending, completionRate,
      projectLabels, projectReqs,
      iterationLabels, iterationReqCounts,
      iterStats, projectHealth, activeIterations.length,
      index,
      projectName
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
    logger.info('   - 迭代关联状态');
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
  index: Awaited<ReturnType<typeof readGlobalIndex>>,
  projectName: string
): string {
  const now = new Date().toISOString().split('T')[0];

  // 生成项目表格行（按需求数降序）
  let projectRows = '';
  const sortedProjects = [...index.projects].sort((a, b) => b.reqCount - a.reqCount);
  for (const proj of sortedProjects) {
    projectRows += `<tr><td>${proj.name}</td><td><span class="badge badge-${proj.type}">${proj.type}</span></td><td>${proj.reqCount}</td><td>${proj.lastImport}</td></tr>`;
  }

  // 生成需求表格行（按迭代倒序：Q3→Q2→Q1，无迭代排最后）
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
    // 同迭代内按状态排：已实现 > 进行中 > 待开发
    const order: Record<string, number> = { '✅': 1, '🔄': 2, '🔲': 3 };
    return (order[a.status.charAt(0)] || 99) - (order[b.status.charAt(0)] || 99);
  });
  for (const req of sortedReqs.slice(0, 30)) {
    const statusClass = req.status.includes('✅') ? 'done' : req.status.includes('🔄') ? 'progress' : 'pending';
    reqRows += `<tr><td>${req.id}</td><td>${req.name}</td><td>${req.project}</td><td><span class="badge badge-${statusClass}">${req.status}</span></td><td>${req.iteration || '-'}</td></tr>`;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="ocean">
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
[data-theme="light"] table th{border-bottom-color:rgba(0,0,0,.15)!important}
[data-theme="light"] table td{border-bottom-color:rgba(0,0,0,.08)!important}
[data-theme="light"] .card,[data-theme="light"] .panel,[data-theme="light"] .header,[data-theme="light"] .stat-card,[data-theme="light"] .chart-card{border-color:rgba(0,0,0,.1)!important}
[data-theme="light"] .card:hover,[data-theme="light"] .panel:hover,[data-theme="light"] .stat-card:hover,[data-theme="light"] .chart-card:hover{border-color:rgba(37,99,235,.25)!important;box-shadow:0 0 24px rgba(37,99,235,.06),inset 0 0 24px rgba(37,99,235,.02)!important}
[data-theme="light"] .footer{border-top-color:rgba(0,0,0,.08)!important}
[data-theme="light"] .scanlines{opacity:.03!important}.stars{opacity:.02!important}
[data-theme="light"] .fs-btn{background:rgba(0,0,0,.03)!important;border-color:rgba(0,0,0,.08)!important}
[data-theme="light"] .data-stream span{color:rgba(0,0,0,.04)!important}
[data-theme="light"] .theme-sw,.lang-sw{border-color:rgba(0,0,0,.1)!important}
[data-theme="light"] tr:hover td{background:rgba(0,0,0,.02)!important}
[data-theme="light"] .header-stat{border-left-color:rgba(0,0,0,.1)!important}
[data-theme="light"] .panel-title::before{text-shadow:none!important}
[data-theme="light"] .grid-pattern{opacity:.3!important}
[data-fs="sm"]{font-size:13px}[data-fs="md"]{font-size:15px}[data-fs="lg"]{font-size:17px}[data-fs="xl"]{font-size:20px}
*,*::after,*::before{box-sizing:border-box;margin:0;padding:0}
.ctrl-panel{position:fixed;top:72px;right:16px;z-index:100;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.ctrl-toggle{width:56px;height:56px;border-radius:50%;border:1px solid var(--border);cursor:pointer;font-size:38px;display:flex;align-items:center;justify-content:center;line-height:0;padding:0;user-select:none;background:var(--surface);color:var(--muted);backdrop-filter:blur(10px);transition:all .3s}
.ctrl-toggle:hover{color:var(--cyan);border-color:var(--cyan);transform:rotate(90deg);transform-origin:center}
.ctrl-toggle.open{color:var(--cyan);border-color:var(--cyan);transform:rotate(90deg);transform-origin:center}
.ctrl-body{max-height:0;overflow:hidden;display:flex;flex-direction:column;gap:6px;align-items:flex-end;transition:max-height .4s ease,opacity .3s ease;opacity:0}
.ctrl-panel.open .ctrl-body{max-height:280px;opacity:1}
.theme-sw{display:flex;gap:6px;background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:4px;backdrop-filter:blur(10px)}
.theme-sw button{width:32px;height:32px;border-radius:16px;border:none;cursor:pointer;transition:all .2s;font-size:14px;display:flex;align-items:center;justify-content:center;background:transparent}
.theme-sw button:hover{transform:scale(1.1)}
.theme-sw button.active{box-shadow:0 0 0 2px var(--cyan);background:rgba(0,240,255,.15)}
.lang-sw{display:flex;gap:4px;background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:4px;backdrop-filter:blur(10px)}
.lang-sw button{padding:4px 10px;border-radius:12px;border:1px solid var(--border);cursor:pointer;font-size:11px;font-family:"JetBrains Mono",monospace;background:transparent;color:var(--muted)}
.lang-sw button:hover{color:var(--text)}
.lang-sw button.active{color:var(--cyan);border-color:var(--cyan);background:rgba(0,240,255,.1)}
html{font-size:18px}html.fs-sm{font-size:11px}html.fs-md{font-size:14px}html.fs-lg{font-size:18px}html.fs-xl{font-size:22px}body{font-family:'JetBrains Mono',monospace!important}.font-jetbrains h1,.font-jetbrains h3,.font-jetbrains .panel-title,.font-jetbrains .num-font,.font-jetbrains .big-num,.font-jetbrains .header-stat .num,.font-jetbrains .card-icon{font-family:'JetBrains Mono',monospace!important}
.font-hybrid,.font-hybrid html{font-size:18px}html.fs-sm{font-size:11px}html.fs-md{font-size:14px}html.fs-lg{font-size:18px}html.fs-xl{font-size:22px}body{font-family:'JetBrains Mono',monospace!important}.font-hybrid h1,.font-hybrid h3,.font-hybrid .panel-title,.font-hybrid .num-font,.font-hybrid .big-num,.font-hybrid .header-stat .num,.font-hybrid .card-icon{font-family:Orbitron,sans-serif!important}
.font-orbitron,.font-orbitron html{font-size:18px}html.fs-sm{font-size:11px}html.fs-md{font-size:14px}html.fs-lg{font-size:18px}html.fs-xl{font-size:22px}body{font-family:Orbitron,sans-serif!important}.font-orbitron h1,.font-orbitron h3,.font-orbitron .panel-title,.font-orbitron .num-font,.font-orbitron .big-num,.font-orbitron .header-stat .num,.font-orbitron .card-icon{font-family:Orbitron,sans-serif!important}
body{font-family:'JetBrains Mono',monospace;background:var(--bg);color:var(--text);min-height:100vh;overflow-x:hidden}
.scanlines{position:fixed;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,240,255,.015) 2px,rgba(0,240,255,.015) 4px);pointer-events:none;z-index:999}
.stars{position:fixed;inset:0;background:radial-gradient(1px 1px at 10% 20%,rgba(255,255,255,.4),transparent),radial-gradient(1px 1px at 25% 65%,rgba(255,255,255,.3),transparent),radial-gradient(1.5px 1.5px at 50% 30%,rgba(0,240,255,.5),transparent),radial-gradient(1px 1px at 70% 55%,rgba(255,255,255,.35),transparent),radial-gradient(1px 1px at 85% 15%,rgba(168,85,247,.4),transparent),radial-gradient(1.5px 1.5px at 15% 80%,rgba(0,240,255,.45),transparent),radial-gradient(1px 1px at 60% 85%,rgba(255,255,255,.3),transparent),radial-gradient(1px 1px at 90% 75%,rgba(0,255,136,.4),transparent);pointer-events:none;z-index:0}
.grid-pattern{position:fixed;inset:0;background-image:linear-gradient(rgba(0,240,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,240,255,.03) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:0}
main{position:relative;z-index:1;max-width:1400px;margin:0 auto;padding:40px 32px}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:36px;padding:24px 32px;background:var(--card);border:1px solid var(--border);border-radius:12px;backdrop-filter:blur(20px);position:relative;overflow:hidden}
.header::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX 3s linear infinite}
.header::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX-rev 3s linear infinite}
@keyframes scanX{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
@keyframes scanX-rev{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}
@keyframes scanY{0%{transform:translateY(-100%)}100%{transform:translateY(100%)}}
@keyframes scanY-rev{0%{transform:translateY(100%)}100%{transform:translateY(-100%)}}
@keyframes cardGlow{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.6)}}
.card-bg{position:absolute;inset:0;pointer-events:none;z-index:0;background:radial-gradient(ellipse at 50% 10%,rgba(14,165,233,.25) 0%,transparent 70%);animation:cardGlow 3s ease-in-out infinite;transform-origin:top center}
.header-left::before{content:'';position:absolute;top:0;left:0;width:1px;bottom:0;background:linear-gradient(180deg,transparent,var(--cyan),transparent);animation:scanY-rev 3s linear infinite;pointer-events:none}
.header-right::after{content:'';position:absolute;top:0;right:0;width:1px;bottom:0;background:linear-gradient(180deg,transparent,var(--cyan),transparent);animation:scanY 3s linear infinite;pointer-events:none}
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
.data-stream{position:absolute;bottom:6px;left:0;right:0;height:18px;overflow:hidden}
.data-stream span{position:absolute;top:3px;color:rgba(0,240,255,.08);font-family:'JetBrains Mono',monospace;font-size:9px;white-space:nowrap;animation:stream 25s linear infinite}
@keyframes stream{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}
.charts{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:28px}
@media(max-width:768px){.charts{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}}
.chart-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:24px;backdrop-filter:blur(20px);position:relative;transition:all .3s}
.chart-card:hover{border-color:rgba(0,240,255,.25);box-shadow:0 0 30px rgba(0,240,255,.08)}
.chart-card:hover .fs-btn{opacity:1}
.chart-card h3{font-size:14px;font-weight:600;margin-bottom:16px;color:var(--muted);letter-spacing:.5px;text-transform:uppercase}
.chart-card canvas{max-height:300px}
.panel{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:28px;backdrop-filter:blur(20px);margin-bottom:28px;position:relative;transition:all .3s}
.panel:hover{border-color:rgba(0,240,255,.25);box-shadow:0 0 30px rgba(0,240,255,.08)}
.panel:hover .fs-btn{opacity:1}
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
.footer{text-align:center;color:var(--muted);font-size:11px;margin-top:40px;padding:16px 0;border-top:1px solid rgba(0,240,255,.06);letter-spacing:1px}
.scroll-table{max-height:70vh;overflow-y:auto}.scroll-table thead{position:sticky;top:0;z-index:2;background:var(--card)}
.fs-btn{position:absolute;top:10px;right:10px;width:28px;height:28px;border-radius:6px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);color:var(--muted);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .2s;z-index:10;opacity:0}
.stat-card:hover .fs-btn,.chart-card:hover .fs-btn,.panel:hover .fs-btn{opacity:1}
.fs-btn:hover{background:rgba(0,240,255,.1);border-color:rgba(0,240,255,.3);color:var(--cyan)}
.fs-fullscreen{position:fixed!important;inset:0!important;z-index:1000!important;border-radius:0!important;overflow-y:auto!important;background:var(--bg)!important;backdrop-filter:none!important;padding:40px!important;width:100vw!important;height:100vh!important;max-width:none!important}
.fs-fullscreen canvas{max-height:60vh!important}
.fs-fullscreen .scroll-table{max-height:none!important}
.fs-tip{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,240,255,.1);border:1px solid rgba(0,240,255,.2);padding:8px 20px;border-radius:20px;font-size:11px;color:var(--cyan);z-index:1001;letter-spacing:1px;animation:fadeIn .3s ease;pointer-events:none}
@keyframes fadeIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
</style>
</head>
<body>
<div class="ctrl-panel" id="ctrlPanel">
  <button class="ctrl-toggle" onclick="toggleCtrl()" title="设置">⚙</button>
  <div class="ctrl-body">
    <div class="theme-sw">
      <button onclick="setTheme('ocean')" title="Ocean Blue">🌊</button><button onclick="setTheme('cyber')" title="Cyber Dark">🌙</button>
      <button onclick="setTheme('light')" title="Light Studio">☀️</button><button onclick="setTheme('mono')" title="Mono Tech">⬛</button>
      <button onclick="setTheme('github')" title="GitHub Dark">🐙</button><button onclick="setTheme('synth')" title="SynthWave">💜</button>
      <button onclick="setTheme('amber')" title="Amber Terminal">🟡</button><button onclick="setTheme('sakura')" title="Cherry Sakura">🌸</button>
      <button onclick="setTheme('forest')" title="Midnight Forest">🌲</button>
    </div>
    <div class="lang-sw">
      <button data-lang="zh" class="active" onclick="setLang('zh')">中文</button>
      <button data-lang="en" onclick="setLang('en')">EN</button>
    </div>
    <div class="lang-sw">
      <button onclick="setFont('hybrid')" class="active" data-font="hybrid">Hybrid</button>
      <button onclick="setFont('orbitron')" data-font="orbitron">Orbit</button>
      <button onclick="setFont('jetbrains')" data-font="jetbrains">Mono</button>
    </div>
    <div class="lang-sw">
      <button onclick="setSize('sm')" data-size="sm">S</button>
      <button onclick="setSize('md')" data-size="md">M</button>
      <button onclick="setSize('lg')" class="active" data-size="lg">L</button>
      <button onclick="setSize('xl')" data-size="xl">XL</button>
    </div>
  </div>
</div>
<div class="scanlines"></div><div class="stars"></div><div class="grid-pattern"></div>
<main>
<div class="header">
  <div class="card-bg"></div>
  <div class="header-left">
    <h1>${projectName || 'SPECCORE'}</h1>
    <div class="subtitle"><span data-i18n="globalDash">全局仪表盘</span> · ${projectCount} <span data-i18n="projects">项目</span> · ${totalReqs} <span data-i18n="reqs">需求</span></div>
  </div>
  <div class="header-right">
    <div class="header-stat"><div class="num">${projectCount}</div><div class="label" data-i18n="projects">项目</div></div>
    <div class="header-stat"><div class="num">${totalReqs}</div><div class="label" data-i18n="reqs">需求</div></div>
    <div class="header-stat"><div class="num">${completionRate}%</div><div class="label" data-i18n="done2">完成</div></div>
    <div class="phase-indicator"><div class="dot"></div><span>LIVE</span></div>
  </div>
  <div class="data-stream" style="position:absolute"><span>SPECCORE · DASHBOARD · ${projectCount} PROJECTS · ${totalReqs} REQUIREMENTS · ${completionRate}% COMPLETE · POWERED BY SPECCORE</span></div>
</div>

<div class="stats">
  <div class="stat-card">
    <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
    <div class="label">📋 <span data-i18n="total">总需求数</span></div>
    <div class="value c-cyan">${totalReqs}</div>
    <div class="sub">${projectCount} 个项目</div>
    <div class="data-stream"><span>SPECCORE · TOTAL REQUIREMENTS · ${now} · V${index.version || '1.0'}</span></div>
  </div>
  <div class="stat-card">
    <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
    <div class="label">✅ <span data-i18n="done">已完成</span></div>
    <div class="value c-green">${implemented}</div>
    <div class="sub"><span data-i18n="done2">完成</span>率 ${completionRate}%</div>
    <div class="data-stream"><span>DONE · ${completionRate}% COMPLETION · ${implemented} IMPLEMENTED</span></div>
  </div>
  <div class="stat-card">
    <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
    <div class="label">🔄 <span data-i18n="progress">进行中</span></div>
    <div class="value c-orange">${inProgress}</div>
    <div class="sub">${Math.round((inProgress/(totalReqs||1))*100)}%</div>
    <div class="data-stream"><span>IN PROGRESS · ${inProgress} ACTIVE · ITERATIONS ACTIVE</span></div>
  </div>
  <div class="stat-card">
    <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
    <div class="label">🔲 <span data-i18n="pending">待开发</span></div>
    <div class="value c-muted">${pending}</div>
    <div class="sub">${Math.round((pending/(totalReqs||1))*100)}%</div>
    <div class="data-stream"><span>PENDING · ${pending} BACKLOG · AWAITING SPRINT</span></div>
  </div>
</div>

<div class="charts">
  <div class="chart-card">
    <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
    <h3>📊 <span data-i18n="statusDist">需求状态分布</span></h3>
    <canvas id="statusChart"></canvas>
    <div class="data-stream"><span>STATUS · ${implemented} DONE · ${inProgress} ACTIVE · ${pending} BACKLOG</span></div>
  </div>
  <div class="chart-card">
    <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
    <h3>📈 <span data-i18n="projDist">项目需求分布</span></h3>
    <canvas id="projectChart"></canvas>
  </div>
</div>

<div class="panel">
  <div class="panel-title"><span data-i18n="projHealth">项目健康度</span></div>
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
    <h3>⚡ <span data-i18n="createdVsResolved">需求创建 vs 完成</span></h3>
    <canvas id="resolvedChart"></canvas>
  </div>
  <div class="chart-card">
    <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
    <h3>📅 <span data-i18n="iterProgress">迭代进度</span></h3>
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
      ${iterStats.length === 0 ? '<div style="color:var(--muted);text-align:center;padding:20px">暂无迭代数据</div>' : ''}
    </div>
  </div>
</div>

<div class="stats">
  <div class="stat-card">
    <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
    <div class="label">🏥 <span data-i18n="health">项目健康度</span></div>
    <div class="value c-cyan">${projectHealth.filter(p => p.pct >= 80).length}/${projectHealth.length}</div>
    <div class="sub">健康项目 / 全部</div>
    <div class="data-stream"><span>HEALTH · ${projectHealth.filter(p=>p.pct>=80).length} GREEN · ${projectHealth.filter(p=>p.pct<40).length} AT RISK</span></div>
  </div>
  <div class="stat-card">
    <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
    <div class="label">📅 <span data-i18n="activeIter">活跃迭代</span></div>
    <div class="value c-green">${activeIterCount}</div>
    <div class="sub">共 ${index.iterations.length} 个迭代</div>
    <div class="data-stream"><span>ITERATIONS · ${activeIterCount} ACTIVE · ${index.iterations.length} TOTAL</span></div>
  </div>
  <div class="stat-card">
    <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
    <div class="label">📈 <span data-i18n="velocity">交付速率</span></div>
    <div class="value c-orange">${completionRate}%</div>
    <div class="sub">已完成 / 总需求</div>
    <div class="data-stream"><span>VELOCITY · ${implemented} DONE · ${totalReqs} TOTAL · ${completionRate}%</span></div>
  </div>
</div>

<div class="panel">
  <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
  <div class="panel-title"><span data-i18n="projList">项目列表</span></div>
  <table>
    <thead><tr><th><span data-i18n="projName">项目名称</span></th><th><span data-i18n="type">类型</span></th><th><span data-i18n="reqCount">需求数</span></th><th><span data-i18n="lastImport">最后导入</span></th></tr></thead>
    <tbody>${projectRows || '<tr><td colspan="4">暂无项目</td></tr>'}</tbody>
  </table>
</div>

<div class="panel">
  <button class="fs-btn" title="全屏 (F)" onclick="toggleFS(this.parentElement)">⛶</button>
  <div class="panel-title"><span data-i18n="reqDetail">需求详情</span></div>
  <div class="scroll-table">
  <table>
    <thead><tr><th><span data-i18n="reqId">需求 ID</span></th><th><span data-i18n="name">名称</span></th><th><span data-i18n="project">项目</span></th><th><span data-i18n="status">状态</span></th><th><span data-i18n="iteration">关联迭代</span></th></tr></thead>
    <tbody>${reqRows || '<tr><td colspan="5">暂无需求</td></tr>'}</tbody>
  </table>
  </div>
</div>

<div class="footer"><span data-i18n="powered">由 SpecCore 驱动</span> ${index.version || 'v1.0'} &nbsp;&nbsp;|&nbsp;&nbsp; Generated ${now}</div>
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
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&fsEl){fsEl.classList.remove('fs-fullscreen');document.body.style.overflow='';fsEl=null}
  if(e.key==='f'||e.key==='F'){
    if(document.activeElement&&document.activeElement.tagName==='INPUT')return;
    const hovered=document.querySelector('.stat-card:hover,.chart-card:hover,.panel:hover');
    if(hovered)toggleFS(hovered);
  }
});

// Export functions
function exportJSON() {
  const data = { projects: ${JSON.stringify(index.projects.map(p=>({name:p.name,type:p.type,reqCount:p.reqCount,lastImport:p.lastImport})))} };
  download(JSON.stringify(data, null, 2), 'dashboard-data.json', 'application/json');
}
function exportCSV() {
  const rows = [['需求ID','项目','名称','状态','版本','迭代'].join(',')];
  ${JSON.stringify(index.reqs)}.forEach(r => rows.push([r.id,r.project,r.name,r.status,r.version,r.iteration||'-'].join(',')));
  download(rows.join('\\n'), 'dashboard-data.csv', 'text/csv');
}
function download(content, name, type) {
  const b = new Blob([content], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click();
}

// Settings toggle (ctrl-panel)
function toggleCtrl() {
  document.getElementById('ctrlPanel').classList.toggle('open');
  document.querySelector('.ctrl-toggle').classList.toggle('open');
}

// Theme - index based (order: ocean,cyber,light,mono,github,synth,amber,sakura,forest)
const THEMES = ['ocean','cyber','light','mono','github','synth','amber','sakura','forest'];
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('speccore-theme', t);
  document.querySelectorAll('.theme-sw button').forEach((b,i) => b.classList.toggle('active', THEMES[i]===t));
  updateChartColors(t);
}
function updateChartColors(t) {
  if(typeof statusChart === 'undefined') return;
  const light = t === 'light';
  const tc = light ? '#64748b' : '#4a5568';
  const gc = light ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.06)';
  [statusChart, projectChart, resolvedChart].forEach(ch => {
    if(!ch) return;
    if(ch.config.type !== 'doughnut') {
      ch.options.scales.x.ticks.color = tc; ch.options.scales.y.ticks.color = tc;
      ch.options.scales.x.grid.color = gc; ch.options.scales.y.grid.color = gc;
    }
    if(ch.options.plugins.legend) ch.options.plugins.legend.labels.color = tc;
    ch.update();
  });
}

// Lang
var I18N={zh:{total:'总需求数',done:'已完成',progress:'进行中',pending:'待开发',health:'项目健康度',activeIter:'活跃迭代',velocity:'交付速率',statusDist:'需求状态分布',projDist:'项目需求分布',createdVsResolved:'需求创建 vs 完成',iterProgress:'迭代进度',projHealth:'项目健康度',projList:'项目列表',reqDetail:'需求详情',projName:'项目名称',type:'类型',reqCount:'需求数',lastImport:'最后导入',reqId:'需求 ID',name:'名称',project:'项目',status:'状态',iteration:'关联迭代',projects:'项目',reqs:'requirements',done2:'完成',live:'LIVE',globalDash:'全局仪表盘',powered:'由 SpecCore 驱动'},en:{total:'Total Reqs',done:'Done',progress:'In Progress',pending:'Backlog',health:'Project Health',activeIter:'Active Iterations',velocity:'Velocity',statusDist:'Status Distribution',projDist:'Project Distribution',createdVsResolved:'Created vs Resolved',iterProgress:'Iteration Progress',projHealth:'PROJECT HEALTH',projList:'Project List',reqDetail:'Requirement Details',projName:'Project Name',type:'Type',reqCount:'Reqs',lastImport:'Last Import',reqId:'Req ID',name:'Name',project:'Project',status:'Status',iteration:'Iteration',projects:'Projects',reqs:'Reqs',done2:'Done',live:'LIVE',globalDash:'GLOBAL DASHBOARD',powered:'Powered by SpecCore'}};
function setLang(l) {
  document.querySelectorAll('.lang-sw button[data-lang]').forEach(b => b.classList.toggle('active', b.dataset.lang===l));
  document.querySelectorAll('[data-i18n]').forEach(el => { var k=el.getAttribute('data-i18n'); if(I18N[l]&&I18N[l][k]) el.textContent=I18N[l][k] });
  localStorage.setItem('speccore-lang', l);
}

// Font family
function setFont(f) {
  document.documentElement.className = document.documentElement.className.replace(/font-\w+/g,'');
  if(f!=='hybrid') document.documentElement.classList.add('font-'+f);
  document.querySelectorAll('.lang-sw button[data-font]').forEach(b => b.classList.toggle('active', b.dataset.font===f));
  localStorage.setItem('speccore-font', f);
}

// Font size
function setSize(s) {
  document.documentElement.className = document.documentElement.className.replace(/fs-\w+/g,'');
  document.documentElement.classList.add('fs-'+s);
  document.querySelectorAll('.lang-sw button[data-size]').forEach(b => b.classList.toggle('active', b.dataset.size===s));
  localStorage.setItem('speccore-size', s);
}

// Init saved settings
(function(){
  setTheme(localStorage.getItem('speccore-theme') || 'ocean');
  setLang(localStorage.getItem('speccore-lang') || 'zh');
  setFont(localStorage.getItem('speccore-font') || 'hybrid');
  setSize(localStorage.getItem('speccore-size') || 'lg');
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
updateChartColors(document.documentElement.getAttribute('data-theme'));
</script>
</body>
</html>`;
}
