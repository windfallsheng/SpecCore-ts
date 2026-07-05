/**
 * /spec - 智能入口命令
 * 自然语言意图识别引擎，自动匹配最合适的 SpecCore 命令
 */

import { recognizeIntent, getConfidenceLevel } from '../core/intent-recognition';
import { logger } from '../utils/logger';
import { getDefaultIteration, getDefaultAssignee } from '../core/context';

export interface SpecOptions {
  /** 使用模式：识别后的命令执行由 AI 协同完成 */
}

export async function specCommand(input: string, _options: SpecOptions): Promise<void> {
  if (!input || !input.trim()) {
    logger.info('🔍 SpecCore 智能入口');
    logger.info('');
    logger.info('用法: speccore spec "<自然语言描述>"');
    logger.info('');
    logger.info('示例:');
    logger.info('  speccore spec "做一个用户登录功能，支持手机号+密码"');
    logger.info('  speccore spec "修复登录超时问题"');
    logger.info('  speccore spec "查看进度"');
    logger.info('  speccore spec "开始干活"');
    logger.info('  speccore spec "把登录改成验证码登录"');
    logger.info('  speccore spec "审查一下"');
    return;
  }

  logger.info(`🔍 正在理解你的意图...`);
  logger.info('');

  const iteration = await getDefaultIteration();
  const assignee = await getDefaultAssignee();

  const results = await recognizeIntent(input);

  if (results.length === 0) {
    // 低置信度：无法识别
    logger.warn('🤔 我没有完全理解你的意图，请补充说明。');
    logger.info('');
    logger.info('你可以这样说：');
    logger.info('  - "查看项目进度"');
    logger.info('  - "帮我创建一个登录功能"');
    logger.info('  - "审查一下当前任务"');
    logger.info('  - "开始开发"');
    logger.info('  - "把登录改成验证码登录"');
    return;
  }

  const best = results[0];
  const level = getConfidenceLevel(best.confidence);

  // 显示上下文信息
  if (iteration) {
    logger.info(`📍 当前期次: ${iteration}`);
  }
  if (assignee && assignee !== 'unknown') {
    logger.info(`👤 当前用户: ${assignee}`);
  }
  logger.info('');

  if (level === 'high') {
    // 高置信度 (>=80%)：展示预览
    await showHighConfidenceResult(best, iteration);
  } else if (level === 'medium') {
    // 中置信度 (50-80%)：展示候选列表
    showMediumConfidenceResults(results.slice(0, 3), iteration);
  } else {
    // 低置信度 (<50%)：引导澄清
    showLowConfidenceGuidance(results.slice(0, 2), input);
  }
}

async function showHighConfidenceResult(
  result: Awaited<ReturnType<typeof recognizeIntent>>[0],
  iteration: string
): Promise<void> {
  logger.info(`🔍 我理解你想：**${getIntentLabel(result.intent)}**`);
  logger.info(`   置信度: ${result.confidence}% | 匹配命令: speccore ${result.command}`);
  logger.info('');

  // 显示匹配详情
  if (result.matchedTriggers.length > 0) {
    logger.debug(`   命中规则: ${result.matchedTriggers.join(', ')}`);
  }

  // 显示提取的参数
  const params = result.extractedParams;
  if (Object.keys(params).length > 0) {
    logger.info('📝 已提取参数:');
    for (const [key, value] of Object.entries(params)) {
      logger.info(`   ${key}: ${value}`);
    }
    logger.info('');
  }

  // 构建执行命令预览
  let cmdPreview = `speccore ${result.command}`;
  if (params.name) {
    cmdPreview += ` --name "${params.name}"`;
  }
  if (params.desc) {
    cmdPreview += ` --desc "${params.desc}"`;
  }
  if (iteration && !params.iteration) {
    cmdPreview += ` --iteration "${iteration}"`;
  }
  if (params.iteration) {
    cmdPreview += ` --iteration "${params.iteration}"`;
  }

  logger.info('📍 建议执行:');
  logger.info(`   $ ${cmdPreview}`);
  logger.info('');
  logger.info('💡 提示: 直接运行上述命令即可执行。或使用 --force 跳过确认。');
}

function showMediumConfidenceResults(
  results: Awaited<ReturnType<typeof recognizeIntent>>,
  iteration: string
): void {
  logger.info('🔍 我注意到你的输入可能有多种含义：');
  logger.info('');

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const cmdPreview = `speccore ${r.command}${iteration ? ` --iteration "${iteration}"` : ''}`;
    logger.info(`  ${i + 1}. **${getIntentLabel(r.intent)}** (置信度: ${r.confidence}%) → ${cmdPreview}`);
  }

  logger.info('');
  logger.info('💡 请输入序号选择（默认 1），或补充更多信息后重试。');
}

function showLowConfidenceGuidance(
  results: Awaited<ReturnType<typeof recognizeIntent>>,
  input: string
): void {
  logger.warn(`🤔 对"${input}"的识别置信度较低。`);

  if (results.length > 0) {
    logger.info('');
    logger.info('你可能想说的是：');
    for (const r of results.slice(0, 2)) {
      logger.info(`  - ${getIntentLabel(r.intent)} (speccore ${r.command})`);
    }
  }

  logger.info('');
  logger.info('你可以补充更多信息，例如：');
  logger.info('  - "查看项目进度"');
  logger.info('  - "帮我创建一个登录功能"');
  logger.info('  - "审查一下当前任务"');
  logger.info('  - "开始开发"');
}

function getIntentLabel(intent: string): string {
  const labels: Record<string, string> = {
    change: '🔄 需求变更',
    execute: '⚡ 执行开发',
    create: '✨ 创建功能/任务',
    bugfix: '🐛 Bug 修复',
    review: '✅ 审查产出',
    plan: '📐 智能调度',
    reference: '📚 查找参考',
    archive: '📦 归档任务',
    query_progress: '📊 查看进度',
    handover: '📤 生成交接文档',
    health: '🏥 查看健康度',
    config: '⚙️ 配置管理',
    help: '📖 查看帮助',
    demo: '🎮 快速体验',
    welcome: '👋 新手引导',
    init: '🏗️ 项目初始化',
    import: '📥 导入项目',
    research: '🔬 技术调研',
    sync: '🔄 反向同步',
    retro: '📝 期次回顾',
    template_add: '📄 添加模板',
  };
  return labels[intent] || intent;
}
