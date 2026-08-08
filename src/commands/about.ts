import { join } from 'path';
import { logger } from '../utils/logger';

export async function aboutCommand(): Promise<void> {
  const pkg = require('../../package.json');
  const ver = pkg.version;

  // 产品功能概览
  const features = [
    { icon: '🧠', title: 'Ask 引擎', desc: '自然语言 → 意图识别 → 自动编排执行' },
    { icon: '📋', title: '任务管理', desc: '10+ 任务类型，迭代/计划/拆分' },
    { icon: '🔍', title: '代码审查', desc: '安全审计/依赖分析/性能诊断' },
    { icon: '🔄', title: '文档驱动', desc: 'Word/Excel/CSV → Spec 双向转换' },
    { icon: '⚡', title: '定时调度', desc: '创建 → daemon 懒启动 → 到点自执行' },
    { icon: '🤖', title: 'Skill 体系', desc: 'OpenSpec 标准，AI 自动路由' },
  ];

  // 近期亮点
  const highlights = [
    '意图合成 — AI 自动提取参数、补全上下文、精准提问',
    '自我检查 — 命令验证 + 置信度 + 遗漏检测',
    '定时调度 — daemon 懒启动，跨平台(LaunchAgent/cron/schtasks)',
    '多选执行 — plan --select 列出任务编号供用户选择',
    '双模式 — 自主全自动 / 分步确认，不跳过用户检查',
  ];

  // 重要里程碑版本
  const milestones = [
    { v: '5.50', date: '2026-08', desc: '定时调度 + 跨平台 daemon' },
    { v: '5.27', date: '2026-07', desc: 'Ask 四模式 + Skill 体系' },
    { v: '4.0', date: '2026-05', desc: '多平台 CLI + 文档转换' },
    { v: '1.0', date: '2026-01', desc: 'Spec 驱动开发，Task 管理' },
  ];

  const featuresHtml = features.map(f =>
    `<div class="feat-item">
      <span class="ficon">${f.icon}</span>
      <div><strong>${f.title}</strong><span class="fsub">${f.desc}</span></div>
    </div>`
  ).join('');

  const highlightsHtml = highlights.map(h => `<li>${h}</li>`).join('');

  const milestonesHtml = milestones.map(m =>
    `<div class="mile">
      <span class="mver">v${m.v}</span>
      <span class="mdate">${m.date}</span>
      <span class="mdesc">${m.desc}</span>
    </div>`
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Speccore v${ver}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=JetBrains+Mono:wght@400;600');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'JetBrains Mono',monospace;background:#0b1221;color:#bae6fd;min-height:100vh;padding:28px 20px}
.scanlines{position:fixed;inset:0;pointer-events:none;z-index:999;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,240,255,.006) 2px,rgba(0,240,255,.006) 4px)}
.card{max-width:680px;margin:0 auto;background:rgba(13,31,56,.95);border:1px solid rgba(14,165,233,.12);border-radius:16px;padding:28px 32px;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,#0ea5e9,transparent);animation:scanX 3s linear infinite}
.card::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,#0ea5e9,transparent);animation:scanX-rev 3s linear infinite}
@keyframes scanX{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
@keyframes scanX-rev{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}
@keyframes scanY{0%{transform:translateY(-100%)}100%{transform:translateY(100%)}}
@keyframes scanY-rev{0%{transform:translateY(100%)}100%{transform:translateY(-100%)}}
.vline{position:absolute;top:0;width:1px;bottom:0;pointer-events:none}
.vline.l{left:0;background:linear-gradient(180deg,transparent,#0ea5e9,transparent);animation:scanY-rev 3s linear infinite}
.vline.r{right:0;background:linear-gradient(180deg,transparent,#0ea5e9,transparent);animation:scanY 3s linear infinite}
h1{font-family:'Orbitron',sans-serif;font-size:24px;font-weight:900;background:linear-gradient(135deg,#0ea5e9,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:2px}
h1 span{font-size:13px;opacity:.6}
h2{font-size:12px;color:#38bdf8;margin:20px 0 10px;letter-spacing:1px}
.sub{color:#5b7fa5;font-size:11px;margin:4px 0 20px}
.row{display:flex;gap:14px;flex-wrap:wrap}
.feat-item{display:flex;gap:10px;align-items:center;padding:8px 0;min-width:48%}
.feat-item strong{font-size:12px;color:#7dd3fc;display:block}
.feat-item .fsub{font-size:10px;color:#5b7fa5;margin-top:2px;display:block}
.ficon{font-size:18px;width:24px;text-align:center}
.highlights{list-style:none;padding:0}
.highlights li{font-size:11px;color:#bae6fd;padding:5px 0 5px 16px;position:relative;border-bottom:1px solid rgba(255,255,255,.02)}
.highlights li::before{content:'▸';position:absolute;left:0;color:#0ea5e9;font-size:10px}
.mile{display:flex;gap:12px;align-items:baseline;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.02)}
.mver{font-size:10px;color:#6366f1;background:rgba(99,102,241,.1);padding:2px 6px;border-radius:3px;min-width:40px;text-align:center}
.mdate{font-size:10px;color:#5b7fa5;min-width:52px}
.mdesc{font-size:10px;color:#bae6fd}
.link{display:inline-block;margin:4px 8px 4px 0;padding:4px 12px;background:rgba(14,165,233,.06);border:1px solid rgba(14,165,233,.1);border-radius:6px;color:#38bdf8;font-size:11px;text-decoration:none}
.link:hover{background:rgba(14,165,233,.14);color:#0ea5e9}
.link strong{font-size:12px;color:#38bdf8;margin-right:6px}
.link span{font-size:10px;color:#5b7fa5}
.footer a{color:#38bdf8;text-decoration:none}
</style></head>
<body>
<div class="scanlines"></div>
<div class="card">
<div class="vline l"></div><div class="vline r"></div>
<h1>SPECCORE <span>v${ver}</span></h1>
<div class="sub">Code by Spec, Not by Vibe.</div>

<h2>⚡ 主要功能</h2>
<div class="row">${featuresHtml}</div>

<h2>✨ 近期亮点</h2>
<ul class="highlights">${highlightsHtml}</ul>

<h2>📜 里程碑</h2>
${milestonesHtml}

<h2>📚 文档 & 指南</h2>
<a class="link" href="https://github.com/windfallsheng/SpecCore-ts/blob/main/README.md" target="_blank"><strong>📖 README</strong><span>项目说明 · 安装 · 场景 · 命令体系</span></a>
<a class="link" href="https://github.com/windfallsheng/SpecCore-ts/blob/main/AGENTS.md" target="_blank"><strong>🤖 AGENTS.md</strong><span>AI 路由表 · 12 Skill · 禁止规则</span></a>
<a class="link" href="https://github.com/windfallsheng/SpecCore-ts/tree/main/examples" target="_blank"><strong>📌 场景指南</strong><span>代码审查 · 安全审计 · 多平台开发 · 文档驱动</span></a>
<a class="link" href="https://github.com/windfallsheng/SpecCore-ts/blob/main/CHANGELOG.md" target="_blank"><strong>📝 CHANGELOG</strong><span>版本历史</span></a>
<a class="link" href="https://www.npmjs.com/package/speccore" target="_blank"><strong>📦 npm 包</strong><span>安装 · 版本</span></a>
<a class="link" href="https://www.npmjs.com/package/speccore" target="_blank">npm 包</a>

<div class="footer">
  <a href="https://github.com/windfallsheng/SpecCore-ts" target="_blank">GitHub</a> · 
  <a href="https://gitee.com/windfullsheng/spec-core-ts" target="_blank">Gitee</a> · 
  <a href="https://www.npmjs.com/package/speccore" target="_blank">npm</a> · 
  <code>speccore ask "…"</code> 开始使用
</div>
</div>
</body>
</html>`;

  const { writeFile } = require('fs-extra');
  const outPath = join(process.cwd(), 'speccore-about.html');
  await writeFile(outPath, html);

  logger.success(`📖 ${outPath}`);
  logger.info(`   Speccore v${ver} · ${process.platform} · Node ${process.version}`);
  process.stdout.write(`[SPECCORE_ABOUT: ${outPath}]\n`);
}
