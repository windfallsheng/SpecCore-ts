/**
 * 意图识别引擎
 * 基于 SpecCore v4.0 的自然语言意图识别引擎
 * 支持 31 种意图类型、200+ 关键词匹配、置信度计算、上下文感知增强
 */

import { loadContext, detectActiveIteration, Context } from './context';

// ============================================================
// 类型定义
// ============================================================

/** 意图类型 */
export type IntentType =
  | 'change'              // 需求变更
  | 'execute'             // 执行开发
  | 'create'              // 创建功能/任务
  | 'iteration_create'    // 创建迭代
  | 'analyze'             // 分析需求
  | 'split'               // 任务拆分
  | 'pr'                  // Pull Request
  | 'done'                // 完成任务
  | 'review'              // 审查
  | 'plan'                // 方案/计划
  | 'reference'           // 参考查找
  | 'archive'             // 归档
  | 'query_progress'      // 查询进度
  | 'handover'            // 交接
  | 'health'              // 健康度
  | 'config'              // 配置
  | 'help'                // 帮助
  | 'demo'                // 体验
  | 'welcome'             // 引导
  | 'init'                // 初始化
  | 'bugfix'              // Bug 修复
  | 'research'            // 调研
  | 'sync'                // 同步
  | 'retro'               // 回顾
  | 'template_add'        // 添加模板
  | 'import_to_global'    // 导入到全量层
  | 'iteration_from_global' // 从全量生成迭代
  | 'sync_to_global'      // 同步到全量层
  | 'global_status'       // 全量层状态
  | 'history'             // 历史查询
  | 'impact'              // 影响分析
  | 'baseline'            // 版本基线
  | 'dashboard'           // 仪表盘
  | 'audit'               // 智能审计
  | 'rename'              // 重命名
  | 'new_task'            // 新建多平台Task
  | 'platform_add'        // 添加平台
  | 'index_update'        // 更新索引
  | 'context'            // 查看上下文
  | 'doc2spec'           // Word 需求文档导入
  | 'synthesize';        // 需求文档智能合成

/** 意图匹配结果 */
export interface IntentResult {
  intent: IntentType;
  command: string;
  confidence: number;
  priority: number;
  matchedTriggers: string[];
  extractedParams: Record<string, string>;
  contextAware: boolean;
}

/** 命令映射条目 */
export interface CommandMapping {
  id: string;
  intent: IntentType;
  priority: number;
  triggers: string[];
  patterns: string[];
  description: string;
  args?: string;
}

// ============================================================
// 命令映射表（12 种意图，按优先级排序）
// ============================================================

const COMMAND_MAPPINGS: CommandMapping[] = [
  // 变更层 - 优先级最高（"改成"不应被"做"匹配）
  // 包含变更 + 新增需求两种意图，change 命令内部再区分
  {
    id: 'change',
    intent: 'change',
    priority: 100,
    triggers: ['改成', '改为', '调整', '修改', '更新', '变更', '升级', '换成', '替换', '加', '改了', '改一下'],
    patterns: ['把(.+)改成(.+)', '将(.+)调整为(.+)', '修改(.+)', '升级(.+)', '换成(.+)', '加(.+)', '改了(.+)', '改一下(.+)'],
    description: '需求变更/新增 — 智能匹配受影响任务或创建新任务，支持 inbox 附件和澄清',
  },
  // 执行层
  {
    id: 'execute',
    intent: 'execute',
    priority: 90,
    triggers: ['开始', '执行', '干活', '继续', '开发', '做', '跑', '开工', '跑一下'],
    patterns: ['开始(.+)', '继续(.+)', '开发(.+)', '做(.+)', '执行(.+)'],
    description: '执行控制中心 — 按过滤条件执行开发任务，支持断点续传',
  },
  // Bug 修复
  {
    id: 'bugfix',
    intent: 'bugfix',
    priority: 88,
    triggers: ['修复', '解决', 'bug', '报错', '错误', '超时', '出问题了'],
    patterns: ['修复(.+)问题', '修复(.+)bug', '解决(.+)', '(.+)报错'],
    description: '快速 Bug 修复 — 创建修复任务并关联变更联动',
  },
  // 创建层
  // 创建迭代（必须在通用创建之前，优先级更高）
  {
    id: 'iteration create',
    intent: 'iteration_create',
    priority: 92,
    triggers: ['创建迭代', '新建迭代创建sprint'],
    patterns: ['创建(.+)迭代创建(.+)迭代'],
    description: '创建新迭代 — 生成 STAFFING + 产品需求 + 需求文档目录',
    args: '--name=<name> --owner=<owner>',
  },
  // 需求分析（全局级 + 迭代级 + 任务级 + 重新/补充分析）
  {
    id: 'analyze',
    intent: 'analyze',
    priority: 90,
    triggers: [
      // 迭代级
      '分析需求', '需求分析', 'AI分析', '代码分析', '分析代码',
      '迭代分析', '分析迭代', '本迭代分析', '当前迭代分析',
      // 全局级（v6.97.0+ 修复：避免全局分析 fallback 到迭代层）
      '全局分析', '全局层分析', '分析全局层', '分析全局',
      '全量分析', '全量层分析', '分析全量层', '分析全量',
      '项目分析', '分析项目', '分析整体架构',
      '分析所有端', '分析所有工程', '跨端分析', '全局架构分析',
      '整体分析', '全项目分析', '项目架构分析',
      '分析整个系统', '分析整个项目', '分析所有源码',
      // 任务级（v6.97.0+ 新增：子任务/单任务分析）
      '任务分析', '分析任务', '子任务分析', '分析子任务',
      'Task分析', '分析Task', '当前任务分析', '单任务分析',
      // 重新/补充分析（v6.97.0+ 新增：覆盖 --supplement / --sync）
      '重新分析', '再分析', '重新生成分析', '重新跑分析',
      '补充分析', '追加分析', '更新分析', '修正分析',
      '完善分析', '刷新分析', '重新评估', '重新审查',
    ],
    patterns: [
      '分析(.+)需求', '分析(.+)代码',
      '迭代(.+)分析', '本迭代(.+)分析',
      // 全局级匹配模式
      '全局分析(.+)', '全量分析(.+)', '分析所有(.+)',
      '分析项目(.+)', '项目(.+)分析', '整体(.+)分析',
      '跨端(.+)分析', '架构(.+)分析',
      // 任务级匹配模式
      '任务(.+)分析', '分析任务(.+)', '子任务(.+)分析',
      'Task(.+)分析', '分析Task(.+)',
      // 重新/补充分析匹配模式
      '重新(.+)分析', '再(.+)分析', '补充(.+)分析',
      '更新(.+)分析', '修正(.+)分析', '完善(.+)分析',
    ],
    description: 'AI 分析 — 需求完整性 + 改动范围 + 风险矩阵（支持全局级/迭代级/任务级/重新分析）',
    args: '-I <iteration> 或 --scope global|task --with-code --supplement --sync',
  },
  // 任务拆分
  {
    id: 'iteration split',
    intent: 'split',
    priority: 88,
    triggers: ['拆分任务', '拆分需求', '任务拆分', '智能拆分'],
    patterns: ['拆分(.+)任务', '拆分(.+)需求', '把(.+)拆'],
    description: '智能拆分 — 复杂度估算 + 人员分配 + 语义依赖',
    args: '-i <iteration> --interactive',
  },
  // PR 提交
  {
    id: 'pr',
    intent: 'pr',
    priority: 84,
    triggers: ['提交PR', '创建PR', '提PR', '发PR', 'pull request'],
    patterns: ['提交(.+)PR', '创建(.+)PR', '为(.+)提PR'],
    description: '创建 Pull Request — 自动推送 + 创建',
    args: '--task=<Task-ID>',
  },
  // 任务完成
  {
    id: 'done',
    intent: 'done',
    priority: 83,
    triggers: ['完成任务', '归档任务', '关闭任务', '任务完成'],
    patterns: ['完成(.+)任务', '归档(.+)任务'],
    description: '完成任务归档 — 校验 + 全局同步',
    args: '--task=<Task-ID> 或 --all',
  },
  // 创建任务（通用创建）
  {
    id: 'task new',
    intent: 'create',
    priority: 85,
    triggers: ['创建一个', '新增一个', '做一个', '实现', '添加一个', '新建', '创建', '新增'],
    patterns: ['创建(.+)', '新增(.+)', '做一个(.+)', '开发(.+)功能', '实现(.+)功能'],
    description: '创建新 Task — 从需求到代码的全流程',
    args: '"<name>" --desc="<description>"',
  },
  // 初始化
  {
    id: 'init',
    intent: 'init',
    priority: 85,
    triggers: ['初始化', '建立项目', '创建项目', '新建项目', '迁移项目'],
    patterns: ['初始化(.+)项目', '建立(.+)项目', '创建(.+)项目'],
    description: '项目初始化 — 创建 .speccore 配置目录和基础文件',
  },
  // 审查层
  {
    id: 'review',
    intent: 'review',
    priority: 80,
    triggers: ['审查', '检查', 'review', '查看产出', '核对', '校验'],
    patterns: ['审查(.+)', '检查(.+)', '查看(.+)产出', 'review(.+)'],
    description: '审查产出 — 检查任务产出物和验收标准是否符合规范',
  },
  // 调研
  {
    id: 'research',
    intent: 'research',
    priority: 80,
    triggers: ['调研', '评估', '选型', '对比'],
    patterns: ['调研(.+)方案', '调研(.+)技术', '评估(.+)技术', '对比(.+)'],
    description: '技术调研 — 评估技术方案、对比工具选项',
  },
  // 计划层
  {
    id: 'plan',
    intent: 'plan',
    priority: 78,
    triggers: ['方案', '计划', '怎么做', '怎么实现', '技术方案', '评估', '估算'],
    patterns: ['(.+)怎么做', '(.+)怎么实现', '需要(.+)时间', '评估(.+)'],
    description: '智能调度 — 分析依赖关系，生成并行执行方案',
  },
  // 归档层
  {
    id: 'archive',
    intent: 'archive',
    priority: 75,
    triggers: ['归档', '存档', '清理', '整理'],
    patterns: ['归档(.+)', '清理(.+)', '整理(.+)'],
    description: '归档任务 — 将已完成任务移动到归档目录',
  },
  // 参考层
  {
    id: 'reference',
    intent: 'reference',
    priority: 75,
    triggers: ['参考', '借鉴', '类似', '有没有', '之前', '以前'],
    patterns: ['参考(.+)', '借鉴(.+)', '有没有(.+)示例'],
    description: '模式搜索 — 在 PATTERNS 中搜索相关技术参考',
  },
  // 同步
  {
    id: 'sync',
    intent: 'sync',
    priority: 70,
    triggers: ['同步', '反向同步', '更新Spec', '对齐'],
    patterns: ['同步(.+)', '更新(.+)Spec', '对齐(.+)'],
    description: '反向同步 — 检测代码与 Spec 的差异并同步更新',
  },
  // 进度层
  {
    id: 'progress',
    intent: 'query_progress',
    priority: 70,
    triggers: ['进度', '进展', '完成多少', '还差', '多少'],
    patterns: ['进度(.+)', '进展(.+)', '完成(.+)'],
    description: '进度总览 — 多维度统计任务完成情况',
  },
  {
    id: 'status',
    intent: 'query_progress',
    priority: 68,
    triggers: ['状态', '情况', '怎么样了'],
    patterns: ['状态(.+)', '情况(.+)', '(.+)怎么样了'],
    description: '状态看板 — 简洁版任务状态总览',
  },
  // 交接
  {
    id: 'handover',
    intent: 'handover',
    priority: 65,
    triggers: ['交接', '转交', '移交', '交付'],
    patterns: ['交接(.+)', '转交(.+)', '生成交接文档'],
    description: '生成交接文档 — 汇总迭代关键信息和待办事项',
  },
  // 健康度
  {
    id: 'health',
    intent: 'health',
    priority: 65,
    triggers: ['健康', '质量', '评分'],
    patterns: ['健康度(.+)', '质量(.+)', '评分(.+)'],
    description: '项目健康度 — 4 维度质量评估与风险预警',
  },
  // 回顾
  {
    id: 'retro',
    intent: 'retro',
    priority: 60,
    triggers: ['回顾', '总结', '复盘', '反思'],
    patterns: ['回顾(.+)', '总结(.+)', '复盘(.+)'],
    description: '迭代回顾 — 总结经验和改进建议',
  },
  // 配置
  {
    id: 'config',
    intent: 'config',
    priority: 60,
    triggers: ['配置', '设置'],
    patterns: ['配置(.+)', '设置(.+)'],
    description: '配置管理 — 查看和修改框架功能开关',
  },
  // 模板
  {
    id: 'template-add',
    intent: 'template_add',
    priority: 55,
    triggers: ['添加模板', '新增模板', '保存模板'],
    patterns: ['添加(.+)模板', '新增(.+)模板', '保存(.+)模板'],
    description: '添加代码模板 — 将现有代码保存为可复用模板',
  },
  // 帮助
  {
    id: 'help',
    intent: 'help',
    priority: 50,
    triggers: ['帮助', '怎么用', '教程', '不会用', '如何使用'],
    patterns: ['帮助(.+)', '怎么用(.+)', '教程(.+)'],
    description: '命令帮助 — 查看所有可用命令和参数说明',
  },
  // 体验
  {
    id: 'demo',
    intent: 'demo',
    priority: 45,
    triggers: ['示例', '体验', '试一下', 'demo'],
    patterns: ['示例(.+)', '体验(.+)', '试一下(.+)'],
    description: '快速体验 — 5 分钟体验 SpecCore 完整流程',
  },
  // 引导
  {
    id: 'welcome',
    intent: 'welcome',
    priority: 40,
    triggers: ['引导', '第一次', '新手', '入门'],
    patterns: ['引导(.+)', '第一次使用', '新手入门', '入门(.+)'],
    description: '首次使用引导 — 交互式引导完成第一个功能开发',
  },
  // ============================================================
  // 全量层命令
  // ============================================================
  // 导入到全量层
  {
    id: 'import-to-global',
    intent: 'import_to_global',
    priority: 83,
    triggers: ['导入项目', '导入到全量层', '添加项目到全量'],
    patterns: ['导入(.+)项目到全量', '添加(.+)到全量层', '导入(.+)作为(.+)项目'],
    description: '导入到全量层 — 扫描项目代码并填充 GLOBAL/ 目录',
  },
  // 从全量生成迭代
  {
    id: 'iteration-from-global',
    intent: 'iteration_from_global',
    priority: 80,
    triggers: ['从全量生成', '基于全局创建', '选择需求生成迭代'],
    patterns: ['从全量(.*)生成迭代创建迭代', '选择(.*)需求生成迭代'],
    description: '从全量层生成迭代 — 按需求 ID 选择并生成新的迭代',
  },
  // 同步全量（已整合到 sync --global）
  {
    id: 'sync-global',
    intent: 'sync',
    priority: 70,
    triggers: ['同步全量', '同步全局', '更新全量层', '同步到全量'],
    patterns: ['同步(.*)到全量层', '更新全量层', '同步全量'],
    description: '全量层双向同步 — 已整合到 sync --global（迭代与全量层之间的双向同步）',
  },
  // 全量状态
  {
    id: 'global-status',
    intent: 'global_status',
    priority: 65,
    triggers: ['全量状态', '全局状态', '全量层', '查看全量', '全局看板'],
    patterns: ['全量状态', '全局状态', '查看全量层', '全局看板'],
    description: '查看全量仪表盘 — 所有项目、需求、架构总览（dashboard --scope global）',
  },
  // 历史
  {
    id: 'history',
    intent: 'history',
    priority: 55,
    triggers: ['历史', '变更记录', '谁改的', '什么时候'],
    patterns: ['查看(.*)历史', '(.*)变更记录', '谁改了(.*)', '(.*)的变更历史'],
    description: '查看需求历史 — 变更历史和版本演进',
  },
  // ============================================================
  // P0/P1/P2 新增命令
  // ============================================================
  // 影响分析 (P0)
  {
    id: 'impact',
    intent: 'impact',
    priority: 80,
    triggers: ['影响', '依赖', '波及', '影响分析', '变更影响', '会影响谁'],
    patterns: ['(.*)影响(.*)', '变更(.*)影响', '分析(.*)依赖', '(.*)会影响谁'],
    description: '变更影响分析 — 分析需求变更对上下游的影响范围',
  },
  // 版本基线 (P1)
  {
    id: 'baseline',
    intent: 'baseline',
    priority: 60,
    triggers: ['基线', '快照', '版本', '回滚'],
    patterns: ['创建基线', '打快照', '回滚', '(.*)基线'],
    description: '版本基线管理 — 创建需求快照、对比和回滚',
  },
  // 仪表盘 (P1)
  {
    id: 'dashboard',
    intent: 'dashboard',
    priority: 55,
    triggers: ['仪表盘', '看板', '可视化', '总览图'],
    patterns: ['仪表盘', '看板', '可视化', '生成.*总览'],
    description: '可视化仪表盘 — 生成 Chart.js 图表看板',
  },
  // 智能审计 (P2)
  {
    id: 'audit',
    intent: 'audit',
    priority: 50,
    triggers: ['审计', '扫描', '检查', '重复', '歧义'],
    patterns: ['智能审计', '扫描全量层', '检查重复需求'],
    description: 'AI 智能审计 — 发现重复需求、歧义描述、孤立需求',
  },
  // 重命名
  {
    id: 'rename',
    intent: 'rename',
    priority: 78,
    triggers: ['重命名', '改名', '修改名称', '更换名称', '改成', '改名为', '更名为'],
    patterns: ['把(.*)改成(.*)', '重命名(.*)为(.*)', '修改(.*)名称为(.*)', '(.*)改名为(.*)'],
    description: '重命名迭代/任务 — 自动更新所有关联引用',
  },
  // ============================================================
  // v4.0.0 新增命令
  // ============================================================
  // 新建多平台 Task (v4.0)
  {
    id: 'new-task',
    intent: 'new_task',
    priority: 84,
    triggers: ['新建任务', '创建任务', '多端任务', '全平台任务'],
    patterns: ['新建(.*)任务', '创建(.*)任务', '做一个(.*)任务', '为(.*)创建任务'],
    description: '创建多平台任务 — 支持 --platforms 指定前端平台',
  },
  // 添加平台 (v4.0)
  {
    id: 'platform-add',
    intent: 'platform_add',
    priority: 62,
    triggers: ['添加平台', '新增平台', '增加端', '新平台'],
    patterns: ['添加(.*)平台', '新增(.*)端', '增加(.*)平台'],
    description: '动态添加平台 — 自动同步到 platforms.yaml 和现有 Task',
  },
  // 更新索引 (v4.0)
  {
    id: 'index-update',
    intent: 'index_update',
    priority: 58,
    triggers: ['更新索引', '重建索引', '刷新索引'],
    patterns: ['更新索引', '重建索引', '刷新索引'],
    description: '索引更新 — 扫描需求文档自动重建 GLOBAL/INDEX.md',
  },
  // 查看上下文 (v4.0)
  {
    id: 'context',
    intent: 'context',
    priority: 60,
    triggers: ['上下文', '上下文状态', '加载状态', '当前状态', '查看上下文'],
    patterns: ['查看上下文', '上下文状态', '加载状态'],
    description: '上下文查看 — 查看 Task 的 Spec 文件加载状态和平台覆盖',
  },
  // Word 文档导入
  {
    id: 'doc2spec',
    intent: 'doc2spec',
    priority: 45,
    triggers: ['导入文档', 'word转', '需求文档', 'doc2spec', 'Word需求', 'PRD导入', '转换文档', 'docx'],
    patterns: ['导入.*文档', '.*word.*转', '需求.*word', 'PRD.*导入', '文档.*转换'],
    description: 'Word 需求文档导入 — 将 .docx/.doc 格式的 PRD 转换为 SpecCore Markdown',
  },
  // 需求文档智能合成（已整合到 analyze --full）
  {
    id: 'synthesize',
    intent: 'analyze',
    priority: 44,
    triggers: ['合成需求', '合并需求', '需求合成', 'synthesize', '智能合成', '需求合并', '多端合成', '全量分析', '跨端综合', '全量合成'],
    patterns: ['合成.*需求', '合并.*需求', '需求.*合成', '多端.*合并', '.*综合需求', '全量.*分析', '跨端.*综合', '.*功能单元.*合成'],
    description: '需求文档智能合成 — 已整合到 analyze --full（多端全量分析 → 跨端综合 → 功能单元合成）',
  },
];

// ============================================================
// 上下文感知增强规则
// ============================================================

interface ContextRule {
  intent: IntentType;
  noContextMessage: string;
  withContextEnhancement: (context: Context) => string;
}

const CONTEXT_RULES: Record<string, ContextRule> = {
  execute: {
    intent: 'execute',
    noContextMessage: '当前无活跃迭代，请先创建迭代',
    withContextEnhancement: (ctx) =>
      `当前迭代: ${ctx.currentIteration}，准备执行待开发任务`,
  },
  query_progress: {
    intent: 'query_progress',
    noContextMessage: '当前无活跃迭代，无法查看进度',
    withContextEnhancement: (ctx) =>
      `当前迭代: ${ctx.currentIteration}`,
  },
  review: {
    intent: 'review',
    noContextMessage: '请指定要审查的 Task',
    withContextEnhancement: (ctx) =>
      ctx.currentTask
        ? `审查当前 Task: ${ctx.currentTask}`
        : `审查当前迭代: ${ctx.currentIteration}`,
  },
  change: {
    intent: 'change',
    noContextMessage: '请指定要变更的 Task',
    withContextEnhancement: (ctx) =>
      ctx.currentTask
        ? `变更当前 Task: ${ctx.currentTask}`
        : `变更当前迭代: ${ctx.currentIteration}`,
  },
};

// ============================================================
// 意图识别引擎
// ============================================================

/**
 * 从用户自然语言输入中识别意图
 */
export async function recognizeIntent(input: string): Promise<IntentResult[]> {
  const context = await loadContext();
  const activeIteration = await detectActiveIteration();
  if (activeIteration) {
    context.currentIteration = activeIteration;
  }

  const results: IntentResult[] = [];
  const inputLower = input.toLowerCase();

  for (const mapping of COMMAND_MAPPINGS) {
    let totalScore = 0;
    const matched: string[] = [];

    // 1. 关键词直接匹配
    for (const trigger of mapping.triggers) {
      if (input.includes(trigger) || inputLower.includes(trigger.toLowerCase())) {
        totalScore += 20;
        matched.push(`关键词: "${trigger}"`);
      }
    }

    // 2. 正则模式匹配
    for (const pattern of mapping.patterns) {
      try {
        const regex = new RegExp(pattern);
        const match = input.match(regex);
        if (match) {
          totalScore += 30;
          matched.push(`模式: "${pattern}"`);
        }
      } catch {
        // 忽略无效正则
      }
    }

    if (totalScore > 0) {
      // 3. 优先级加成
      totalScore += mapping.priority * 0.3;

      // 4. 上下文感知增强
      let contextAware = false;
      const contextRule = CONTEXT_RULES[mapping.id];
      if (contextRule) {
        // v6.97.0+ 修复：用户明确说全局分析时，不因活跃迭代给迭代级意图加分
        const hasGlobalScope = /全局|全量|所有项目|所有工程|整体架构|跨端|整个系统/.test(input);
        if (activeIteration && !hasGlobalScope) {
          totalScore += 15;
          contextAware = true;
          matched.push('上下文感知: 有活跃迭代');
        } else if (activeIteration && hasGlobalScope && mapping.intent === 'analyze') {
          // 全局分析时，analyze 意图不因活跃迭代加分（避免全局被迭代上下文拉高）
          matched.push('上下文感知: 有活跃迭代，但用户明确全局分析，不加分');
        } else if (
          mapping.intent === 'execute' ||
          mapping.intent === 'query_progress'
        ) {
          totalScore -= 20; // 无上下文降权
          matched.push('上下文感知: 无活跃迭代');
        }
      }

      // 5. 语境加成/减分：区分 speccore 域内 vs 域外表达
      // 5a. 开发术语加成（+10）：输入包含 speccore 领域的专业词汇
      const devTerms = /功能|模块|接口|需求|迭代|任务|代码|登录|支付|用户|权限|数据库|API|前端|后端|部署|测试|Bug|bug|PR|分支|合并|发布|上线|配置|环境|服务|组件|页面|路由|状态|数据|模型|实体|规格|架构|方案|设计|文档.*spec|spec.*文档/i;
      if (devTerms.test(input)) {
        totalScore += 10;
        matched.push('语境加成: 含开发术语');
      }

      // 5b. speccore 结构词加成（+10）：提到目录结构或 speccore 专有概念
      const specTerms = /speccore|010-|020-|030-|\.speccore|Task-\d|Iteration-|Q\d|需求文档|规格文档|功能模块|知识图谱|衰减检测|RAG|reindex|analyze|split|execute|dashboard/i;
      if (specTerms.test(input)) {
        totalScore += 10;
        matched.push('语境加成: 含 speccore 专有词');
      }

      // 5c. 非 speccore 域信号减分（-30）：明确是文档编辑/日常办公场景
      const outOfDomain = /错别字|拼写|语法错误|word文件|excel|表格|PPT|演示文稿|邮件|日程|会议记录[^需]|翻译.*文档|排版|格式调整|字体|字号.*文档|打印|导出.*pdf|导出.*word/i;
      if (outOfDomain.test(input)) {
        totalScore -= 30;
        matched.push('域外信号: 非 speccore 场景');
      }

      // 6. 计算置信度百分比 (0-100)
      const confidence = Math.max(0, Math.min(100, Math.round(totalScore)));

      // 6. 提取参数
      const extractedParams = extractParams(input, mapping);

      results.push({
        intent: mapping.intent,
        command: mapping.id,
        confidence,
        priority: mapping.priority,
        matchedTriggers: matched,
        extractedParams,
        contextAware,
      });
    }
  }

  // 按置信度降序排列
  return results.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.priority - a.priority;
  });
}

/**
 * 从输入中提取参数
 */
function extractParams(input: string, mapping: CommandMapping): Record<string, string> {
  const params: Record<string, string> = {};

  // 提取任务名称（引号内容）
  const quoted = input.match(/[""]([^""]+)[""]/);
  if (quoted) {
    params.name = quoted[1];
  }

  // 提取描述（冒号后或"支持"后内容）
  const descMatch = input.match(/[：:]\s*(.+)$/);
  if (descMatch) {
    params.desc = descMatch[1].trim();
  }

  // 从模式中提取参数
  for (const pattern of mapping.patterns) {
    try {
      const regex = new RegExp(pattern);
      const match = input.match(regex);
      if (match && match[1]) {
        if (!params.name) {
          params.name = match[1].trim();
        }
        if (match[2]) {
          params.target = match[2].trim();
        }
      }
    } catch {
      // 忽略
    }
  }

  // 检测是否指定了迭代
  const iterMatch = input.match(/迭代[：:]*\s*(\S+)/);
  if (iterMatch) {
    params.iteration = iterMatch[1];
  }

  // 检测 scope 参数（全局分析 vs 迭代分析 vs 任务分析）
  // v6.97.0+ 新增：任务级 scope 映射，优先级高于全局（先匹配先命中）
  const scopeKeywords: Record<string, string> = {
    // 任务级（优先匹配，避免"任务"被误判为迭代级）
    '子任务': 'task', '单任务': 'task',
    '任务级': 'task', '任务层': 'task',
    // 全局级
    '全局': 'global', '全局层': 'global', '全局范围': 'global',
    '全量': 'global', '全量层': 'global', '全量范围': 'global',
    '所有工程': 'global', '全部工程': 'global',
    '所有项目': 'global', '全部项目': 'global', '全项目': 'global',
    '整个项目': 'global', '整个系统': 'global',
    '所有端': 'global', '全部端': 'global',
    '所有源码': 'global', '全部源码': 'global',
    '整体': 'global', '全部': 'global',
  };
  for (const [keyword, scopeValue] of Object.entries(scopeKeywords)) {
    if (input.includes(keyword)) {
      params.scope = scopeValue;
      break;
    }
  }

  // 检测任务名（--task 参数）
  // v6.97.0+ 新增：从输入中提取 Task-XXX 或子任务名
  const taskIdMatch = input.match(/Task[\-\s]*(\w+)/i);
  if (taskIdMatch) {
    params.task = `Task-${taskIdMatch[1]}`;
  }
  const taskNameMatch = input.match(/(?:子任务|任务)[：:\s]*([^，,。\s]+)/);
  if (taskNameMatch && !params.task) {
    params.task = taskNameMatch[1];
  }

  // 检测 --with-code 参数（源码扫描）
  const codeKeywords = ['源码', '代码', '结合源码', '扫描代码', '读代码', '看代码', 'with-code', 'with code'];
  if (codeKeywords.some(k => input.includes(k))) {
    params.withCode = 'true';
  }

  // 检测重新/补充分析参数（--supplement / --sync）
  // v6.97.0+ 新增：覆盖"重新分析""补充分析""更新分析"等场景
  const supplementKeywords = ['重新', '再', '补充', '追加', '更新', '修正', '完善', '刷新'];
  if (supplementKeywords.some(k => input.includes(k)) && input.includes('分析')) {
    params.supplement = 'true';
  }
  const syncKeywords = ['回写', '同步到', '写回', '局部更新'];
  if (syncKeywords.some(k => input.includes(k))) {
    params.sync = 'true';
  }

  // 检测工具/平台名称（--tool 参数）
  const toolKeywords: Record<string, string> = {
    'trae': 'trae', 'tree': 'trae',
    'codebuddy': 'codebuddy', 'code buddy': 'codebuddy',
    'claude': 'claude', 'cloud': 'claude',
    'cursor': 'cursor',
    'windsurf': 'windsurf', 'wind surf': 'windsurf',
    'qoder': 'qoder', 'q coder': 'qoder', 'qcoder': 'qoder',
    'workbuddy': 'workbuddy', 'work buddy': 'workbuddy',
  };
  const matchedTools: string[] = [];
  const lowerInput = input.toLowerCase();
  for (const [keyword, toolName] of Object.entries(toolKeywords)) {
    if (lowerInput.includes(keyword)) {
      if (!matchedTools.includes(toolName)) {
        matchedTools.push(toolName);
      }
    }
  }
  if (matchedTools.length > 0) {
    params.tool = matchedTools.join(',');
  }

  // 检测开发指南参数
  if (input.includes('开发指南') || input.includes('生成开发指南') || input.includes('带开发指南')) {
    params.devGuide = 'true';
  }

  // 检测是否要求传统拆分模式（不走 AI 增强路径）
  if (input.includes('直接拆分') || input.includes('按章节') || input.includes('传统拆分') || input.includes('不用ai拆分')) {
    params.splitDirect = 'true';
  }

  return params;
}

/**
 * 根据置信度分级获取行为建议
 */
export function getConfidenceLevel(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 80) return 'high';
  if (confidence >= 50) return 'medium';
  return 'low';
}

/**
 * 获取所有命令映射（用于 help 命令）
 */
export function getAllCommandMappings(): CommandMapping[] {
  return [...COMMAND_MAPPINGS];
}

/**
 * 根据命令 ID 获取映射
 */
export function getCommandMapping(commandId: string): CommandMapping | undefined {
  return COMMAND_MAPPINGS.find((m) => m.id === commandId);
}

/**
 * 根据意图类型获取相关命令
 */
export function getCommandsByIntent(intent: IntentType): CommandMapping[] {
  return COMMAND_MAPPINGS.filter((m) => m.intent === intent);
}

// ═══════════════════════════════════════════════════════════
// 意图域检测 — 区分 speccore CLI 操作 vs 普通 AI 对话
// ═══════════════════════════════════════════════════════════

/** 明确表明用户在使用 speccore 的上下文关键词 */
const SPECCORE_CONTEXT_KEYWORDS = [
  // 工具名
  'speccore', 'spec-core', 'spec_ask', 'spec-ask',
  // 迭代/项目管理
  '迭代', 'iteration', 'sprint', 'STAFFING',
  // 全局分析（speccore 专有概念）
  '全局', '全局层', '全量', '全量层', '跨端',
  // 任务/拆分
  '拆分', 'split', '子任务', 'Task-', 'task-',
  // 文档/规格
  'PRD', 'doc2spec', 'spec2doc', 'ANALYSIS', '020-specs', '030-tasks',
  // 执行相关（明确 speccore 语境）
  'execute', 'dev --', 'done', 'reindex',
  // 端（speccore 专有概念）
  'backend', 'frontend', 'h5', 'admin', 'with-code', 'with code',
  // 变更
  '变更', 'change --',
];

/** 容易与"普通 AI 对话"混淆的意图 */
export const AMBIGUOUS_INTENTS = new Set<IntentType>([
  'analyze', 'split', 'execute', 'plan', 'review',
]);

/**
 * 判断用户输入是否明确与 speccore CLI 操作相关
 * v6.97.0+ 新增：避免"分析代码""讨论需求"等普通聊天被误判为 speccore 操作
 */
export function isSpeccoreOperation(input: string): boolean {
  const lower = input.toLowerCase();
  return SPECCORE_CONTEXT_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}
