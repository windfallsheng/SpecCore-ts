/**
 * 意图识别引擎
 * 基于 SpecCore v2.0 的自然语言意图识别引擎
 * 支持 12 种意图类型、100+ 关键词匹配、置信度计算、上下文感知增强
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
  | 'import'              // 导入
  | 'bugfix'              // Bug 修复
  | 'research'            // 调研
  | 'sync'                // 同步
  | 'retro'               // 回顾
  | 'template_add'        // 添加模板
  | 'import_to_global'    // 导入到全量层
  | 'iteration_from_global' // 从全量生成期次
  | 'sync_to_global'      // 同步到全量层
  | 'global_status'       // 全量层状态
  | 'history'             // 历史查询
  | 'impact'              // 影响分析
  | 'baseline'            // 版本基线
  | 'dashboard'           // 仪表盘
  | 'audit'               // 智能审计
  | 'rename';             // 重命名

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
  {
    id: 'change',
    intent: 'change',
    priority: 100,
    triggers: ['改成', '改为', '调整', '修改', '更新', '变更', '升级', '换成', '替换'],
    patterns: ['把(.+)改成(.+)', '将(.+)调整为(.+)', '修改(.+)', '升级(.+)', '换成(.+)'],
    description: '需求变更联动 — 修改需求时自动更新关联 Spec 文件',
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
  {
    id: 'goal',
    intent: 'create',
    priority: 85,
    triggers: ['创建一个', '新增一个', '做一个', '实现', '添加一个', '新建', '创建', '新增'],
    patterns: ['创建(.+)', '新增(.+)', '做一个(.+)', '开发(.+)功能', '实现(.+)功能'],
    description: '完整需求交付 — 从需求到代码的全流程自动化',
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
  // 导入
  {
    id: 'import',
    intent: 'import',
    priority: 82,
    triggers: ['导入', '迁移', '转换', '从代码导入', '从需求导入'],
    patterns: ['导入(.+)代码', '从(.+)导入', '迁移(.+)项目'],
    description: '存量项目导入 — 从代码/PRD/原型自动生成 Spec 配置',
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
    description: '生成交接文档 — 汇总期次关键信息和待办事项',
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
    description: '期次回顾 — 总结经验和改进建议',
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
  // 从全量生成期次
  {
    id: 'iteration-from-global',
    intent: 'iteration_from_global',
    priority: 80,
    triggers: ['从全量生成', '基于全局创建', '选择需求生成期次'],
    patterns: ['从全量(.*)生成期次', '基于全局(.*)创建期次', '选择(.*)需求生成期次'],
    description: '从全量层生成期次 — 按需求 ID 选择并生成新的期次',
  },
  // 同步全量
  {
    id: 'sync-global',
    intent: 'sync_to_global',
    priority: 70,
    triggers: ['同步全量', '同步全局', '更新全量层', '同步到全量'],
    patterns: ['同步(.*)到全量层', '更新全量层', '同步全量'],
    description: '全量层双向同步 — 期次与全量层之间的双向同步',
  },
  // 全量状态
  {
    id: 'global-status',
    intent: 'global_status',
    priority: 65,
    triggers: ['全量状态', '全局状态', '全量层', '查看全量'],
    patterns: ['全量状态', '全局状态', '查看全量层'],
    description: '查看全量层状态 — 所有项目、需求、架构总览',
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
    description: '重命名期次/任务 — 自动更新所有关联引用',
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
    noContextMessage: '当前无活跃期次，请先创建期次',
    withContextEnhancement: (ctx) =>
      `当前期次: ${ctx.currentIteration}，准备执行待开发任务`,
  },
  query_progress: {
    intent: 'query_progress',
    noContextMessage: '当前无活跃期次，无法查看进度',
    withContextEnhancement: (ctx) =>
      `当前期次: ${ctx.currentIteration}`,
  },
  review: {
    intent: 'review',
    noContextMessage: '请指定要审查的 Task',
    withContextEnhancement: (ctx) =>
      ctx.currentTask
        ? `审查当前 Task: ${ctx.currentTask}`
        : `审查当前期次: ${ctx.currentIteration}`,
  },
  change: {
    intent: 'change',
    noContextMessage: '请指定要变更的 Task',
    withContextEnhancement: (ctx) =>
      ctx.currentTask
        ? `变更当前 Task: ${ctx.currentTask}`
        : `变更当前期次: ${ctx.currentIteration}`,
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
        if (activeIteration) {
          totalScore += 15;
          contextAware = true;
          matched.push('上下文感知: 有活跃期次');
        } else if (
          mapping.intent === 'execute' ||
          mapping.intent === 'query_progress'
        ) {
          totalScore -= 20; // 无上下文降权
          matched.push('上下文感知: 无活跃期次');
        }
      }

      // 5. 计算置信度百分比 (0-100)
      const confidence = Math.min(100, Math.round(totalScore));

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

  // 检测是否指定了期次
  const iterMatch = input.match(/期次[：:]*\s*(\S+)/);
  if (iterMatch) {
    params.iteration = iterMatch[1];
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
