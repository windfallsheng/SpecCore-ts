/**
 * /ask - 智能入口命令
 * 自然语言意图识别引擎，自动匹配最合适的 SpecCore 命令
 */

import { recognizeIntent, getConfidenceLevel } from '../core/intent-recognition';
import { recognizeWithAi } from '../core/intent-ai';
import { logger } from '../utils/logger';
import { getDefaultIteration, getDefaultAssignee } from '../core/context';

export interface SpecOptions {
  /** 使用模式：识别后的命令执行由 AI 协同完成 */
}

export async function askCommand(input: string, _options: SpecOptions): Promise<void> {
  if (!input || !input.trim()) {
    logger.info('🔍 SpecCore 智能入口');
    logger.info('');
    logger.info('用法: speccore ask "<自然语言描述>"');
    logger.info('');
    logger.info('示例:');
    logger.info('  speccore ask "做一个用户登录功能，支持手机号+密码"');
    logger.info('  speccore ask "修复登录超时问题"');
    logger.info('  speccore ask "查看进度"');
    logger.info('  speccore ask "开始干活"');
    logger.info('  speccore ask "把登录改成验证码登录"');
    logger.info('  speccore ask "审查一下"');
    return;
  }

  logger.info(`🔍 正在理解你的意图...`);
  logger.info('');

  const iteration = await getDefaultIteration();
  const assignee = await getDefaultAssignee();

  const results = await recognizeIntent(input);
  
  // AI 增强：置信度不足时自动调用

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

  // AI 增强：置信度不足时自动调用
  const { final: aiBest, usedAi } = await recognizeWithAi(input, results);
  const best = aiBest || results[0];
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
  // ── 1. 明确告知用户理解了什么 ──
  logger.info('━'.repeat(55));
  logger.info(`✅ 我理解了：你想 **${getIntentLabel(result.intent)}**`);
  logger.info(`   匹配: speccore ${result.command} （置信度 ${result.confidence}%）`);
  logger.info('━'.repeat(55));
  logger.info('');

  const params = result.extractedParams;

  // ── 2. 用自然语言重述用户意图 ──
  const paraphrase = buildParaphrase(result.intent, result.command, params, iteration);
  if (paraphrase) {
    logger.info(`💬 你是说：${paraphrase}`);
    logger.info('');
  }

  // ── 3. 展示将要执行的命令 + 参数说明 ──
  logger.info('📋 将要执行的命令:');
  let cmdPreview = `speccore ${result.command}`;
  if (params.name) cmdPreview += ` -n "${params.name}"`;
  if (params.desc) cmdPreview += ` -d "${params.desc}"`;
  if (params.task) cmdPreview += ` -t "${params.task}"`;
  if (iteration && !params.iteration) cmdPreview += ` -i "${iteration}"`;
  if (params.iteration) cmdPreview += ` -i "${params.iteration}"`;
  logger.info(`   $ ${cmdPreview}`);
  logger.info('');

  // ── 4. 展示后续步骤（如果有关联流程）─
  const nextSteps = getNextStepsForIntent(result.intent, result.command, params, iteration);
  if (nextSteps.length > 0) {
    logger.info('📌 建议的完整流程:');
    let stepNum = 1;
    for (const step of nextSteps) {
      logger.info(`   ${stepNum}. ${step}`);
      stepNum++;
    }
    logger.info('');
  }

  // ── 5. 提示可以马上执行 ──
  logger.info('💡 直接运行上述命令即可开始，或输入更多细节调整参数。');
}

function showMediumConfidenceResults(
  results: Awaited<ReturnType<typeof recognizeIntent>>,
  iteration: string
): void {
  logger.info('🔍 你的输入可能有以下含义，请选择：');
  logger.info('');

  // ── 命令→详细步骤映射 ──
  const stepMap: Record<string, string[]> = {
    init: ['1. speccore init           # 初始化项目，生成 .speccore/'],
    'task new': [
      '1. speccore task new -n "功能名"   # 创建开发任务',
      '2. speccore analyze -t Task-001   # AI 分析需求',
      '3. speccore execute -t Task-001 --force  # 执行开发',
    ],
    execute: [
      '1. speccore execute -t Task-001 --force        # 直接执行',
      '2. speccore execute -t Task-001 --force --verify  # 执行+自动验证',
    ],
    bugfix: [
      '1. speccore bugfix -n "bug描述"              # 单个 Bug',
      '2. speccore bugfix --batch-file=bugs.xlsx --interactive  # 批量导入',
    ],
    change: [
      '1. speccore change "变更描述" -t Task-001        # 口语化变更',
      '2. speccore change -t Task-001 --interactive     # 交互确认',
    ],
    'status-panel': [
      '1. speccore status-panel              # 终端查看',
      '2. speccore status-panel --export=html  # 导出仪表盘',
    ],
    import: [
      '1. speccore import --project=xxx --path=./src --type=backend   # 源码导入',
      '2. speccore import --project=xxx --path=req.xlsx               # Excel导入',
    ],
    'iteration split': [
      '1. speccore analyze -i Q1              # 先分析需求',
      '2. speccore iteration split -i Q1       # 拆分为 Task',
    ],
    pr: [
      '1. speccore pr -t Task-001              # 自动推送+创建PR',
      '2. speccore pr -t Task-001 --interactive  # 分步确认',
    ],
    done: [
      '1. speccore done -t Task-001            # 单个归档',
      '2. speccore done --all -i Q1             # 批量归档',
    ],
    dev: [
      '1. speccore dev                         # 检测下一步',
      '2. speccore dev --auto                  # 全自动流水线',
    ],
  };

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    logger.info(`  ${i + 1}. ${getIntentLabel(r.intent)} (${r.confidence}%) → speccore ${r.command}`);
    
    // 显示详细步骤
    const steps = stepMap[r.command];
    if (steps) {
      for (const step of steps) {
        logger.info(`     ${step}`);
      }
    }
    logger.info('');
  }

  logger.info('💡 输入序号选择（默认 1），输入更多信息重试，或 q 取消');
  logger.info('');
}

function showLowConfidenceGuidance(
  results: Awaited<ReturnType<typeof recognizeIntent>>,
  input: string
): void {
  logger.warn(`🤔 对"${input}"不太确定，以下是可能的匹配：`);
  logger.info('');

  if (results.length > 0) {
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      logger.info(`  ${i + 1}. ${getIntentLabel(r.intent)} → speccore ${r.command}`);
    }
    logger.info('');
  }

  // 引导性提问
  logger.info('你可以换个方式说，比如：');
  logger.info('  "我要开始开发了"          → 自动匹配 execute');
  logger.info('  "帮我看看项目进度"         → 自动匹配 status-panel');
  logger.info('  "创建一个用户登录功能"     → 自动匹配 task new');
  logger.info('  "批量导入这些bug"         → 自动匹配 bugfix');
  logger.info('  "把刚才的需求拆成任务"     → 自动匹配 iteration split');
  logger.info('');
  logger.info('或者直接输入: speccore help  查看所有命令');
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

// ── 自然语言重述 ──
function buildParaphrase(intent: string, cmd: string, params: Record<string, string>, iteration: string): string {
  const name = params.name || '';
  const desc = params.desc || '';
  const task = params.task || '';

  const templates: Record<string, (p: Record<string,string>, i: string) => string> = {
    'task new': (p) => `创建一个新任务"${p.name || ''}"${p.desc ? '，描述：' + p.desc : ''}`,
    'iteration create': (p) => `创建一个新期次"${p.name || ''}"`,
    execute: (p) => p.task ? `执行任务 "${p.task}"` : '执行开发任务',
    bugfix: (p) => p.name ? `修复 Bug："${p.name}"` : p.desc ? `修复问题：${p.desc}` : '修复一个 Bug',
    change: (p) => p.desc ? `把需求改为：${p.desc}` : '',
    import: () => '导入一个存量项目',
    'iteration split': () => '把当前需求拆分成开发任务',
    'status-panel': () => '查看项目进度和状态',
    pr: (p) => p.task ? `为任务 ${p.task} 创建 Pull Request` : '',
    done: (p) => p.task ? `完成任务 ${p.task}` : '',
    analyze: () => '分析需求文档',
    dev: () => '检测项目当前阶段并继续推进',
    validate: () => '检查项目规范性',
  };

  const fn = templates[cmd];
  return fn ? fn(params, iteration) : '';
}

// ── 关联后续步骤 ──
function getNextStepsForIntent(intent: string, cmd: string, params: Record<string, string>, iteration: string): string[] {
  const iter = iteration || 'Q1';
  const task = params.task || 'Task-001';

  const flows: Record<string, string[]> = {
    'iteration create': [
      `speccore doc2spec -f PRD.docx -p backend -i ${iter}   # 导入需求文档`,
      `speccore analyze -i ${iter}                            # AI 分析需求`,
      `speccore iteration split -i ${iter}                    # 拆分为 Task`,
    ],
    'task new': [
      `speccore analyze -t ${task} -i ${iter} --auto          # AI 分析`,
      `speccore execute -t ${task} --force --verify           # 开发 + 验证`,
      `speccore pr -t ${task}                                 # 提 PR`,
      `speccore done -t ${task}                               # 完成归档`,
    ],
    execute: [
      `speccore pr -t ${task}                                 # 代码提 PR`,
      `speccore done -t ${task}                               # 标记完成`,
    ],
    bugfix: [
      `speccore execute -t ${task} --force --verify           # 修复 + 验证`,
      `speccore pr -t ${task}                                 # 提 PR`,
    ],
    'iteration split': [
      `speccore plan -i ${iter}                               # 生成执行计划`,
      `speccore execute --all --force --verify -i ${iter}     # 批量执行`,
    ],
    import: [
      `在 AI IDE 中触发 /spec-import-analyze                   # AI 反工程分析`,
      `speccore analyze -i ${iter}                            # 完善需求`,
      `speccore iteration split -i ${iter}                    # 拆分为 Task`,
    ],
  };

  return flows[cmd] || [];
}
