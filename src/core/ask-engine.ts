/**
 * ask — SpecCore 万能 AI 入口引擎
 * 四种模式：命令解释(explain) / 任务指引(guide) / 意图匹配(match) / 复杂编排(pipeline)
 */

import { logger } from '../utils/logger';
import { recognizeIntent, IntentResult, isSpeccoreOperation, AMBIGUOUS_INTENTS } from './intent-recognition';
import { askWithLlm } from './ask-llm';
import { tryHostAi } from './ask-host-ai';
import { loadAskConfig } from './ask-config';
import { getCachedIntent, cacheIntent } from './intent-cache';
import { buildAskContext, formatContextForHostAi } from './ask-context';
import { loadFreshKnowledgeGraph, GraphEntity } from './knowledge-graph';
import { loadProjectConfig, type PlatformConfig } from './unified-config';
import { parsePlatformList } from './spec-paths';
import { matchProjectsFromText, formatProjectCardInjection } from './project-cards';

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
  /**
   * 同分 tie-break 显式优先级（缺省 0，值大者赢）。
   * 歧义词条（如「验证」同挂 verify/validate）靠此裁决，不依赖数组声明顺序；
   * 新增词条若与现有词条共享触发词，必须显式声明 priority。
   */
  priority?: number;
}

/** Pipeline 步骤 */
export interface PipelineStep {
  order: number;
  command: string;
  args: string;
  explanation: string;
  dependsOn?: number;
  // v8.3.165+: 该步骤的 subagent 角色（覆盖命令默认角色）
  subagent?: string;
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
  /** 按需注入的项目名片块（用户句中出现端名/业务名/类型词时命中，未命中为空） */
  projectCards?: string;
}

/** Ask 引擎选项 */
export interface AskEngineOptions {
  /** 显式 speccore 调用（来自 /spec-ask Skill），跳过意图域确认 */
  explicit?: boolean;
}

// ============================================================
// 命令知识库
// ============================================================

// ⚠️ 同分裁决规则（v8.3.351+ 显式化）：
// 触发词总长度同分时按 priority 裁决（值大者赢，缺省 0）；priority 也相同才回退声明顺序。
// 歧义词条必须显式设 priority（如 verify 与 validate 共享「验证」），禁止依赖声明顺序先到先得。
const COMMAND_KB: CommandKnowledge[] = [
  { name: 'init', aliases: ['in'], description: '初始化 SpecCore 项目，创建 .speccore 目录和配置',
    usage: 'speccore init [--interactive] [--name <name>]', examples: ['speccore init', 'speccore init --name my-project'], related: ['run', 'config'], triggers: ['初始化', 'init', '开始', '新建项目', '创建项目'] },
  { name: 'doc2spec', aliases: ['d2s'], description: '导入 PRD/Word 文档，AI + Pandoc 双路转换为 SpecCore MD。--classify 智能分类 sources/ 文档到 staging/（按类型提取 feature/bug/refactor/research）；--normalize 转换后按 SpecCore 标准标题体系重写标题（默认关闭，说「按标准文档转换」自动开启）',
    usage: 'speccore doc2spec -f <file> --iter <iteration> [--task <task>] [--no-ai] [--normalize] [--classify [--prompt] [--response <json>]]', examples: ['speccore doc2spec -f PRD.docx --iter Q3', 'speccore doc2spec -f 需求.docx --iter Q2 --task T-01 --no-ai', 'speccore doc2spec --classify --prompt -I Q3', 'speccore doc2spec --classify -I Q3'], related: ['spec2doc', 'analyze'], triggers: ['导入', 'doc2spec', 'word转', '文档转换', 'PRD', '需求文档', '智能分类', 'classify', '分类文档', '提取需求', '按标准文档', '标准文档转换', '标准文档调整'] },
  { name: 'spec2doc', aliases: ['s2d'], description: 'SpecCore MD 导出为 Word/PDF/HTML/PPTX',
    usage: 'speccore spec2doc [-i <iteration>] [-t <task>] [-f <format>] [-o <output>]', examples: ['speccore spec2doc -i Q3 -o 需求.docx', 'speccore spec2doc -t T-01 -f html'], related: ['doc2spec'], triggers: ['导出', 'spec2doc', '生成文档', '导出word', '导出pdf'] },
  { name: 'dashboard', aliases: ['db'], description: '项目仪表盘：迭代状态/进度/健康度，--scope global 全量视图',
    usage: 'speccore dashboard [--scope global|iteration] [--export html] [--health] [--lifecycle]', examples: ['speccore dashboard', 'speccore dashboard --scope global --export html'], related: ['analyze', 'health'], triggers: ['看板', '仪表盘', 'dashboard', '进度', '状态'] },
  { name: 'analyze', aliases: ['al'], description: '迭代层分析：需求文档+源码→分析报告（产物 020-specs/）。支持 --full 三阶段合成，--deep 单文档深度分析，--iterative 迭代式生成，--filter 按需分析指定模块，--with-code 注入代码结构化数据，--phase 单阶段合成，--feature 局部分析功能模块，--doc 局部分析类型文档，--no-source 跳过源码，--supplement 追加源码；全局层（源码→技术文档/反推需求）用 speccore global',
    usage: 'speccore analyze [--iteration <name>] [--full] [--deep <doc>] [--iterative] [--filter <keywords>] [--with-code] [--phase <n>] [--feature <module>] [--doc <type/slug>] [--no-source] [--source-scope <dirs>] [--supplement] [--dev-guide]', examples: ['speccore analyze', 'speccore analyze --full -i Q2', 'speccore analyze --deep ARCHITECTURE.md --iterative', 'speccore analyze --filter "订单,支付" --with-code', 'speccore analyze --phase 1 -i Q2', 'speccore analyze --feature 支付模块', 'speccore analyze --doc bugs/login-timeout', 'speccore analyze --with-code', 'speccore analyze --supplement --source-scope src/core', 'speccore global analyze --layer 1', 'speccore global from-source --src src/core'], related: ['dashboard', 'validate'], triggers: ['分析', 'analyze', '审计', 'audit', '检查', '结合源码', '连代码', '带代码', '源码分析', '迭代分析', '分析迭代', '分析代码', '不读源码', '不读代码', '跳过源码', '指定目录分析', '只扫描', '补充分析', '追加分析', '补充源码', '追加源码', '遗漏', '没分析到', '没覆盖', '漏掉', '再分析', '多读几个', '局部分析', '单个模块', '单独分析', 'bug分析', '重构分析', '局部回写', '回写spec', '同步spec', '合成需求', '合并需求', '需求合成', '智能合成', '需求合并', '开发指南', '生成开发指南', '带开发指南', '深度分析', '深入分析', '详细分析', '迭代生成', '逐节分析', '大纲分析', '按需分析', '只分析', '过滤分析', '聚焦分析'] },
  { name: 'global', aliases: [], description: '全局层分析：源码→技术文档（global analyze，Layer 1→4 推进）/ 源码→需求文档（global from-source，反推）。产物 .speccore/GLOBAL/，独立于迭代层 analyze',
    usage: 'speccore global analyze [--layer 1-4] [--with-code] [--auto] | speccore global from-source --src <dirs> [--depth <depth>]', examples: ['speccore global analyze --layer 1', 'speccore global analyze --with-code', 'speccore global from-source --src backend/src,admin-web/src'], related: ['analyze'], triggers: ['全局分析', '全局层分析', '分析全局', '全局架构', '全局代码分析', '全局技术分析', '分析所有端', '分析所有源码', '分析所有工程', '分析整体架构', '项目架构分析', '全量分析', '跨端综合', '全量合成', '多端合成', '源码反推', '从源码反推', '源码生成需求', '反推需求', '从代码生成', '倒推需求', '反推', '逆向工程', '按端反推', '按端生成需求', '根据端生成需求', '端生成需求', '生成需求文档', '需求文档反推', '代码生成需求', '从代码生成需求', '根据代码生成需求', '按模块反推', '反推文档', '从工程生成需求'] },
  { name: 'execute', aliases: ['ex'], description: '执行开发任务：依赖排序+分批+交互引导+计划联动',
    usage: 'speccore execute [--task <id>] [--batch-size <n>] [--auto]', examples: ['speccore execute', 'speccore execute --batch-size 3'], related: ['plan', 'done'], triggers: ['执行', 'execute', '开发', '开始做', '干活'] },
  { name: 'plan', aliases: ['pl'], description: '生成执行计划+管理历史：创建/交互/列表/详情/取消',
    usage: 'speccore plan [--all] [--task <id>] [--interactive]', examples: ['speccore plan --all', 'speccore plan --interactive'], related: ['execute'], triggers: ['计划', 'plan', '安排', '规划'] },
  { name: 'taskify', aliases: [], description: '拆分需求为开发任务（任务化）：默认 AI 智能分析（--prompt）→ AI 输出 JSON → 自动创建；也可传统模式按 REQUIREMENT.md 章节拆分',
    usage: 'speccore iteration taskify [--prompt] [--response <json>] [-f <file>] [--preview] [--iteration <name>]', examples: ['speccore iteration taskify --prompt', 'speccore iteration taskify --response "<ai_json>"', 'speccore iteration taskify -f REQUIREMENT.md', 'speccore iteration taskify --preview'], related: ['task', 'plan'], triggers: ['拆分', '分解', '划分', '拆', '拆需求', '拆任务', '任务拆分', '需求拆分', '任务化', 'split'] },
  { name: 'unitize', aliases: ['unitz'], description: '切分需求文档为功能单元（单元化，区别于 taskify 拆任务）：按标题结构+维度识别切分 converted/*.md → 010-requirements/features/{单元}/（SOURCE.md 切片+端覆盖矩阵+类型标记），支持 --titles 仅切指定标题章节',
    usage: 'speccore unitize --file <md路径> [--iter <迭代>] [--platform <端名>] [--files "a.md=端1,b.md=端2@标题1|标题2"] [--titles "标题1,标题2"]', examples: ['speccore unitize --file 010-requirements/converted/admin-web.md --iter meeting-system', 'speccore unitize --file admin-web.md --titles "预订管理,消息中心"', 'speccore unitize --files "admin-web.md=admin-web@预订管理|消息中心,h5-mobile.md=h5-mobile@订单确认" -i Q3'], related: ['doc2spec', 'analyze', 'taskify'], triggers: ['切分', '切需求', '切需求文档', '切分功能单元', '单元化', '功能单元', '切片', 'unitize', '切功能'] },
  { name: 'pr', aliases: ['mr'], description: '创建 Pull Request：提交预览+文件选择+交互确认',
    usage: 'speccore pr [--task <id>] [--auto]', examples: ['speccore pr', 'speccore pr --task T-01 --auto'], related: ['done', 'execute'], triggers: ['pr', 'pull request', '提交', '合并', 'MR'] },
  // v8.3.95+: verify 命令
  { name: 'verify', aliases: ['vf'], description: '测试验证：冒烟测试 + 视觉检查 + API 契约 + 性能基线。支持 --headed 有头模式、--browser 多浏览器、--device 多设备',
    usage: 'speccore verify [--ui] [--smoke-only] [--visual-only] [--headed] [--browser <b>] [--device <d>] [--config <file>]', examples: ['speccore verify --ui', 'speccore verify --ui --headed', 'speccore verify --config ./tests/smoke.yaml'], related: ['deploy', 'execute', 'dashboard'], triggers: ['verify', '测试', '冒烟', 'smoke', '视觉检查', 'ui验证', '验证', '跑测试', '测一下', '检查页面'],
    // v8.3.351+: 「验证」同挂 verify/validate，测试/验证动作词义优先（显式分层，不靠声明顺序）
    priority: 1 },
  { name: 'validate', aliases: ['vl'], description: '合规验证：检查 Spec 完整性与一致性',
    usage: 'speccore validate [--iteration <name>]', examples: ['speccore validate', 'speccore validate --iteration Q2'], related: ['analyze'], triggers: ['验证', 'validate', '检查', '合规', '校验'] },
  { name: 'sync', aliases: ['sy'], description: '双向同步：代码↔Spec，--global 同步到全局层（原 sync-global）',
    usage: 'speccore sync [--task <id>] [--iteration <name>] [--global] [--direction to_global|from_global]', examples: ['speccore sync --task Task-001', 'speccore sync --global', 'speccore sync --global --direction from_global'], related: ['run'], triggers: ['同步', 'sync', '对齐', '更新', '同步全量', '同步全局', '更新全量层', '同步到全量'] },
  { name: 'change', aliases: ['ch'], description: '需求变更：联动更新所有关联 Spec，支持口语化输入',
    usage: 'speccore change "<description>" [--task <id>]', examples: ['speccore change "把登录改成验证码登录"', 'speccore change "加上支付功能" --task T-03'], related: ['analyze'], triggers: ['变更', 'change', '修改', '改', '更新需求'] },
  { name: 'done', aliases: ['dn'], description: '收尾归档：校验→同步→审计，--all 批量归档',
    usage: 'speccore done [--task <id>] [--all] [--interactive]', examples: ['speccore done --task T-01', 'speccore done --all'], related: ['execute', 'pr'], triggers: ['完成', 'done', '归档', '结束', '做完'] },
  { name: 'next', aliases: ['n'], description: '检测当前迭代进度，提示下一步操作（只指引，不执行）',
    usage: 'speccore next [--iteration <name>]', examples: ['speccore next', 'speccore next -i Q2'], related: ['run', 'status'], triggers: ['下一步', '接下来', '该做什么', '接下来做什么', 'next', '做到哪了', '下一步做什么', '现在到哪了'] },
  { name: 'run', aliases: ['r'], description: '端到端命名流水线：支持 preset（full/import/analyze/develop/deliver/deploy/docs）或起止点（--from/--to），默认 develop（分析→验证），三闸口',
    usage: 'speccore run [--preset <name>] [--from <phase>] [--to <phase>] [--demo]', examples: ['speccore run --preset deploy', 'speccore run --from analyze --to execute', 'speccore run --demo'], related: ['next', 'req-doc', 'execute'], triggers: ['run', '跑一遍', '端到端', '全流程', '一键开发', '自动开发', '从头到尾', '完整流程', '全自动', '流水线'] },
  { name: 'task', aliases: ['tk'], description: '任务管理：创建/列表/状态。子命令: new, list, status',
    usage: 'speccore task new --name <name> [--id <id>] | speccore task list | speccore task status', examples: ['speccore task new --name "用户登录"', 'speccore task list'], related: ['plan', 'execute'], triggers: ['task', '任务列表', '查看任务', '列出任务'] },
  { name: 'iteration', aliases: ['it'], description: '迭代管理：创建时自动生成唯一编码（Iteration-001-功能名），支持拆分/列表',
    usage: 'speccore iteration create -n <name> | speccore iteration taskify | speccore iteration list', examples: ['speccore iteration create -n Q3 → Iteration-001-Q3', 'speccore iteration list'], related: ['task', 'plan'], triggers: ['迭代', 'iteration', '迭代', 'sprint'] },
  { name: 'context', aliases: ['ctx'], description: '查看/设置当前上下文：迭代、任务、阶段',
    usage: 'speccore context [--set --iteration <name>] [--list]', examples: ['speccore context --list', 'speccore context --set --iteration Q1'], related: ['dashboard', 'run'], triggers: ['切换', '上下文', 'context', '当前.*迭代', '设置.*迭代', '换到', '切换到'] },
  { name: 'search', aliases: ['sh'], description: '全文搜索：跨所有 Spec 文件关键词检索',
    usage: 'speccore search <query> [--task <id>] [--iteration <name>]', examples: ['speccore search "登录"', 'speccore search "支付" --iteration Q2'], related: ['analyze'], triggers: ['搜索', 'search', '查找', '检索', 'grep'] },
  { name: 'rename', aliases: ['rn'], description: '重命名迭代/任务，自动更新所有关联引用',
    usage: 'speccore rename [--iteration <old> <new>] [--task <old> <new>]', examples: ['speccore rename --iteration Q2 Q3', 'speccore rename --task T-01 T-10'], related: ['sync'], triggers: ['重命名', 'rename', '改名', '更名'] },
  { name: 'task-create', aliases: ['tc'], description: '创建任务：交互式需求澄清 → 生成 REQUIREMENT.md',
    usage: '激活 spec-task-create Skill', examples: ['创建一个bug任务', '新建修复登录问题的任务'], related: ['analyze', 'execute'], triggers: ['创建.*任务', '新建.*任务', '建.*bug', '新增.*任务', '帮我写.*需求', '记录.*bug', '创建.*审查', '创建.*测试', '创建.*文档', '创建.*部署', '创建.*重构', '创建.*安全', '创建.*性能'] },
  { name: 'iteration-create', aliases: ['ic'], description: '创建迭代：智能命名 + 平台检查',
    usage: '激活 spec-iteration-create Skill', examples: ['创建一个新迭代', '创建Q2迭代'], related: ['init', 'doc2spec'], triggers: ['创建.*迭代', '新建.*迭代', '生成.*迭代', '迭代.*新建', '开始.*迭代'] },
  { name: 'welcome', aliases: ['wel'], description: '欢迎页：展示 SpecCore 项目状态与引导流程（HTML 页面）',
    usage: 'speccore welcome', examples: ['speccore welcome'], related: ['help', 'about', 'dashboard'], triggers: ['欢迎', 'welcome', '引导页', '入门', '新手', '开始使用', '使用说明', '帮助页面'] },
  { name: 'help', aliases: ['h'], description: '帮助页：命令速查 + 场景示例 + 流水线说明（HTML 页面）',
    usage: 'speccore help', examples: ['speccore help'], related: ['welcome', 'about', 'dashboard'], triggers: ['帮助', 'help', '怎么用', '命令列表', '所有命令', '功能介绍'] },
  { name: 'about', aliases: ['ab'], description: '关于页：SpecCore 理念 + 方法论 + 版本信息（HTML 页面）',
    usage: 'speccore about', examples: ['speccore about'], related: ['welcome', 'help'], triggers: ['关于', 'about', '版本', '理念', '方法论', 'SDD', '是什么'] },
  { name: 'reindex', aliases: ['ri'], description: '全量重建所有层级索引 + 知识 图谱 + 衰减检测。--check 只检查不修复',
    usage: 'speccore reindex [--check]', examples: ['speccore reindex', 'speccore reindex --check'], related: ['validate', 'analyze'], triggers: ['重建', 'reindex', '全量重建', '重建图谱', '重建索引', '索引不一致', '死链', '更新索引', '刷新索引', '索引过期', '索引过时'] },
  // v8.3.0+: 需求澄清
  { name: 'req-doc', aliases: ['rd'], description: '需求文档化：将口语化/非专业需求整理为 PRD 级文档。支持 --local 临时工作区模式',
    usage: 'speccore req-doc "<描述>" | req-doc --from <file> [--to <iteration> | --local]',
    examples: ['speccore req-doc "我要加个购物车"', 'speccore req-doc --from notes.md --local', 'speccore req-doc --promote <entryId> --to <iteration>'], related: ['analyze', 'doc2spec'], triggers: ['整理需求', '专业化', '规范化', '整理一下', '写成PRD', '润色需求', '需求整理', '整理成文档', '需求文档化', '需求专业化'] },
];

// ============================================================
// 同义词表 — 扩展 KB 匹配覆盖面（纯数据，不改架构）
// key = 用户可能的口语化表达，value = 对应命令名
// ============================================================

const SYNONYM_MAP: Record<string, string> = {
  // ── dashboard ──
  '看板': 'dashboard', '面板': 'dashboard', '概览': 'dashboard',
  '总览': 'dashboard',
  '项目状态': 'dashboard', '健康度': 'dashboard',
  // 注意: '全局'/'全量' 不直接映射到 dashboard，避免与 analyze --scope global 冲突
  // ── analyze ──
  '审计': 'analyze', '代码审计': 'analyze', '代码检查': 'analyze',
  '质量检查': 'analyze', '风险评估': 'analyze',
  '局部分析': 'analyze', '单个模块': 'analyze', '单独分析': 'analyze',
  'bug分析': 'analyze', '重构分析': 'analyze',
  '合成需求': 'analyze', '需求合成': 'analyze', '智能合成': 'analyze',
  '需求合并': 'analyze', '多端合成': 'global', '全量分析': 'global',
  '跨端综合': 'global', '全量合成': 'global',
  // ── execute ──
  '开始做': 'execute', '干活': 'execute', '开工': 'execute',
  '跑任务': 'execute', '开发任务': 'execute',
  // ── taskify ──
  '分解': 'taskify', '划分': 'taskify', '拆需求': 'taskify', '拆任务': 'taskify',
  // ── pr ──
  '提交代码': 'pr', '发起PR': 'pr', '发起MR': 'pr', '创建MR': 'pr',
  // ── validate ──
  '合规检查': 'validate', '完整性检查': 'validate', '校验': 'validate',
  // ── change ──
  '改需求': 'change', '需求变更': 'change', '改一下': 'change',
  // ── done ──
  '收尾': 'done', '归档': 'done', '完结': 'done',
  // ── init ──
  '建项目': 'init', '项目初始化': 'init',
  // ── doc2spec ──
  '智能分类': 'doc2spec', '分类文档': 'doc2spec', '提取需求': 'doc2spec',
  'classify': 'doc2spec', '导入文档': 'doc2spec',
  // ── search ──
  '找': 'search', '查找': 'search', '全文搜索': 'search',
  // ── sync ──
  '对齐': 'sync', '双向同步': 'sync',
  '同步全量': 'sync', '同步全局': 'sync', '更新全量层': 'sync', '同步到全量': 'sync',
  // ── rename ──
  '改名': 'rename', '更名': 'rename',
  // ── context ──
  '切换迭代': 'context', '当前迭代': 'context',
  // ── welcome / help / about ──
  '新手': 'welcome', '入门': 'welcome', '开始使用': 'welcome',
  '怎么用': 'help', '命令列表': 'help', '所有命令': 'help',
  '版本': 'about', '理念': 'about', '方法论': 'about', '是什么': 'about',
  // ── iteration ──
  'sprint': 'iteration',
  // ── run（原 dev，v8.3.189 合并）──
  '流水线': 'run', '全自动': 'run',
  // ── verify ──
  '冒烟': 'verify', 'smoke': 'verify', '视觉检查': 'verify', 'ui验证': 'verify', '跑测试': 'verify', '测一下': 'verify', '检查页面': 'verify',
  // ── reindex（含原 refresh 的索引词，refresh 命令已移除）──
  '更新索引': 'reindex', '刷新索引': 'reindex', '索引过期': 'reindex',
  '重建': 'reindex', '全量重建': 'reindex', '重建图谱': 'reindex', '死链': 'reindex',
};

// ============================================================
// 任务指引 — 预定义工作流
// ============================================================

// v8.3.165+: 命令 → 默认 subagent 角色映射
const STEP_SUBAGENT_MAP: Record<string, string | undefined> = {
  analyze: 'requirement-analyzer',
  split: 'task-decomposer',
  plan: 'schedule-planner',
  execute: 'code-generator',
  pr: 'code-reviewer',
  validate: 'code-reviewer',
  change: 'impact-analyst',
  verify: 'test-engineer',
};

const WORKFLOWS: Record<string, PipelineStep[]> = {
  'new feature': [
    { order: 1, command: 'init', args: '', explanation: '初始化项目（如果还没有）', dependsOn: undefined },
    { order: 2, command: 'doc2spec', args: '-f PRD.docx --iter {iteration}', explanation: '导入 PRD 文档，AI 分析生成需求规格', dependsOn: 1 },
    { order: 3, command: 'analyze', args: '--iteration {iteration}', explanation: 'AI 分析需求，生成审计报告', dependsOn: 2, subagent: 'requirement-analyzer' },
    { order: 4, command: 'iteration taskify', args: '-f REQUIREMENT.md', explanation: '将需求拆分为独立开发任务', dependsOn: 3, subagent: 'task-decomposer' },
    { order: 5, command: 'plan', args: '--all', explanation: '生成任务执行计划，确定优先级和依赖', dependsOn: 4, subagent: 'schedule-planner' },
    { order: 6, command: 'execute', args: '--auto', explanation: '按计划依次执行开发任务', dependsOn: 5, subagent: 'code-generator' },
    { order: 7, command: 'pr', args: '--auto', explanation: '代码提交后创建 Pull Request', dependsOn: 6, subagent: 'code-reviewer' },
    { order: 8, command: 'done', args: '--all', explanation: '全部完成后归档收尾', dependsOn: 7 },
  ],
  'bugfix': [
    { order: 1, command: 'task', args: 'new --name "{bug}" --type bugfix', explanation: '创建 Bug 修复任务', dependsOn: undefined },
    { order: 2, command: 'analyze', args: '--prompt --task {task}', explanation: '分析 Bug 根因和影响范围', dependsOn: 1, subagent: 'requirement-analyzer' },
    { order: 3, command: 'plan', args: '--prompt --task {task}', explanation: '生成修复方案和排程', dependsOn: 2, subagent: 'schedule-planner' },
    { order: 4, command: 'execute', args: '--prompt --task {task}', explanation: '按方案执行修复', dependsOn: 3, subagent: 'code-generator' },
    { order: 5, command: 'validate', args: '', explanation: '验证修复完整性', dependsOn: 4, subagent: 'code-reviewer' },
    { order: 6, command: 'pr', args: '--task {task}', explanation: '提交修复 PR', dependsOn: 5, subagent: 'code-reviewer' },
    { order: 7, command: 'done', args: '--task {task}', explanation: '归档修复记录', dependsOn: 6 },
  ],
  'batch execute': [
    { order: 1, command: 'plan', args: '--select', explanation: '列出所有可执行任务（编号 + CLI命令），用户多选', dependsOn: undefined, subagent: 'schedule-planner' },
  ],
  'code review': [
    { order: 1, command: 'validate', args: '', explanation: '合规检查 Spec 完整性', dependsOn: undefined, subagent: 'code-reviewer' },
    { order: 2, command: 'analyze', args: '--iteration {iteration}', explanation: '深度审计分析', dependsOn: 1, subagent: 'requirement-analyzer' },
    { order: 3, command: 'pr', args: '--auto', explanation: '生成 PR 审查', dependsOn: 2, subagent: 'code-reviewer' },
  ],
  // v8.3.160+: 常见复合意图工作流
  // v8.3.165+: 各步骤配置 subagent 角色
  'analyze-split': [
    { order: 1, command: 'analyze', args: '--iteration {iteration}', explanation: 'AI 分析需求，生成各端规格文档', dependsOn: undefined, subagent: 'requirement-analyzer' },
    { order: 2, command: 'iteration taskify', args: '-i {iteration}', explanation: '将分析结果拆分为独立开发任务', dependsOn: 1, subagent: 'task-decomposer' },
  ],
  'analyze-split-plan': [
    { order: 1, command: 'analyze', args: '--iteration {iteration}', explanation: 'AI 分析需求，生成各端规格文档', dependsOn: undefined, subagent: 'requirement-analyzer' },
    { order: 2, command: 'iteration taskify', args: '-i {iteration}', explanation: '将分析结果拆分为独立开发任务', dependsOn: 1, subagent: 'task-decomposer' },
    { order: 3, command: 'plan', args: '--all', explanation: '生成任务执行计划，确定优先级和依赖', dependsOn: 2, subagent: 'schedule-planner' },
  ],
  'plan-execute': [
    { order: 1, command: 'plan', args: '--all', explanation: '生成任务执行计划，确定优先级和依赖', dependsOn: undefined, subagent: 'schedule-planner' },
    { order: 2, command: 'execute', args: '--auto', explanation: '按计划依次执行开发任务', dependsOn: 1, subagent: 'code-generator' },
  ],
  'analyze-plan-execute': [
    { order: 1, command: 'analyze', args: '--iteration {iteration}', explanation: 'AI 分析需求，生成各端规格文档', dependsOn: undefined, subagent: 'requirement-analyzer' },
    { order: 2, command: 'plan', args: '--all', explanation: '生成任务执行计划，确定优先级和依赖', dependsOn: 1, subagent: 'schedule-planner' },
    { order: 3, command: 'execute', args: '--auto', explanation: '按计划依次执行开发任务', dependsOn: 2, subagent: 'code-generator' },
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
    /(dashboard|dev|init|execute|plan|pr|verify|sync|validate|analyze|taskify|unitize|search|rename|doc2spec|spec2doc|ask)\s*(命令|用法|怎么用|是什么|功能|参数|选项)/,
    /怎么用\s*(dashboard|dev|init|execute|plan|pr|verify|sync|validate|analyze|taskify|unitize|search|rename|doc2spec|spec2doc|ask)/,
    /(dashboard|dev|init|execute|plan|pr|verify|sync|validate|analyze|taskify|unitize|search|rename|doc2spec|spec2doc|ask)\s*有哪些/,
    /解释[一下]?\s*(dashboard|dev|init|execute|plan|pr|verify|sync|validate|analyze|taskify|unitize|search|rename|doc2spec|spec2doc|ask)/,
    /(what|how).*use.*(dashboard|dev|init|execute|plan|pr|verify|sync|validate|analyze|taskify|unitize|search|rename|doc2spec|spec2doc|ask)/i,
  ];
  if (explainPatterns.some(p => p.test(lower))) return 'explain';

  // v8.3.190+: run 流水线意图前置检测（"从 X 到 Y"、"跑/执行流水线"、"帮我部署/交付"等）
  // 优先于 pipeline/guide 判定，让 run 命名流水线编排走 match 分支
  const runPipelinePatterns = [
    /从.+?(?:到|至).+/,
    /(?:跑|执行|运行).{0,4}流水线/,
    /帮我(?:部署|交付|上线|提代码|提交代码)/,
    /(?:部署|交付|上线).{0,4}流水线/,
    /(?:跑|执行).{0,4}全流程/,
    /(?:生成|出).{0,2}(?:spec|规格)/,
    /.{0,6}到拆分/,
    /开发(?:流程|到验证|到执行)/,
    /(?:分析|需求).{0,4}到开发/,
  ];
  if (runPipelinePatterns.some(p => p.test(input))) return 'match';

  // v8.3.348+: 部署确定性意图——「部署到 X 环境」句直接路由 guide 分支
  // （handleGuide 生成 deploy 单命令，含备份词识别）。
  // 排除 run 专属词（流水线/全流程/端到端），避免抢占 run 编排。
  const deployDirect = /(?:部署|deploy|发布|上线)(?:到|至|:)?\s*(local|dev|develop|test|staging|production|prod|预发布|预发|线上|测试|开发|本地)/i;
  if (deployDirect.test(input) && !/(?:流水线|全流程|端到端)/.test(input)) return 'guide';

  // 模式4: 复杂编排 — 包含多个动作词 + 时序/数量词
  // v8.3.189+: 补充「分析」「拆分」动作词和「并且」「以及」并列连接词，
  // 使「分析…拆分…」这类复合意图能进入 pipeline 编排（analyze-split-plan）
  const pipelineKeywords = ['然后', '再', '接着', '最后', '同时', '之后', '并且', '以及', '还要',
    'then', 'after', 'finally', '同时执行', 'pipeline'];
  const actionWords = ['计划', '执行', '分批', '安排', '分析', '拆分',
    'plan', 'execute', 'batch', 'analyze', 'split'];
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

/** 匹配类型（degrade to honesty：不同匹配层级的可靠性不同，需诚实区分） */
type KbMatchType = 'name' | 'alias' | 'synonym' | 'trigger';

/** 最近一次 KB 匹配类型（供置信度诚实赋值：触发词匹配不能伪装成精确匹配） */
let lastKbMatchType: KbMatchType | null = null;

/** 单词边界匹配：word 作为独立 token 出现，避免短 alias 误匹配包含它的词（如 "split" 误匹配 "sp"/"pl"） */
function wordMatch(text: string, word: string): boolean {
  try {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(text);
  } catch {
    return text.includes(word);
  }
}

/** 匹配命令知识（精确匹配 → 同义词表 → 触发词 三层降级） */
function matchCommandInKB(input: string): CommandKnowledge | null {
  const lower = input.toLowerCase();
  // 精确匹配命令名（单词边界，最可靠）
  for (const cmd of COMMAND_KB) {
    if (wordMatch(lower, cmd.name)) { lastKbMatchType = 'name'; return cmd; }
    for (const alias of cmd.aliases) {
      if (alias.length > 1 && wordMatch(lower, alias)) { lastKbMatchType = 'alias'; return cmd; }
    }
  }
  // 同义词表优先于触发词：同义词表是显式映射，更准确
  for (const [syn, cmdName] of Object.entries(SYNONYM_MAP)) {
    if (lower.includes(syn)) {
      const found = COMMAND_KB.find(c => c.name === cmdName);
      if (found) { lastKbMatchType = 'synonym'; return found; }
    }
  }
  // 触发词匹配（最不可靠，需诚实声明低置信度）
  let best: CommandKnowledge | null = null;
  let bestScore = 0;
  let bestPriority = -Infinity;
  for (const cmd of COMMAND_KB) {
    // v8.3.257: 用匹配触发词的总长度加权——长词（如「全局分析」4字）比短词（「分析」2字）更具体，
    // 避免「全局分析」被 analyze 的泛触发词「分析」抢占
    // v8.3.351+: 同分 tie-break 显式化——priority 值大者赢，priority 相同回退声明顺序
    const score = cmd.triggers.filter(t => lower.includes(t)).reduce((s, t) => s + t.length, 0);
    const priority = cmd.priority ?? 0;
    if (score > bestScore || (score === bestScore && priority > bestPriority)) {
      bestScore = score; best = cmd; bestPriority = priority;
    }
  }
  if (bestScore > 0 && best) { lastKbMatchType = 'trigger'; return best; }

  lastKbMatchType = null;
  return null;
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
function handleGuide(input: string): AskResult | null {
  // v8.3.83+: 提取环境名和平台名（用于 deploy/verify 自动执行）
  const envMap: Record<string, string> = {
    '预发布': 'staging', '预发': 'staging', '线上': 'production', 'prod': 'production',
    '测试': 'test', '开发': 'dev', 'develop': 'dev', '本地': 'local',
  };
  const envMatch = input.match(/(?:环境|env|到|部署到|发布到|上线到)\s*(local|dev|develop|test|staging|production|prod|预发布|预发|线上|测试|开发)/i);
  const parsedEnv = envMatch ? (envMap[envMatch[1].toLowerCase()] || envMatch[1].toLowerCase()) : '';
  const platformMatch = input.match(/(?:平台|端|platform)\s*[:=]?\s*([a-zA-Z0-9\-_]+)/i);
  const parsedPlatform = platformMatch ? platformMatch[1] : '';
  const isAll = /所有端|全部平台|所有平台|--all|\ball\b/.test(input);
  // v8.3.348+: 端级备份排除——「h5-mobile 不备份」「order-api、sr-web 免备份」→ --skip-backup-for h5-mobile,order-api
  // 只匹配英文端名（PROJECT.yaml 端名规范为小写 slug），中文端名无法可靠映射时走全局开关/配置
  const noBackupForMatch = input.match(/([a-z][a-z0-9\-]*(?:\s*[,，、和及]\s*[a-z][a-z0-9\-]*)*)\s*(?:不备份|不用备份|无需备份|免备份)/i);
  const noBackupForArg = noBackupForMatch
    ? `--skip-backup-for ${noBackupForMatch[1].split(/[,，、和及\s]+/).filter(Boolean).join(',')}`
    : '';
  // v8.3.348+: 全局备份词——先剔除端级排除片段，避免「h5-mobile 不备份」中的「不备份」
  // 误判为全局不备份（那会关掉所有端的备份）；剔除后「备份/不备份」才代表全局开关
  const backupScopeInput = noBackupForMatch ? input.replace(noBackupForMatch[0], '') : input;
  const backupArg = /(?:不|不要|无需|免)备份/.test(backupScopeInput) ? '--no-backup' : /备份/.test(backupScopeInput) ? '--backup' : '';

  // 匹配工作流
  let matchedWorkflow: PipelineStep[] | null = null;
  let workflowName = '';

  // v8.3.83+: 组合意图 — 部署 + 测试/验证
  // v8.3.348+: 排除「测试环境」中的「测试」——环境名不算测试动作，否则
  // 「部署到测试环境并备份」会被误判为部署+冒烟 pipeline
  const deployWithVerify = /(?:部署|deploy|发布|上线).*(?:冒烟|smoke|验证|verify)/i.test(input) ||
    /(?:冒烟|smoke|验证|verify).*(?:部署|deploy|发布|上线)/i.test(input) ||
    (/部署|deploy|发布|上线/i.test(input) && /(?:测试|test)(?!\s*环境)/i.test(input));
  if (deployWithVerify) {
    const env = parsedEnv || 'staging';
    const platformArg = isAll || !parsedPlatform ? '--all' : `--platform ${parsedPlatform}`;
    const deployArgs = `--env ${env} ${platformArg} ${backupArg} ${noBackupForArg}`.trim();
    return {
      mode: 'pipeline',
      summary: `部署并验证（${env} 环境）`,
      detail: `🚀 步骤 1: speccore deploy ${deployArgs}\n🧪 步骤 2: speccore verify --ui --smoke-only\n\n确认后自动执行部署+冒烟验证`,
      commands: ['deploy', 'verify'],
      pipeline: {
        steps: [
          { order: 1, command: 'deploy', args: deployArgs, explanation: `部署到 ${env} 环境`, dependsOn: undefined },
          { order: 2, command: 'verify', args: '--ui --smoke-only', explanation: '部署后冒烟验证', dependsOn: 1 },
        ],
        input,
        confirm: true,
      },
      autoExec: { command: 'deploy', args: deployArgs, confirm: true },
    };
  }

  if (/bug|修复|fix|defect/i.test(input)) {
    matchedWorkflow = WORKFLOWS['bugfix'];
    workflowName = 'Bug 修复流程';
  } else if (/审查|review|代码检查|code review|检查.*代码/i.test(input)) {
    matchedWorkflow = WORKFLOWS['code review'];
    workflowName = '代码审查流程';
  } else if (/自审|review.*spec|review.*分析|检查.*(文档|spec|分析|源码|需求)|评审.*(tech|analysis|文档|spec|需求|源码)|文档.*质量|spec.*质量|分析.*不好|分析.*有问题|重新.*(分析|澄清)|完善.*(文档|spec|分析)|任务.*(文档|spec)|全局.*(分析|文档)/i.test(input)) {
    // v8.3.142+: Spec 自审意图（扩展：支持全局/迭代/任务层/源码/需求澄清等场景）

    // 迭代名提取：支持 "Iteration-001"、"迭代 Iteration-001"、"iteration Iteration-001"
    const iterationMatch = input.match(/(?:迭代|iteration)?\s*[:=]?\s*(Iteration-[a-zA-Z0-9\-_]+)/i)
      || input.match(/(?:迭代|iteration)\s*[:=]?\s*([a-zA-Z0-9\-_]+)/i);
    const iteration = iterationMatch ? iterationMatch[1] : '';

    // 多端提取：支持 "backend,frontend"、"backend 和 frontend"
    const platformMatch = input.match(/(?:端|平台|platform)\s*[:=]?\s*([a-zA-Z0-9\-_,]+(?:[,，]\s*[a-zA-Z0-9\-_]+)*)/i);
    const platform = platformMatch ? platformMatch[1].replace(/[，]/g, ',') : '';

    // 文档路径提取：支持多种格式
    const docMatch = input.match(/(?:doc|文档|文件|spec|TECH|ANALYSIS)\s*[:=]?\s*([a-zA-Z0-9_\-\/\.]+(?:\.md)?)/i)
      || input.match(/(?:020-specs|030-tasks)\/[a-zA-Z0-9_\-\/\.]+/i);
    const doc = docMatch ? docMatch[0] : '';

    // 全局标志
    const isGlobal = /全局|global|GLOBAL/.test(input);

    // 任务ID提取
    const taskMatch = input.match(/(?:任务|task)\s*[:=]?\s*(Task-[a-zA-Z0-9\-_]+)/i);
    const taskId = taskMatch ? taskMatch[1] : '';

    let args = '';
    if (iteration) args += ` -I ${iteration}`;
    if (isGlobal) args += ' --global';
    if (platform) args += ` --platform ${platform}`;
    if (doc) args += ` --doc ${doc}`;
    if (taskId) args += ` --task ${taskId}`;
    if (!iteration && !isGlobal && !platform && !doc && !taskId) args += ' -I {iteration}';

    return {
      mode: 'match',
      summary: 'Spec 自审：检查分析文档质量',
      detail: `🔍 即将执行: speccore review${args}\n\nAI 将对照需求文档和源码，检查分析文档的完整性、边界情况、与源码一致性、可执行性。`,
      commands: ['review'],
      autoExec: { command: 'review', args: args.trim(), confirm: true },
    };
  } else if (/测试|test|写.*用例|补充.*测试|冒烟|smoke|验证|verify/i.test(input) &&
      // v8.3.348+: 部署句已在 427/549 行处理，「测试环境」中的「测试」不是测试动作
      !/(?:部署|deploy|发布|上线)/i.test(input) &&
      !/(?:测试|test)\s*环境/.test(input)) {
    const env = parsedEnv || 'staging';
    // v8.3.102+: 修复参数映射，与 verify.ts 实际支持的参数对齐
    // verify.ts 支持：--type compile|lint|test|all（代码验证）
    //                 --ui（UI测试） --smoke-only --visual-only
    //                 --api-contract（API契约） --perf（性能）
    let args = '--type all';
    let testDesc = '全量测试（代码验证 + UI + API）';
    if (/冒烟|smoke/.test(input)) {
      args = '--ui --smoke-only';
      testDesc = 'UI 冒烟测试';
    } else if (/api|接口/.test(input)) {
      args = '--api-contract';
      testDesc = 'API 契约测试';
    } else if (/视觉|visual|ui|页面/.test(input)) {
      args = '--ui --visual-only';
      testDesc = 'UI 视觉回归测试';
    } else if (/lint|代码检查|规范/.test(input)) {
      args = '--type lint';
      testDesc = '代码规范检查';
    } else if (/单元测试|unit/.test(input)) {
      args = '--type test';
      testDesc = '单元测试';
    }
    return {
      mode: 'match',
      summary: `运行 ${testDesc}（${env} 环境）`,
      detail: `🧪 即将执行: speccore verify ${args}\n\n确认后自动执行测试`,
      commands: ['verify'],
      autoExec: { command: 'verify', args, confirm: true },
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
    const env = parsedEnv || 'staging';
    const platformArg = isAll || !parsedPlatform ? '--all' : `--platform ${parsedPlatform}`;
    const args = `--env ${env} ${platformArg} ${backupArg} ${noBackupForArg}`.trim();
    return {
      mode: 'match',
      summary: `部署到 ${env} 环境`,
      detail: `🚀 即将执行: speccore deploy ${args}\n\n确认后自动执行部署`,
      commands: ['deploy'],
      autoExec: { command: 'deploy', args, confirm: true },
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
    return null;
  } else if (/分类|classify|提取需求|智能导入|批量导入|文档.*分类|导入.*分类|sources/i.test(input)) {
    // 分类只是 doc2spec 的一个模式，不触发 pipeline，让用户逐步交互
    return null;
  } else if (/批量|分批|batch|队列/i.test(input)) {
    matchedWorkflow = WORKFLOWS['batch execute'];
    workflowName = '批量执行流程';
  } else if (/创建.*迭代创建.*迭代/i.test(input)) {
    // 不应该进 guide 模式——让调用方降级到 match
    return null;
  } else {
    // 无匹配工作流 → 返回 null，由 askEngine 降级到 handleMatch
    return null;
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
    `  一键执行: speccore run（自动检测并推进）`,
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

/** 检测补充分析意图：用户说“有遗漏”“补充一下”“再分析”等 */
const SUPPLEMENT_INTENT = /补充分析|追加分析|补充源码|追加源码|有.*遗漏|遗漏.*分析|没分析到|没覆盖|漏掉|再分析|多读几个|追加.*源码|再.*读.*文件|还有.*没.*分析|补充.*覆盖|补充.*源码|补充.*文件/;
/** 排除模式：这些场景不应触发补充分析 */
const SUPPLEMENT_EXCLUDE = /补充测试|补充用例|补充文档|补.*文档|补充.*报告/;

/** v8.3.257: 意图展示命令格式化 — global 命令族需拼子命令（反推词→from-source，否则→analyze） */
function formatCommandDisplay(r: IntentResult): string {
  return r.command === 'global'
    ? `global ${r.extractedParams?.fromCode ? 'from-source' : 'analyze'}`
    : r.command;
}

/** 模式3: 意图匹配（当前 ask 逻辑） */
/**
 * v8.3.351+: 提取「合并/提交到 {环境}」句式的目标环境名（归一化英文标识）供 pr 意图透传 --base；
 * 识别与解析分离——分支解析在 pr 命令内走 resolveEnvBranchRef（与 pr_target 环境名引用同链路）。
 * 无环境词时返回空串（普通 pr 意图不加 --base）。
 */
function extractMergeEnvTarget(input: string): string {
  const match = input.match(/(?:合并|merge|合到|合入|提交|commit)(?:到|至|入)?[^，。！？]{0,6}(local|dev|develop|test|staging|production|prod|预发布|预发|线上|生产|测试|开发|本地)(?:\s*环境)?/i);
  if (!match) return '';
  const envMap: Record<string, string> = {
    '预发布': 'staging', '预发': 'staging', '线上': 'production', '生产': 'production', 'prod': 'production',
    '测试': 'test', '开发': 'dev', 'develop': 'dev', '本地': 'local',
  };
  return envMap[match[1].toLowerCase()] || match[1].toLowerCase();
}

async function handleMatch(input: string, isExplicit = false): Promise<AskResult> {
  // 补充分析意图已在 askEngine 顶层检测（第零层），此处不再重复

  // 优先用 KB 精确匹配
  const kbMatch = matchCommandInKB(input);
  const config = await loadAskConfig();

  // v8.3.351+: 「合并/提交到 {环境}」确定性短路——无论 KB 词条（「开发」抢 pr 先手）
  // 还是意图识别（execute 宽触发词）谁得先机，该句式一律路由 pr --base <环境>；
  // 环境名是目标环境，不是开发/测试动作词。「合并需求」无「到」不短路（走 analyze）。
  const mergeEnvTarget = extractMergeEnvTarget(input);
  if (mergeEnvTarget && /(?:合并|merge|合到|合入|提交)(?:到|至|入)/i.test(input)) {
    const mergeResult: AskResult = {
      mode: 'match',
      summary: `✅ 推荐: speccore pr --base ${mergeEnvTarget}`,
      detail: `🎯 推荐命令: speccore pr --base ${mergeEnvTarget}\n创建 Pull Request：目标分支指向 ${mergeEnvTarget} 环境分支（pr 内解析 environments/${mergeEnvTarget}.yaml 的 branch）\n\n⚠️  请确认后执行以上命令。`,
      commands: ['pr'],
    };
    // 域检测（与 AMBIGUOUS_INTENTS 机制对齐）：「合并到测试环境」也是日常讨论高频句，
    // 分不清是 speccore 操作还是普通对话时先确认，不直接执行
    if (!isExplicit && !isSpeccoreOperation(input)) {
      return {
        mode: 'ambiguous',
        summary: `待确认: pr — 是 speccore 操作还是普通对话?`,
        detail: [
          '🤔 我识别到你可能想执行 speccore 命令，但不确定这是调用 CLI 还是普通技术讨论：',
          '',
          `  你的输入: "${input}"`,
          `  匹配意图: pr → speccore pr --base ${mergeEnvTarget}（目标分支指向该环境分支）`,
          '',
          '如果是 speccore 操作（创建 PR 并指向该环境分支），请输入 y 确认；',
          '如果是普通技术讨论（如讨论代码流向/分支策略），请直接描述你的问题。',
          '',
          '或输入 y 确认执行: speccore pr --base ' + mergeEnvTarget,
        ].join('\n'),
        commands: ['pr'],
      };
    }
    return mergeResult;
  }
  
  const results = await recognizeIntent(input);
  let best = results[0];
  // v8.3.191+: run 意图带 preset/起止点（extractParams 已精确识别编排）时优先 run 编排，
  // 避免被 execute/analyze 的宽泛触发词（跑/开发/分析）抢占。
  // 条件：confidence>=40 兜底，防止极低置信度的 run 误抢。
  // runForced：preset/起止点已精确识别 → 跳过歧义检测与中置信度确认，直接编排执行。
  let runForced = false;
  const runWithParams = results.find(r => r.intent === 'run' && r.confidence >= 40 && (r.extractedParams?.preset || r.extractedParams?.from || r.extractedParams?.to || r.extractedParams?.gate));
  if (runWithParams) {
    // v8.3.195+: run 带精确参数（preset/起止点/闸口）即视为已识别编排意图，
    // 无论 best 是否已是 run 都强制编排（否则 run 排第一但与 execute 差距<15% 时会走歧义、丢参数）
    if (best?.intent !== 'run') best = runWithParams;
    runForced = true;
  }
  // v8.3.190+: 澄清三态 flag（仅 analyze 命令，供各分支命令展示统一使用）
  const clarifyFlag = best && best.command === 'analyze' && best.extractedParams?.clarify === 'on' ? ' --clarify'
    : best && best.command === 'analyze' && best.extractedParams?.clarify === 'off' ? ' --skip-clarify'
    : '';
  // v8.3.190+: run 流水线 flag（preset / 起止点，供各分支命令展示统一使用）
  let runFlag = '';
  if (best && best.command === 'run') {
    const rp = best.extractedParams || {};
    if (rp.preset) runFlag += ` --preset ${rp.preset}`;
    if (rp.from) runFlag += ` --from ${rp.from}`;
    if (rp.to) runFlag += ` --to ${rp.to}`;
    if (rp.gate) runFlag += ` --gate ${rp.gate}`;  // v8.3.195+: 全自动 → 跳过闸口 A/B
  }
  
  // 如果 KB 有匹配且置信度高于意图识别，用 KB（但要整合意图识别的参数）
  // v8.3.191+: run 意图有 preset/起止点时，优先 run 编排（避免被 KB 的 split/deploy 等抢占）
  // v8.3.351+: KB 命中 pr 且句中提取到目标环境（「合并到开发环境」）时强制走 KB 分支——
  // 「开发」是环境名不是开发动作，不得被 execute 的宽触发词抢占
  const runHasParams = best?.command === 'run' && (best.extractedParams?.preset || best.extractedParams?.from || best.extractedParams?.to || best.extractedParams?.gate);
  const prWithEnvTarget = kbMatch?.name === 'pr' && extractMergeEnvTarget(input) !== '';
  if (kbMatch && (!best || best.confidence < 60 || prWithEnvTarget) && !runHasParams) {
    const params = best?.extractedParams || {};
    let fullCommand = `speccore ${kbMatch.name}`;
    // v8.3.301+: from-source 端名自动映射的备注，等 paramNotes 声明后再 append
    let srcMapNote: string | undefined;
    // v8.3.255+: global 命令族需子命令（反推词→from-source，否则→analyze）
    if (kbMatch.name === 'global') {
      fullCommand = params.fromCode ? `speccore global from-source` : `speccore global analyze`;
      if (params.fromCode) {
        const enriched = await enrichFromSourceCommand(input, fullCommand);
        fullCommand = enriched.command;
        srcMapNote = enriched.note;
      }
    }
    const paramNotes: string[] = [];
    if (srcMapNote) paramNotes.push(srcMapNote);
    if (params.tool) { fullCommand += ` --tool="${params.tool}"`; paramNotes.push(`🔧 平台: ${params.tool}`); }
    // v8.3.257: KB 命令名是顶层（如 task/iteration），-n/--iter 只存在于子命令，拼上即死参数。
    // name 仅作提示；iteration 用全名 --iteration（大多数命令注册了该选项）
    if (params.name) { paramNotes.push(`📛 名称: ${params.name}`); }
    if (params.iteration) { fullCommand += ` --iteration "${params.iteration}"`; paramNotes.push(`🔄 迭代: ${params.iteration}`); }
    // v8.3.255+: global 子命令无 --scope 选项（scope 已在子命令选择时消费）
    // v8.3.257: --scope 不是通用选项（仅 dashboard/verify/analyze 注册）。sync 用 --global 布尔，
    // 其余命令只作提示，避免死参数
    if (params.scope && kbMatch.name !== 'global' && kbMatch.name !== 'analyze') {
      if (kbMatch.name === 'sync') { fullCommand += ` --global`; }
      else if (kbMatch.name === 'dashboard') { fullCommand += ` --scope ${params.scope}`; }
      paramNotes.push(`🌐 范围: ${params.scope}`);
    }
    // v8.3.193+: 源码反推（--from-code）/ 源码扫描（--with-code），互斥
    if (kbMatch.name === 'analyze' && params.fromCode) { fullCommand += ` --from-code`; paramNotes.push(`🔍 源码反推: 从源码生成需求文档`); }
    if (kbMatch.name === 'analyze' && params.withCode) { fullCommand += ` --with-code`; paramNotes.push(`🔍 源码扫描: 结合工程源码分析`); }
    // v8.3.190+: 澄清三态 ask 单次覆盖（仅 analyze）
    if (kbMatch.name === 'analyze' && params.clarify === 'on') { fullCommand += ` --clarify`; paramNotes.push(`🔍 澄清: 强制澄清`); }
    if (kbMatch.name === 'analyze' && params.clarify === 'off') { fullCommand += ` --skip-clarify`; paramNotes.push(`⏭️ 澄清: 跳过`); }
    // v8.3.190+: run 流水线意图（preset / 起止点）
    if (kbMatch.name === 'run') {
      if (params.preset) { fullCommand += ` --preset ${params.preset}`; paramNotes.push(`🎯 流水线: ${params.preset}`); }
      if (params.from) { fullCommand += ` --from ${params.from}`; paramNotes.push(`📍 起点: ${params.from}`); }
      if (params.to) { fullCommand += ` --to ${params.to}`; paramNotes.push(`🏁 终点: ${params.to}`); }
      if (params.gate) { fullCommand += ` --gate ${params.gate}`; paramNotes.push(`🤖 闸口: 全自动（跳过 A/B）`); }
    }
    // v8.3.257: taskify 默认走 AI 增强路径（--prompt），除非用户明确要求传统模式
    if (kbMatch.name === 'taskify' && !params.splitDirect) { fullCommand += ` --prompt`; paramNotes.push(`🧠 模式: AI 智能拆分`); }

    // v8.3.351+: KB trigger「合并」命中 pr 时，提取目标环境透传 --base——
    // pr 命令内 resolveEnvBranchRef 解析为 environments/{env}.yaml 的 branch；
    // 「合并到测试环境」在 COMMAND_MAPPINGS 无 pr 触发词（best 为空），必走本 KB 分支
    if (kbMatch.name === 'pr') {
      const mergeEnv = extractMergeEnvTarget(input);
      if (mergeEnv) {
        fullCommand += ` --base ${mergeEnv}`;
        paramNotes.push(`🌿 目标环境: ${mergeEnv} → PR 目标分支指向该环境分支`);
      }
    }

    // 补充分析意图已在 askEngine 顶层检测，此处不再重复
    
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
  if (best.confidence < config.routing.lowThreshold) {
    return {
      mode: 'match',
      summary: '置信度过低',
      detail: `⚠️ 未找到高置信度匹配 (最高: ${best.intent} ${best.confidence}%)\n\n请重新描述你的需求，或使用 speccore help 查看可用命令。`,
      commands: [],
    };
  }

  // ── 歧义检测: 第二候选与第一差距 < 15% ──
  const second = results[1];
  if (!runForced && second && (best.confidence - second.confidence) < 15) {
    const candidates = results.slice(0, 4);
    const lines = ['🤔 检测到多个可能意图，请选择:', ''];
    candidates.forEach((r, i) => {
      lines.push(`[${i + 1}] ${r.intent} (${r.confidence}%) — speccore ${formatCommandDisplay(r)}`);
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

  // ── 意图域检测: 区分 speccore 操作 vs 普通 AI 对话 ──
  // v6.97.0+ 新增：如果匹配到容易混淆的意图（analyze/taskify/execute/plan），
  // 但输入中没有 speccore 上下文词（如"迭代""全局""speccore"等），
  // 可能是用户在普通聊天（如"分析代码""讨论需求"），应返回确认而非直接执行
  // v6.97.0+ 修复：显式调用（/spec-ask Skill）时跳过此检测，直接执行
  if (!isExplicit && AMBIGUOUS_INTENTS.has(best.intent) && !isSpeccoreOperation(input)) {
    // v8.3.257: global 命令族需子命令（反推词→from-source，否则→analyze）
    const displayCmd = formatCommandDisplay(best);
    const lines = [
      '🤔 我识别到你可能想执行 speccore 命令，但不确定这是调用 CLI 还是普通技术讨论：',
      '',
      `  你的输入: "${input}"`,
      `  匹配意图: ${best.intent} → speccore ${displayCmd}${clarifyFlag}${runFlag}`,
      '',
      '如果是 speccore 操作，请补充明确的上下文词，例如：',
      '  • "用 speccore 分析本迭代需求"',
      '  • "全局分析项目架构"',
      '  • "拆分 Task-001 的开发任务"',
      '  • "执行迭代 Iteration-001 的计划"',
      '',
      '如果是普通技术讨论（解释代码、审查片段、讨论需求），请直接描述你的问题。',
      '',
      '或输入 y 确认执行: speccore ' + displayCmd + clarifyFlag + runFlag,
    ];
    return {
      mode: 'ambiguous',
      summary: `待确认: ${best.intent} — 是 speccore 操作还是普通对话?`,
      detail: lines.join('\n'),
      commands: [best.command],
    };
  }

  // ── 中置信度确认: 匹配到了但不确定，询问用户 ──
  if (!runForced && best.confidence < config.routing.highThreshold && best.confidence >= config.routing.lowThreshold) {
    const lines = ['🤔 我理解你想做这个，但不太确定，请确认:', ''];
    lines.push(`🎯 我的理解: ${best.intent} (${best.confidence}%)`);
    lines.push(`📋 建议命令: speccore ${formatCommandDisplay(best)}${clarifyFlag}${runFlag}`);
    lines.push('');
    if (results.length > 1) {
      lines.push('其他可能:');
      for (const r of results.slice(1, 3)) {
        lines.push(`  • ${r.intent} (${r.confidence}%) — speccore ${formatCommandDisplay(r)}`);
      }
      lines.push('');
    }
    lines.push('输入 y/回车 确认执行，或重新描述你的需求。');
    return {
      mode: 'ambiguous',
      summary: `待确认: ${best.intent} (${best.confidence}%)`,
      detail: lines.join('\n'),
      commands: [best.command],
    };
  }
  const params = best.extractedParams;
  let fullCommand: string;
  const paramNotes: string[] = [];

  // task-create / iteration-create 需要子命令
  if (best.command === 'task-create') {
    const name = params.name || params.desc || input.slice(0, 30);
    fullCommand = `speccore task new -n "${name}"`;
  } else if (best.command === 'iteration create') {
    // v8.3.372: 此前判断写的是 'iteration-create'（连字符）而 mapping.id 是空格版
    // 'iteration create'，永远不命中——死分支，name/topic 拼装实际走 else 分支且
    // 多拼死参数 --iteration（iteration create 未注册）导致命令 fail(1)
    const name = params.name || input.slice(0, 20);
    fullCommand = `speccore iteration create -n "${name}"`;
    // v8.3.372: 「主要功能是 X」提取的 topic 透传给 CLI（--topic 拼 slug，
    // 中文主题 CLI 拼音兜底，宿主 AI 英译见 spec-iteration-create 剧本）
    if (params.topic) fullCommand += ` --topic "${params.topic}"`;
  } else if (best.command === 'global') {
    // v8.3.255+: global 命令族 — 反推词→from-source，否则→analyze
    // 注：extractParams 中 fromCode 与 withCode 互斥（反推优先级高于扫描）
    fullCommand = (params.fromCode || (params.scope === 'global' && /反推|逆向|生成需求/.test(input)))
      ? `speccore global from-source`
      : `speccore global analyze`;
    if (params.withCode) fullCommand += ` --with-code`;
    // v8.3.301+: from-source 端名自动映射（PROJECT.yaml 端名/描述 → --platform + --src）
    if (fullCommand.includes('from-source')) {
      const enriched = await enrichFromSourceCommand(input, fullCommand);
      fullCommand = enriched.command;
      if (enriched.note) paramNotes.push(enriched.note);
    }
  } else if (best.command === 'bugfix' || best.command === 'research') {
    // v8.3.257: bugfix/research 无独立 CLI 命令 — 路由到 task new -t <type>
    const name = params.name || params.desc || input.slice(0, 30);
    fullCommand = `speccore task new -t ${best.command} -n "${name}"`;
    paramNotes.push(`📦 任务类型: ${best.command}`);
  } else if (best.command === 'task append') {
    // v8.3.311+: 补端子任务 — 提取 Task-ID 与端名，路由 task new --into/--platform
    // （上游门禁在 CLI 内：020-specs 无该端规格时拦截并提示先 analyze --platform）
    const taskId = params.task || '';
    let platform = '';
    try {
      const projectPlatforms = await parsePlatformList();
      // 按端名长度降序匹配：miniapp 必须优先于 app（否则「补一个 miniapp 端」被子串误命中 app）
      const sorted = [...projectPlatforms].sort((a, b) => b.length - a.length);
      platform = sorted.find(p => input.toLowerCase().includes(p.toLowerCase())) || '';
    } catch { /* 端列表解析失败留空，CLI 侧校验 */ }
    if (!taskId) {
      // 注意：pattern 捕获的 params.name 是「新建(.+)子任务」的碎片（如「一个」），
      // 不能当任务名用；无 Task 锚点时用输入整体截断，避免建出「Task-xxx-yi-ge」这类废任务
      fullCommand = `speccore task new -n "${input.slice(0, 30)}"`;
      paramNotes.push('⚠️ 未识别到 Task 编号，按新建任务处理；补端子任务请带上 Task-XXX');
    } else {
      fullCommand = `speccore task new --into ${taskId}`;
      if (platform) {
        fullCommand += ` --platform ${platform}`;
        paramNotes.push(`🔌 补端: ${platform}（上游规格缺失时 CLI 会拦截提示先 analyze --platform）`);
      } else {
        paramNotes.push('⚠️ 未识别端名，请用 --platform 指定（CONSTITUTION 端列表中的端名）');
      }
    }
  } else if (best.command === 'search') {
    // v8.3.257: search 用位置参数而非 -n（search 无 -n 选项，避免死参数）
    fullCommand = `speccore search "${params.name || input.slice(0, 40)}"`;
  } else if (best.command === 'pr') {
    fullCommand = `speccore pr`;
    // v8.3.351+: 高置信度 pr 意图同样支持「合并到 {环境}」环境名透传（KB 分支的对称兜底）；
    // 「需求合并」等语料由 SYNONYM_MAP 优先路由 analyze，不会落到此处
    const mergeEnv = extractMergeEnvTarget(input);
    if (mergeEnv) {
      fullCommand += ` --base ${mergeEnv}`;
      paramNotes.push(`🌿 目标环境: ${mergeEnv} → PR 目标分支指向该环境分支`);
    }
  } else {
    fullCommand = `speccore ${best.command}`;
    // v8.3.257: -n/--iter 不是通用选项——仅 task new/iteration create 注册了 -n，
    // 仅 unitize 注册了 --iter；change 用位置参数，其余命令忽略 name 避免死参数
    if (params.name && (best.command === 'task new' || best.command === 'iteration create')) {
      fullCommand += ` -n "${params.name}"`;
    } else if (best.command === 'change') {
      // v8.3.386: change 用完整输入而非 pattern 捕获碎片——「加(.+)」捕获组会剥离
      // 触发词，把「加一个消息通知功能」变成「一个消息通知功能」，CLI 端
      // inferCategoryFromDescription 误判 unknown。整体透传保留新增/变更语义；
      // 「把 A 改成 B」的 target 捕获组信息同样靠完整句传递，不再丢失。
      fullCommand += ` "${(params.desc || input).slice(0, 120)}"`;
    }
    if (params.iteration) {
      fullCommand += (best.command === 'unitize' || best.command === 'doc2spec')
        ? ` --iter "${params.iteration}"`
        : ` --iteration "${params.iteration}"`;
    }
    // v8.3.334+: unitize 多文档各自标题（fileTitles: "a.md:t1|t2;b.md:t3"）→ --files @语法；
    // 无标题多文档（files）→ 批量切分；单文档标题（titles）→ --titles；单文档无标题 → --file
    if (best.command === 'unitize' && params.fileTitles) {
      const segs = params.fileTitles.split(';').filter(Boolean).map(seg => {
        const idx = seg.indexOf(':');
        if (idx < 0) return seg;
        const f = seg.slice(0, idx);
        const ts = seg.slice(idx + 1);
        return ts ? `${f}@${ts}` : f;
      });
      fullCommand += ` --files "${segs.join(',')}"`;
      paramNotes.push(`📦 文档+标题组: ${params.fileTitles}`);
    } else if (best.command === 'unitize' && params.files && params.files.split(',').length > 1) {
      fullCommand += ` --files "${params.files}"`;
      paramNotes.push(`📦 多文档批量切分: ${params.files}`);
    } else if (best.command === 'unitize' && params.file) {
      fullCommand += ` --file "${params.file}"`;
      paramNotes.push(`📄 文档: ${params.file}`);
    }
    // v8.3.337+: doc2spec 文件参数（.md/.docx/.doc/.pdf 均提取）与 --normalize 显式开启
    // （AI 标题规范化默认关闭，仅用户说「按标准文档转换/调整」时开启）
    if (best.command === 'doc2spec' && params.file) {
      fullCommand += ` -f "${params.file}"`;
      paramNotes.push(`📄 文档: ${params.file}`);
    }
    if (best.command === 'doc2spec' && params.normalize) {
      fullCommand += ` --normalize`;
      paramNotes.push(`📝 标准标题: 转换后按 SpecCore 标准标题体系调整`);
    }
    // v8.3.334+: 单文档标题过滤（--titles）——文件+标题组合；与 --content 内容模式互斥
    if (best.command === 'unitize' && params.titles && !params.fileTitles && !params.content) {
      fullCommand += ` --titles "${params.titles.replace(/"/g, '\\"')}"`;
      paramNotes.push(`🎯 仅切分标题: ${params.titles}`);
    }
    // v8.3.318+: unitize 直接切分一段文档内容（「把这段内容切分成功能单元：...」）——
    // 双引号转义防注入；宿主可从 user 消息中带内容时同时给 --title 定文档名
    if (best.command === 'unitize' && params.content) {
      fullCommand += ` --content "${params.content.replace(/"/g, '\\"')}"`;
      if (params.title) fullCommand += ` --title "${params.title.replace(/"/g, '\\"')}"`;
      paramNotes.push(`📝 内容切分${params.title ? `（文档名: ${params.title}）` : ''}`);
    }
    // v8.3.257: --scope 不是通用选项（仅 dashboard/verify/analyze 注册）。sync 用 --global 布尔，
    // 其余命令只作提示，避免死参数
    if (params.scope && best.command !== 'analyze') {
      if (best.command === 'sync') {
        fullCommand += ` --global`;
      } else if (best.command === 'dashboard') {
        fullCommand += ` --scope ${params.scope}`;
      }
      paramNotes.push(`🌐 范围: ${params.scope}`);
    }
    // v8.3.255+: analyze 意图若仍带 scope=global（旧语料），改路由到 global analyze，不拼 --scope global
    if (best.command === 'analyze' && params.scope === 'global') {
      fullCommand = params.fromCode ? `speccore global from-source` : `speccore global analyze`;
      paramNotes.push(`🌐 全局层: 已路由到 speccore global`);
    }
    if (params.fromCode) {
      fullCommand += ` --from-code`;
      paramNotes.push(`🔍 源码反推: 从源码生成需求与技术文档`);
    }
    if (params.withCode) {
      fullCommand += ` --with-code`;
      paramNotes.push(`🔍 源码扫描: 结合工程源码分析`);
    }
    // v8.3.190+: 澄清步骤 ask 单次覆盖（仅 analyze 命令消费 optional_steps.clarify）
    if (best.command === 'analyze') {
      if (params.clarify === 'on') {
        fullCommand += ` --clarify`;
        paramNotes.push(`🔍 澄清: 强制澄清`);
      } else if (params.clarify === 'off') {
        fullCommand += ` --skip-clarify`;
        paramNotes.push(`⏭️ 澄清: 跳过`);
      }
    }
    // v8.3.190+: run 流水线意图 — preset 或起止点自动编排
    if (best.command === 'run') {
      if (params.preset) {
        fullCommand += ` --preset ${params.preset}`;
        paramNotes.push(`🎯 流水线: ${params.preset}`);
      }
      if (params.from) {
        fullCommand += ` --from ${params.from}`;
        paramNotes.push(`📍 起点: ${params.from}`);
      }
      if (params.to) {
        fullCommand += ` --to ${params.to}`;
        paramNotes.push(`🏁 终点: ${params.to}`);
      }
      if (params.gate) {
        fullCommand += ` --gate ${params.gate}`;
        paramNotes.push(`🤖 闸口: 全自动（跳过 A/B）`);
      }
    }
    // v6.97.0+: 重新/补充分析模式
    if (params.supplement) {
      fullCommand += ` --supplement`;
      paramNotes.push(`🔄 补充模式: 追加到现有报告`);
    }
    if (params.sync) {
      fullCommand += ` --sync`;
      paramNotes.push(`💾 同步模式: 局部回写到 020-specs/`);
    }
    if (params.tool) {
      fullCommand += ` --tool="${params.tool}"`;
      paramNotes.push(`🔧 工具/平台: ${params.tool}`);
    }
    // v7.4.0+: DEV_GUIDE.md 是标准文档，始终生成，无需参数控制
    // v8.3.257: taskify 默认走 AI 增强路径（--prompt），除非用户明确要求传统模式。
    // v8.3.231 起 split 已正名 taskify（command 恒为 'iteration taskify'，旧判断是死分支）
    if ((best.command === 'iteration taskify' || best.command === 'taskify') && !params.splitDirect) {
      fullCommand += ` --prompt`;
      paramNotes.push(`🧠 模式: AI 智能拆分（输出 Prompt 供 AI 分析）`);
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
      detailLines.push(`  • ${r.intent} (${r.confidence}%) — speccore ${formatCommandDisplay(r)}`);
    }
    detailLines.push('');
  }

  // 确认提示
  detailLines.push('⚠️  请确认后执行以上命令。');
  detailLines.push('  输入 y/回车 确认，或修改参数后重新输入。');

  const detail = `[SPECCORE_MODE: match]\n${detailLines.join('\n')}`;

  // v6.97.0+ 修复：强制确认命令列表 — 即使置信度高也需要用户确认
  // 这些命令会产生文件/副作用，不能误执行
  const FORCE_CONFIRM_COMMANDS = new Set([
    'analyze', 'global', 'iteration taskify', 'taskify', 'plan', 'execute', 'run',
    'doc2spec', 'spec2doc', 'iteration', 'task',
    'pr', 'done', 'change', 'reindex',
  ]);
  const needsConfirm = FORCE_CONFIRM_COMMANDS.has(best.command);

  // autoExec 仅在置信度 >= highThreshold 时启用
  // 但强制确认命令始终带 confirm 标记，AI 上下文不会直接执行
  const shouldAutoExec = best.confidence >= config.routing.highThreshold;

  return {
    mode: 'match',
    summary: `匹配到: ${best.intent} (${best.confidence}%) → ${fullCommand}`,
    detail,
    commands: [best.command],
    autoExec: shouldAutoExec ? {
      // v8.3.317 修复：无参数命令（如 `speccore unitize`）下 args 提取正则失配，
      // args 保留了整个 fullCommand → 执行标记畸形（speccore unitize speccore unitize）。
      // 改用首空格拆分：无空格则 args 为空，绝不回退整串。
      command: fullCommand.replace(/^speccore\s+/, '').split(/\s+/)[0],  // 主命令
      args: (() => {
        const rest = fullCommand.replace(/^speccore\s+/, '');
        const idx = rest.indexOf(' ');
        return idx === -1 ? '' : rest.slice(idx + 1);                     // 子命令 + 参数
      })(),
      // v6.97.0+ 修复：强制确认命令始终要求确认，避免"直接就乱搞"
      confirm: needsConfirm || best.confidence < 95,
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
  // v8.3.160+: 增加复合意图维度
  const scores = {
    batchExec: 0,
    newFeature: 0,
    auto: 0,
    analyzeSplit: 0,
    planExecute: 0,
  };

  // 维度1: 动作词
  const actionWords: [RegExp, number, keyof typeof scores][] = [
    [/(?:定时|指定时间|几点|晚.*点|早上.*点|明天.*点|到.*点|时间.*执行)/, 40, 'batchExec'],
    [/(?:分批|批次|batch|分.*批|多个)|(\d+[\s]*(?:个|批次|任务))/, 30, 'batchExec'],
    [/(?:执行|跑|运行|execute|run)/, 10, 'batchExec'],
    [/(?:实现|动手|做|开发|feature|新.*功能|新.*模块)/, 40, 'newFeature'],
    [/(?:自主|自动|一键|不用确认|直接|全部.*执行|全自动)/, 30, 'auto'],
    // v8.3.160+: 复合意图动作词
    [/(?:分析.*拆分|拆分.*任务|分析.*然后.*拆分|先分析.*再拆分)/, 40, 'analyzeSplit'],
    [/(?:计划.*执行|排程.*执行|先计划.*再执行|分析.*计划.*执行)/, 40, 'planExecute'],
  ];
  for (const [re, wt, key] of actionWords) {
    if (re.test(lower)) scores[key] += wt;
  }

  // 维度2: 上下文词（得分加权）
  if (/计划|plan|安排|排程|规划/.test(lower)) scores.batchExec += 20;
  if (/任务|task|代码审查|review|测试|test/.test(lower)) scores.batchExec += 15;
  if (/所有|全部|都|each|every|all/.test(lower)) scores.auto += 20;
  if (/先看|先列|先.*看|预览|看看|再说|然后|再.*执行/.test(lower)) scores.auto -= 30; // 说明想要交互
  // v8.3.160+: 复合意图上下文词
  if (/分析|analyze|audit|审计/.test(lower) && /拆分|split|task|任务/.test(lower)) scores.analyzeSplit += 20;
  if (/计划|plan|排程/.test(lower) && /执行|execute|跑|运行/.test(lower)) scores.planExecute += 20;
  if (/分析|analyze/.test(lower) && /计划|plan/.test(lower) && /执行|execute/.test(lower)) scores.planExecute += 15;

  // 维度3: 复杂度 — 只要有一点不确定，必须确认
  // 触发复杂度 = 任何多步骤/定时/多任务/审查/修改 的信号
  const isComplex = (
    // 计划+执行 组合
    (/计划|plan|安排|排程/.test(lower) && /执行|跑|execute/.test(lower)) ||
    // 分析+拆分 组合
    (/分析|analyze|审计/.test(lower) && /拆分|split|任务|task/.test(lower)) ||
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
  if (/别|不要|不.*执行|先别|取消/.test(lower)) { scores.batchExec = 0; scores.auto = 0; scores.analyzeSplit = 0; scores.planExecute = 0; }

  // 判断：batchExec 最高 → 批量流程
  const hasAuto = scores.auto > 0;
  // auto 模式 ≠ 跳过确认，auto = 确认后全自动执行步骤
  // 只有简单任务才真正跳过确认
  const needConfirm = !isSimple;
  if (scores.batchExec >= 40) {
    const wfName = 'batch execute';
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

  // v8.3.160+: 匹配 analyze-split 复合意图
  if (scores.analyzeSplit >= 40) {
    const steps = WORKFLOWS['analyze-split-plan'];
    return {
      mode: 'pipeline',
      summary: `已编排「分析→拆分→计划」流程（${steps.length} 步）`,
      detail: buildPipelineDetail(steps, input),
      commands: steps.map(s => s.command),
      pipeline: { steps, input, confirm: true },
    };
  }

  // v8.3.160+: 匹配 plan-execute 复合意图
  if (scores.planExecute >= 40) {
    const hasAnalyze = /分析|analyze|审计|audit/.test(lower);
    const wfName = hasAnalyze ? 'analyze-plan-execute' : 'plan-execute';
    const steps = WORKFLOWS[wfName];
    return {
      mode: 'pipeline',
      summary: `已编排「${hasAnalyze ? '分析→' : ''}计划→执行」流程（${steps.length} 步）`,
      detail: buildPipelineDetail(steps, input),
      commands: steps.map(s => s.command),
      pipeline: { steps, input, confirm: true },
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

  // 默认返回 guide（降级到 match 若 guide 无匹配）
  const guideResult = handleGuide(input);
  if (guideResult) return guideResult;
  return {
    mode: 'match',
    summary: '未匹配到编排模式',
    detail: '无法识别为 Pipeline 模式，请尝试更具体的描述。',
    commands: [],
  };
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

export async function askEngine(input: string, options?: AskEngineOptions): Promise<AskResult> {
  const isExplicit = options?.explicit || false;
  // ═══════════════════════════════════════════════════════════
  // 第零层: 确定性操作直接路由（零成本，最高优先级）
  // ═══════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════
  // 第零层: 补充分析意图快速检测（正则零成本，不受缓存干扰）
  // 放在所有层之前，避免缓存模糊匹配导致误触发
  // ═══════════════════════════════════════════════════════════
  if (SUPPLEMENT_INTENT.test(input) && !SUPPLEMENT_EXCLUDE.test(input)) {
    const fullCommand = `speccore analyze --supplement`;
    const detail = [
      `🎯 推荐命令: ${fullCommand}`,
      `追加未覆盖的源码文件到现有分析报告（不重新生成全部文档）`,
      ``,
      `💡 也可以指定目录:`,
      `  speccore analyze --supplement --source-scope <目录>`,
      `  speccore analyze --supplement --depth deep（每次多读一些）`,
    ].join('\n');
    return { mode: 'match', summary: `✅ 推荐: ${fullCommand}`, detail, commands: ['analyze --supplement'] };
  }

  // ═══════════════════════════════════════════════════════════
  // 加载统一配置（环境变量 > ask.json > 默认值）
  // ═══════════════════════════════════════════════════════════
  const config = await loadAskConfig();

  // ═══════════════════════════════════════════════════════════
  // 第一层: 意图缓存（零成本，高频意图越用越快）
  // ═══════════════════════════════════════════════════════════
  if (config.routing.cacheEnabled) {
    const cached = await getCachedIntent(input);
    if (cached) {
      logger.info(`💾 缓存命中: "${input.slice(0, 30)}..."`);
      return cached;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 第二层: 本地意图引擎（关键词+正则+上下文）
  // ═══════════════════════════════════════════════════════════
  const mode = classifyMode(input);
  let localResult: AskResult;
  let localCandidates: IntentResult[] = [];

  switch (mode) {
    case 'explain':
      localResult = handleExplain(input);
      break;
    case 'guide': {
      const guide = handleGuide(input);
      localResult = guide || await handleMatch(input, isExplicit);
      break;
    }
    case 'pipeline':
      localResult = handlePipeline(input);
      // v8.3.263: 编排未匹配时回退单命令识别——「分析/执行」双动作词会误入
      // pipeline 判定，但「对当前迭代执行需求分析并落盘」实为 analyze 单命令；
      // 不兜底会输出「未匹配到编排模式」且被负面缓存固化
      if (!localResult.commands || localResult.commands.length === 0) {
        localCandidates = await recognizeIntent(input);
        localResult = await handleMatch(input, isExplicit);
      }
      break;
    default:
      localCandidates = await recognizeIntent(input);
      localResult = await handleMatch(input, isExplicit);
  }

  // 知识图谱语义增强：如果本地引擎匹配到需要 task 的命令但缺少参数，尝试从图谱补全
  localResult = await enrichWithKG(localResult, input);

  // 项目名片按需注入：用户句中出现端名/业务名/类型词（前端/后端/H5端）时，把对应名片附到结果
  localResult = await enrichWithProjectCards(localResult, input);

  // 计算本地置信度（explain/guide/pipeline 视为高置信度）
  // v8.3.184+ degrade to honesty：按匹配层级诚实赋值，触发词匹配不得伪装成精确匹配
  const hasKbMatch = localResult.commands.length > 0 && localResult.mode === 'match' && !localResult.summary.includes('未识别');
  const kbMatchConf = lastKbMatchType === 'name' || lastKbMatchType === 'alias' ? 90   // 精确匹配命令名
    : lastKbMatchType === 'synonym' ? 80                                                // 同义词表（显式映射）
    : lastKbMatchType === 'trigger' ? 60                                                // 触发词（是猜的，需确认）
    : 55;
  const fallbackConfidence = localResult.autoExec ? 85 : (mode === 'explain' || mode === 'pipeline') ? 90 : hasKbMatch ? kbMatchConf : 55;
  const localConfidence = hasKbMatch
    ? (lastKbMatchType === 'trigger'
        ? 60  // 触发词匹配：诚实封顶 60，走中分区（宿主 AI 双路确认），不被意图识别虚高分抬升
        : Math.max(localCandidates[0]?.confidence || 0, fallbackConfidence))
    : (localCandidates[0]?.confidence || fallbackConfidence);

  // --rules / forceHostAi 强制所有请求走 AI
  const forceHostAi = input.includes('--rules') || config.rules.forceHostAi;

  // ═══════════════════════════════════════════════════════════
  // 第三层: 三段式动态路由策略
  // ═══════════════════════════════════════════════════════════
  //
  //  ┌─────────────────────────────────────────────────────┐
  //  │  ≥ highThreshold (70)  │ 本地直接执行，不打扰 AI    │
  //  │  lowThreshold~high     │ 双路并行，取更优结果       │
  //  │  < lowThreshold (45)   │ 直接交给 AI，本地只提参数  │
  //  └─────────────────────────────────────────────────────┘

  // ── 段1: 高分区 ── 本地引擎直接执行，零AI成本 ──
  if (!forceHostAi && localConfidence >= config.routing.highThreshold) {
    if (config.routing.cacheEnabled) await cacheIntent(input, localResult, 'local');
    return localResult;
  }

  // ── 段2: 中分区 ── 双路并行，取更优结果 ──
  if (!forceHostAi && localConfidence >= config.routing.lowThreshold) {
    // 本地结果已就绪，同时触发宿主AI
    const hostPromise = tryHostAiEnhanced(input, localCandidates);
    const hostResult = await hostPromise;

    if (hostResult && hostResult.commands.length > 0) {
      // AI 返回有效结果 → 优先AI（语义理解更精准）
      const enriched = await enrichWithProjectCards(hostResult, input);
      if (config.routing.cacheEnabled) await cacheIntent(input, enriched, 'host-ai');
      return enriched;
    }
    // AI 不可用或失败 → 回退本地
    if (config.routing.cacheEnabled) await cacheIntent(input, localResult, 'local');
    return localResult;
  }

  // ── 段3: 低分区 ── 直接交给AI，本地只负责提取参数 ──
  // 此时本地引擎置信度不足，优先AI语义判断
  if (forceHostAi || config.routing.autoHostAi) {
    if (mode === 'match' || mode === 'ambiguous') {
      const hostResult = await tryHostAiEnhanced(input, localCandidates);
      if (hostResult && hostResult.commands.length > 0) {
        const enriched = await enrichWithProjectCards(hostResult, input);
        if (config.routing.cacheEnabled) await cacheIntent(input, enriched, 'host-ai');
        return enriched;
      }
      // 自有LLM冗余（用户配置了provider时启用）
      const llmResult = await tryLlmProviders(input, config);
      if (llmResult) {
        const enriched = await enrichWithProjectCards(llmResult, input);
        if (config.routing.cacheEnabled) await cacheIntent(input, enriched, 'llm');
        return enriched;
      }
    }
  }

  // ── 兜底 ── 所有AI路径都失败，返回本地结果
  return localResult;
}

// ═══════════════════════════════════════════════════════════
// 知识图谱语义增强：把用户输入中的任务/需求描述映射到图谱实体
// ═══════════════════════════════════════════════════════════

const STOP_WORDS = new Set(['的', '与', '和', '及', '在', '中', '对', '为', '是', '有', '从', '到', 'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'for', 'on', 'with']);

/** 从输入中提取有意义的查询词 */
function extractQueryTokens(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t));
}

/** 计算两个字符串的相似分 (0-1) */
function similarityScore(queryTokens: string[], title: string): number {
  const lowerTitle = title.toLowerCase();
  let hits = 0;
  for (const t of queryTokens) {
    if (lowerTitle.includes(t)) hits++;
  }
  return queryTokens.length > 0 ? hits / queryTokens.length : 0;
}

/**
 * 尝试从知识图谱中匹配用户输入引用的任务或需求
 * 返回最佳匹配的实体 ID 和类型
 */
async function tryMatchEntityFromKG(
  input: string
): Promise<{ id: string; type: string; title: string; score: number } | null> {
  try {
    const graph = await loadFreshKnowledgeGraph(process.cwd());
    if (!graph || Object.keys(graph.entities).length === 0) return null;

    // 优先检查是否直接提及了实体 ID（如 Task-001, REQ-001）
    const idMatch = input.match(/(?:Task|REQ)-\d+/i);
    if (idMatch) {
      const exactId = idMatch[0];
      const entity = graph.entities[exactId];
      if (entity) {
        return { id: entity.id, type: entity.type, title: entity.title, score: 1.0 };
      }
    }

    const queryTokens = extractQueryTokens(input);
    if (queryTokens.length === 0) return null;

    let best: { id: string; type: string; title: string; score: number } | null = null;

    for (const entity of Object.values(graph.entities)) {
      // 只关注 task / requirement / spec
      if (!['task', 'subtask', 'requirement', 'spec'].includes(entity.type)) continue;

      const score = similarityScore(queryTokens, entity.title);
      if (score >= 0.5 && (!best || score > best.score)) {
        best = { id: entity.id, type: entity.type, title: entity.title, score };
      }
    }

    return best;
  } catch {
    return null;
  }
}

/** 判断命令是否需要 task 参数 */
function commandNeedsTask(command: string): boolean {
  return ['execute', 'analyze', 'plan', 'pr', 'done', 'change', 'task-create'].includes(command);
}

/** 将知识图谱匹配结果注入到 AskResult 中 */
async function enrichWithKG(
  result: AskResult,
  input: string
): Promise<AskResult> {
  if (result.mode !== 'match' || result.commands.length === 0) return result;
  const primaryCommand = result.commands[0];
  if (!commandNeedsTask(primaryCommand)) return result;

  // 如果已经有 task 参数，不重复注入
  const hasTaskParam = result.autoExec?.args?.includes('--task') || result.autoExec?.args?.includes('-t');
  if (hasTaskParam) return result;

  const match = await tryMatchEntityFromKG(input);
  if (!match || match.score < 0.6) return result;

  const taskArg = match.type === 'subtask' ? match.id.split('-').slice(0, 2).join('-') : match.id;
  const newArgs = result.autoExec?.args ? `${result.autoExec.args} --task ${taskArg}` : `--task ${taskArg}`;

  logger.info(`🔗 知识图谱增强: "${input.slice(0, 30)}..." → ${match.id}(${match.title})`);

  return {
    ...result,
    summary: `${result.summary} (KG: ${match.id})`,
    detail: result.detail + `\n\n🔗 知识图谱匹配: ${match.id} — ${match.title}`,
    autoExec: result.autoExec
      ? { ...result.autoExec, args: newArgs }
      : { command: primaryCommand, args: newArgs, confirm: true },
  };
}

// ═══════════════════════════════════════════════════════════
// 项目名片按需注入：用户句中出现端名/业务名/类型词时，把对应名片附到结果
// 设计：未提到项目 → 零注入（0 token）；提到 N 端 → 注入 N 张小名片（约 40 token/端）
// ═══════════════════════════════════════════════════════════

async function enrichWithProjectCards(result: AskResult, input: string): Promise<AskResult> {
  if (!input || !result || result.mode === 'explain') return result;
  if (result.projectCards) return result; // 已注入过，幂等防重
  let platforms: PlatformConfig[] = [];
  try {
    const cfg = await loadProjectConfig();
    platforms = cfg?.platforms || [];
  } catch {
    return result; // 配置缺失时静默跳过，不影响主流程
  }
  const hits = matchProjectsFromText(input, platforms);
  if (hits.length === 0) return result;
  const block = formatProjectCardInjection(hits);
  return { ...result, projectCards: block, detail: result.detail + '\n\n' + block };
}

// ═══════════════════════════════════════════════════════════
// 宿主AI增强（传入Rich Context）
// ═══════════════════════════════════════════════════════════

async function tryHostAiEnhanced(input: string, candidates: IntentResult[]): Promise<AskResult | null> {
  const context = await buildAskContext(input, candidates);
  try {
    const hostResult = await tryHostAi('ask', input, {
      ...context,
      formattedContext: formatContextForHostAi(context),
    });
    if (hostResult) {
      logger.info(`🤖 宿主AI增强成功: ${hostResult.summary || hostResult.mode}`);
      return hostResult as AskResult;
    }
  } catch (e: any) {
    logger.debug(`宿主AI增强失败: ${e.message}`);
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// 多LLM冗余路由（用户配置了provider时启用，默认禁用）
// ═══════════════════════════════════════════════════════════

async function tryLlmProviders(input: string, config: { llmProviders: any[] }): Promise<AskResult | null> {
  const enabledProviders = (config.llmProviders || [])
    .filter(p => p.enabled)
    .sort((a, b) => a.priority - b.priority);

  if (enabledProviders.length === 0) return null;

  for (const provider of enabledProviders) {
    try {
      // 注入provider配置到环境变量（临时）
      if (provider.endpoint) process.env.SPECCORE_LLM_ENDPOINT = provider.endpoint;
      if (provider.apiKey) process.env.SPECCORE_LLM_KEY = provider.apiKey;
      if (provider.model) process.env.SPECCORE_LLM_MODEL = provider.model;

      const llmResult = await askWithLlm(input);
      if (llmResult && llmResult.commands.length > 0) {
        logger.info(`🧠 ${provider.name} 响应成功: ${llmResult.mode}`);
        (llmResult as any)._source = 'llm';
        return llmResult;
      }
    } catch (e: any) {
      logger.warn(`${provider.name} 不可用: ${e.message}`);
    }
  }

  return null;
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
    `  一键执行: speccore run（自动检测并推进）`,
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

// ═══════════════════════════════════════════════════════════
// v8.3.301+: from-source 端名自动映射（PROJECT.yaml → --platform + --src）
// 纯函数 resolvePlatformFromInput 供测试直接覆盖，enrichFromSourceCommand 做异步装配
// ═══════════════════════════════════════════════════════════

/**
 * 从用户原话中解析端名（先标准端名 name，再中文描述 description/project_name）。
 * 标准端名取最长命中，避免短名子串误伤（如 api 命中 admin-web 里的 api）。
 */
export function resolvePlatformFromInput(input: string, platforms: PlatformConfig[]): PlatformConfig | null {
  if (!platforms || platforms.length === 0) return null;
  const lower = input.toLowerCase();
  let best: PlatformConfig | null = null;
  let bestLen = 0;
  for (const p of platforms) {
    const name = (p.name || '').toLowerCase();
    if (name.length >= 3 && lower.includes(name) && name.length > bestLen) {
      best = p;
      bestLen = name.length;
    }
  }
  if (best) return best;
  // 中文端描述/工程名（长度≥2 防单字误匹配）
  for (const p of platforms) {
    for (const desc of [p.description, p.project_name]) {
      if (desc && desc.length >= 2 && input.includes(desc)) return p;
    }
  }
  return null;
}

/**
 * 从用户原话中解析端列表（多端，v8.3.381+）。优先级：
 * 1. 精确单端命中（端名/中文描述/工程名）——最具体意图优先，
 *    防止「会议预订后端工程」被类型词扩成所有后端；
 * 2. 类型词命中——「前端/前端项目」→ 全部 frontend 端，「后端/后端项目」→ 全部 backend 端，
 *    前后端同现 → 两类并集；
 * 3. 全量词命中——「所有端/所有工程/所有项目」→ 全部端；
 * 4. 无命中 → 空数组。
 */
export function resolvePlatformsFromInput(input: string, platforms: PlatformConfig[]): PlatformConfig[] {
  if (!platforms || platforms.length === 0) return [];
  const single = resolvePlatformFromInput(input, platforms);
  if (single) return [single];
  // 「前后端/全栈」两词均不包含「前端」「后端」子串，需单列，否则漏配
  const bothTypes = /前后端|全栈|fullstack|full-stack/i.test(input);
  const hasFrontend = bothTypes || /前端|frontend|web\s*端|h5\s*端/i.test(input);
  const hasBackend = bothTypes || /后端|backend|服务端|server/i.test(input);
  if (hasFrontend || hasBackend) {
    const types = new Set<string>();
    if (hasFrontend) types.add('frontend');
    if (hasBackend) types.add('backend');
    const matched = platforms.filter(p => types.has(p.type));
    if (matched.length > 0) return matched;
  }
  if (/所有端|所有工程|所有项目|全部端|全部工程|全部项目/.test(input)) return platforms;
  return [];
}

/**
 * 为 global from-source 命令自动补端参数：
 * 用户句中出现 PROJECT.yaml 端名/描述或「前端/后端/所有端」类型词 →
 * --platform <name1,name2> + --src <code_path1,code_path2>（配了才加）。
 * 配置加载失败时静默返回原命令，不影响主流程。
 */
export async function enrichFromSourceCommand(
  input: string,
  fullCommand: string,
): Promise<{ command: string; note?: string }> {
  let platforms: PlatformConfig[] = [];
  try {
    const cfg = await loadProjectConfig();
    platforms = cfg?.platforms || [];
  } catch {
    return { command: fullCommand };
  }
  // v8.3.381: 多端解析——「所有前端项目」这类类型词此前漏配 --src/--platform，
  // CLI 空 src 走 DEFAULT_SCOPE 全扫，把后端也反推了；此处按类型词过滤端列表。
  const matched = resolvePlatformsFromInput(input, platforms);
  if (matched.length === 0) return { command: fullCommand };
  let command = fullCommand;
  const srcs = matched.map(p => p.code_path).filter((s): s is string => !!s);
  if (srcs.length > 0) command += ` --src "${srcs.join(',')}"`;
  command += ` --platform "${matched.map(p => p.name).join(',')}"`;
  const names = matched.map(p => p.name).join(',');
  const note = srcs.length > 0
    ? `📍 端映射: ${names} → 源码 ${srcs.join(',')}`
    : `📍 端映射: ${names}（PROJECT.yaml 未配 code_path，仅按端过滤，需手动 --src）`;
  return { command, note };
}
