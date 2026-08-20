/**
 * ask — 万能智能入口（美化版）
 * 四种模式：命令解释 / 任务指引 / 意图匹配 / 复杂编排
 * 终端输出使用 Unicode 框线 + 颜色码，呈现视觉化预览
 */

import { logger } from '../utils/logger';
import { isAiContext, detectHostAi } from '../core/ask-host-ai';
import { askEngine, AskResult, PipelinePlan, extractTime } from '../core/ask-engine';

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
  lines.push(header('🎯 意图匹配', `来源: "${result.summary.slice(0, 40)}"`));
  lines.push('');
  lines.push(section('📋 匹配详情', result.detail.split('\n')));
  lines.push('');
  // 确认提示
  lines.push(`${COLORS.magenta}${'═'.repeat(58)}${COLORS.reset}`);
  lines.push(`${COLORS.magenta}  ⚠️  请确认后执行。${COLORS.reset}`);
  lines.push(`${COLORS.magenta}  ${COLORS.bold}确认无误后复制命令执行${COLORS.reset}，或修改参数后重新 speccore ask`);
  lines.push(`${COLORS.magenta}${'═'.repeat(58)}${COLORS.reset}`);
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
  const ver = require('../../package.json').version;

  if (!input || !input.trim()) {
    logger.info('🔍 SpecCore 万能 AI 入口');
    logger.info('用法: speccore ask "<自然语言>"');
    return;
  }

  // ── 🎉 升级仪式：首次使用 / 版本升级时展示引导页 ──
  const { pathExists, readFile, writeFile, ensureDir, copy } = await import('fs-extra');
  const { join } = await import('path');
  const markerDir = join(process.cwd(), '.speccore', 'local');
  const markerFile = join(markerDir, '.ask-onboarded');
  await ensureDir(markerDir);
  let lastVersion = '';
  if (await pathExists(markerFile)) {
    try { lastVersion = (await readFile(markerFile, 'utf-8')).trim(); } catch {}
  }
  if (lastVersion !== ver) {
    const html = renderOnboardingHtml();
    const outPath = join(process.cwd(), 'outputs', 'speccore-ask-onboarding.html');
    await ensureDir(join(process.cwd(), 'outputs'));
    await writeFile(outPath, html);
    // 复制关联模板页面到 outputs/
    const tplDir = join(process.cwd(), 'templates', 'html');
    for (const f of ['speccore-ask-explain.html','speccore-ask-guide.html','speccore-ask-match.html','speccore-ask-pipeline.html','speccore-help.html']) {
      const src = join(tplDir, f);
      if (await pathExists(src)) await copy(src, join(process.cwd(), 'outputs', f));
    }
    await writeFile(markerFile, ver);
    // 输出 SPECCORE_ONBOARD 标记让 AI 展示引导页
    process.stdout.write(`[SPECCORE_ONBOARD: ${outPath}]\n`);
    logger.info(`👋 ${lastVersion ? `v${lastVersion} → v${ver} 升级` : '首次使用'} — 已生成引导页: ${outPath}`);
  }

  const result = await askEngine(input);
  // 始终输出模式标记到 stdout，供 Skill/编排器解析
  process.stdout.write(`[SPECCORE_MODE: ${result.mode}]\n`);

  // ═══════════════════════════════════════════
  // AI 上下文（WorkBuddy / ClaudeCode 等）：自动执行模式
  // 核心原则：不打印命令让用户复制，直接执行
  // ═══════════════════════════════════════════
  if (isAiContext() || !process.stdout.isTTY) {
    const { spawnSync } = await import('child_process');
    const { writeFile } = await import('fs-extra');

    // —— 统一执行函数 ——
    async function autoExecute(command: string, args: string, confirm: boolean): Promise<{ ok: boolean; output: string }> {
      const fullCmd = `speccore ${command} ${args}`.trim();
      process.stdout.write(`[SPECCORE_EXEC: ${fullCmd}]\n`);
      if (confirm) process.stdout.write(`[SPECCORE_CONFIRM: 是否确认执行?]\n`);

      const argList = (args.match(/(?:[^\s"]+|"[^"]*")+/g) || []).map((s: string) => s.replace(/^"|"$/g, ''));
      try {
        const r = spawnSync('speccore', [command, ...argList], {
          encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd(),
          timeout: 300000, // 5min: execute/split 等长命令需要足够时间
        });
        const output = ((r.stdout || '') + (r.stderr || '')).trim();
        const ok = r.status === 0;
        process.stdout.write(`[SPECCORE_EXEC_STATUS: ${ok ? 'ok' : `fail(${r.status})`}]\n`);
        if (ok) {
          process.stdout.write(output.slice(0, 2000) + '\n');
        } else {
          process.stdout.write(output.slice(-800) + '\n');
        }
        return { ok, output };
      } catch (e: any) {
        process.stdout.write(`[SPECCORE_EXEC_ERROR: ${e.message}]\n`);
        return { ok: false, output: e.message };
      }
    }

    // 1. Pipeline 交互执行（逐步骤确认）
    if (result.pipeline && result.mode === 'pipeline') {
      const isAuto = /一键|全自动|自主|auto/i.test(input) || !result.pipeline?.confirm;
      process.stdout.write(`\n📋 管道模式: ${result.pipeline.steps.length} 步\n`);
      if (!isAuto) process.stdout.write(`⚠️ 交互模式: 每步执行前需要确认\n`);

      for (let i = 0; i < result.pipeline.steps.length; i++) {
        const step = result.pipeline.steps[i];
        const argsFilled = (step.args || '').replace(/\{(\w+)\}/g, (_: string, k: string) => {
          if (k === 'time') return extractTime(input);
          if (k === 'batch') { const m = input.match(/(\d+)[批次个]/); return m ? m[1] : '5'; }
          if (k === 'iteration') { const m = input.match(/Iteration[- ]?\S+|Q\d+|sample/i); return m ? m[0].replace(/^Iteration[- ]?/, '') : ''; }
          return '';
        });
        const fullCmd = `${step.command} ${argsFilled}`.trim();

        // 交互模式: 每步确认
        if (!isAuto) {
          process.stdout.write(`[SPECCORE_CONFIRM_STEP: ${step.order}/${result.pipeline.steps.length}] ${fullCmd} — ${step.explanation}\n`);
          process.stdout.write(`[SPECCORE_CONFIRM_ASK: 执行这一步? (确认=y, 跳过=s, 停止=q)]\n`);
          // daemon/schedule 步骤可跳过确认（非破坏性）
          if (step.command === 'schedule' && step.args?.includes('daemon')) {
            continue; // daemon start 自动执行
          }
        }

        const r = await autoExecute(step.command, argsFilled, false);
        if (!r.ok && step.command !== 'schedule') {
          process.stdout.write(`[SPECCORE_STEP_FAIL: ${step.command}] 用户决定: [重试/跳过/停止]\n`);
          break;
        }
      }
      await askHtml(input);
      return;
    }

    // 2. 有 autoExec → 单命令执行
    if (result.autoExec) {
      await autoExecute(result.autoExec.command, result.autoExec.args, !!result.autoExec.confirm);
      await askHtml(input);
      return;
    }

    // 2. ambiguous 模式 → 提示 AI 让用户选择
    if (result.mode === 'ambiguous') {
      process.stdout.write(`[SPECCORE_AMBIGUOUS: ${result.commands.join(' | ')}]\n`);
      process.stdout.write(`请让用户从以下选项中选择:\n${result.detail}\n`);
      await askHtml(input);
      return;
    }

    // 3. explain / 纯 guide → 生成 HTML（没有可执行的操作）
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
    logger.info('  ⚡ 复杂编排: speccore ask "重新分析全部文档，按计划自动开发"');
    return;
  }

  logger.info(`🔍 正在分析: "${input}"`);
  logger.info('');
  logger.info(`${modeBadge(result.mode)}`);
  logger.info('');

  try {
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
  const file = path.join(process.cwd(), 'outputs', 'speccore-ask-result.html');
  if (!!process.env.WORKBUDDY_SESSION) { process.stdout.write(html); } else { fs.writeFileSync(file, html); process.stdout.write('file://' + file + '\n'); }
  logger.info(`✅ 已生成: ${file}`);
}

function renderAskHtml(result: any, input: string): string {
  switch (result.mode) {
    case 'explain':  return renderExplainHtml(result, input);
    case 'guide':    return renderGuideHtml(result, input);
    case 'pipeline': return renderPipelineHtml(result, input);
    default:         return renderMatchHtml(result, input);
  }
}

function renderExplainHtml(result: any, input: string): string {
  const lines = result.detail.split('\n').filter((l: string) => l.trim());
  let desc = '', usage = '', examples: string[] = [], related = '';
  for (const l of lines) {
    if (l.includes('描述:')) desc = l.replace(/.*描述:\s*/, '');
    else if (l.includes('用法:')) usage = l.replace(/.*用法:\s*/, '');
    else if (l.startsWith('$')) examples.push(l.replace('$ ', ''));
    else if (l.includes('关联命令:')) related = l.replace(/.*关联命令:\s*/, '');
  }
  const body = `<div class="explain-box"><div class="explain-desc">${desc}</div><div class="explain-usage"><span class="label">用法</span><code>${usage}</code></div>${examples.length > 0 ? `<div class="explain-examples"><span class="label">示例</span>${examples.map(e=>`<code>${e}</code>`).join('')}</div>` : ''}${related ? `<div class="explain-related"><span class="label">关联</span>${related.split(',').map((r: string)=>`<span class="tag">${r.trim()}</span>`).join(' ')}</div>` : ''}</div>`;
  return buildPage('📖 命令解释', body, input, '#14b8a6');
}

function renderGuideHtml(result: any, input: string): string {
  const steps = result.pipeline?.steps || [];
  const body = `<div class="guide-title">${result.summary}</div><div class="guide-steps">${steps.map((s: any) => `<div class="guide-step"><div class="step-num">${s.order}</div><div class="step-body"><div class="step-cmd">speccore ${s.command}${s.args ? ' ' + s.args : ''}</div><div class="step-desc">${s.explanation}</div></div></div>`).join('')}</div>`;
  return buildPage('🗺️ 任务指引', body, input, '#f97316');
}

function renderMatchHtml(result: any, input: string): string {
  const body = `<div class="match-result"><div class="match-summary">${result.summary}</div><div class="match-detail">${result.detail.replace(/\n/g, '<br>').replace(/speccore\s+(\S+)/g, '<code>$&</code>')}</div></div>`;
  return buildPage('🎯 意图匹配', body, input, '#0ea5e9');
}

function renderPipelineHtml(result: any, input: string): string {
  const steps = result.pipeline?.steps || [];
  const body = `<div class="pipeline-title">📋 ${steps.length} 步执行计划</div><div class="pipeline-steps">${steps.map((s: any) => `<div class="pipe-step"><div class="pipe-num">#${s.order}</div><div class="pipe-body"><div class="pipe-cmd">speccore ${s.command} <span class="pipe-args">${s.args || ''}</span></div><div class="pipe-desc">${s.explanation}</div>${s.dependsOn ? `<div class="pipe-dep">🔗 依赖 #${s.dependsOn}</div>` : ''}</div></div>`).join('')}</div><div class="confirm-bar">⚠️ 确认后执行 · 输入 y / n</div>`;
  return buildPage('⚡ 复杂编排', body, input, '#6366f1');
}

function buildPage(title: string, body: string, input: string, accent: string): string {
  const ver = require('../../package.json').version;
  return `<!DOCTYPE html><html lang="zh-CN" data-theme="ocean"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>SpecCore · ${input.slice(0,20)}</title><style>@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=JetBrains+Mono:wght@400;600;700&display=swap');[data-theme="ocean"]{--cyan:#0ea5e9;--bg:#0b1929;--card:rgba(13,31,56,.95);--border:rgba(14,165,233,.15);--text:#bae6fd;--muted:#5b7fa5;--green:#14b8a6;--orange:#f97316;--purple:#6366f1}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'JetBrains Mono',monospace;background:var(--bg);color:var(--text);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 20px}.scanlines{position:fixed;inset:0;pointer-events:none;z-index:99;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,240,255,.01) 2px,rgba(0,240,255,.01) 4px)}.card{max-width:800px;width:100%;margin:0 auto;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:24px;position:relative;overflow:hidden}.card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX 3s linear infinite}.card::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--cyan),transparent);animation:scanX-rev 3s linear infinite}@keyframes scanX{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}@keyframes scanX-rev{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}@keyframes scanY{0%{transform:translateY(-100%)}100%{transform:translateY(100%)}}@keyframes scanY-rev{0%{transform:translateY(100%)}100%{transform:translateY(-100%)}}.vline{position:absolute;top:0;width:1px;bottom:0;pointer-events:none}.vline.l{left:0;background:linear-gradient(180deg,transparent,var(--cyan),transparent);animation:scanY-rev 3s linear infinite}.vline.r{right:0;background:linear-gradient(180deg,transparent,var(--cyan),transparent);animation:scanY 3s linear infinite}h1{font-family:'Orbitron',sans-serif;font-size:24px;font-weight:900;background:linear-gradient(135deg,var(--cyan),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:2px;animation:titleGlow 3s ease-in-out infinite}@keyframes titleGlow{0%,100%{filter:drop-shadow(0 0 20px rgba(14,165,233,.4)) drop-shadow(0 0 60px rgba(14,165,233,.15))}50%{filter:drop-shadow(0 0 30px rgba(14,165,233,.7)) drop-shadow(0 0 80px rgba(14,165,233,.3))}}@keyframes cardGlow{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.6)}}.card-bg{position:absolute;inset:0;pointer-events:none;z-index:0;background:radial-gradient(ellipse at 50% 10%,rgba(14,165,233,.25) 0%,transparent 70%);animation:cardGlow 3s ease-in-out infinite;transform-origin:top center}.grid-pattern{position:fixed;inset:0;pointer-events:none;z-index:0;background-image:linear-gradient(rgba(14,165,233,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(14,165,233,.03) 1px,transparent 1px);background-size:60px 60px}.query{color:var(--muted);font-size:12px;margin:8px 0 16px}.badge{display:inline-block;padding:4px 14px;border-radius:20px;font-size:11px;font-weight:600;background:${accent}22;color:${accent};border:1px solid ${accent}44;margin-bottom:20px}code{background:rgba(14,165,233,.1);padding:2px 8px;border-radius:4px;color:var(--cyan);font-size:12px;display:inline-block;margin:4px 4px 4px 0}.tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;background:rgba(20,184,166,.1);color:var(--green);margin:2px}
/* Explain */
.explain-box{padding:10px 0}.explain-desc{font-size:13px;margin-bottom:16px}.explain-usage,.explain-examples,.explain-related{margin:10px 0}.label{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-right:8px}
/* Guide */
.guide-title{font-weight:600;margin-bottom:16px}.guide-steps{display:flex;flex-direction:column;gap:8px}.guide-step{display:flex;gap:14px;padding:12px 14px;background:rgba(249,115,22,.04);border-left:2px solid var(--orange);border-radius:0 8px 8px 0}.guide-step .step-num{font-family:Orbitron;font-size:20px;font-weight:900;color:var(--orange);min-width:30px}.guide-step .step-cmd{font-weight:600;color:var(--text)}.guide-step .step-desc{color:var(--muted);font-size:10px;margin-top:4px}
/* Match */
.match-result{padding:10px 0}.match-summary{font-weight:600;font-size:14px;margin-bottom:12px}.match-detail{color:var(--muted);font-size:12px;line-height:1.6}
/* Pipeline */
.pipeline-title{font-weight:600;margin-bottom:16px}.pipeline-steps{display:flex;flex-direction:column;gap:10px}.pipe-step{display:flex;gap:14px;padding:12px 14px;background:rgba(99,102,241,.04);border-left:2px solid var(--purple);border-radius:0 8px 8px 0}.pipe-step .pipe-num{font-family:Orbitron;font-size:20px;font-weight:900;color:var(--purple);min-width:36px}.pipe-step .pipe-cmd{font-weight:600;color:var(--green)}.pipe-step .pipe-args{color:var(--muted);font-size:11px}.pipe-step .pipe-desc{color:var(--muted);font-size:10px;margin-top:4px}.pipe-step .pipe-dep{font-size:9px;color:var(--orange);margin-top:4px}.confirm-bar{text-align:center;padding:14px;margin-top:16px;background:rgba(99,102,241,.08);border:1px dashed rgba(99,102,241,.2);border-radius:8px;color:var(--purple);font-size:12px}
.footer{text-align:center;color:var(--muted);font-size:10px;margin-top:24px;padding-top:16px;border-top:1px solid rgba(255,255,255,.04)}</style></head><body><div class="scanlines"></div><div class="grid-pattern"></div><div class="card"><div class="card-bg"></div><div class="vline l"></div><div class="vline r"></div><h1>SPECCORE ASK</h1><div class="query">"${input}"</div><div class="badge">${title}</div>${body}<div class="footer">由 SpecCore 驱动 v${ver} · ${new Date().toISOString().split('T')[0]}</div></div></body></html>`;
}

function renderOnboardingHtml(): string {
  const ver = require('../../package.json').version;
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Speccore Ask 首次引导</title><style>@import url(\'https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=JetBrains+Mono:wght@400;600;700\');*{box-sizing:border-box}body{margin:0;padding:24px 20px;background:#0b1929;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:\'JetBrains Mono\',monospace;position:relative}.scanlines{position:fixed;inset:0;pointer-events:none;z-index:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,240,255,.015) 2px,rgba(0,240,255,.015) 4px)}.grid-pattern{position:fixed;inset:0;pointer-events:none;z-index:0;background-image:linear-gradient(rgba(14,165,233,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(14,165,233,.03) 1px,transparent 1px);background-size:60px 60px}.card{max-width:800px;width:100%;background:rgba(13,31,56,.95);border:1px solid rgba(14,165,233,.15);border-radius:16px;padding:24px;position:relative;overflow:hidden;z-index:1}.card::before{content:\'\';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,#0ea5e9,transparent);animation:scanX 3s linear infinite}.card::after{content:\'\';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,#0ea5e9,transparent);animation:scanX-rev 3s linear infinite}.vline{position:absolute;top:0;width:1px;bottom:0;pointer-events:none}.vline.l{left:0;background:linear-gradient(0deg,transparent,#0ea5e9,transparent);animation:scanY-rev 3s linear infinite}.vline.r{right:0;background:linear-gradient(0deg,transparent,#0ea5e9,transparent);animation:scanY 3s linear infinite}@keyframes scanX{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}@keyframes scanX-rev{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}@keyframes scanY{0%{transform:translateY(-100%)}100%{transform:translateY(100%)}}@keyframes scanY-rev{0%{transform:translateY(100%)}100%{transform:translateY(-100%)}}.wrap svg{display:block;width:100%;height:auto}.badge-line{text-align:center;margin-top:14px;position:relative;z-index:1;color:#5b7fa5;font-size:11px}.badge-line code{background:rgba(14,165,233,.15);color:#0ea5e9;padding:4px 14px;border-radius:6px;font-size:13px;border:1px solid rgba(14,165,233,.2)}.sub{color:#5b7fa5;font-size:12px;letter-spacing:1px;text-align:center;margin-top:6px}.bottom-bar{text-align:center;margin-top:14px;padding:12px 20px;background:rgba(14,165,233,.08);border:1px solid rgba(14,165,233,.15);border-radius:10px}.bottom-bar .entry{color:#bae6fd;font-size:12px}.bottom-bar .flow-desc{color:#5b7fa5;font-size:10px;margin-top:6px}.ft{text-align:center;color:#5b7fa5;font-size:10px;margin-top:16px;z-index:1}@keyframes cardGlow{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.6)}}.card-bg{position:absolute;inset:0;pointer-events:none;z-index:0;background:radial-gradient(ellipse at 50% 10%,rgba(14,165,233,.25) 0%,transparent 70%);animation:cardGlow 3s ease-in-out infinite;transform-origin:top center}@keyframes titleGlow{0%,100%{filter:drop-shadow(0 0 20px rgba(14,165,233,.4)) drop-shadow(0 0 60px rgba(14,165,233,.15))}50%{filter:drop-shadow(0 0 30px rgba(14,165,233,.7)) drop-shadow(0 0 80px rgba(14,165,233,.3))}}h1,h2{font-family:\'Orbitron\',sans-serif;font-size:40px;font-weight:900;background:linear-gradient(135deg,#0ea5e9,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:2px;text-align:center;animation:titleGlow 3s ease-in-out infinite}.mode-rect{transition:all .3s;cursor:pointer}.mode-rect:hover{filter:brightness(1.4) drop-shadow(0 0 8px currentColor)}.ask-circle{cursor:pointer;transition:all .3s}.ask-circle:hover{filter:drop-shadow(0 0 16px rgba(14,165,233,.6))}.start-bar{text-align:center;margin-top:18px;position:relative;z-index:1}.start-btn{display:inline-block;padding:12px 36px;background:linear-gradient(135deg,#0ea5e9 0%,#6366f1 100%);border:none;border-radius:40px;color:#fff;font-family:\'JetBrains Mono\',monospace;font-size:13px;font-weight:700;letter-spacing:1px;cursor:pointer;box-shadow:0 0 24px rgba(14,165,233,.3);transition:all .3s;text-decoration:none}.start-btn:hover{box-shadow:0 0 40px rgba(14,165,233,.5);transform:translateY(-1px)}.copy-hint{display:inline-block;margin-top:10px;color:#5b7fa5;font-size:10px;cursor:pointer;transition:color .2s}.copy-hint:hover{color:#0ea5e9}</style></head><body><div class="scanlines"></div><div class="grid-pattern"></div><div class="card"><div class="card-bg"></div><div class="vline l"></div><div class="vline r"></div><h1>ask — SpecCore 万能AI入口</h1><div class="sub">一个命令解决所有问题：解释 / 指引 / 匹配 / 编排</div><div style="display:block;width:100%">'+SVG_ONBOARD+'</div><div class="badge-line">任意自然语言，AI 自动匹配最佳模式</div><div class="start-bar"><a class="start-btn" href="speccore-help.html">知道了，开始使用</a><div class="copy-hint" onclick="navigator.clipboard.writeText(\'/spec-ask 你的需求\');this.textContent=\'✅ 已复制到剪贴板\'" title="点击复制">📋 点击复制命令</div></div><div class="bottom-bar"><div class="entry">统一入口: /spec-ask 任意自然语言，AI 自动理解意图</div><div class="flow-desc">AI 自动判断模式 → 执行匹配逻辑 → 展示结果 → 用户确认</div></div><div class="ft">SpecCore v'+ver+' — 下次直接显示结果</div></div></body></html>';
}

export const SVG_ONBOARD = '<svg viewBox="0 0 680 400" xmlns="http://www.w3.org/2000/svg"><style>.mode-rect{transition:all .3s;cursor:pointer}.mode-rect:hover{filter:brightness(1.4) drop-shadow(0 0 12px currentColor)}.ask-circle{cursor:pointer;transition:all .3s}.ask-circle:hover{filter:drop-shadow(0 0 20px rgba(14,165,233,.7))}</style><line x1="319" y1="218" x2="230" y2="178" stroke="#14b8a6" stroke-width="1.5"/><line x1="361" y1="218" x2="450" y2="178" stroke="#f97316" stroke-width="1.5"/><line x1="319" y1="238" x2="230" y2="278" stroke="#0ea5e9" stroke-width="1.5"/><line x1="361" y1="238" x2="450" y2="278" stroke="#a78bfa" stroke-width="1.5"/><rect class="mode-rect" x="40" y="68" width="285" height="110" rx="8" fill="#0d1f38" stroke="#14b8a6" stroke-width="1" onclick="window.location.href=\'speccore-ask-explain.html\'"/><text x="56" y="90" fill="#14b8a6" font-size="13" font-family="monospace" font-weight="bold">模式1: 命令解释</text><text x="56" y="110" fill="#5b7fa5" font-size="10" font-family="monospace">解释下 dashboard 命令</text><text x="56" y="128" fill="#5b7fa5" font-size="10" font-family="monospace">init 有哪些参数？</text><text x="56" y="146" fill="#5b7fa5" font-size="10" font-family="monospace">显示命令详情 + 示例 + 关联命令</text><rect x="160" y="158" width="120" height="16" rx="8" fill="#14b8a6" opacity="0.15"/><text x="220" y="170" text-anchor="middle" fill="#14b8a6" font-size="9" font-family="monospace">知识库匹配</text><rect class="mode-rect" x="355" y="68" width="285" height="110" rx="8" fill="#0d1f38" stroke="#f97316" stroke-width="1" onclick="window.location.href=\'speccore-ask-guide.html\'"/><text x="371" y="90" fill="#f97316" font-size="13" font-family="monospace" font-weight="bold">模式2: 任务指引</text><text x="371" y="110" fill="#5b7fa5" font-size="10" font-family="monospace">我想做一个登录功能</text><text x="371" y="128" fill="#5b7fa5" font-size="10" font-family="monospace">怎么开始一个新项目？</text><text x="371" y="146" fill="#5b7fa5" font-size="10" font-family="monospace">展示完整操作步骤流水线</text><rect x="480" y="158" width="120" height="16" rx="8" fill="#f97316" opacity="0.15"/><text x="540" y="170" text-anchor="middle" fill="#f97316" font-size="9" font-family="monospace">工作流生成</text><rect class="mode-rect" x="40" y="278" width="285" height="110" rx="8" fill="#0d1f38" stroke="#0ea5e9" stroke-width="1" onclick="window.location.href=\'speccore-ask-match.html\'"/><text x="56" y="300" fill="#0ea5e9" font-size="13" font-family="monospace" font-weight="bold">模式3: 意图匹配</text><text x="56" y="320" fill="#5b7fa5" font-size="10" font-family="monospace">查看项目进度 → dashboard</text><text x="56" y="338" fill="#5b7fa5" font-size="10" font-family="monospace">帮我审查代码 → validate</text><text x="56" y="356" fill="#5b7fa5" font-size="10" font-family="monospace">直接匹配命令</text><rect x="160" y="368" width="120" height="16" rx="8" fill="#0ea5e9" opacity="0.15"/><text x="220" y="378" text-anchor="middle" fill="#0ea5e9" font-size="9" font-family="monospace">38意图+AI</text><rect class="mode-rect" x="355" y="278" width="285" height="110" rx="8" fill="#0d1f38" stroke="#a78bfa" stroke-width="1" onclick="window.location.href=\'speccore-ask-pipeline.html\'"/><text x="371" y="300" fill="#a78bfa" font-size="13" font-family="monospace" font-weight="bold">模式4: 复杂编排</text><text x="371" y="320" fill="#5b7fa5" font-size="10" font-family="monospace">计划所有任务晚8点分批</text><text x="371" y="338" fill="#5b7fa5" font-size="10" font-family="monospace">做完分析拆分执行PR</text><text x="371" y="356" fill="#5b7fa5" font-size="10" font-family="monospace">LLM分解预览确认执行</text><rect x="480" y="368" width="120" height="16" rx="8" fill="#a78bfa" opacity="0.15"/><text x="540" y="378" text-anchor="middle" fill="#a78bfa" font-size="9" font-family="monospace">Pipeline引擎</text><circle class="ask-circle" cx="340" cy="228" r="28" fill="#0d1f38" stroke="#0ea5e9" stroke-width="2"/><text x="340" y="234" text-anchor="middle" fill="#0ea5e9" font-size="16" font-family="monospace" font-weight="bold">ask</text></svg>';
