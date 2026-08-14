import { join } from 'path';
import { logger } from '../utils/logger';

export async function aboutCommand(): Promise<void> {
  const pkg = require('../../package.json');
  const ver = pkg.version;

  // 产品功能概览
  const features = [
    { icon: '🧠', title: 'Ask 引擎', desc: '自然语言 → 意图识别 → 自动编排执行' },
    { icon: '📋', title: '任务管理', desc: '10+ 任务类型，迭代/计划/拆分' },
    { icon: '🔍', title: '统一检索层', desc: '文档 RAG + 代码切片 + 知识图谱三源合一' },
    { icon: '🔄', title: '文档驱动', desc: 'Word/Excel/CSV → Spec 双向转换' },
    { icon: '📚', title: '全局知识沉淀', desc: 'sync-global 自动聚合 specs 到全局索引' },
    { icon: '🤖', title: 'Skill 体系', desc: 'OpenSpec 标准，AI 自动路由' },
  ];

  // 近期亮点
  const highlights = [
    '统一检索层 — 文档 RAG + 代码切片 + 知识图谱，一次查询三源合并',
    'RAG 轻量级检索 — 按标题分块 + 结构化摘要 + 关键词标签，无向量数据库',
    '全局知识沉淀 — sync-global 后自动聚合 specs，生成 GLOBAL/SUMMARY.md',
    '代码索引智能增强 — 知识图谱关联 + @spec 注释 + Git 联动 + 语义扩展',
    'Prompt 性能优化 — 统一读取 + 进程缓存 + 动态裁剪 + ExtraSpecs 大小限制',
    '增量刷新 — mtime 检测 + 只重建变更文件 + 新增文件扫描',
    '意图合成 — AI 自动提取参数、补全上下文、精准提问',
    '自我检查 — 命令验证 + 置信度 + 遗漏检测',
    '多选执行 — plan --select 列出任务编号供用户选择',
    '双模式 — 自主全自动 / 分步确认，不跳过用户检查',
  ];

  // 重要里程碑版本
  const milestones = [
    { v: '6.8', date: '2026-08', desc: '统一检索层 + RAG 检索 + 全局知识沉淀' },
    { v: '6.5', date: '2026-08', desc: '知识图谱 + 衰减检测 + AI 关联链注入' },
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
body{font-family:'JetBrains Mono',monospace;background:#0b1221;color:#bae6fd;padding:28px 20px}
.scanlines{position:fixed;inset:0;pointer-events:none;z-index:999;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,240,255,.006) 2px,rgba(0,240,255,.006) 4px)}
.card{max-width:800px;width:100%;margin:0 auto;background:rgba(13,31,56,.95);border:1px solid rgba(14,165,233,.12);border-radius:16px;padding:24px;position:relative;overflow:hidden;z-index:1}
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
.grid-pattern{position:fixed;inset:0;pointer-events:none;z-index:0;background-image:linear-gradient(rgba(14,165,233,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(14,165,233,.03) 1px,transparent 1px);background-size:60px 60px}
@keyframes cardGlow{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.6)}}
.card-bg{position:absolute;inset:0;pointer-events:none;z-index:0;background:radial-gradient(ellipse at 50% 10%,rgba(14,165,233,.25) 0%,transparent 70%);animation:cardGlow 3s ease-in-out infinite;transform-origin:top center}
@keyframes titleGlow{0%,100%{filter:drop-shadow(0 0 20px rgba(14,165,233,.4)) drop-shadow(0 0 60px rgba(14,165,233,.15))}50%{filter:drop-shadow(0 0 30px rgba(14,165,233,.7)) drop-shadow(0 0 80px rgba(14,165,233,.3))}
h1,h2{animation:titleGlow 3s ease-in-out infinite}
</style></head>
<body>
<div class="scanlines"></div>
<div class="grid-pattern"></div>
<div class="card">
<div class="card-bg"></div>
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
<a class="link" href="https://github.com/windfallsheng/SpecCore-ts/blob/main/README.md" target="_blank"><strong>📖 README</strong><span>项目说明 · 安装 · 核心概念 · 工作流</span></a>
<a class="link" href="https://github.com/windfallsheng/SpecCore-ts/blob/main/docs/总览.md" target="_blank"><strong>🔭 总览</strong><span>核心概念 · 工作流 · 三种使用方式</span></a>
<a class="link" href="https://github.com/windfallsheng/SpecCore-ts/blob/main/docs/命令参考.md" target="_blank"><strong>📋 命令参考</strong><span>全部 23 命令 · 子命令 · 示例</span></a>
<a class="link" href="https://github.com/windfallsheng/SpecCore-ts/blob/main/docs/场景实战.md" target="_blank"><strong>🎯 场景实战</strong><span>35 个真实开发场景</span></a>
<a class="link" href="https://github.com/windfallsheng/SpecCore-ts/blob/main/docs/SDD方法论.md" target="_blank"><strong>💡 SDD 方法论</strong><span>规范驱动开发理念</span></a>
<a class="link" href="https://github.com/windfallsheng/SpecCore-ts/blob/main/docs/工作空间组织.md" target="_blank"><strong>📁 工作空间</strong><span>目录结构与文件规范</span></a>
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

  const { writeFile, ensureDir } = require('fs-extra');
  const outPath = join(process.cwd(), 'outputs', 'speccore-about.html');
  await ensureDir(join(process.cwd(), 'outputs'));
  await writeFile(outPath, html);

  logger.success(`📖 ${outPath}`);
  logger.info(`   📄 file://${outPath}`);
  logger.info(`   Speccore v${ver} · ${process.platform} · Node ${process.version}`);
  process.stdout.write(`[SPECCORE_ABOUT: ${outPath}]\n`);
}
