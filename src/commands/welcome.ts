/**
 * welcome — SpecCore 项目名片 + 使用引导
 * 首次接触即了解：我是谁、能做什么、怎么开始
 */

import { logger } from '../utils/logger';
import { join } from 'path';
import { pathExists, readdir } from 'fs-extra';
import { getDefaultIteration } from '../core/context';

const C = { r: '\x1b[0m', b: '\x1b[1m', d: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', magenta: '\x1b[35m', gray: '\x1b[90m', blue: '\x1b[34m' };
const B = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', dot: '◆', arrow: '→' };

function box(title: string, body: string[], w = 60): string {
  const top = `${C.cyan}${B.tl}${B.h.repeat(2)} ${C.b}${title}${C.r} ${B.h.repeat(Math.max(0, w - 5 - title.length))}${B.tr}${C.r}`;
  const mid = body.map(l => `${C.cyan}${B.v}${C.r} ${l}`).join('\n');
  const bot = `${C.cyan}${B.bl}${B.h.repeat(w - 2)}${B.br}${C.r}`;
  return [top, mid, bot].join('\n');
}

export interface WelcomeOptions { force?: boolean; }

export async function welcomeCommand(_options: WelcomeOptions): Promise<void> {
  const version = require('../../package.json').version;

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
