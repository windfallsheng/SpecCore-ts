/**
 * welcome — SpecCore 身份卡片
 * 任何时候输入 speccore welcome，看到的是一张干净的项目名片
 */
import { logger } from '../utils/logger';
import { join } from 'path';
import { pathExists, readdir } from 'fs-extra';
import { getDefaultIteration } from '../core/context';

export interface WelcomeOptions {
  force?: boolean;
}

export async function welcomeCommand(_options: WelcomeOptions): Promise<void> {
  const version = require('../../package.json').version;
  const isInit = await pathExists(join(process.cwd(), '.speccore'));

  // ── 身份卡片 ──
  logger.info(`
  ███████╗██████╗ ███████╗ ██████╗ ██████╗ ██████╗ ██████╗ ███████╗
  ██╔════╝██╔══██╗██╔════╝██╔════╝██╔════╝██╔═══██╗██╔══██╗██╔════╝
  ███████╗██████╔╝█████╗  ██║     ██║     ██║   ██║██████╔╝█████╗  
  ╚════██║██╔═══╝ ██╔══╝  ██║     ██║     ██║   ██║██╔══██╗██╔══╝  
  ███████║██║     ███████╗╚██████╗╚██████╗╚██████╔╝██║  ██║███████╗
  ╚══════╝╚═╝     ╚══════╝ ╚═════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝
`);
  logger.info(`  Code by Spec, Not by Vibe.   v${version}`);
  logger.info('');
  logger.info('  SpecCore 是一套面向 AI 原生团队的规范驱动工具链。');
  logger.info('  它把需求 → 拆分 → 计划 → 执行 → 交付串成一个闭环。');
  logger.info('');

  // ── 项目状态 ──
  if (!isInit) {
    logger.info('  📦 当前项目: 未初始化');
    logger.info('  👉 speccore init');
    logger.info('');
    return;
  }

  const iteration = await getDefaultIteration('');
  if (!iteration) {
    logger.info('  📦 项目已初始化  |  无活跃期次');
    logger.info('  👉 speccore iteration create --name=Q1');
    logger.info('');
    return;
  }

  const iterDir = `期次-${iteration}`;
  let taskCount = 0;
  try {
    const entries = await readdir(iterDir, { withFileTypes: true });
    taskCount = entries.filter(e => e.isDirectory() && e.name.startsWith('Task-')).length;
  } catch {}

  logger.info(`  📦 项目已初始化  |  期次: ${iteration}  |  任务: ${taskCount} 个`);
  logger.info('');

  // ── 一步引导 ──
  const reqDoc = join(iterDir, '00-需求文档', 'REQUIREMENT.md');
  const analysis = join(iterDir, '00-需求文档', 'ANALYSIS.md');

  if (!(await pathExists(reqDoc))) {
    logger.info('  👉 speccore doc2spec -f PRD.docx --iteration=' + iteration);
  } else if (!(await pathExists(analysis))) {
    logger.info('  👉 speccore analyze -I ' + iteration);
  } else if (taskCount === 0) {
    logger.info('  👉 speccore iteration split -I ' + iteration);
  } else {
    logger.info('  📋 speccore plan -I ' + iteration + '        生成执行计划');
    logger.info('  💻 speccore execute --all -I ' + iteration + '  开始开发');
    logger.info('  📊 speccore status-panel              查看看板');
  }
  logger.info('');
}
