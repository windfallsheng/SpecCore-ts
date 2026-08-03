/**
 * welcome — SpecCore 名片
 * 干净、漂亮、有内涵。任何时候看一眼就知道你是谁。
 */
import { logger } from '../utils/logger';
import { join } from 'path';
import { pathExists, readdir } from 'fs-extra';
import { getDefaultIteration } from '../core/context';

export interface WelcomeOptions { force?: boolean; }

export async function welcomeCommand(_options: WelcomeOptions): Promise<void> {
  const version = require('../../package.json').version;

  // ── 名片 ──
  logger.info(`
  ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
  █▌   SpecCore  ·  Code by Spec, Not by Vibe   ▐▌
  █▌                                             ▐▌
  █▌   需求 ─→ 拆分 ─→ 计划 ─→ 执行 ─→ 交付      ▐▌
  █▌   规范驱动  ·  人机协同  ·  可追溯闭环        ▐▌
  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
`);

  // ── 状态行 ──
  const isInit = await pathExists(join(process.cwd(), '.speccore'));
  if (!isInit) {
    logger.info(`  v${version}  ·  📦 未初始化  →  speccore init\n`);
    return;
  }

  const iteration = await getDefaultIteration('');
  if (!iteration) {
    logger.info(`  v${version}  ·  📦 已初始化  →  speccore iteration create --name=Q1\n`);
    return;
  }

  let taskCount = 0;
  try {
    const entries = await readdir(`期次-${iteration}`, { withFileTypes: true });
    taskCount = entries.filter(e => e.isDirectory() && e.name.startsWith('Task-')).length;
  } catch {}

  const reqDoc = join(`期次-${iteration}`, '00-需求文档', 'REQUIREMENT.md');
  const analysis = join(`期次-${iteration}`, '00-需求文档', 'ANALYSIS.md');
  let hint = `speccore plan -I ${iteration}`;

  if (!(await pathExists(reqDoc))) hint = `speccore doc2spec -f PRD.docx --iteration=${iteration}`;
  else if (!(await pathExists(analysis))) hint = `speccore analyze -I ${iteration}`;
  else if (taskCount === 0) hint = `speccore iteration split -I ${iteration}`;

  logger.info(`  v${version}  ·  ${iteration}  ·  ${taskCount} 个 Task`);
  logger.info(`  →  ${hint}\n`);
}
