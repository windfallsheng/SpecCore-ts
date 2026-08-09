/**
 * ask — SpecCore 万能 AI 入口引擎
 * 四种模式：命令解释(explain) / 任务指引(guide) / 意图匹配(match) / 复杂编排(pipeline)
 */

import { logger } from '../utils/logger';
import { recognizeIntent } from './intent-recognition';
import { askWithLlm } from './ask-llm';
import { tryHostAi } from './ask-host-ai';

// ============================================================
// 类型定义
// ============================================================

/** ask 模式 */
export type AskMode = 'explain' | 'guide' | 'match' | 'pipeline' | 'ambiguous';

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
  /** AI 模式下可直接执行的命令（自动而非打印给人） */
  autoExec?: { command: string; args: string; confirm?: boolean };
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
  { name: 'dashboard', aliases: ['db', 'sp'], description: '项目仪表盘：迭代状态/进度/健康度，--scope global 全量视图',
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
    usage: 'speccore task new --name <name> [--id <id>] | speccore task list | speccore task status', examples: ['speccore task new --name "用户登录"', 'speccore task list'], related: ['plan', 'execute'], triggers: ['task', '任务列表', '查看任务', '列出任务'] },
  { name: 'schedule', aliases: ['sc'], description: '定时调度管理：创建/查看/取消/重试/守护进程',
    usage: 'speccore schedule create --at "HH:mm" | speccore schedule list | speccore schedule cancel --id <id>',
    examples: ['speccore schedule list', 'speccore schedule retry --id sch-xxx'],
    related: ['plan', 'execute', 'task'], triggers: ['调度', '定时', 'schedule', '重调度', 'retry', '守护进程', 'daemon', '队列'] },
  { name: 'iteration', aliases: ['it'], description: '迭代管理：创建时自动生成唯一编码（Iteration-001-功能名），支持拆分/列表',
    usage: 'speccore iteration create -n <name> | speccore iteration split | speccore iteration list', examples: ['speccore iteration create -n Q3 → Iteration-001-Q3', 'speccore iteration list'], related: ['task', 'plan'], triggers: ['迭代', 'iteration', '迭代', 'sprint'] },
  { name: 'context', aliases: ['ctx'], description: '查看/设置当前上下文：迭代、任务、阶段',
    usage: 'speccore context [--set --iteration <name>] [--list]', examples: ['speccore context --list', 'speccore context --set --iteration Q1'], related: ['dashboard', 'dev'], triggers: ['切换', '上下文', 'context', '当前.*迭代', '设置.*迭代', '换到', '切换到'] },
  { name: 'search', aliases: ['sh'], description: '全文搜索：跨所有 Spec 文件关键词检索',
    usage: 'speccore search <query> [--task <id>] [--iteration <name>]', examples: ['speccore search "登录"', 'speccore search "支付" --iteration Q2'], related: ['track'], triggers: ['搜索', 'search', '查找', '检索', 'grep'] },
  { name: 'track', aliases: ['trk'], description: '合并 trace + tracker: REQ→Task→Code 全链路追踪',
    usage: 'speccore track [--req <id>] [--task <id>] [--full]', examples: ['speccore track --req REQ-001', 'speccore track --full'], related: ['search', 'analyze'], triggers: ['追踪', 'track', 'trace', '链路', '追溯'] },
  { name: 'rename', aliases: ['rn'], description: '重命名迭代/任务，自动更新所有关联引用',
    usage: 'speccore rename [--iteration <old> <new>] [--task <old> <new>]', examples: ['speccore rename --iteration Q2 Q3', 'speccore rename --task T-01 T-10'], related: ['sync'], triggers: ['重命名', 'rename', '改名', '更名'] },
  { name: 'task-create', aliases: ['tc'], description: '创建任务：交互式需求澄清 → 生成 REQUIREMENT.md',
    usage: '激活 spec-task-create Skill', examples: ['创建一个bug任务', '新建修复登录问题的任务'], related: ['analyze', 'execute'], triggers: ['创建.*任务', '新建.*任务', '建.*bug', '新增.*任务', '帮我写.*需求', '记录.*bug', '创建.*审查', '创建.*测试', '创建.*文档', '创建.*部署', '创建.*重构', '创建.*安全', '创建.*性能'] },
  { name: 'iteration-create', aliases: ['ic'], description: '创建迭代：智能命名 + 平台检查',
    usage: '激活 spec-iteration-create Skill', examples: ['创建一个新迭代', '创建Q2迭代'], related: ['init', 'doc2spec'], triggers: ['创建.*迭代', '新建.*迭代', '生成.*迭代', '迭代.*新建', '开始.*迭代'] },
];

// ============================================================
// 任务指引 — 预定义工作流
// ============================================================

/** 工作流阶段顺序：不管用户口述顺序如何，匹配到的命令都按此逻辑顺序排列 */
const PHASE_ORDER: Record<string, number> = {
  init: 0, doc2spec: 1, task: 2, analyze: 3, split: 4, plan: 5,
  execute: 6, pr: 7, done: 8, spec2doc: 9, validate: 10,
  dashboard: 99, context: 99, config: 99,
};

/** 对匹配到的命令按工作流逻辑顺序重排 */
function reorderCommands(commands: string[]): string[] {
  return [...commands].sort((a, b) => (PHASE_ORDER[a] ?? 50) - (PHASE_ORDER[b] ?? 50));
}

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
    { order: 2, command: 'analyze', args: '--prompt --task {task}', explanation: '分析 Bug 根因和影响范围', dependsOn: 1 },
    { order: 3, command: 'plan', args: '--prompt --task {task}', explanation: '生成修复方案和排程', dependsOn: 2 },
    { order: 4, command: 'execute', args: '--prompt --task {task}', explanation: '按方案执行修复', dependsOn: 3 },
    { order: 5, command: 'validate', args: '', explanation: '验证修复完整性', dependsOn: 4 },
    { order: 6, command: 'pr', args: '--task {task}', explanation: '提交修复 PR', dependsOn: 5 },
    { order: 7, command: 'done', args: '--task {task}', explanation: '归档修复记录', dependsOn: 6 },
  ],
  'batch execute': [
    { order: 1, command: 'plan', args: '--select', explanation: '列出所有可执行任务（编号 + CLI命令），用户多选', dependsOn: undefined },
    { order: 2, command: 'schedule', args: 'create --at "{time}" --batch-size {batch}', explanation: '创建定时调度', dependsOn: 1 },
  ],
  'analyze plan schedule': [
    { order: 1, command: 'analyze', args: '--prompt --task {task}', explanation: 'AI 分析任务需求（立即执行）', dependsOn: undefined },
    { order: 2, command: 'plan', args: '--prompt --all', explanation: 'AI 制定执行计划（立即执行）', dependsOn: 1 },
    { order: 3, command: 'schedule', args: 'create --at "{time}" --batch-size {batch}', explanation: '创建定时调度', dependsOn: 2 },
  ],
  'batch execute auto': [
    { order: 1, command: 'plan', args: '--all', explanation: '生成全部任务计划', dependsOn: undefined },
    { order: 2, command: 'schedule', args: 'create --at "{time}" --batch-size {batch}', explanation: '创建定时调度', dependsOn: 1 },
    { order: 3, command: 'schedule', args: 'daemon start', explanation: '启动调度守护进程', dependsOn: 2 },
    { order: 4, command: 'execute', args: '--auto --batch-size {batch}', explanation: '按计划分批自动执行', dependsOn: 2 },
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
  const hasBugfix = /bug|修复|fix|defect/i.test(lower);
  const actionCount = actionWords.filter(w => lower.includes(w)).length;
  const pipelineCount = pipelineKeywords.filter(w => lower.includes(w)).length;
  if ((actionCount >= 2) || (actionCount >= 1 && (hasTiming || hasBatch)) || pipelineCount >= 2 || hasBugfix) return 'pipeline';

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
  } else if (/审查|review|代码检查|code review|检查.*代码/i.test(input)) {
    matchedWorkflow = WORKFLOWS['code review'];
    workflowName = '代码审查流程';
  } else if (/测试|test|写.*用例|补充.*测试/i.test(input)) {
    return {
      mode: 'match',
      summary: '建议创建测试任务',
      detail: '📋 建议: speccore ask "创建一个测试任务" 来生成测试计划',
      commands: ['task-create'],
    };
  } else if (/文档|docs|写.*文档|补.*文档/i.test(input)) {
    return {
      mode: 'match',
      summary: '建议创建文档任务',
      detail: '📋 建议: speccore ask "创建一个文档任务" 来补充文档',
      commands: ['task-create'],
    };
  } else if (/重构|refactor|优化.*代码|整理.*代码/i.test(input)) {
    return {
      mode: 'match',
      summary: '建议创建重构任务',
      detail: '📋 建议: speccore ask "创建一个重构任务" 来优化代码结构',
      commands: ['task-create'],
    };
  } else if (/部署|deploy|发布|上线/i.test(input)) {
    return {
      mode: 'match',
      summary: '建议创建部署任务',
      detail: '📋 建议: speccore ask "创建一个部署任务" 来准备发布',
      commands: ['task-create'],
    };
  } else if (/安全|security|漏洞|审计/i.test(input)) {
    return {
      mode: 'match',
      summary: '建议创建安全审计任务',
      detail: '📋 建议: speccore ask "创建一个安全审计任务"',
      commands: ['task-create'],
    };
  } else if (/性能|performance|优化.*速度|慢/i.test(input)) {
    return {
      mode: 'match',
      summary: '建议创建性能优化任务',
      detail: '📋 建议: speccore ask "创建一个性能优化任务"',
      commands: ['task-create'],
    };
  } else if (/新功能|feature|登录|注册|支付|创建.*功能|做.*功能/i.test(input)) {
    matchedWorkflow = WORKFLOWS['new feature'];
    workflowName = '新功能开发全流程';
  } else if (/先分析.*[再然后].*[计划列计划规划]|分析.*任务.*列.*[计划规划]|分析.*再.*执行/i.test(input)) {
    matchedWorkflow = WORKFLOWS['analyze plan schedule execute'];
    workflowName = '分析 → 计划 → 定时执行流程';
  } else if (/批量|分批|batch|队列/i.test(input)) {
    matchedWorkflow = WORKFLOWS['batch execute'];
    workflowName = '批量执行流程';
  } else if (/创建.*迭代创建.*迭代/i.test(input)) {
    // 不应该进 guide 模式——让调用方降级到 match
    throw new Error('FALLBACK_TO_MATCH');
  } else {
    // 无匹配工作流 → 抛出，由 askEngine 降级到 handleMatch
    throw new Error('FALLBACK_TO_MATCH');
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

  const firstStep = matchedWorkflow[0];
  return {
    mode: 'guide',
    summary: `已为你规划「${workflowName}」（${matchedWorkflow.length} 步）`,
    detail,
    commands: matchedWorkflow.map(s => s.command),
    pipeline: { steps: matchedWorkflow, input, confirm: false },
    autoExec: firstStep ? {
      command: firstStep.command,
      args: (firstStep.args || '').replace(/\{(iteration|task|bug|name)\}/g, input.substring(0, 30)),
      confirm: true,
    } : undefined,
  };
}

/** 模式3: 意图匹配（当前 ask 逻辑） */
async function handleMatch(input: string): Promise<AskResult> {
  // 优先用 KB 精确匹配
  const kbMatch = matchCommandInKB(input);
  
  const results = await recognizeIntent(input);
  const best = results[0];
  
  // 如果 KB 有匹配且置信度高于意图识别，用 KB（但要整合意图识别的参数）
  if (kbMatch && (!best || best.confidence < 70)) {
    const params = best?.extractedParams || {};
    let fullCommand = `speccore ${kbMatch.name}`;
    const paramNotes: string[] = [];
    if (params.tool) { fullCommand += ` --tool="${params.tool}"`; paramNotes.push(`🔧 平台: ${params.tool}`); }
    if (params.name) { fullCommand += ` -n "${params.name}"`; paramNotes.push(`📛 名称: ${params.name}`); }
    if (params.iteration) { fullCommand += ` --iter "${params.iteration}"`; paramNotes.push(`🔄 迭代: ${params.iteration}`); }
    
    let detail = `🎯 推荐命令: ${fullCommand}\n${kbMatch.description}\n\n用法: ${kbMatch.usage}`;
    if (paramNotes.length > 0) detail += `\n\n${paramNotes.join('\n')}`;
    detail += '\n\n⚠️  请确认后执行以上命令。';
    
    return { mode: 'match', summary: `✅ 推荐: ${fullCommand}`, detail, commands: [kbMatch.name] };
  }
  
  if (results.length === 0) {
    if (kbMatch) {
      return { mode: 'match', summary: `建议使用 ${kbMatch.name}`, detail: `💡 推荐命令: speccore ${kbMatch.name}\n${kbMatch.description}\n\n用法: ${kbMatch.usage}`, commands: [kbMatch.name] };
    }
    return { mode: 'match', summary: '未识别到匹配命令', detail: '我无法完全理解你的意图。试试:\n  speccore help — 查看命令列表\n  或更详细地描述你想做什么', commands: [] };
  }

  // ── 低置信度拒绝 ──
  if (best.confidence < 45) {
    return {
      mode: 'match',
      summary: '置信度过低',
      detail: `⚠️ 未找到高置信度匹配 (最高: ${best.intent} ${best.confidence}%)\n\n请重新描述你的需求，或使用 speccore help 查看可用命令。`,
      commands: [],
    };
  }

  // ── 歧义检测: 第二候选与第一差距 < 15% ──
  const second = results[1];
  if (second && (best.confidence - second.confidence) < 15) {
    const candidates = results.slice(0, 4);
    const lines = ['🤔 检测到多个可能意图，请选择:', ''];
    candidates.forEach((r, i) => {
      lines.push(`[${i + 1}] ${r.intent} (${r.confidence}%) — speccore ${r.command}`);
    });
    lines.push('');
    lines.push('输入编号选择，或重新描述你的需求。');
    return {
      mode: 'ambiguous',
      summary: `歧义: ${candidates.map(c => c.intent).join(' vs ')}`,
      detail: lines.join('\n'),
      commands: candidates.map(c => c.command),
    };
  }
  const params = best.extractedParams;
  let fullCommand: string;
  const paramNotes: string[] = [];

  // task-create / iteration-create 需要子命令
  if (best.intent === 'task-create') {
    const name = params.name || params.desc || input.slice(0, 30);
    fullCommand = `speccore task new -n "${name}"`;
  } else if (best.intent === 'iteration-create') {
    const name = params.name || input.slice(0, 20);
    fullCommand = `speccore iteration create -n "${name}"`;
  } else {
    fullCommand = `speccore ${best.command}`;
    if (params.name) fullCommand += ` -n "${params.name}"`;
    if (params.iteration) fullCommand += ` --iter "${params.iteration}"`;
    if (params.tool) {
      fullCommand += ` --tool="${params.tool}"`;
      paramNotes.push(`🔧 工具/平台: ${params.tool}`);
    }
    if (params.desc) {
      fullCommand += ` "${params.desc}"`;
      paramNotes.push(`📝 描述: ${params.desc}`);
    }
  }
  if (params.target) paramNotes.push(`🎯 目标: ${params.target}`);

  // 构建详细输出
  const detailLines: string[] = [];
  detailLines.push(`🎯 识别意图: ${best.intent} (置信度: ${best.confidence}%)`);
  detailLines.push('');
  detailLines.push(`📋 执行命令:`);
  detailLines.push(`  ${fullCommand}`);
  detailLines.push('');

  // 显示匹配到的关键词
  if (best.matchedTriggers.length > 0) {
    detailLines.push(`🔑 匹配关键词: ${best.matchedTriggers.map(t => t.replace(/.*"([^"]+)".*/, '$1')).join(', ')}`);
    detailLines.push('');
  }

  // 显示参数说明
  if (paramNotes.length > 0) {
    detailLines.push(...paramNotes);
    detailLines.push('');
  }

  // 备选意图
  if (results.length > 1) {
    detailLines.push('💡 备选意图:');
    for (const r of results.slice(1, 4)) {
      detailLines.push(`  • ${r.intent} (${r.confidence}%) — speccore ${r.command}`);
    }
    detailLines.push('');
  }

  // 确认提示
  detailLines.push('⚠️  请确认后执行以上命令。');
  detailLines.push('  输入 y/回车 确认，或修改参数后重新输入。');

  const detail = `[SPECCORE_MODE: match]\n${detailLines.join('\n')}`;

  return {
    mode: 'match',
    summary: `匹配到: ${best.intent} (${best.confidence}%) → ${fullCommand}`,
    detail,
    commands: [best.command],
    autoExec: best.confidence >= 70 ? {
      command: fullCommand.replace(/^speccore /, '').split(' ')[0],  // 主命令
      args: fullCommand.replace(/^speccore [a-z-]+ /, ''),           // 子命令 + 参数
      confirm: true,
    } : undefined,
  };
}

/** 模式4: 复杂编排 */
function handlePipeline(input: string): AskResult {
  const lower = input.toLowerCase();

  // 辅助函数：从输入提取模板变量
  const fillTemplate = (tmpl: string) => tmpl.replace(/\{(\w+)\}/g, (_: string, k: string) => {
    if (k === 'time') return extractTime(input);
    if (k === 'iteration') {
      const m = input.match(/Iteration[- ]?\S+|Q\d+|sample/i);
      return m ? m[0].replace(/^Iteration[- ]?/, '') : '';
    }
    if (k === 'batch') { const m = input.match(/(\d+)[批次个]/); return m ? m[1] : '5'; }
    if (k === 'task') {
      const tm = input.match(/(?:任务|Task)\s*(\d+[,.，、\s]*\d*)/i);
      return tm ? tm[1] : '';
    }
    if (k === 'bug' || k === 'name') return input.replace(/\s+/g, '-').slice(0, 30);
    return '';
  });

  // ── 意图得分系统（替代硬关键词匹配，模拟语义理解）──
  // 得分 = 维度加权，而非单关键词触发
  const scores = {
    batchExec: 0,
    newFeature: 0,
    auto: 0,
  };

  // 维度1: 动作词
  const actionWords: [RegExp, number, keyof typeof scores][] = [
    [/(?:定时|指定时间|几点|晚.*点|早上.*点|明天.*点|到.*点|时间.*执行)/, 40, 'batchExec'],
    [/(?:分批|批次|batch|分.*批|多个)|(\d+[\s]*(?:个|批次|任务))/, 30, 'batchExec'],
    [/(?:执行|跑|运行|execute|run)/, 10, 'batchExec'],
    [/(?:实现|动手|做|开发|feature|新.*功能|新.*模块)/, 40, 'newFeature'],
    [/(?:自主|自动|一键|不用确认|直接|全部.*执行|全自动)/, 30, 'auto'],
  ];
  for (const [re, wt, key] of actionWords) {
    if (re.test(lower)) scores[key] += wt;
  }

  // 维度2: 上下文词（得分加权）
  if (/计划|plan|安排|排程|规划/.test(lower)) scores.batchExec += 20;
  if (/任务|task|代码审查|review|测试|test/.test(lower)) scores.batchExec += 15;
  if (/所有|全部|都|each|every|all/.test(lower)) scores.auto += 20;
  if (/先看|先列|先.*看|预览|看看|再说|然后|再.*执行/.test(lower)) scores.auto -= 30; // 说明想要交互

  // 维度3: 复杂度 — 只要有一点不确定，必须确认
  // 触发复杂度 = 任何多步骤/定时/多任务/审查/修改 的信号
  const isComplex = (
    // 计划+执行 组合
    (/计划|plan|安排|排程/.test(lower) && /执行|跑|execute/.test(lower)) ||
    // 时间调度
    /定时|指定时间|几点|晚.*点|早上.*点|明天.*点|到.*点|稍后|一会/.test(lower) ||
    // 审查/测试/安全 任务
    (/代码|审查|review|安全|audit|测试|test/.test(lower) && (/任务|task|个|全部|所有/.test(lower))) ||
    // 多任务批量
    /全部.*任务|所有.*任务|batch|分批|批量|多个.*任务/.test(lower) ||
    // 用户明确说自主/自动——仍是复杂，只是确认后全自动
    /自主|自动|一键|全自动/.test(lower) ||
    // 多步骤连接词
    /然后|接着|再|之后|完了|最后|同时|并且|也|还.要/.test(lower) ||
    // 修改/变更类
    /修改|变更|改|调整|change/.test(lower) ||
    // 不确定性: 用户说"看看"/"试试"
    /看看|试一下|怎么.*弄|帮.*看|不确定/.test(lower)
  );
  // 简单任务 = 纯单一命令，长度短，无任何复杂信号
  const isSimple = !isComplex && lower.length < 40 && !/计划|安排|然后|再|同时|并且|也|还/.test(lower);

  // 维度4: 否定词减分
  if (/别|不要|不.*执行|先别|取消/.test(lower)) { scores.batchExec = 0; scores.auto = 0; }

  // 判断：batchExec 最高 → 批量流程
  const hasAuto = scores.auto > 0;
  // auto 模式 ≠ 跳过确认，auto = 确认后全自动执行步骤
  // 只有简单任务才真正跳过确认
  const needConfirm = !isSimple;
  if (scores.batchExec >= 40) {
    // 如果用户要"先分析再计划" → 用 analyze+plan+schedule 模板
    const hasAnalyzeFirst = /先.*分析|分析.*[再然后]|analyze.*plan/i.test(input);
    const wfName = hasAnalyzeFirst ? 'analyze plan schedule execute' :
                   hasAuto ? 'batch execute auto' : 'batch execute';
    const steps = WORKFLOWS[wfName];
    const firstStep = steps[0];
    return {
      mode: 'pipeline',
      summary: isSimple ? '✅ 直接执行' :
               hasAuto ? '🤖 自主执行（确认后全自动）' :
               '📋 需要确认后再执行',
      detail: buildPipelineDetail(steps, input),
      commands: steps.map(s => s.command),
      pipeline: { steps, input, confirm: needConfirm },
    };
  }

  // 匹配新功能流程（得分系统）
  if (scores.newFeature >= 40) {
    const steps = WORKFLOWS['new feature'];
    const firstStep = steps[0]; // 'init'
    return {
      mode: 'pipeline',
      summary: `已编排「新功能开发流程」（${steps.length} 步）`,
      detail: buildPipelineDetail(steps, input),
      commands: steps.map(s => s.command),
      pipeline: { steps, input, confirm: true },
      autoExec: firstStep ? {
        command: firstStep.command,
        args: fillTemplate(firstStep.args || ''),
        confirm: true,
      } : undefined,
    };
  }

  // 默认返回 guide
  return handleGuide(input);
}

function buildPipelineDetail(steps: PipelineStep[], input: string): string {
  // fill template placeholders
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_: string, k: string) => {
    if (k === 'time') return extractTime(input);
    if (k === 'batch') { const m = input.match(/(\d+)[批次个]/); return m ? m[1] : '5'; }
    if (k === 'iteration') {
      const m = input.match(/Iteration[- ]?\S+|Q\d+|sample/i);
      return m ? m[0].replace(/^Iteration[- ]?/, '') : '';
    }
    if (k === 'task') {
      const tm = input.match(/(?:任务|Task)\s*(\d+[,.，、\s]*\d*)/i);
      return tm ? tm[1] : '';
    }
    return '';
  });

  const filledSteps = steps.map(s => ({ ...s, args: s.args ? fill(s.args) : '' }));
  // 判断: 第一步是 task new → 只执行创建，其余为建议
  const isTaskCreation = filledSteps[0]?.command === 'task' && filledSteps[0]?.args?.includes('new');

  if (isTaskCreation && filledSteps.length > 1) {
    const immediate = filledSteps[0];
    const recommended = filledSteps.slice(1);
    const lines = [
      `📋 执行计划 (来源: "${input}")`,
      ``,
      `▶ 立即执行:`,
      `  speccore ${immediate.command}${immediate.args ? ' ' + immediate.args : ''}`,
      `     ${immediate.explanation}`,
      ``,
      `💡 创建完成后，建议按以下顺序操作:`,
      ...recommended.map((s, i) =>
        `  ${i + 1}. speccore ${s.command}${s.args ? ' ' + s.args : ''} — ${s.explanation}`
      ),
      ``,
      `⚠️ 后续步骤不会自动执行，需手动确认每一步。`,
      ``,
      `---`,
      `是否创建任务？[是/修改/取消]`,
    ];
    return lines.join('\n');
  }

  // 其他工作流: 完整展示
  return [
    `📋 执行计划 (来源: "${input}")`,
    ``,
    ...filledSteps.map(s =>
      `  ${s.order}. speccore ${s.command}${s.args ? ' ' + s.args : ''}` +
      (s.dependsOn ? `  ← 依赖步骤 ${s.dependsOn}` : '') +
      `\n     ${s.explanation}`
    ),
    ``,
    `---`,
    `⚠️  请确认后执行。`,
  ].join('\n');
}

// ============================================================
// 统一入口
// ============================================================

/**
 * 理解用户意图并自我检查
 * 返回结构化分析：AI理解了什么？命令匹配度？是否有遗漏？
 */
export interface IntentUnderstanding {
  /** AI 理解的用户意图摘要 */
  what: string;
  /** 匹配到的命令列表 */
  commands: string[];
  /** 置信度 (0-100) */
  confidence: number;
  /** 是否有分歧/不确定的地方 */
  gaps: string[];
  /** 是否应该进入确认流程 */
  needsConfirm: boolean;
  /** 来源：llm/host/rules */
  source: string;
}

export async function understandIntent(input: string): Promise<IntentUnderstanding & { result: AskResult }> {
  const result = await askEngine(input);
  // 按工作流逻辑顺序重排——不管用户口述顺序如何
  result.commands = reorderCommands(result.commands);
  const gaps: string[] = [];
  let confidence = 0;
  let source = 'rules';

  // 1. 命令验证：检查返回的命令是否都在 KB 中
  const validCommands = new Set(COMMAND_KB.map(c => c.name));
  const unknownCmds = result.commands.filter(c => !validCommands.has(c));
  if (unknownCmds.length > 0) {
    gaps.push(`未知命令: ${unknownCmds.join(', ')}`);
    confidence -= 20;
  }

  // 2. 来源可信度
  if (result.detail?.length > 100) confidence += 30; // 有详细解释
  if (result.commands.length > 0) confidence += 30;  // 有命令
  if (result.mode === 'pipeline') confidence += 20;   // 流程模式
  if (result.mode === 'match') confidence += 10;      // 直接匹配
  if (result.mode === 'ambiguous') { confidence -= 30; gaps.push('意图不明确'); }
  if (result.mode === 'explain') confidence += 15;    // 帮助模式

  // 3. LLM 来源加分
  if ((result as any)._source === 'llm') { confidence += 25; source = 'llm'; }
  else if ((result as any)._source === 'host') { confidence += 15; source = 'host'; }
  else { confidence += 5; source = 'rules'; }

  // 4. 命令覆盖率检查：是否有关联命令被遗漏？
  if (result.commands.length > 0) {
    const primary = result.commands[0];
    const kbEntry = COMMAND_KB.find(c => c.name === primary);
    if (kbEntry?.related) {
      const related = kbEntry.related.filter(r => !result.commands.includes(r));
      if (related.length > 0) {
        gaps.push(`建议补充: ${related.join(', ')}（通常与 ${primary} 配合使用）`);
      }
    }
  }

  // 5. 多步骤检查：如果输入含多步骤但只有一个命令
  if (/然后|再|之后|接着|最后|同时|并且/.test(input) && result.commands.length === 1) {
    gaps.push('用户描述了多个步骤但只匹配到一个命令，可能遗漏');
    confidence -= 15;
  }

  // 6. 时间检查：如果输入含时间但没有 schedule 命令
  if (/几点|晚.*点|早上|明天|定时|稍后/.test(input) && !result.commands.includes('schedule')) {
    gaps.push('提到了时间但未生成 schedule 命令');
    confidence -= 15;
  }

  confidence = Math.max(0, Math.min(100, confidence));
  const needsConfirm = confidence < 80 || gaps.length > 0 || (result.pipeline?.confirm !== false);

  return {
    what: result.summary || `匹配到 ${result.commands.join(' → ')}`,
    commands: result.commands,
    confidence,
    gaps,
    needsConfirm,
    source,
    result,
  };
}

/**
 * 🧠 SynthesizeIntent — 智能意图合成层
 * 
 * 理解 → 参数提取 → 上下文补全 → 命令匹配 → 自检纠错 → 仅模糊点时确认
 * 
 * 核心原则:
 *   - AI 能自己推断的，不打扰用户
 *   - 缺了参数但能从上下文补的，自动补上并告诉用户
 *   - 只有真正歧义的才和用户确认
 */
export interface SynthesizedIntent {
  /** AI 理解 */
  what: string;
  /** 来源 */
  source: string;
  /** 最终理解的结果（含理解说明） */
  result: AskResult;
  /** AI 自动补充的内容 */
  autoFilled: { field: string; value: string; reason: string }[];
  /** 无法确定、需要用户澄清的问题 */
  questions: string[];
  /** 是否需要用户确认 */
  needsConfirm: boolean;
  /** 置信度 0-100 */
  confidence: number;
  /** 最终将执行的完整命令列表 */
  finalCommands: { command: string; args: string; explanation: string }[];
}

export async function synthesizeIntent(input: string): Promise<SynthesizedIntent> {
  const { result, commands, confidence: baseConf, gaps, source } = await understandIntent(input);
  const autoFilled: SynthesizedIntent['autoFilled'] = [];
  const questions: string[] = [];
  let confidence = baseConf;

  // ═══ 1. 参数提取 ═══
  // 从输入中提取所有可识别参数
  const parsed: Record<string, string> = {};
  
  // 时间
  const timeVal = extractTime(input);
  if (timeVal && timeVal !== new Date().toISOString().slice(0, 19).replace('T', ' ')) {
    parsed.time = timeVal;
  }
  // 任务类型
  const typeMap: Record<string, string> = {
    'bug': 'bugfix', '缺陷': 'bugfix', '修复': 'bugfix', 'review': 'review',
    '审查': 'review', '代码审查': 'review', '测试': 'test', 'test': 'test',
    '安全': 'security', 'security': 'security', '文档': 'docs', 'docs': 'docs',
    '重构': 'refactor', 'refactor': 'refactor', '部署': 'deploy', 'deploy': 'deploy',
    '性能': 'performance', 'performance': 'performance',
  };
  for (const [kw, type] of Object.entries(typeMap)) {
    if (input.includes(kw)) { parsed.type = type; break; }
  }
  // 优先级
  if (/高优|紧急|urgent|critical/.test(input)) parsed.priority = 'high';
  else if (/低优|low/.test(input)) parsed.priority = 'low';
  // 批次
  const batchMatch = input.match(/(\d+)\s*(?:批次|个|任务)/);
  if (batchMatch) parsed.batch = batchMatch[1];
  // 平台
  if (/后端|backend/.test(input)) parsed.platform = 'backend';
  else if (/前端|frontend/.test(input)) parsed.platform = 'frontend';
  else if (/小程序|miniapp/.test(input)) parsed.platform = 'miniapp';
  // 任务名
  const nameMatch = input.match(/(?:创建|新建|做一个?)\s*(?:一个?\s*)?["""]([^"]+)["'']/);
  if (!nameMatch) {
    const alt = input.match(/(?:创建|新建|做一个?)\s*(?:一个?\s*)?(\S{2,20}(?:功能|任务|模块|页面))/);
    if (alt) parsed.name = alt[1];
  } else parsed.name = nameMatch[1];

  // ═══ 2. 上下文补全 ═══
  try {
    const { getDefaultIteration } = await import('./context');
    const iter = await getDefaultIteration();
    if (iter && !parsed.iteration) {
      parsed.iteration = iter;
      autoFilled.push({ field: 'iteration', value: iter, reason: '从当前上下文自动补全迭代' });
      confidence += 5;
    }
  } catch {}

  // 批次默认值
  if (!parsed.batch && commands.includes('execute')) {
    parsed.batch = '5';
    autoFilled.push({ field: 'batch', value: '5', reason: '默认批次大小' });
  }

  // ═══ 3. 命令增强（自动补充缺失步骤） ═══
  const finalCommands: SynthesizedIntent['finalCommands'] = [];
  
  for (const cmd of commands) {
    let args = '';
    let explanation = '';
    
    switch (cmd) {
      case 'plan':
        args = parsed.iteration ? `-I ${parsed.iteration}` : '--all';
        explanation = '生成执行计划';
        break;
      case 'schedule':
        if (commands.length > 1) {
          args = parsed.time ? `create --at "${parsed.time}"` : 'create';
          if (parsed.batch) args += ` --batch-size ${parsed.batch}`;
          explanation = parsed.time ? `创建定时调度 @ ${parsed.time}` : '创建调度';
        }
        break;
      case 'task':
        args = 'new';
        if (parsed.name) args += ` -n "${parsed.name}"`;
        if (parsed.type) { args += ` --type ${parsed.type}`; autoFilled.push({ field: 'type', value: parsed.type, reason: '从输入中识别任务类型' }); }
        if (parsed.priority) args += ` --priority ${parsed.priority}`;
        explanation = parsed.name ? `创建任务: ${parsed.name}` : '创建任务';
        break;
      case 'execute':
        args = parsed.iteration ? `-I ${parsed.iteration}` : '';
        if (parsed.batch) args += ` --batch-size ${parsed.batch}`;
        args += ' --auto --force';
        explanation = '自动执行任务';
        break;
      case 'analyze':
        args = parsed.iteration ? `-I ${parsed.iteration}` : '';
        if (parsed.type) args += ` --type ${parsed.type}`;
        explanation = parsed.type ? `深度分析(${parsed.type})` : '深度分析';
        break;
      case 'validate':
        args = parsed.iteration ? `--iteration=${parsed.iteration}` : '';
        explanation = '合规检查';
        break;
      default:
        explanation = '执行命令';
    }
    
    if (cmd === 'schedule') {
      // schedule 可能有两个子命令：create 和 daemon start
      if (args.includes('create')) {
        finalCommands.push({ command: 'schedule', args, explanation });
        finalCommands.push({ command: 'schedule', args: 'daemon start', explanation: '启动守护进程（自动）' });
        autoFilled.push({ field: 'daemon', value: 'auto-start', reason: '创建调度后自动启动守护进程' });
      }
    } else {
      finalCommands.push({ command: cmd, args, explanation });
    }
  }

  // ═══ 4. 自检：补全后还有遗漏吗？ ═══
  // 有执行但没有 schedule → 不需要定时
  if (commands.includes('execute') && !commands.includes('schedule')) {
    // 这是直接执行，用户没说定时，不补 schedule
  }
  
  // 有任务名但没 type → 可继续（类型默认 feature）
  if (parsed.name && !parsed.type) {
    // 不追问，类型默认即可
  }

  // ═══ 5. 是否真需要确认？ ═══
  // 只有这些情况才需要：
  //  a) AI 理解不清楚（gaps 非空）
  //  b) 置信度低于阈值
  //  c) 参数严重缺失（如无任务名就创建任务）
  // 否则 AI 自主补全后直接执行
  const isProblematic = gaps.length > 0 || confidence < 70;
  
  // 关键参数缺失 → 提问
  if (commands.includes('task') && !parsed.name && !parsed.type) {
    questions.push('请描述你要创建的任务类型和名称（如：创建一个登录功能的bug修复任务）');
  }
  if (commands.includes('schedule') && !parsed.time) {
    questions.push('请指定执行时间（如：晚上10点）');
  }

  const finalConf = confidence + autoFilled.length * 5; // 自动补全加分
  const needsConfirm = isProblematic || questions.length > 0 || (result.pipeline?.confirm !== false);

  // 给 pipeline 结果填充 auto-fill 后的参数
  if (result.pipeline) {
    for (const step of result.pipeline.steps) {
      const fc = finalCommands.find(c => c.command === step.command);
      if (fc) step.args = fc.args;
    }
  }

  return {
    what: result.summary || finalCommands.map(c => `${c.command} ${c.args}`).join(' → '),
    source,
    result,
    autoFilled,
    questions,
    needsConfirm,
    confidence: Math.min(100, finalConf),
    finalCommands,
  };
}

export async function askEngine(input: string): Promise<AskResult> {
  // ── 第零层: 确定性操作直接路由 ──
  // 切换上下文 → context set（无歧义，直接执行）
  if (/切换.*[到至].*迭代|上下文.*切换|切换到/.test(input)) {
    const iterMatch = input.match(/Iteration[- ]?\S+|Q\d+|sample/i);
    const raw = iterMatch ? iterMatch[0] : '';
    const iter = raw.replace(/^Iteration[- ]?/, '');
    if (iter) {
      return {
        mode: 'match',
        summary: `切换当前上下文到 Iteration-${iter}`,
        detail: `✅ 将当前活跃迭代设置为 Iteration-${iter}`,
        commands: ['context'],
        autoExec: { command: 'context', args: `--set --iteration ${iter}`, confirm: true },
      };
    }
  }

  // ── --rules 模式: 自有 LLM + 关键词匹配（显式触发）──
  if (input.includes('--rules')) {
    // 优先: 自有 LLM（需要配置 SPECCORE_LLM_KEY）
    if (process.env.SPECCORE_LLM_KEY) {
      try {
        const llmResult = await askWithLlm(input);
        if (llmResult && llmResult.commands.length > 0) {
          logger.info(`🧠 自有 LLM: ${modeLabel(llmResult.mode as AskMode)}`);
          (llmResult as any)._source = 'llm';
          return llmResult;
        }
      } catch (e: any) { logger.warn(`LLM 不可用: ${e.message}`); }
    }
    // 兜底: 关键词匹配
    const mode = classifyMode(input);
    switch (mode) {
      case 'explain': return handleExplain(input);
      case 'guide': return handleGuide(input);
      case 'pipeline': return handlePipeline(input);
      default: return handleMatch(input);
    }
  }

  // ── 宿主 AI 文件协议（TRAE 等）──
  try {
    const hostResult = await tryHostAi('ask', input);
    if (hostResult) {
      logger.info(`🤖 宿主 AI: ${modeLabel((hostResult.mode || 'match') as AskMode)}`);
      (hostResult as any)._source = 'host';
      return hostResult as AskResult;
    }
  } catch (e: any) { /* 不可用，继续 */ }

  // ── 输出知识库，交给宿主 AI 语义分析 ......
  const kb = COMMAND_KB.map(c =>
    `  ${c.name}: ${c.description.padEnd(30)} → ${c.usage}`
  ).join('\n');

  const pipelines = Object.entries(WORKFLOWS).map(([name, steps]) =>
    `  ${name}: ${steps.map(s => s.command).join(' → ')}`
  ).join('\n');

  return {
    mode: 'match',
    summary: '宿主 AI 语义分析',
    detail: [
      `## 用户输入`,
      `"${input}"`,
      ``,
      `## 可用操作`,
      kb,
      ``,
      `## 常用工作流`,
      pipelines,
      ``,
      `## 你的任务`,
      `根据用户输入和可用操作，判断用户意图，`,
      `直接 call speccore CLI 命令（如 analyze/plan/schedule/execute）执行。`,
      `需要 AI 参与的命令加 --prompt 标志。`,
    ].join('\n'),
    commands: [],
  };
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
  const labels: Record<AskMode, string> = { explain: '📖 命令解释', guide: '🗺️ 任务指引', match: '🎯 意图匹配', pipeline: '⚡ 复杂编排', ambiguous: '🤔 歧义消解' };
  return labels[mode];
}

/** 从用户输入中提取时间 → YYYY-MM-DD HH:mm:ss */
export function extractTime(input: string): string {
  const now = new Date();
  const target = new Date(now);

  // 优先匹配 HH:MM 格式（如 "17:15"、"17:02"）
  const colonMatch = input.match(/(\d{1,2}):(\d{2})/);
  if (colonMatch) {
    const hour = parseInt(colonMatch[1]);
    const min = parseInt(colonMatch[2]);
    target.setHours(hour, min, 0, 0);
    if (target.getTime() < now.getTime()) target.setDate(target.getDate() + 1);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())} ${pad(target.getHours())}:${pad(target.getMinutes())}:${pad(target.getSeconds())}`;
  }

  // 匹配中文格式（如 "晚8点"、"下午3点"）
  const m = input.match(/(?:晚|早上|上午|下午|中午)?\s*(\d{1,2})[点时]/);
  if (m) {
    let hour = parseInt(m[1]);
    if (/晚|晚上|下午/.test(input) && hour < 12) hour += 12;
    target.setHours(hour, 0, 0, 0);
    if (target.getTime() < now.getTime()) target.setDate(target.getDate() + 1);
  } else {
    target.setHours(20, 0, 0, 0);
    if (target.getTime() < now.getTime()) target.setDate(target.getDate() + 1);
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())} ${pad(target.getHours())}:${pad(target.getMinutes())}:${pad(target.getSeconds())}`;
}

export { COMMAND_KB, WORKFLOWS };
