export interface PlanHtmlTask {
  id: string;
  name: string;
  priority: string;
  status: string;
  owner?: string;
  dependsOn: string[];
}

export interface PlanHtmlOptions {
  version: string;
  iteration: string;
  planName?: string;
}

/**
 * Generate a dark cyberpunk-style HTML visualization for execution plan.
 */
export function generatePlanHtml(
  tasks: PlanHtmlTask[],
  opts: PlanHtmlOptions
): string {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const total = tasks.length;
  const completed = tasks.filter(t => t.status === 'completed').length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length;
  const pending = total - completed - inProgress;

  // Mermaid flowchart data
  const mermaidLines: string[] = [];
  const hasDeps = tasks.some(t => t.dependsOn.length > 0);
  if (hasDeps || tasks.length > 1) {
    mermaidLines.push('graph LR');
    for (const t of tasks) {
      const label = t.name.length > 18 ? t.name.slice(0, 15) + '...' : t.name;
      const escapedLabel = label.replace(/"/g, '\\"');
      if (t.dependsOn.length > 0) {
        for (const d of t.dependsOn) {
          // Find the dep label
          const depTask = tasks.find(x => x.id === d);
          const depLabel = depTask
            ? (depTask.name.length > 18 ? depTask.name.slice(0, 15) + '...' : depTask.name)
            : d;
          mermaidLines.push(`  ${d}["${depLabel.replace(/"/g, '\\"')}"] --> ${t.id}["${escapedLabel}"]`);
        }
      } else {
        mermaidLines.push(`  ${t.id}["${escapedLabel}"]`);
      }
    }
    // Style high-priority or multi-dependency tasks
    for (const t of tasks) {
      if (t.priority === 'high' || t.dependsOn.length >= 2) {
        mermaidLines.push(`  style ${t.id} fill:#f97316,stroke:#0ea5e9,stroke-width:2px,color:#fff`);
      }
    }
    // Style completed tasks
    for (const t of tasks) {
      if (t.status === 'completed') {
        mermaidLines.push(`  style ${t.id} fill:#14b8a6,stroke:#0ea5e9,stroke-width:1px,color:#fff`);
      }
    }
  }

  const mermaidDef = mermaidLines.join('\n');

  // Task cards HTML
  const taskCards = tasks.map((t, idx) => {
    const statusConfig: Record<string, { emoji: string; label: string; color: string }> = {
      completed: { emoji: '✅', label: '已完成', color: '#14b8a6' },
      in_progress: { emoji: '🔄', label: '进行中', color: '#f97316' },
      pending: { emoji: '⏳', label: '待开始', color: '#64748b' },
    };
    const sc = statusConfig[t.status] || statusConfig.pending;
    const prioColor = t.priority === 'high' ? '#ef4444' : t.priority === 'medium' ? '#f59e0b' : '#22c55e';
    const prioLabel = t.priority === 'high' ? '🔴 高' : t.priority === 'medium' ? '🟡 中' : '🟢 低';

    return `
      <div class="task-card" style="border-left: 3px solid ${sc.color}">
        <div class="task-header">
          <span class="task-num">#${String(idx + 1).padStart(2, '0')}</span>
          <span class="task-id">${t.id}</span>
          <span class="task-status" style="color:${sc.color}">${sc.emoji} ${sc.label}</span>
        </div>
        <div class="task-name">${t.name}</div>
        <div class="task-meta">
          <span class="meta-prio" style="color:${prioColor}">${prioLabel}</span>
          ${t.owner ? `<span class="meta-owner">👤 ${t.owner}</span>` : ''}
          ${t.dependsOn.length > 0 ? `<span class="meta-deps">🔗 依赖: ${t.dependsOn.join(', ')}</span>` : '<span class="meta-deps" style="color:#4a5568">🔗 无依赖</span>'}
        </div>
        ${t.status === 'in_progress' ? '<div class="progress-bar"><div class="progress-fill"></div></div>' : ''}
      </div>`;
  }).join('');

  // Timeline items
  const timelineItems = tasks.map((t, idx) => {
    const dotColor = t.status === 'completed' ? '#14b8a6' : t.status === 'in_progress' ? '#f97316' : '#64748b';
    const dotPulse = t.status === 'in_progress' ? 'dot-pulse' : '';
    return `
      <div class="tl-item">
        <div class="tl-dot ${dotPulse}" style="background:${dotColor};box-shadow:0 0 10px ${dotColor}"></div>
        <div class="tl-content">
          <div class="tl-num">#${String(idx + 1).padStart(2, '0')}</div>
          <div class="tl-id">${t.id}</div>
          <div class="tl-name">${t.name}</div>
        </div>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SpecCore 执行计划 — ${opts.iteration}</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=JetBrains+Mono:wght@400;600');

:root {
  --bg: #0b1929;
  --card: rgba(13, 31, 56, 0.9);
  --border: rgba(14, 165, 233, 0.15);
  --cyan: #0ea5e9;
  --green: #14b8a6;
  --orange: #f97316;
  --purple: #6366f1;
  --text: #bae6fd;
  --muted: #5b7fa5;
  --surface: rgba(13, 31, 56, 0.9);
}

*, *::after, *::before { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'JetBrains Mono', monospace;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  overflow-x: hidden;
}

/* ── Scanlines ── */
.scanlines {
  position: fixed; inset: 0;
  background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(14,165,233,.015) 2px, rgba(14,165,233,.015) 4px);
  pointer-events: none; z-index: 999;
}

/* ── Grid ── */
.grid-pattern {
  position: fixed; inset: 0;
  background-image: linear-gradient(rgba(14,165,233,.02) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(14,165,233,.02) 1px, transparent 1px);
  background-size: 60px 60px;
  pointer-events: none; z-index: 0;
}

main { position: relative; z-index: 1; max-width: 1200px; margin: 0 auto; padding: 40px 24px; }

/* ── Header ── */
.header {
  text-align: center; margin-bottom: 36px;
  padding: 32px 24px;
  background: var(--card); border: 1px solid var(--border);
  border-radius: 16px; backdrop-filter: blur(20px);
  position: relative; overflow: hidden;
}
.header::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
  background: linear-gradient(90deg, transparent, var(--cyan), transparent);
  animation: scanX 3s linear infinite;
}
@keyframes scanX { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
.header h1 {
  font-family: 'Orbitron', sans-serif; font-size: 28px; font-weight: 900;
  background: linear-gradient(135deg, var(--cyan), var(--purple));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text; letter-spacing: 2px;
  text-shadow: 0 0 40px rgba(14,165,233,.3);
}
.header .sub { color: var(--muted); font-size: 13px; margin-top: 8px; letter-spacing: 1px; }

/* ── Progress ── */
.progress-section { margin: 20px 0 30px; }
.progress-bar {
  height: 8px; background: rgba(255,255,255,.06); border-radius: 4px;
  position: relative; overflow: hidden;
}
.progress-fill {
  height: 100%; background: linear-gradient(90deg, #14b8a6, #0ea5e9);
  border-radius: 4px; position: absolute; top: 0; left: 0; transition: width .5s;
}
.progress-inprogress {
  height: 100%; background: #f97316; border-radius: 0 4px 4px 0;
  position: absolute; top: 0; transition: .5s;
}
.progress-legend {
  display: flex; gap: 20px; justify-content: center; margin-top: 8px;
  font-size: 12px; color: var(--muted);
}

/* ── Stats ── */
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px; margin-bottom: 32px;
}
.stat-card {
  background: var(--card); border: 1px solid var(--border);
  border-radius: 12px; padding: 24px; text-align: center;
  backdrop-filter: blur(20px); transition: all .3s;
  position: relative; overflow: hidden;
}
.stat-card:hover { border-color: rgba(14,165,233,.35); box-shadow: 0 0 30px rgba(14,165,233,.08); }
.stat-card .label { font-size: 12px; color: var(--muted); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px; }
.stat-card .value { font-family: 'Orbitron', sans-serif; font-size: 42px; font-weight: 900; }
.stat-card .value.c-cyan { color: var(--cyan); text-shadow: 0 0 30px rgba(14,165,233,.3); }
.stat-card .value.c-green { color: var(--green); text-shadow: 0 0 30px rgba(20,184,166,.3); }
.stat-card .value.c-orange { color: var(--orange); text-shadow: 0 0 20px rgba(249,115,22,.3); }
.stat-card .value.c-muted { color: var(--muted); }

/* ── Sections ── */
.section {
  background: var(--card); border: 1px solid var(--border);
  border-radius: 16px; padding: 28px; margin-bottom: 28px;
  backdrop-filter: blur(20px); transition: all .3s;
}
.section:hover { border-color: rgba(14,165,233,.25); box-shadow: 0 0 30px rgba(14,165,233,.08); }
.section-title {
  font-family: 'Orbitron', sans-serif; font-size: 15px; font-weight: 700;
  color: var(--cyan); letter-spacing: 2px; margin-bottom: 20px;
  display: flex; align-items: center; gap: 10px;
}
.section-title::before { content: '◆'; font-size: 10px; color: var(--cyan); text-shadow: 0 0 8px var(--cyan); }

/* ── Mermaid ── */
.mermaid-wrapper {
  background: rgba(0,0,0,.2); border-radius: 8px;
  padding: 20px; overflow-x: auto;
  display: flex; justify-content: center;
}
.mermaid-wrapper .mermaid { min-width: 100%; }

/* ── Task Cards ── */
.task-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
.task-card {
  background: rgba(0,0,0,.2); border: 1px solid var(--border);
  border-radius: 10px; padding: 18px; transition: all .3s;
}
.task-card:hover { border-color: rgba(14,165,233,.35); box-shadow: 0 0 16px rgba(14,165,233,.06); }
.task-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.task-num { font-family: 'Orbitron', sans-serif; font-size: 14px; color: var(--cyan); font-weight: 700; }
.task-id { font-size: 12px; color: var(--muted); background: rgba(14,165,233,.08); padding: 2px 8px; border-radius: 4px; }
.task-status { margin-left: auto; font-size: 12px; font-weight: 600; }
.task-name { font-size: 14px; font-weight: 600; margin-bottom: 10px; line-height: 1.5; }
.task-meta { display: flex; flex-wrap: wrap; gap: 10px; font-size: 11px; color: var(--muted); }
.meta-prio { font-weight: 600; }
.meta-owner, .meta-deps { opacity: 0.8; }

/* ── Progress Bar ── */
.progress-bar {
  margin-top: 10px; height: 3px; background: rgba(255,255,255,.06);
  border-radius: 2px; overflow: hidden;
}
.progress-fill {
  height: 100%; width: 50%;
  background: linear-gradient(90deg, var(--orange), var(--cyan));
  border-radius: 2px; animation: progressPulse 2s ease-in-out infinite;
}
@keyframes progressPulse {
  0%, 100% { opacity: 0.7; } 50% { opacity: 1; }
}

/* ── Timeline ── */
.timeline {
  position: relative; padding-left: 30px;
}
.timeline::before {
  content: ''; position: absolute; left: 12px; top: 0; bottom: 0;
  width: 2px; background: linear-gradient(180deg, var(--cyan), var(--purple), var(--green));
}
.tl-item {
  position: relative; margin-bottom: 24px; padding-left: 24px;
}
.tl-dot {
  position: absolute; left: -7px; top: 4px;
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid var(--border); background: var(--muted);
}
.tl-dot.dot-pulse { animation: dotPulse 2s ease-in-out infinite; }
@keyframes dotPulse {
  0%, 100% { box-shadow: 0 0 10px currentColor; } 50% { box-shadow: 0 0 20px currentColor, 0 0 40px currentColor; }
}
.tl-content {
  background: rgba(0,0,0,.15); border: 1px solid var(--border);
  border-radius: 8px; padding: 12px 16px; transition: all .3s;
}
.tl-content:hover { border-color: rgba(14,165,233,.3); }
.tl-num { font-family: 'Orbitron', sans-serif; font-size: 12px; color: var(--cyan); margin-bottom: 4px; }
.tl-id { font-size: 11px; color: var(--muted); margin-bottom: 4px; }
.tl-name { font-size: 14px; font-weight: 600; }

/* ── Footer ── */
.footer {
  text-align: center; color: var(--muted); font-size: 12px;
  margin-top: 40px; padding: 20px 0;
  border-top: 1px solid rgba(14,165,233,.06); letter-spacing: 1px;
  display: flex; justify-content: center; align-items: center; gap: 20px; flex-wrap: wrap;
}
.refresh-btn {
  cursor: pointer; color: var(--cyan); font-weight: 600;
  padding: 6px 16px; border: 1px solid rgba(14,165,233,.3); border-radius: 6px;
  transition: .2s; font-size: 11px;
}
.refresh-btn:hover { background: rgba(14,165,233,.12); border-color: var(--cyan); }
.auto-refresh { color: var(--muted); font-size: 11px; cursor: pointer; }
.auto-refresh input { accent-color: var(--cyan); margin-right: 4px; }

/* ── Responsive ── */
@media (max-width: 768px) {
  .stats { grid-template-columns: 1fr 1fr; }
  .task-grid { grid-template-columns: 1fr; }
  main { padding: 20px 12px; }
  .header h1 { font-size: 20px; }
  .stat-card .value { font-size: 32px; }
}
</style>
</head>
<body>
<div class="scanlines"></div>
<div class="grid-pattern"></div>

<main>
  <!-- Header -->
  <div class="header">
    <h1>${opts.planName ? `📋 ${opts.planName}` : '📋 SpecCore 执行计划'}</h1>
    <div class="sub">迭代: ${opts.iteration} · 版本: ${opts.version} · 进度: ${total > 0 ? completed + inProgress : 0}/${total} (${total > 0 ? Math.round((completed / total) * 100) : 0}%)</div>
  </div>

  ${total > 0 ? `
  <!-- Progress -->
  <div class="progress-section">
    <div class="progress-bar">
      <div class="progress-fill" style="width:${Math.round((completed / total) * 100)}%"></div>
      <div class="progress-inprogress" style="width:${Math.round((inProgress / total) * 100)}%; left:${Math.round((completed / total) * 100)}%"></div>
    </div>
    <div class="progress-legend">
      <span>🟢 已完成 ${completed}</span>
      <span>🟡 进行中 ${inProgress}</span>
      <span>⚪ 待开始 ${pending}</span>
    </div>
  </div>` : '<div class="sub" style="text-align:center;margin-top:20px;color:var(--muted)">暂无任务，请先 analyze → split 生成任务</div>'}

  <!-- Stats -->
  <div class="stats">
    <div class="stat-card">
      <div class="label">总任务数</div>
      <div class="value c-cyan">${total}</div>
    </div>
    <div class="stat-card">
      <div class="label">已完成</div>
      <div class="value c-green">${completed}</div>
    </div>
    <div class="stat-card">
      <div class="label">进行中</div>
      <div class="value c-orange">${inProgress}</div>
    </div>
    <div class="stat-card">
      <div class="label">待开始</div>
      <div class="value c-muted">${pending}</div>
    </div>
  </div>

${hasDeps || tasks.length > 1 ? `
  <!-- Mermaid Flowchart -->
  <div class="section">
    <div class="section-title">🔗 任务依赖关系图</div>
    <div class="mermaid-wrapper">
      <pre class="mermaid">
${mermaidDef}
      </pre>
    </div>
  </div>
` : ''}

  <!-- Task List -->
  <div class="section">
    <div class="section-title">📦 任务列表</div>
    <div class="task-grid">
${taskCards}
    </div>
  </div>

  <!-- Timeline -->
  <div class="section">
    <div class="section-title">⏱️ 执行时间线</div>
    <div class="timeline">
${timelineItems}
    </div>
  </div>

  <!-- Footer -->
  <div class="footer">
    <label class="auto-refresh"><input type="checkbox" id="autoRefresh" onchange="toggleAutoRefresh()"> 自动刷新（30s）</label>
    <span class="refresh-btn" onclick="location.reload()" title="刷新页面获取最新数据">🔄 立即刷新</span>
    <span id="refreshStatus"></span>
  </div>
</main>

<script>
let autoTimer = null;
function toggleAutoRefresh() {
  if (document.getElementById('autoRefresh').checked) {
    autoTimer = setInterval(() => location.reload(), 30000);
    document.getElementById('refreshStatus').textContent = '● 监控中';
    document.getElementById('refreshStatus').style.color = '#14b8a6';
  } else {
    clearInterval(autoTimer);
    document.getElementById('refreshStatus').textContent = '';
  }
}
// 默认开启自动刷新
document.getElementById('autoRefresh').checked = true;
toggleAutoRefresh();
</script>

<script>
mermaid.initialize({
  startOnLoad: true,
  theme: 'dark',
  themeVariables: {
    primaryColor: '#0ea5e9',
    primaryTextColor: '#bae6fd',
    primaryBorderColor: '#0ea5e9',
    lineColor: '#5b7fa5',
    secondaryColor: '#1e293b',
    tertiaryColor: '#0b1929',
    fontSize: '14px',
    fontFamily: 'JetBrains Mono, monospace',
  },
  flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
});
</script>
</body>
</html>`;
}
