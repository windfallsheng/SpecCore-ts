/**
 * ask — SpecCore 万能 AI 入口引擎
 * 四种模式：命令解释(explain) / 任务指引(guide) / 意图匹配(match) / 复杂编排(pipeline)
 */

import { logger } from '../utils/logger';
import { recognizeIntent } from './intent-recognition';
import { askWithLlm } from './ask-llm';

// ============================================================
// 类型定义
// ============================================================

/** ask 模式 */
export type AskMode = 'explain' | 'guide' | 'match' | 'pipeline';

/** 命令知识条目 */
export interface CommandKnowledge {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  examples: string[];
  related: string[];
  triggers: string[];
}

/** Pipeline 步骤 */
export interface PipelineStep {
  order: number;
  command: string;
  args: string;
  explanation: string;
  dependsOn?: number;
}

/** Pipeline 计划 */
export interface PipelinePlan {
  steps: PipelineStep[];
  input: string;
  confirm: boolean;
}

/** Ask 结果 */
export interface AskResult {
  mode: AskMode;
  summary: string;
  detail: string;
  commands: string[];
  pipeline?: PipelinePlan;
}

// ============================================================
// 命令知识库
// ============================================================

const COMMAND_KB: CommandKnowledge[] = [
  { name: 'init', aliases: ['in'], description: '初始化 SpecCore 项目，创建 .speccore 目录和配置',
    usage: 'speccore init [--interactive] [--name <name>]', examples: ['speccore init', 'speccore init --name my-project'], related: ['dev', 'config'], triggers: ['初始化', 'init', '开始', '新建项目', '创建项目'] },
  { name: 'doc2spec', aliases: ['d2s'], description: '导入 PRD/Word 文档，AI + Pandoc 双路转换为 SpecCore MD',
    usage: 'speccore doc2spec -f <file> --iter <iteration> [--task <task>] [--no-ai]', examples: ['speccore doc2spec -f PRD.docx --iter Q3', 'speccore doc2spec -f 需求.docx --iter Q2 --task T-01 --no-ai'], related: ['spec2doc', 'analyze'], triggers: ['导入', 'doc2spec', 'word转', '文档转换', 'PRD', '需求文档'] },
  { name: 'spec2doc', aliases: ['s2d'], description: 'SpecCore MD 导出为 Word/PDF/HTML/PPTX',
    usage: 'speccore spec2doc [-i <iteration>] [-t <task>] [-f <format>] [-o <output>]', examples: ['speccore spec2doc -i Q3 -o 需求.docx', 'speccore spec2doc -t T-01 -f html'], related: ['doc2spec'], triggers: ['导出', 'spec2doc', '生成文档', '导出word', '导出pdf'] },
  { name: 'dashboard', aliases: ['db', 'sp'], description: '项目仪表盘：期次状态/进度/健康度，--scope global 全量视图',
    usage: 'speccore dashboard [--scope global|iteration] [--export html] [--health] [--lifecycle]', examples: ['speccore dashboard', 'speccore dashboard --scope global --export html'], related: ['analyze', 'health'], triggers: ['看板', '仪表盘', 'dashboard', '进度', '状态', '全局', '全量'] },
  { name: 'analyze', aliases: ['al'], description: 'AI 统一分析：需求文档+源码→分析报告，--audit 审计模式',
    usage: 'speccore analyze [--task <id>] [--iteration <name>] [--audit]', examples: ['speccore analyze', 'speccore analyze --task T-01 --audit'], related: ['dashboard', 'validate'], triggers: ['分析', 'analyze', '审计', 'audit', '检查'] },
  { name: 'execute', aliases: ['ex'], description: '执行开发任务：依赖排序+分批+交互引导+计划联动',
    usage: 'speccore execute [--task <id>] [--batch-size <n>] [--auto]', examples: ['speccore execute', 'speccore execute --batch-size 3'], related: ['plan', 'done'], triggers: ['执行', 'execute', '开发', '开始做', '干活'] },
  { name: 'plan', aliases: ['pl'], description: '生成执行计划+管理历史：创建/交互/列表/详情/取消',
    usage: 'speccore plan [--all] [--task <id>] [--interactive]', examples: ['speccore plan --all', 'speccore plan --interactive'], related: ['execute', 'schedule'], triggers: ['计划', 'plan', '调度', '安排', '规划'] },
  { name: 'split', aliases: ['sp'], description: '拆分需求为独立 Task：预览→逐一确认/一键创建',
    usage: 'speccore split [-f <file>] [--preview]', examples: ['speccore split -f REQUIREMENT.md', 'speccore split --preview'], related: ['task', 'plan'], triggers: ['拆分', 'split', '分解', '划分', '拆'] },
  { name: 'pr', aliases: ['mr'], description: '创建 Pull Request：提交预览+文件选择+交互确认',
    usage: 'speccore pr [--task <id>] [--auto]', examples: ['speccore pr', 'speccore pr --task T-01 --auto'], related: ['done', 'execute'], triggers: ['pr', 'pull request', '提交', '合并', 'MR'] },
  { name: 'validate', aliases: ['vl'], description: '合规验证：检查 Spec 完整性与一致性',
    usage: 'speccore validate [--iteration <name>]', examples: ['speccore validate', 'speccore validate --iteration Q2'], related: ['analyze', 'audit'], triggers: ['验证', 'validate', '检查', '合规', '校验'] },
  { name: 'sync', aliases: ['sy'], description: '双向同步：代码↔Spec，--global 同步到全局层',
    usage: 'speccore sync [--global] [--iteration <name>]', examples: ['speccore sync', 'speccore sync --global'], related: ['dev'], triggers: ['同步', 'sync', '对齐', '更新'] },
  { name: 'change', aliases: ['ch'], description: '需求变更：联动更新所有关联 Spec，支持口语化输入',
    usage: 'speccore change "<description>" [--task <id>]', examples: ['speccore change "把登录改成验证码登录"', 'speccore change "加上支付功能" --task T-03'], related: ['analyze'], triggers: ['变更', 'change', '修改', '改', '更新需求'] },
  { name: 'done', aliases: ['dn'], description: '收尾归档：校验→同步→审计，--all 批量归档',
    usage: 'speccore done [--task <id>] [--all] [--interactive]', examples: ['speccore done --task T-01', 'speccore done --all'], related: ['execute', 'pr'], triggers: ['完成', 'done', '归档', '结束', '做完'] },
  { name: 'dev', aliases: ['d'], description: '智能级联：--auto 全自动流水线 detect→execute',
    usage: 'speccore dev [--auto] [--from <phase>] [--to <phase>]', examples: ['speccore dev --auto', 'speccore dev --from analyze --to execute'], related: ['execute', 'plan'], triggers: ['dev', '流水线', '自动', '级联'] },
  { name: 'task', aliases: ['tk'], description: '任务管理：创建/列表/状态。子命令: new, list, status',
    usage: 'speccore task new --name <name> [--id <id>] | speccore task list | speccore task status', examples: ['speccore task new --name "用户登录"', 'speccore task list'], related: ['plan', 'execute'], triggers: ['task', '任务', '创建任务', '新建'] },
  { name: 'iteration', aliases: ['it'], description: '期次管理：创建/拆分/列表。子命令: create, split, list',
    usage: 'speccore iteration create -n <name> | speccore iteration split | speccore iteration list', examples: ['speccore iteration create -n Q3', 'speccore iteration list'], related: ['task', 'plan'], triggers: ['期次', 'iteration', '迭代', 'sprint'] },
  { name: 'search', aliases: ['sh'], description: '全文搜索：跨所有 Spec 文件关键词检索',
    usage: 'speccore search <query> [--task <id>] [--iteration <name>]', examples: ['speccore search "登录"', 'speccore search "支付" --iteration Q2'], related: ['track'], triggers: ['搜索', 'search', '查找', '检索', 'grep'] },
  { name: 'track', aliases: ['trk'], description: '合并 trace + tracker: REQ→Task→Code 全链路追踪',
    usage: 'speccore track [--req <id>] [--task <id>] [--full]', examples: ['speccore track --req REQ-001', 'speccore track --full'], related: ['search', 'analyze'], triggers: ['追踪', 'track', 'trace', '链路', '追溯'] },
  { name: 'rename', aliases: ['rn'], description: '重命名期次/任务，自动更新所有关联引用',
    usage: 'speccore rename [--iteration <old> <new>] [--task <old> <new>]', examples: ['speccore rename --iteration Q2 Q3', 'speccore rename --task T-01 T-10'], related: ['sync'], triggers: ['重命名', 'rename', '改名', '更名'] },
];

// ============================================================
// 任务指引 — 预定义工作流
// ============================================================

const WORKFLOWS: Record<string, PipelineStep[]> = {
  'new feature': [
    { order: 1, command: 'init', args: '', explanation: '初始化项目（如果还没有）', dependsOn: undefined },
    { order: 2, command: 'doc2spec', args: '-f PRD.docx --iter {iteration}', explanation: '导入 PRD 文档，AI 分析生成需求规格', dependsOn: 1 },
    { order: 3, command: 'analyze', args: '--iteration {iteration} --audit', explanation: 'AI 分析需求，生成审计报告', dependsOn: 2 },
    { order: 4, command: 'split', args: '-f REQUIREMENT.md', explanation: '将需求拆分为独立开发任务', dependsOn: 3 },
    { order: 5, command: 'plan', args: '--all', explanation: '生成任务执行计划，确定优先级和依赖', dependsOn: 4 },
    { order: 6, command: 'execute', args: '--auto', explanation: '按计划依次执行开发任务', dependsOn: 5 },
    { order: 7, command: 'pr', args: '--auto', explanation: '代码提交后创建 Pull Request', dependsOn: 6 },
    { order: 8, command: 'done', args: '--all', explanation: '全部完成后归档收尾', dependsOn: 7 },
  ],
  'bugfix': [
    { order: 1, command: 'task', args: 'new --name "{bug}" --type bugfix', explanation: '创建 Bug 修复任务', dependsOn: undefined },
    { order: 2, command: 'analyze', args: '--task {task} --audit', explanation: '分析 Bug 影响范围', dependsOn: 1 },
    { order: 3, command: 'execute', args: '--task {task}', explanation: '执行修复', dependsOn: 2 },
    { order: 4, command: 'validate', args: '', explanation: '验证修复完整性', dependsOn: 3 },
    { order: 5, command: 'pr', args: '--task {task}', explanation: '提交修复 PR', dependsOn: 4 },
    { order: 6, command: 'done', args: '--task {task}', explanation: '归档修复记录', dependsOn: 5 },
  ],
  'batch execute': [
    { order: 1, command: 'plan', args: '--all', explanation: '生成所有待执行任务的计划', dependsOn: undefined },
    { order: 2, command: 'schedule', args: 'create --at "{time}" --batch-size {batch}', explanation: '创建定时调度，指定执行时间和批次大小', dependsOn: 1 },
    { order: 3, command: 'execute', args: '--auto --batch-size {batch}', explanation: '按计划分批自动执行', dependsOn: 2 },
  ],
  'code review': [
    { order: 1, command: 'validate', args: '', explanation: '合规检查 Spec 完整性', dependsOn: undefined },
    { order: 2, command: 'analyze', args: '--audit', explanation: '深度审计分析', dependsOn: 1 },
    { order: 3, command: 'pr', args: '--auto', explanation: '生成 PR 审查', dependsOn: 2 },
  ],
};

// ============================================================
// 引擎核心
// ============================================================

/** 判断问句属于哪种模式 */
export function classifyMode(input: string): AskMode {
  const lower = input.toLowerCase();

  // 模式1: 命令解释 — 询问特定命令用法
  const explainPatterns = [
    /(dashboard|dev|init|execute|plan|pr|sync|validate|analyze|split|search|track|rename|doc2spec|spec2doc|ask)\s*(命令|用法|怎么用|是什么|功能|参数|选项)/,
    /怎么用\s*(dashboard|dev|init|execute|plan|pr|sync|validate|analyze|split|search|track)/,
    /(dashboard|dev|init|execute|plan|pr|sync|validate|analyze|split|search|track)\s*有哪些/,
    /解释[一下]?\s*(dashboard|dev|init|execute|plan|pr|sync|validate|analyze|split|search|track)/,
    /(what|how).*use.*(dashboard|dev|init|execute|plan|pr|sync)/i,
  ];
  if (explainPatterns.some(p => p.test(lower))) return 'explain';

  // 模式4: 复杂编排 — 包含多个动作词 + 时序/数量词
  const pipelineKeywords = ['然后', '再', '接着', '最后', '同时', '之后',
    'then', 'after', 'finally', '同时执行', 'pipeline'];
  const actionWords = ['计划', '执行', '分批', '定时', '安排', '调度',
    'plan', 'execute', 'schedule', 'batch'];
  const hasTiming = /晚.*点|早上.*点|明天|今天|后天|下周|周[一到日]|(\d+)[点时]/i.test(lower);
  const hasBatch = /分批|批次|batch|一批|一组/i.test(lower);
  const actionCount = actionWords.filter(w => lower.includes(w)).length;
  const pipelineCount = pipelineKeywords.filter(w => lower.includes(w)).length;
  if ((actionCount >= 2) || (actionCount >= 1 && (hasTiming || hasBatch)) || pipelineCount >= 2) return 'pipeline';

  // 模式2: 任务指引 — 问"怎么做/如何/我想做"
  const guidePatterns = [
    /怎么[做弄搞]/,
    /如何/,
    /步骤/,
    /流程/,
    /从[哪零]开始/,
    /我想[做弄搞]/,
    /帮我[做弄搞]/,
    /how\s+(to|do|can\s+i)/i,
    /什么流程/,
    /需要.*命令/,
  ];
  if (guidePatterns.some(p => p.test(lower))) return 'guide';

  // 默认：意图匹配
  return 'match';
}

/** 匹配命令知识 */
function matchCommandInKB(input: string): CommandKnowledge | null {
  const lower = input.toLowerCase();
  // 精确匹配命令名
  for (const cmd of COMMAND_KB) {
    if (lower.includes(cmd.name)) return cmd;
    for (const alias of cmd.aliases) {
      if (lower.includes(alias) && alias.length > 1) return cmd;
    }
  }
  // 触发词匹配
  let best: CommandKnowledge | null = null;
  let bestScore = 0;
  for (const cmd of COMMAND_KB) {
    const score = cmd.triggers.filter(t => lower.includes(t)).length;
    if (score > bestScore) { bestScore = score; best = cmd; }
  }
  return bestScore > 0 ? best : null;
}

/** 模式1: 命令解释 */
function handleExplain(input: string): AskResult {
  const cmd = matchCommandInKB(input);
  if (!cmd) {
    return { mode: 'explain', summary: '未找到匹配的命令', detail: `没有找到与 "${input}" 相关的命令。请尝试:\n  speccore help — 查看所有命令\n  speccore ask "dashboard 怎么用"`, commands: [] };
  }

  const detail = [
    `📖 ${cmd.name} ${cmd.aliases.length ? '(' + cmd.aliases.join('/') + ')' : ''}`,
    `   描述: ${cmd.description}`,
    `   用法: ${cmd.usage}`,
    ``,
    `   示例:`,
    ...cmd.examples.map(e => `     $ ${e}`),
    ``,
    `   关联命令: ${cmd.related.join(', ')}`,
    ``,
    `💡 更多参数: speccore ${cmd.name} --help`,
  ].join('\n');

  return { mode: 'explain', summary: `${cmd.name} 命令详解`, detail, commands: [cmd.name] };
}

/** 模式2: 任务指引 */
function handleGuide(input: string): AskResult {
  // 匹配工作流
  let matchedWorkflow: PipelineStep[] | null = null;
  let workflowName = '';

  if (/bug|修复|fix|defect/i.test(input)) {
    matchedWorkflow = WORKFLOWS['bugfix'];
    workflowName = 'Bug 修复流程';
  } else if (/审查|review|检查代码|code review/i.test(input)) {
    matchedWorkflow = WORKFLOWS['code review'];
    workflowName = '代码审查流程';
  } else if (/新功能|feature|登录|注册|支付|创建.*功能|做.*功能/i.test(input)) {
    matchedWorkflow = WORKFLOWS['new feature'];
    workflowName = '新功能开发全流程';
  } else if (/批量|分批|batch|队列/i.test(input)) {
    matchedWorkflow = WORKFLOWS['batch execute'];
    workflowName = '批量执行流程';
  } else {
    // 默认：新功能全流程
    matchedWorkflow = WORKFLOWS['new feature'];
    workflowName = '推荐标准开发流程';
  }

  const steps = matchedWorkflow.map(s =>
    `  ${s.order}. speccore ${s.command}${s.args ? ' ' + s.args : ''}` +
    `\n     → ${s.explanation}`
  ).join('\n\n');

  const detail = [
    `🗺️ ${workflowName}`,
    ``,
    steps,
    ``,
    `---`,
    `执行方式:`,
    `  逐步执行: 按顺序手动执行每一步`,
    `  一键执行: speccore dev --auto（自动检测并推进）`,
    `  编排执行: speccore ask "完整描述你的需求" --pipeline`,
  ].join('\n');

  return {
    mode: 'guide',
    summary: `已为你规划「${workflowName}」（${matchedWorkflow.length} 步）`,
    detail,
    commands: matchedWorkflow.map(s => s.command),
    pipeline: { steps: matchedWorkflow, input, confirm: false },
  };
}

/** 模式3: 意图匹配（当前 ask 逻辑） */
async function handleMatch(input: string): Promise<AskResult> {
  // 优先用 KB 精确匹配
  const kbMatch = matchCommandInKB(input);
  
  const results = await recognizeIntent(input);
  const best = results[0];
  
  // 如果 KB 有匹配且置信度高于意图识别，用 KB
  if (kbMatch && (!best || best.confidence < 70)) {
    return { mode: 'match', summary: `✅ 推荐: ${kbMatch.name}`, detail: `🎯 推荐命令: speccore ${kbMatch.name}\n${kbMatch.description}\n\n用法: ${kbMatch.usage}\n\n示例:\n${kbMatch.examples.map(e=>'  $ '+e).join('\n')}`, commands: [kbMatch.name] };
  }
  
  if (results.length === 0) {
    if (kbMatch) {
      return { mode: 'match', summary: `建议使用 ${kbMatch.name}`, detail: `💡 推荐命令: speccore ${kbMatch.name}\n${kbMatch.description}\n\n用法: ${kbMatch.usage}`, commands: [kbMatch.name] };
    }
    return { mode: 'match', summary: '未识别到匹配命令', detail: '我无法完全理解你的意图。试试:\n  speccore help — 查看命令列表\n  或更详细地描述你想做什么', commands: [] };
  }

  const cmdName = kbMatch?.name || best.command || best.intent;
  return {
    mode: 'match',
    summary: `匹配到: ${best.intent} (${best.confidence}%)`,
    detail: kbMatch ? `🎯 推荐命令: speccore ${kbMatch.name}\n${kbMatch.description}\n\n用法: ${kbMatch.usage}` : `🎯 speccore ${cmdName}`,
    commands: [cmdName],
  };
}

/** 模式4: 复杂编排 */
function handlePipeline(input: string): AskResult {
  const lower = input.toLowerCase();

  // 匹配批量执行流程
  if (/计划.*执行|plan.*execute|分批|batch|定时|schedule|晚.*点|早上|几点/.test(lower)) {
    const steps = WORKFLOWS['batch execute'];
    return {
      mode: 'pipeline',
      summary: `已编排「批量执行流程」（${steps.length} 步）`,
      detail: buildPipelineDetail(steps, input),
      commands: steps.map(s => s.command),
      pipeline: { steps, input, confirm: true },
    };
  }

  // 匹配新功能流程
  if (/功能|feature|开发|新.*模块|做.*个/.test(lower)) {
    const steps = WORKFLOWS['new feature'];
    return {
      mode: 'pipeline',
      summary: `已编排「新功能开发流程」（${steps.length} 步）`,
      detail: buildPipelineDetail(steps, input),
      commands: steps.map(s => s.command),
      pipeline: { steps, input, confirm: true },
    };
  }

  // 默认返回 guide
  return handleGuide(input);
}

function buildPipelineDetail(steps: PipelineStep[], input: string): string {
  return [
    `📋 执行计划预览 (来源: "${input}")`,
    ``,
    ...steps.map(s =>
      `  ${s.order}. \x1b[36mspeccore ${s.command}${s.args ? ' ' + s.args : ''}\x1b[0m` +
      (s.dependsOn ? `  ← 依赖步骤 ${s.dependsOn}` : '') +
      `\n     ${s.explanation}`
    ),
    ``,
    `---`,
    `⚠️  请确认后执行。输入 y 确认，或修改参数后重试。`,
  ].join('\n');
}

// ============================================================
// 统一入口
// ============================================================

export async function askEngine(input: string): Promise<AskResult> {
  // ── 第一层: LLM 智能解析 ──
  try {
    const llmResult = await askWithLlm(input);
    if (llmResult && llmResult.commands.length > 0) {
      logger.info(`🧠 AI 识别: ${modeLabel(llmResult.mode as AskMode)}`);
      
      // LLM 结果补充 detail（如果 LLM 没有返回详细内容，用规则引擎补充）
      if (!llmResult.detail || llmResult.detail.length < 20) {
        const enriched = enrichWithRules(llmResult, input);
        return enriched;
      }
      return llmResult;
    }
  } catch (e: any) {
    logger.warn(`LLM 增强失败: ${e.message}，降级到规则引擎`);
  }

  // ── 第二层: 规则引擎兜底 ──
  const mode = classifyMode(input);
  logger.info(`📐 规则识别: ${modeLabel(mode)}`);

  switch (mode) {
    case 'explain': return handleExplain(input);
    case 'guide': return handleGuide(input);
    case 'pipeline': return handlePipeline(input);
    case 'match':
    default: return handleMatch(input);
  }
}

/** 用规则引擎补充 LLM 结果的内容 */
function enrichWithRules(llmResult: AskResult, input: string): AskResult {
  const mode = llmResult.mode as AskMode || 'match';

  switch (mode) {
    case 'explain': {
      const cmd = matchCommandInKB(input);
      if (cmd) {
        return { ...llmResult, detail: buildExplainDetail(cmd) };
      }
      return llmResult;
    }
    case 'guide': {
      const wf = matchWorkflow(input);
      if (wf) {
        return { ...llmResult, detail: buildGuideDetail(wf.name, wf.steps), pipeline: wf.steps.length > 0 ? { steps: wf.steps, input, confirm: false } : undefined };
      }
      return llmResult;
    }
    case 'pipeline': {
      const wf = matchWorkflow(input);
      if (wf) {
        return { ...llmResult, detail: buildPipelineDetail(wf.steps, input), pipeline: { steps: wf.steps, input, confirm: true } };
      }
      return llmResult;
    }
    default:
      return llmResult;
  }
}

function buildExplainDetail(cmd: CommandKnowledge): string {
  return [
    `📖 ${cmd.name} ${cmd.aliases.length ? '(' + cmd.aliases.join('/') + ')' : ''}`,
    `   描述: ${cmd.description}`,
    `   用法: ${cmd.usage}`,
    ``,
    `   示例:`,
    ...cmd.examples.map(e => `     $ ${e}`),
    ``,
    `   关联命令: ${cmd.related.join(', ')}`,
    ``,
    `💡 更多参数: speccore ${cmd.name} --help`,
  ].join('\n');
}

function buildGuideDetail(name: string, steps: PipelineStep[]): string {
  const s = steps.map(s =>
    `  ${s.order}. speccore ${s.command}${s.args ? ' ' + s.args : ''}` +
    `\n     → ${s.explanation}`
  ).join('\n\n');
  return [
    `🗺️ ${name}`,
    ``,
    s,
    ``,
    `---`,
    `执行方式:`,
    `  逐步执行: 按顺序手动执行每一步`,
    `  一键执行: speccore dev --auto（自动检测并推进）`,
    `  编排执行: speccore ask "完整描述你的需求" --pipeline`,
  ].join('\n');
}

function matchWorkflow(input: string): { name: string; steps: PipelineStep[] } | null {
  const lower = input.toLowerCase();
  if (/bug|修复|fix|defect/i.test(lower)) return { name: 'Bug 修复流程', steps: WORKFLOWS['bugfix'] };
  if (/审查|review|检查代码|code review/i.test(lower)) return { name: '代码审查流程', steps: WORKFLOWS['code review'] };
  if (/新功能|feature|登录|注册|支付|创建.*功能|做.*功能/i.test(lower)) return { name: '新功能开发全流程', steps: WORKFLOWS['new feature'] };
  if (/批量|分批|batch|队列|计划.*执行|定时/i.test(lower)) return { name: '批量执行流程', steps: WORKFLOWS['batch execute'] };
  return { name: '推荐标准开发流程', steps: WORKFLOWS['new feature'] };
}

function modeLabel(mode: AskMode): string {
  const labels: Record<AskMode, string> = { explain: '📖 命令解释', guide: '🗺️ 任务指引', match: '🎯 意图匹配', pipeline: '⚡ 复杂编排' };
  return labels[mode];
}

export { COMMAND_KB, WORKFLOWS };
