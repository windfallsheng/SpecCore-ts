import { join } from 'path';
import { logger } from '../utils/logger';

export async function aboutCommand(): Promise<void> {
  const pkg = require('../../package.json');
  const ver = pkg.version;

  // 版本信息 + 近期功能
  const highlights = [
    { v: '5.63.x', feat: '🧠 synthesizeIntent 智能意图合成 — AI 参数提取+自动补全+精准提问' },
    { v: '5.62.x', feat: '✅ understandIntent 自我检查层 — 命令验证+置信度+遗漏检查' },
    { v: '5.61.x', feat: '🤖 "自主"=确认后全自动 — 复杂任务绝不跳过确认' },
    { v: '5.58.x', feat: '📋 plan --select 多选模式 + 具体命令章节' },
    { v: '5.56.x', feat: '⏰ daemon 懒启动 — 有调度才运行，无调度自停' },
    { v: '5.54.x', feat: '🔄 schedule retry 重调度 + init 时自动安装 daemon' },
    { v: '5.28.x', feat: '⚡ Ask 引擎四模式 — pipeline/guide/match 全部 autoExec' },
    { v: '5.27.x', feat: '🏗️ OpenSpec Skill 体系 — 12 Skill + references + 禁止规则' },
  ];

  const docs = [
    { name: 'AGENTS.md', desc: 'AI 助手配置与 Skill 路由表', path: 'AGENTS.md' },
    { name: 'README.md', desc: 'Speccore 完整文档（中文）', path: 'README.md' },
    { name: 'CHANGELOG.md', desc: '版本历史', path: 'CHANGELOG.md' },
  ];

  const links = [
    { name: 'GitHub', url: pkg.repository?.url || 'https://github.com/windfallsheng/SpecCore-ts' },
    { name: 'Gitee', url: 'https://gitee.com/windfullsheng/spec-core-ts' },
    { name: 'npm', url: `https://www.npmjs.com/package/${pkg.name}` },
  ];

  const highlightsHtml = highlights.map(h =>
    `<div class="feat"><span class="ver">${h.v}</span><span class="desc">${h.feat}</span></div>`
  ).join('');

  const docsHtml = docs.map(d =>
    `<a class="link-card" href="${d.path}" target="_blank"><strong>${d.name}</strong><span>${d.desc}</span></a>`
  ).join('');

  const linksHtml = links.map(l =>
    `<a class="link-card external" href="${l.url}" target="_blank"><strong>🔗 ${l.name}</strong></a>`
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Speccore v${ver} — About</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=JetBrains+Mono:wght@400;600;700');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'JetBrains Mono',monospace;background:#0b1221;color:#bae6fd;min-height:100vh;padding:32px 20px}
.scanlines{position:fixed;inset:0;pointer-events:none;z-index:999;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,240,255,.008) 2px,rgba(0,240,255,.008) 4px)}
.card{max-width:720px;margin:0 auto;background:rgba(13,31,56,.95);border:1px solid rgba(14,165,233,.15);border-radius:16px;padding:32px;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,#0ea5e9,transparent);animation:scanX 3s linear infinite}
@keyframes scanX{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
h1{font-family:'Orbitron',sans-serif;font-size:28px;font-weight:900;background:linear-gradient(135deg,#0ea5e9,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:3px}
.sub{color:#5b7fa5;font-size:12px;margin:8px 0 24px}
.section{margin:24px 0}
.section h2{font-size:14px;color:#0ea5e9;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(14,165,233,.1);letter-spacing:1px}
.feat{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.03);align-items:baseline}
.feat .ver{font-size:11px;color:#6366f1;background:rgba(99,102,241,.1);padding:2px 8px;border-radius:4px;white-space:nowrap;min-width: 60px;text-align:center}
.feat .desc{font-size:12px;color:#bae6fd;line-height:1.6}
.links{display:flex;gap:12px;flex-wrap:wrap}
.link-card{display:block;padding:12px 16px;background:rgba(14,165,233,.05);border:1px solid rgba(14,165,233,.1);border-radius:8px;text-decoration:none;color:#7dd3fc;font-size:12px;transition:all .2s}
.link-card:hover{background:rgba(14,165,233,.12);border-color:rgba(14,165,233,.3);color:#0ea5e9}
.link-card strong{display:block;margin-bottom:4px;color:#38bdf8}
.link-card span{color:#5b7fa5;font-size:11px}
.link-card.external strong{color:#14b8a6}
.footer{text-align:center;color:#5b7fa5;font-size:10px;margin-top:32px;padding-top:16px;border-top:1px solid rgba(255,255,255,.04)}
.footer code{background:rgba(14,165,233,.15);color:#0ea5e9;padding:2px 8px;border-radius:4px}
</style></head>
<body>
<div class="scanlines"></div>
<div class="card">
<h1>SPECCORE</h1>
<div class="sub">v${ver} — Code by Spec, Not by Vibe.</div>

<div class="section">
<h2>🔭 近期亮点</h2>
${highlightsHtml}
</div>

<div class="section">
<h2>📚 文档</h2>
<div class="links">${docsHtml}</div>
</div>

<div class="section">
<h2>🔗 链接</h2>
<div class="links">${linksHtml}</div>
</div>

<div class="footer">
  <code>speccore ask "..."</code> 任意自然语言 → AI 自动匹配最佳模式<br>
  <code>speccore about</code> 随时查看版本信息
</div>
</div>
</body>
</html>`;

  const { writeFile, ensureDir } = require('fs-extra');
  const outPath = join(process.cwd(), 'speccore-about.html');
  await writeFile(outPath, html);

  logger.success(`📖 版本信息: ${outPath}`);
  logger.info(`   Speccore v${ver} — ${pkg.description}`);
  logger.info('');
  logger.info(`   通道:       ask | qoder | cli | init`);
  logger.info(`   版本:       ${ver}`);
  logger.info(`   引擎:       Node.js ${process.version}`);
  logger.info(`   平台:       ${process.platform}`);
  logger.info('');

  // 输出标记供宿主 AI 展示
  process.stdout.write(`[SPECCORE_ABOUT: ${outPath}]\n`);
}
