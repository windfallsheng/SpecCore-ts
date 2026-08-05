/**
 * welcome — SpecCore 项目名片 + 使用引导
 * 首次接触即了解：我是谁、能做什么、怎么开始
 */

import { logger } from '../utils/logger';
import { join } from 'path';
import { pathExists, readdir, writeFile } from 'fs-extra';
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

  // 非 TTY（AI 调用）→ 直接输出 HTML
  if (!process.stdout.isTTY) {
    const iteration = await getDefaultIteration('');
    const iterName = (!iteration || iteration.includes('---') || iteration.length < 2) ? '' : iteration;
    const html = renderWelcomeHtml(version, true, iterName, 'doc', 0);
    const outPath = _options.output || join(process.cwd(), 'speccore-welcome.html');
    await writeFile(outPath, html);
    logger.info(`✅ 已生成: ${outPath}`);
    return;
  }

  // ══════════ 名片头部 ══════════
  logger.info('');
  logger.info(`${C.cyan}╔══════════════════════════════════════════════════════════╗${C.r}`);
  logger.info(`${C.cyan}║${C.r}  ${C.b}${C.cyan}SpecCore${C.r} ${C.gray}· Code by Spec, Not by Vibe${C.r}  ${C.gray}v${version}${C.r}${' '.repeat(23 - version.length)}${C.cyan}║${C.r}`);
  logger.info(`${C.cyan}╚══════════════════════════════════════════════════════════╝${C.r}`);
  logger.info('');

  // ══════════ 项目状态 ══════════
  const isInit = await pathExists(join(process.cwd(), '.speccore'));

  if (!isInit) {
    logger.info(box('📦 项目状态', [
      '',
      `${C.gray}  尚未初始化 SpecCore 项目${C.r}`,
      '',
      `${C.cyan}  ${B.dot} 快速开始:${C.r}`,
      `  ${C.b}speccore init${C.r}${C.gray}          → 初始化项目${C.r}`,
      `  ${C.b}speccore init --interactive${C.r}${C.gray} → 引导式初始化${C.r}`,
    ]));
    logger.info('');
    showAskGuide();
    return;
  }

  const iteration = await getDefaultIteration('');
  const iterName = (!iteration || iteration.includes('---') || iteration.length < 2) ? '' : iteration;

  if (!iterName) {
    logger.info(box('📦 项目状态: 已初始化', [
      '',
      `${C.gray}  当前没有活跃期次${C.r}`,
      '',
      `${C.cyan}  ${B.dot} 下一步:${C.r}`,
      `  ${C.b}speccore iteration create -n Q1${C.r}${C.gray} → 创建第一个期次${C.r}`,
    ]));
    logger.info('');
    showAskGuide();
    return;
  }

  let taskCount = 0;
  try {
    const entries = await readdir(`期次-${iterName}`, { withFileTypes: true });
    taskCount = entries.filter(e => e.isDirectory() && e.name.startsWith('Task-')).length;
  } catch {}

  const reqDoc = join(`期次-${iterName}`, '00-需求文档', 'REQUIREMENT.md');
  const analysis = join(`期次-${iterName}`, '00-需求文档', 'ANALYSIS.md');

  // 判定当前阶段
  let phase = 'idle';
  let nextHint = '';
  let phaseLabel = '';

  if (!(await pathExists(reqDoc))) {
    phase = 'doc'; phaseLabel = '📝 需要导入需求文档';
    nextHint = `speccore doc2spec -f PRD.docx --iteration=${iterName}`;
  } else if (!(await pathExists(analysis))) {
    phase = 'analyze'; phaseLabel = '🧠 需要 AI 分析需求';
    nextHint = `speccore analyze -I ${iterName}`;
  } else if (taskCount === 0) {
    phase = 'split'; phaseLabel = '📦 需要拆分任务';
    nextHint = `speccore iteration split -I ${iterName}`;
  } else {
    phase = 'execute'; phaseLabel = `⚡ 准备执行 (${taskCount} 个任务)`;
    nextHint = `speccore plan --all`;
  }

  logger.info(box(`📦 项目状态 · ${iterName}`, [
    '',
    `  ${phaseLabel}`,
    `  ${C.gray}${taskCount > 0 ? `任务数: ${taskCount}` : '暂无任务'}${C.r}`,
    '',
    `${C.cyan}  ${B.dot} 推荐下一步:${C.r}`,
    `  ${C.b}${nextHint}${C.r}`,
  ]));
  logger.info('');

  // ══════════ 流水线可视化 ══════════
  const phases = [
    { name: '导入', cmd: 'doc2spec', done: phase !== 'doc' },
    { name: '分析', cmd: 'analyze', done: phase !== 'doc' && phase !== 'analyze' },
    { name: '拆分', cmd: 'split', done: phase !== 'doc' && phase !== 'analyze' && phase !== 'split' },
    { name: '计划', cmd: 'plan', done: phase === 'execute' },
    { name: '执行', cmd: 'execute', done: false },
    { name: '交付', cmd: 'done', done: false },
  ];

  const flow = phases.map(p => {
    const color = p.done ? C.green : C.gray;
    const icon = p.done ? '●' : '○';
    return `${color}${icon} ${p.name}${C.r}`;
  }).join(` ${C.gray}${B.arrow}${C.r} `);

  logger.info(box('🔄 核心流水线', [
    '',
    `  ${flow}`,
    '',
    `  ${C.gray}全程可 AI 辅助: 在任何步骤使用 ${C.cyan}speccore ask "描述"${C.gray}${C.r}`,
  ]));
  logger.info('');

  // ══════════ ask 万能入口介绍 ══════════
  showAskGuide();
}

function showAskGuide(): void {
  logger.info(box('🧠 AI 万能入口 · speccore ask', [
    '',
    `  ${C.b}speccore ask "自然语言"${C.r}${C.gray} → AI 自动识别你的意图${C.r}`,
    '',
    `  ${C.green}📖${C.r} ${C.b}命令解释${C.r}${C.gray}  "dashboard 怎么用" → 显示完整用法${C.r}`,
    `  ${C.yellow}🗺️${C.r} ${C.b}任务指引${C.r}${C.gray}  "我想做一个登录功能" → 8 步全流程${C.r}`,
    `  ${C.green}🎯${C.r} ${C.b}意图匹配${C.r}${C.gray}  "查看进度" → 自动匹配 dashboard${C.r}`,
    `  ${C.magenta}⚡${C.r} ${C.b}复杂编排${C.r}${C.gray}  "计划任务，晚8点分批执行" → plan→schedule→execute${C.r}`,
    '',
    `  ${C.gray}── 常用命令 ──${C.r}`,
    `  ${C.cyan}${B.dot}${C.r} speccore ${C.b}dashboard${C.r}${C.gray}           → 项目看板${C.r}`,
    `  ${C.cyan}${B.dot}${C.r} speccore ${C.b}dev --auto${C.r}${C.gray}          → 智能级联${C.r}`,
    `  ${C.cyan}${B.dot}${C.r} speccore ${C.b}help${C.r}${C.gray}               → 19 个命令${C.r}`,
  ]));
  logger.info('');
}

/**
 * 生成 HTML 项目名片 Web 页面
 */
export function renderWelcomeHtml(
  version: string, isInit: boolean, iterName: string,
  phase: string, taskCount: number
): string {
  const phaseLabel = phase === 'doc' ? '📝 导入需求文档' : phase === 'analyze' ? '🧠 AI 分析需求' : phase === 'split' ? '📦 拆分任务' : `⚡ 执行中 (${taskCount} 任务)`;
  const now = new Date().toISOString().split('T')[0];
  const phases = ['导入','分析','拆分','计划','执行','交付'];
  const doneIdx = ['doc','analyze','split','execute'].indexOf(phase) + (phase==='execute'?1:0);

  return `<!DOCTYPE html><html lang="zh-CN" data-theme="ocean"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>SpecCore — 项目名片</title><style>@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=JetBrains+Mono:wght@400;600;700&display=swap');[data-theme="ocean"]{--cyan:#0ea5e9;--bg:#0b1929;--card:rgba(13,31,56,.95);--border:rgba(14,165,233,.15);--text:#bae6fd;--muted:#5b7fa5;--green:#14b8a6;--orange:#f97316;--purple:#6366f1}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'JetBrains Mono',monospace;background:var(--bg);color:var(--text);display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}.scanlines{position:fixed;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,240,255,.015) 2px,rgba(0,240,255,.015) 4px);pointer-events:none;z-index:99}.card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:40px;max-width:640px;width:100%;position:relative;overflow:hidden;z-index:1}.card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX 3s linear infinite}.card::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX-rev 3s linear infinite}@keyframes scanX{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}@keyframes scanX-rev{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}h1{font-family:'Orbitron',sans-serif;font-size:28px;font-weight:900;background:linear-gradient(135deg,var(--cyan),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:2px}.sub{color:var(--muted);font-size:12px;margin:8px 0 24px;letter-spacing:1px}.section{margin:20px 0;padding:16px;background:rgba(14,165,233,.03);border:1px solid rgba(14,165,233,.08);border-radius:10px}.section-title{font-size:11px;font-weight:700;color:var(--cyan);text-transform:uppercase;letter-spacing:2px;margin-bottom:10px}.flow{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:10px 0}.flow-dot{width:10px;height:10px;border-radius:50%}.flow-dot.done{background:var(--green);box-shadow:0 0 8px var(--green)}.flow-dot.pending{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2)}.flow-arrow{color:var(--muted);margin:0 2px}.flow-label{font-size:10px;color:var(--muted)}.flow-label.done{color:var(--green)}.ask-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.ask-item{background:rgba(14,165,233,.04);border:1px solid rgba(14,165,233,.06);border-radius:8px;padding:10px;transition:all .2s}.ask-item:hover{border-color:rgba(14,165,233,.2)}.ask-item .icon{font-size:18px;margin-bottom:4px}.ask-item .title{font-size:11px;font-weight:600;margin-bottom:2px}.ask-item .desc{font-size:9px;color:var(--muted)}.cmd{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;background:rgba(14,165,233,.1);color:var(--cyan);margin:3px}.footer{text-align:center;color:var(--muted);font-size:10px;margin-top:24px;padding-top:16px;border-top:1px solid rgba(14,165,233,.06)}</style></head><body><div class="scanlines"></div><div class="card"><h1>SPECCORE</h1><div class="sub">Code by Spec, Not by Vibe · v${version}${iterName?' · '+iterName:''}</div><div class="section"><div class="section-title">📦 项目状态</div><div>${phaseLabel}</div><div style="font-size:10px;color:var(--muted);margin-top:4px">${isInit?(iterName?'当前期次: '+iterName+(taskCount>0?' · '+taskCount+' 个任务':''):'已初始化 · 无活跃期次'):'未初始化'}</div></div><div class="section"><div class="section-title">🔄 核心流水线</div><div class="flow">${phases.map((n,i)=>'<span class="flow-dot '+(i<doneIdx?'done':'pending')+'"></span><span class="flow-label '+(i<doneIdx?'done':'')+'">'+n+'</span>'+(i<5?'<span class="flow-arrow">→</span>':'')).join('')}</div></div><div class="section"><div class="section-title">🧠 AI 万能入口 · speccore ask</div><div style="font-size:10px;color:var(--muted);margin-bottom:8px">自然语言 → AI 自动识别意图</div><div class="ask-grid"><div class="ask-item"><div class="icon">📖</div><div class="title">命令解释</div><div class="desc">"dashboard 怎么用"</div></div><div class="ask-item"><div class="icon">🗺️</div><div class="title">任务指引</div><div class="desc">"我想做一个登录功能"</div></div><div class="ask-item"><div class="icon">🎯</div><div class="title">意图匹配</div><div class="desc">"查看进度" → dashboard</div></div><div class="ask-item"><div class="icon">⚡</div><div class="title">复杂编排</div><div class="desc">plan → schedule → execute</div></div></div><div style="margin-top:10px"><span class="cmd">speccore ask "描述"</span><span class="cmd">speccore dashboard</span><span class="cmd">speccore dev --auto</span></div></div><div class="footer">由 SpecCore 驱动 v${version} | ${now}</div></div></body></html>`;
}
