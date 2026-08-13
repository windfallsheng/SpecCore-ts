/**
 * welcome — SpecCore 项目名片 + 使用引导
 * 终端模式：Unicode 框线；AI 模式（HTML）：彩色卡片架构图
 */

import { logger } from '../utils/logger';
import { isAiContext, detectHostAi } from '../core/ask-host-ai';
import { join } from 'path';
import { pathExists, readdir, writeFile, ensureDir } from 'fs-extra';
import { getDefaultIteration } from '../core/context';

const C = { r: '\x1b[0m', b: '\x1b[1m', d: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', magenta: '\x1b[35m', gray: '\x1b[90m', blue: '\x1b[34m' };
const B = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', dot: '◆', arrow: '→' };

function box(title: string, body: string[], w = 60): string {
  const top = `${C.cyan}${B.tl}${B.h.repeat(2)} ${C.b}${title}${C.r} ${B.h.repeat(Math.max(0, w - 5 - title.length))}${B.tr}${C.r}`;
  const mid = body.map(l => `${C.cyan}${B.v}${C.r} ${l}`).join('\n');
  const bot = `${C.cyan}${B.bl}${B.h.repeat(w - 2)}${B.br}${C.r}`;
  return [top, mid, bot].join('\n');
}

export interface WelcomeOptions { force?: boolean; web?: boolean; output?: string; }

export async function welcomeCommand(_options: WelcomeOptions): Promise<void> {
  const version = require('../../package.json').version;
  const isInit = await pathExists(join(process.cwd(), '.speccore'));
  const iteration = await getDefaultIteration('');
  const iterName = (!iteration || iteration.includes('---') || iteration.length < 2) ? '' : iteration;

  if (isAiContext() || !process.stdout.isTTY || _options.web) {
    let taskCount = 0;
    if (iterName) { try { const entries = await readdir(`Iteration-${iterName}`, { withFileTypes: true }); taskCount = entries.filter(e => e.isDirectory() && e.name.startsWith('Task-')).length; } catch {} }
    let phase = 'doc';
    if (iterName) {
      const reqDoc = join(`Iteration-${iterName}`, '020-specs', 'REQUIREMENT.md');
      if (!(await pathExists(reqDoc))) phase = 'doc';
      else if (!(await pathExists(join(`Iteration-${iterName}`, '020-specs', 'ANALYSIS.md')))) phase = 'analyze';
      else if (taskCount === 0) phase = 'split';
      else phase = 'execute';
    }
    const html = renderWelcomeHtml(version, isInit, iterName, phase, taskCount);
    const outPath = _options.output || join(process.cwd(), 'outputs', 'welcome-SpecCore.html');
    await ensureDir(join(process.cwd(), 'outputs'));
    await writeFile(outPath, html);
    process.stdout.write(`✅ 页面已生成: file://${outPath}\n`);
    process.stdout.write(`[SPECCORE_WELCOME: ${outPath}]\n`);
    return;
  }

  logger.info('');
  logger.info(`${C.cyan}╔══════════════════════════════════════════════════════════╗${C.r}`);
  logger.info(`${C.cyan}║${C.r}  ${C.b}${C.cyan}SpecCore${C.r} ${C.gray}· Code by Spec, Not by Vibe${C.r}  ${C.gray}v${version}${C.r}${' '.repeat(23 - version.length)}${C.cyan}║${C.r}`);
  logger.info(`${C.cyan}╚══════════════════════════════════════════════════════════╝${C.r}`);
  logger.info('');

  if (!isInit) {
    logger.info(box('📦 项目状态', ['', `${C.gray}尚未初始化${C.r}`, '', `${C.cyan}◆ 快速开始:${C.r}  speccore init`]));
    logger.info('');
    showAskGuide();
    process.stdout.write(`[SPECCORE_WELCOME: ${join(process.cwd(), 'outputs', 'welcome-SpecCore.html')}]\n`);
    return;
  }
  if (!iterName) {
    logger.info(box('📦 项目状态', [`${C.gray}无活跃迭代${C.r}`, `${C.b}speccore iteration create -n Q1${C.r}`]));
    logger.info('');
    showAskGuide();
    process.stdout.write(`[SPECCORE_WELCOME: ${join(process.cwd(), 'outputs', 'welcome-SpecCore.html')}]\n`);
    return;
  }
  let taskCount = 0;
  try { const entries = await readdir(`Iteration-${iterName}`, { withFileTypes: true }); taskCount = entries.filter(e => e.isDirectory() && e.name.startsWith('Task-')).length; } catch {}
  logger.info(box(`📦 项目状态 · ${iterName}`, [`${C.gray}任务数: ${taskCount}${C.r}`, `${C.b}speccore dev --auto${C.r}`]));
  logger.info('');
  showAskGuide();
  // 始终输出标记，确保 AI 宿主弹出页面
  const outPath = join(process.cwd(), 'outputs', 'welcome-SpecCore.html');
  process.stdout.write(`[SPECCORE_WELCOME: ${outPath}]\n`);
}

function showAskGuide(): void {
  logger.info(box('🧠 AI 万能入口 · speccore ask', [
    '',
    `${C.green}📖${C.r} ${C.b}命令解释${C.r}  "dashboard 怎么用"`,
    `${C.yellow}🗺️${C.r} ${C.b}任务指引${C.r}  "我想做一个登录功能"`,
    `${C.green}🎯${C.r} ${C.b}意图匹配${C.r}  "查看进度"`,
    `${C.magenta}⚡${C.r} ${C.b}复杂编排${C.r}  "计划任务晚8点分批"`,
  ]));
}

/**
 * HTML 项目名片 — 复刻 ask 架构图风格（彩色卡片 + 中央 ask 节点 + 4 模式分支）
 */
export function renderWelcomeHtml(
  version: string, isInit: boolean, iterName: string,
  phase: string, taskCount: number
): string {
  const phaseLabel = phase === 'doc' ? '📝 需要导入需求文档' : phase === 'analyze' ? '🧠 需要 AI 分析' : phase === 'split' ? '📦 需要拆分任务' : `⚡ 执行中 (${taskCount} 任务)`;
  const now = new Date().toISOString().split('T')[0];
  const phases = ['导入','分析','拆分','计划','执行','交付'];
  const doneIdx = ['doc','analyze','split','execute'].indexOf(phase) + (phase==='execute'?1:0);

  return `<!DOCTYPE html><html lang="zh-CN" data-theme="ocean"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>SpecCore — 项目名片</title><style>@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=JetBrains+Mono:wght@400;600;700&display=swap');[data-theme="ocean"]{--cyan:#0ea5e9;--bg:#0b1929;--card:rgba(13,31,56,.95);--border:rgba(14,165,233,.15);--text:#bae6fd;--muted:#5b7fa5;--green:#14b8a6;--orange:#f97316;--purple:#6366f1}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'JetBrains Mono',monospace;background:var(--bg);color:var(--text);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 20px}.scanlines{position:fixed;inset:0;pointer-events:none;z-index:99;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,240,255,.015) 2px,rgba(0,240,255,.015) 4px)}.stars{position:fixed;inset:0;pointer-events:none;background:radial-gradient(1px 1px at 20% 30%,rgba(255,255,255,.3),transparent),radial-gradient(1.5px 1.5px at 60% 70%,rgba(14,165,233,.4),transparent)}.card{max-width:800px;width:100%;margin:0 auto;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:24px;position:relative;overflow:hidden;z-index:1}.card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX 3s linear infinite}.card::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX-rev 3s linear infinite}@keyframes scanX{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}@keyframes scanX-rev{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}@keyframes scanY{0%{transform:translateY(-100%)}100%{transform:translateY(100%)}}@keyframes scanY-rev{0%{transform:translateY(100%)}100%{transform:translateY(-100%)}}.vline{position:absolute;top:0;width:1px;bottom:0;pointer-events:none}.vline.l{left:0;background:linear-gradient(180deg,transparent,var(--cyan),transparent);animation:scanY-rev 3s linear infinite}.vline.r{right:0;background:linear-gradient(180deg,transparent,var(--cyan),transparent);animation:scanY 3s linear infinite}.center-node{width:90px;height:90px;border-radius:50%;border:2px solid var(--cyan);display:flex;align-items:center;justify-content:center;background:rgba(14,165,233,.08);margin:24px auto;font-family:Orbitron,sans-serif;font-size:20px;font-weight:900;background:linear-gradient(135deg,var(--cyan),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;position:relative;z-index:2}.modes-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:20px 0}.mode-card{border-radius:10px;padding:14px;position:relative;overflow:hidden;background:rgba(255,255,255,.02)}.mode-card.m1{border:1.5px solid var(--green)}.mode-card.m2{border:1.5px solid var(--orange)}.mode-card.m3{border:1.5px solid var(--cyan)}.mode-card.m4{border:1.5px solid var(--purple)}.mode-card .mode-title{font-weight:600;margin:6px 0;font-size:13px}.mode-card.m1 .mode-title{color:var(--green)}.mode-card.m2 .mode-title{color:var(--orange)}.mode-card.m3 .mode-title{color:var(--cyan)}.mode-card.m4 .mode-title{color:var(--purple)}.mode-card .mode-icon{font-size:18px;margin-right:4px}.mode-card .mode-desc{font-size:10px;color:var(--muted);margin:4px 0}.mode-card .mode-tag{display:inline-block;padding:2px 8px;font-size:9px;border-radius:4px;background:rgba(20,184,166,.1);color:var(--green);margin-top:6px}.mode-card.m1 .mode-tag{background:rgba(20,184,166,.08);color:var(--green)}.mode-card.m2 .mode-tag{background:rgba(249,115,22,.08);color:var(--orange)}.mode-card.m3 .mode-tag{background:rgba(14,165,233,.08);color:var(--cyan)}.mode-card.m4 .mode-tag{background:rgba(99,102,241,.08);color:var(--purple)}.status-row{display:flex;align-items:center;gap:8px;margin:8px 0;padding:10px 14px;background:rgba(14,165,233,.04);border:1px solid rgba(14,165,233,.1);border-radius:8px}.flow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-start}.flow-step{display:flex;flex-direction:row;align-items:center;gap:12px;padding:10px 28px;border-radius:10px;border:none}.flow-step.done{background:rgba(20,184,166,.1)}.flow-step.pending{background:rgba(255,255,255,.04)}.flow-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;border:none}.flow-dot.done{background:var(--green);box-shadow:0 0 8px var(--green)}.flow-dot.pending{background:rgba(255,255,255,.15)}.flow-label{font-size:11px;color:var(--muted);white-space:nowrap}.flow-label.done{color:var(--green)}.flow-arrow{color:var(--muted);font-size:12px;text-align:center;line-height:1}.cmd-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.cmd-pill{padding:3px 10px;border-radius:4px;font-size:10px;background:rgba(14,165,233,.1);color:var(--cyan);border:1px solid rgba(14,165,233,.15)}.footer{text-align:center;color:var(--muted);font-size:10px;margin-top:24px;padding-top:16px;border-top:1px solid rgba(255,255,255,.04)}h1{font-family:'Orbitron',sans-serif;font-size:32px;font-weight:900;background:linear-gradient(135deg,var(--cyan),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:2px;text-align:center}.sub{color:var(--muted);font-size:11px;letter-spacing:1px;text-align:center;margin-top:4px}.section-title{font-size:10px;font-weight:700;color:var(--cyan);text-transform:uppercase;letter-spacing:2px;margin:20px 0 10px}.confirm-bar{text-align:center;padding:18px;margin:24px 0 8px;background:linear-gradient(135deg,var(--cyan) 0%,#0284c7 100%);border-radius:40px;color:#fff;font-weight:600;font-size:14px;box-shadow:0 0 30px rgba(14,165,233,.3);cursor:pointer;letter-spacing:1px;text-decoration:none;display:block}.confirm-bar:hover{box-shadow:0 0 45px rgba(14,165,233,.5);transform:translateY(-1px)}.action-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:20px 0}.action-card{padding:14px;border-radius:10px;border:1px solid var(--border);background:rgba(13,31,56,.7);text-align:center;cursor:pointer;text-decoration:none;transition:all .3s;position:relative;z-index:1}.action-card.primary{background:linear-gradient(135deg,var(--cyan) 0%,#0284c7 100%);border-color:var(--cyan);color:#fff}.action-card.secondary{border-color:rgba(14,165,233,.2);color:var(--text)}.action-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(14,165,233,.2)}.action-icon{font-size:24px;margin-bottom:6px}.action-title{font-size:12px;font-weight:700;margin-bottom:4px}.action-desc{font-size:9px;color:var(--muted);line-height:1.3}.action-card.primary .action-desc{color:rgba(255,255,255,.8)}.section{margin:14px 0;padding:14px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.04);border-radius:10px}.grid-pattern{position:fixed;inset:0;pointer-events:none;z-index:0;background-image:linear-gradient(rgba(14,165,233,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(14,165,233,.03) 1px,transparent 1px);background-size:60px 60px}@keyframes cardGlow{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.6)}}.card-bg{position:absolute;inset:0;pointer-events:none;z-index:0;background:radial-gradient(ellipse at 50% 10%,rgba(14,165,233,.25) 0%,transparent 70%);animation:cardGlow 3s ease-in-out infinite;transform-origin:top center}@keyframes titleGlow{0%,100%{filter:drop-shadow(0 0 20px rgba(14,165,233,.4)) drop-shadow(0 0 60px rgba(14,165,233,.15))}50%{filter:drop-shadow(0 0 30px rgba(14,165,233,.7)) drop-shadow(0 0 80px rgba(14,165,233,.3))}h1,h2{animation:titleGlow 3s ease-in-out infinite}</style></head><body><div class="scanlines"></div><div class="grid-pattern"></div><div class="stars"></div><div class="card"><div class="card-bg"></div><div class="vline l"></div><div class="vline r"></div><h1>SPECCORE</h1><div class="sub">Code by Spec, Not by Vibe · v${version}${iterName?' · '+iterName:''}</div><div class="status-row"><span>📍</span><div><div style="font-size:11px;font-weight:600">${phaseLabel}</div><div style="font-size:9px;color:var(--muted)">${isInit?(iterName?'当前迭代: '+iterName+(taskCount>0?' · '+taskCount+' 任务':''):'已初始化 · 无活跃迭代'):'未初始化'}</div></div></div><div class="section-title">🔄 核心流水线</div><div class="section"><div class="flow">${phases.map((n,i)=>'<div class="flow-step '+(i<doneIdx?'done':'pending')+'"><span class="flow-dot '+(i<doneIdx?'done':'pending')+'"></span><span class="flow-label '+(i<doneIdx?'done':'')+'">'+n+'</span></div>'+(i<5?'<div class="flow-arrow">→</div>':'')).join('')}</div></div><div class="section-title">🧠 ask — SpecCore 万能 AI 入口</div><div class="modes-grid"><div class="mode-card m1"><div class="mode-title"><span class="mode-icon">📖</span>命令解释</div><div class="mode-desc">"dashboard 怎么用"<br>"init 有哪些参数"</div><div class="mode-tag">知识库匹配</div></div><div class="mode-card m2"><div class="mode-title"><span class="mode-icon">🗺️</span>任务指引</div><div class="mode-desc">"我想做一个登录功能"<br>"怎么开始新项目"</div><div class="mode-tag">工作流生成</div></div><div class="mode-card m3"><div class="mode-title"><span class="mode-icon">🎯</span>意图匹配</div><div class="mode-desc">"查看进度" → dashboard<br>"审查代码" → validate</div><div class="mode-tag">38意图 + AI</div></div><div class="mode-card m4"><div class="mode-title"><span class="mode-icon">⚡</span>复杂编排</div><div class="mode-desc">"计划所有任务晚8点分批"<br>"做完分析→拆分→PR"</div><div class="mode-tag">Pipeline 引擎</div></div></div><div class="confirm-bar" onclick="window.location.href='speccore-ask-onboarding.html'">确认进入 · 输入 <code style="background:rgba(255,255,255,.2);padding:2px 8px;border-radius:4px">speccore ask "你的需求"</code> 开始</div><div class="section-title">━━ 常用命令 ━━</div><div class="cmd-row"><span class="cmd-pill">speccore dashboard</span><span class="cmd-pill">speccore dev --auto</span><span class="cmd-pill">speccore ask "描述"</span><span class="cmd-pill">speccore help</span></div>${isInit?`<div class="section-title">⚡ 快速操作</div><div class="action-grid"><a class="action-card primary" href="#" onclick="alert('请在终端执行：\\nspeccore iteration create -n xxx --topic \\"xxx\\"')"><div class="action-icon">🚀</div><div class="action-title">创建第一个迭代</div><div class="action-desc">开始你的开发周期</div></a><a class="action-card secondary" href="speccore-prompts.html"><div class="action-icon">📚</div><div class="action-title">查看提示词库</div><div class="action-desc">浏览常用模板</div></a><a class="action-card secondary" href="speccore-setup-guide.html"><div class="action-icon">📋</div><div class="action-title">完整配置指南</div><div class="action-desc">6步详细教程</div></a></div>`:''}<div class="footer">由 SpecCore 驱动 v${version} · ${now}</div></div></body></html>`;
}
