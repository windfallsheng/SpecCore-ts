/**
 * ask — 万能智能入口（美化版）
 * 四种模式：命令解释 / 任务指引 / 意图匹配 / 复杂编排
 * 终端输出使用 Unicode 框线 + 颜色码，呈现视觉化预览
 */

import { logger } from '../utils/logger';
import { askEngine, AskResult, PipelinePlan } from '../core/ask-engine';

const COLORS = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m',
  red: '\x1b[31m', blue: '\x1b[34m', magenta: '\x1b[35m',
  gray: '\x1b[90m', bg: '\x1b[48;5;236m', border: '\x1b[38;5;39m',
};

const BOX = {
  tl: '╭', tr: '╮', bl: '╰', br: '╯',
  h: '─', v: '│', tee: '├', cross: '┼',
  arrow: '→', down: '↓', up: '↑', branch: '├─', end: '└─',
  bar: '│', thick: '┃', dashed: '╴',
};

function box(width: number, content: string[]): string {
  const lines: string[] = [];
  const top = `${COLORS.border}${BOX.tl}${BOX.h.repeat(width - 2)}${BOX.tr}${COLORS.reset}`;
  const bot = `${COLORS.border}${BOX.bl}${BOX.h.repeat(width - 2)}${BOX.br}${COLORS.reset}`;
  lines.push(top);
  for (const line of content) {
    // 计算实际长度（去掉 ANSI 颜色码）
    const clean = line.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = Math.max(0, width - 2 - clean.length);
    lines.push(`${COLORS.border}${BOX.v}${COLORS.reset}${line}${' '.repeat(pad)}${COLORS.border}${BOX.v}${COLORS.reset}`);
  }
  lines.push(bot);
  return lines.join('\n');
}

function section(title: string, body: string[], width = 60): string {
  const lines: string[] = [];
  lines.push(`${COLORS.cyan}${BOX.tl}${'─'.repeat(2)} ${title} ${'─'.repeat(width - 5 - title.length)}${BOX.tr}${COLORS.reset}`);
  for (const line of body) {
    lines.push(`${COLORS.cyan}${BOX.v}${COLORS.reset} ${line}`);
  }
  lines.push(`${COLORS.cyan}${BOX.bl}${'─'.repeat(width - 2)}${BOX.br}${COLORS.reset}`);
  return lines.join('\n');
}

function header(title: string, subtitle: string): string {
  return [
    '',
    `${COLORS.cyan}${BOX.tl}━${'━'.repeat(56)}━${BOX.tr}${COLORS.reset}`,
    `${COLORS.cyan}${BOX.v}${COLORS.reset}  ${COLORS.bold}${COLORS.cyan}${title.padEnd(56)}${COLORS.reset}${COLORS.cyan}${BOX.v}${COLORS.reset}`,
    `${COLORS.cyan}${BOX.v}${COLORS.reset}  ${COLORS.gray}${subtitle.padEnd(56)}${COLORS.reset}${COLORS.cyan}${BOX.v}${COLORS.reset}`,
    `${COLORS.cyan}${BOX.bl}━${'━'.repeat(56)}━${BOX.br}${COLORS.reset}`,
  ].join('\n');
}

function modeBadge(mode: string): string {
  const map: Record<string, { emoji: string; color: string }> = {
    explain: { emoji: '📖', color: COLORS.cyan },
    guide: { emoji: '🗺️', color: COLORS.yellow },
    match: { emoji: '🎯', color: COLORS.green },
    pipeline: { emoji: '⚡', color: COLORS.magenta },
  };
  const info = map[mode] || { emoji: '🔍', color: COLORS.gray };
  return `${info.color}${info.emoji} ${mode.toUpperCase()}${COLORS.reset}`;
}

function renderExplain(result: AskResult): string {
  const lines: string[] = [];
  const [name, ...rest] = result.detail.split('\n');
  lines.push(section(`📖 命令详解: ${name.replace('📖', '').trim()}`, rest.slice(0, rest.length - 1)));
  return lines.join('\n');
}

function renderGuide(result: AskResult): string {
  const lines: string[] = [];
  lines.push(section('🗺️ 任务指引', [
    `${COLORS.bold}${result.summary}${COLORS.reset}`,
    '',
    ...result.detail.split('\n').slice(1),
  ]));
  return lines.join('\n');
}

function renderMatch(result: AskResult): string {
  const lines: string[] = [];
  lines.push(section('🎯 意图匹配', [
    `${COLORS.bold}${result.summary}${COLORS.reset}`,
    '',
    ...result.detail.split('\n').slice(1),
  ]));
  return lines.join('\n');
}

function renderPipeline(result: AskResult, plan: PipelinePlan): string {
  const lines: string[] = [];
  lines.push(header('⚡ 多步执行计划', `来源: "${plan.input}"`));
  lines.push('');

  // 流程拓扑
  const steps = plan.steps;
  const stepWidth = 22;
  const flowTop = steps.map((_, i) => `${COLORS.magenta}${'─'.repeat(stepWidth - 6)}▶${COLORS.reset}`).join(`${COLORS.gray}┐${COLORS.reset}\n${COLORS.gray}│${COLORS.reset}\n${COLORS.gray}┘${COLORS.reset}\n${COLORS.gray}│${COLORS.reset}\n`);
  // 简单版：横向并排流程
  const cols = steps.map((s, i) => {
    const num = `${COLORS.cyan}${COLORS.bold}${s.order}.${COLORS.reset}`;
    const cmd = `${COLORS.cyan}${s.command}${COLORS.reset}`;
    return [
      `${num} ${COLORS.bold}${cmd}${COLORS.reset}`,
      `${COLORS.gray}${(s.args || '').slice(0, stepWidth - 2)}${COLORS.reset}`,
    ];
  });

  // 渲染两行
  const row1 = steps.map((s, i) => {
    const n = `${COLORS.cyan}${COLORS.bold}#${s.order}${COLORS.reset}`;
    return `${n} ${COLORS.bold}${s.command}${COLORS.reset}` + ' '.repeat(Math.max(0, 18 - s.command.length - 3));
  }).join(`${COLORS.gray} ▶ ${COLORS.reset}`);

  const row2 = steps.map((s, i) => {
    return `${COLORS.gray}${(s.args || '').padEnd(18).slice(0, 18)}${COLORS.reset}`;
  }).join(' '.repeat(4));

  // 流程卡片：先输出所有顶部，再 body，再箭头
  const topBorder = steps.map(() => `${COLORS.cyan}  ${BOX.tl}${'─'.repeat(20)}${BOX.tr}${COLORS.reset}`).join(`  ${COLORS.gray}───────${COLORS.reset}  `);
  lines.push(topBorder);
  const line1 = steps.map(s => `${COLORS.cyan}  ${BOX.v}${COLORS.reset} ${COLORS.bold}#${s.order} ${(s.command + '              ').slice(0, 12)}${COLORS.reset}${COLORS.cyan}  ${BOX.v}${COLORS.reset}`).join(`  ${COLORS.gray}───────${COLORS.reset}  `);
  const line2 = steps.map(s => `${COLORS.cyan}  ${BOX.v}${COLORS.reset} ${COLORS.gray}${(s.args || '').padEnd(14).slice(0, 14)}${COLORS.reset}${COLORS.cyan}  ${BOX.v}${COLORS.reset}`).join(`  ${COLORS.gray}───────${COLORS.reset}  `);
  const bottomBorder = steps.map(() => `${COLORS.cyan}  ${BOX.bl}${'─'.repeat(20)}${BOX.br}${COLORS.reset}`).join(`  ${COLORS.gray}───────${COLORS.reset}  `);
  lines.push(line1);
  lines.push(line2);
  lines.push(bottomBorder);
  // 箭头
  const arrows = steps.map((_, i) => i < steps.length - 1 ? `  ${COLORS.magenta}▼${COLORS.reset}` : '   ').join(`       `);
  lines.push(arrows);
  lines.push('');
  lines.push('');

  // 详细步骤
  lines.push(section('📋 详细步骤', [
    ...steps.map(s => {
      const dep = s.dependsOn ? `  ${COLORS.gray}← 依赖 #${s.dependsOn}${COLORS.reset}` : '';
      return `${COLORS.cyan}  #${s.order}${COLORS.reset} ${COLORS.bold}${COLORS.green}speccore ${s.command}${COLORS.reset} ${COLORS.yellow}${s.args || ''}${COLORS.reset}${dep}`;
    }),
    '',
    `${COLORS.gray}  ── 解析说明 ──${COLORS.reset}`,
    ...steps.map(s => `  ${COLORS.gray}#${s.order}: ${s.explanation}${COLORS.reset}`),
  ]));
  lines.push('');

  // 确认按钮
  lines.push(`${COLORS.magenta}${'═'.repeat(58)}${COLORS.reset}`);
  lines.push(`${COLORS.magenta}  ⚠️  请确认后执行。输入 ${COLORS.bold}y${COLORS.reset}${COLORS.magenta} 确认，或 ${COLORS.bold}n${COLORS.reset}${COLORS.magenta} 取消${COLORS.reset}`);
  lines.push(`${COLORS.magenta}${'═'.repeat(58)}${COLORS.reset}`);

  return lines.join('\n');
}

export async function askCommand(input: string, _options: any): Promise<void> {
  // 如果不是 TTY（AI 调用），输出 HTML 页面
  if (!process.stdout.isTTY) {
    await askHtml(input);
    return;
  }

  if (!input || !input.trim()) {
    logger.info('🔍 SpecCore 万能 AI 入口');
    logger.info('');
    logger.info('用法: speccore ask "<自然语言>"');
    logger.info('');
    logger.info('四种模式自动识别:');
    logger.info('  📖 命令解释: speccore ask "dashboard 怎么用"');
    logger.info('  🗺️ 任务指引: speccore ask "我想做一个登录功能"');
    logger.info('  🎯 意图匹配: speccore ask "查看项目进度"');
    logger.info('  ⚡ 复杂编排: speccore ask "计划所有任务，晚8点分批执行"');
    return;
  }

  logger.info(`🔍 正在分析: "${input}"`);

  try {
    const result = await askEngine(input);
    logger.info('');
    logger.info(`${modeBadge(result.mode)}`);
    logger.info('');

    if (result.mode === 'pipeline' && result.pipeline) {
      logger.info(renderPipeline(result, result.pipeline));
    } else if (result.mode === 'explain') {
      logger.info(renderExplain(result));
    } else if (result.mode === 'guide') {
      logger.info(renderGuide(result));
    } else {
      logger.info(renderMatch(result));
    }
  } catch (e: any) {
    logger.error(`分析失败: ${e.message || e}`);
    logger.info('💡 请使用 speccore help 查看可用命令');
  }
}

/**
 * AI 模式：生成 HTML 页面（非 TTY 环境自动使用）
 */
async function askHtml(input: string): Promise<void> {
  const { askEngine } = await import('../core/ask-engine');
  const result = await askEngine(input || '');
  const html = renderAskHtml(result, input);
  const path = require('path');
  const fs = require('fs');
  const file = path.join(process.cwd(), 'speccore-ask-result.html');
  fs.writeFileSync(file, html);
  logger.info(`✅ 已生成: ${file}`);
}

function renderAskHtml(result: any, input: string): string {
  const modeColors: Record<string, string> = { explain: '#14b8a6', guide: '#f97316', match: '#0ea5e9', pipeline: '#6366f1' };
  const modeIcons: Record<string, string> = { explain: '📖', guide: '🗺️', match: '🎯', pipeline: '⚡' };
  const modeLabels: Record<string, string> = { explain: '命令解释', guide: '任务指引', match: '意图匹配', pipeline: '复杂编排' };
  const mc = modeColors[result.mode] || '#0ea5e9';
  const mi = modeIcons[result.mode] || '🔍';
  const ml = modeLabels[result.mode] || result.mode;

  let bodyHtml = '';
  if (result.pipeline) {
    bodyHtml = `<div class="pipeline">${result.pipeline.steps.map((s: any) =>
      `<div class="step"><span class="step-num">#${s.order}</span><span class="step-cmd">speccore ${s.command}</span><span class="step-args">${s.args||''}</span><span class="step-desc">${s.explanation}</span>${s.dependsOn?`<span class="step-dep">依赖 #${s.dependsOn}</span>`:''}</div>`
    ).join('')}</div>`;
  } else {
    bodyHtml = result.detail.replace(/\n/g, '<br>').replace(/speccore\s+(\S+)/g, '<code>$&</code>');
  }

  return `<!DOCTYPE html><html lang="zh-CN" data-theme="ocean"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>SpecCore Ask · ${input.slice(0,20)}</title><style>@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=JetBrains+Mono:wght@400;600;700&display=swap');[data-theme="ocean"]{--cyan:#0ea5e9;--bg:#0b1929;--card:rgba(13,31,56,.95);--border:rgba(14,165,233,.15);--text:#bae6fd;--muted:#5b7fa5;--green:#14b8a6;--orange:#f97316;--purple:#6366f1}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'JetBrains Mono',monospace;background:var(--bg);color:var(--text);min-height:100vh;padding:40px 20px}.scanlines{position:fixed;inset:0;pointer-events:none;z-index:99;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,240,255,.01) 2px,rgba(0,240,255,.01) 4px)}.card{max-width:680px;margin:0 auto;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:36px;position:relative;overflow:hidden}.card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX 3s linear infinite}.card::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX-rev 3s linear infinite}@keyframes scanX{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}@keyframes scanX-rev{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}@keyframes scanY{0%{transform:translateY(-100%)}100%{transform:translateY(100%)}}@keyframes scanY-rev{0%{transform:translateY(100%)}100%{transform:translateY(-100%)}}.vline{position:absolute;top:0;width:1px;bottom:0;pointer-events:none}.vline.l{left:0;background:linear-gradient(180deg,transparent,var(--cyan),transparent);animation:scanY-rev 3s linear infinite}.vline.r{right:0;background:linear-gradient(180deg,transparent,var(--cyan),transparent);animation:scanY 3s linear infinite}h1{font-family:'Orbitron',sans-serif;font-size:24px;font-weight:900;background:linear-gradient(135deg,var(--cyan),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:2px}.query{color:var(--muted);font-size:12px;margin:8px 0 20px}.badge{display:inline-block;padding:4px 14px;border-radius:20px;font-size:11px;font-weight:600;letter-spacing:1px;background:${mc}22;color:${mc};border:1px solid ${mc}44;margin-bottom:16px}.section{margin:16px 0;padding:14px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.04);border-radius:10px}.pipeline{display:flex;flex-direction:column;gap:12px}.step{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:10px 14px;background:rgba(14,165,233,.04);border-left:2px solid ${mc};border-radius:0 8px 8px 0}.step-num{font-family:Orbitron;font-size:18px;font-weight:900;color:var(--cyan);min-width:36px}.step-cmd{font-weight:600;color:var(--green)}.step-args{color:var(--muted);font-size:11px}.step-desc{color:var(--muted);font-size:10px;flex-basis:100%}.step-dep{font-size:9px;color:var(--orange);margin-left:auto}code{background:rgba(14,165,233,.1);padding:1px 6px;border-radius:4px;color:var(--cyan);font-size:11px}.footer{text-align:center;color:var(--muted);font-size:10px;margin-top:24px;padding-top:16px;border-top:1px solid rgba(255,255,255,.04)}</style></head><body><div class="scanlines"></div><div class="card"><div class="vline l"></div><div class="vline r"></div><h1>SPECCORE ASK</h1><div class="query">"${input}"</div><div class="badge">${mi} ${ml}</div><div class="section">${bodyHtml}</div><div class="footer">由 SpecCore 驱动 · ${new Date().toISOString().split('T')[0]}</div></div></body></html>`;
}
