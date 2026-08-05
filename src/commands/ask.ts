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

  lines.push(`${COLORS.cyan}  ${BOX.tl}${'─'.repeat(20)}${BOX.tr}  ${COLORS.reset}${COLORS.gray} ${BOX.tl}${'─'.repeat(20)}${BOX.tr}  ${COLORS.reset}${COLORS.gray} ${BOX.tl}${'─'.repeat(20)}${BOX.tr}${COLORS.reset}`);
  steps.forEach((s, i) => {
    const cardLines = [
      `${COLORS.cyan}  ${BOX.v}${COLORS.reset} ${COLORS.bold}#${s.order} ${s.command.padEnd(12).slice(0, 12)}${COLORS.cyan}  ${BOX.v}${COLORS.reset}`,
      `${COLORS.cyan}  ${BOX.v}${COLORS.reset} ${COLORS.gray}${(s.args || '').padEnd(14).slice(0, 14)}${COLORS.cyan}  ${BOX.v}${COLORS.reset}`,
    ];
    if (i < steps.length - 1) {
      cardLines.push(`${COLORS.cyan}  ${BOX.bl}${'─'.repeat(20)}${BOX.br}  ${COLORS.reset}${COLORS.magenta}   ━━━━━▶   ${COLORS.reset}`);
    } else {
      cardLines.push(`${COLORS.cyan}  ${BOX.bl}${'─'.repeat(20)}${BOX.br}  ${COLORS.reset}`);
    }
    lines.push(cardLines[0]);
    lines.push(cardLines[1]);
    if (i < steps.length - 1) lines.push(cardLines[2]);
  });
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
