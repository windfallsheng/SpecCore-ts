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
  | 'run'                 // 流水线执行（v8.3.190+：命名流水线 + 起止点）
  | 'create'              // 创建功能/任务
  | 'iteration_create'    // 创建迭代
  | 'analyze'             // 分析需求
  | 'split'               // 任务拆分（taskify）
  | 'split-units'         // 切分功能单元（unitize）
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
  | 'req_doc'             // 需求文档化（原 clarify）
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
  | 'synthesize'         // 需求文档智能合成
  | 'verdict'            // v8.3.24+: 契约冲突裁决
  | 'global_analyze'     // v8.3.255+: 全局层分析（speccore global 独立命令）
  | 'next';              // v8.3.189+: 下一步指引（检测进度）

/** 意图匹配结果 */
export interface IntentResult {
  intent: IntentType;
  command: string;
  confidence: number;
  priority: number;
  matchedTriggers: string[];
  extractedParams: Record<string, string>;
  contextAware: boolean;
  /** v8.3.263+: 命中关键词 trigger 的总长度——同分时精确短语优先于宽泛单字（如「执行需求分析并落盘」应命中 analyze 而非 execute 的「执行」） */
  triggerSpecificity?: number;
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
  // 下一步指引（v8.3.189+，优先级高于 execute 的「做」）
  // patterns 用非捕获组 (?:...)：给置信度加分，但避免捕获「该做什么」误作 name 参数
  {
    id: 'next',
    intent: 'next',
    priority: 95,
    triggers: ['下一步', '接下来', '该做什么', '下一步做什么', '接下来做什么', '做到哪了', '现在到哪了', '当前进度'],
    patterns: ['下一步(?:.+)?', '接下来(?:.+)?'],
    description: '检测当前迭代进度，提示下一步操作（只指引，不执行）',
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
  // 流水线执行（run — 命名流水线 + 起止点编排，v8.3.190+）
  {
    id: 'run',
    intent: 'run',
    priority: 95,
    triggers: [
      '执行流水线', '跑流水线', '运行流水线', '全自动执行', '自动执行', '端到端',
      '一键执行', '跑全流程', '执行全流程', '跑完整流程', '全流程执行',
      '部署流水线', '交付流水线', '开发流水线', '导入需求流水线', '文档导出流水线',
      '自动跑流水线', '自动执行流水线',
      '部署', '上线', '交付', '提代码', '提交代码', '发布',
      '生成spec', '出spec', '生成规格', '出规格', '到拆分', '生成拆分方案',
      '开发流程', '开发到验证', '开发到执行', '跑开发', '分析到开发', '需求到开发',
      // v8.3.218+: 冒烟节点消歧——开发完冒烟/部署+冒烟 是流水线意图（不是单独跑冒烟测试）
      '开发完成', '开发完', '开发后',
      '冒烟', '本地冒烟', '环境冒烟', '部署冒烟', '部署前冒烟', '部署后冒烟', '上线冒烟', '上线后冒烟',
    ],
    patterns: ['跑(?:.+?)流水线', '执行(?:.+?)流水线', '运行(?:.+?)流水线', '帮我(?:.+?)', '自动(?:.+?)', '从(?:.+?)(?:到|至)(?:.+?)'],
    description: '端到端流水线执行 — 按 preset 或起止点自动编排（run）',
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
  // v8.3.286+: triggers 补口语化虚词变体——「创建迭代」「新建迭代」被「一个/个/新」隔断后
  //   仍能命中；英文变体覆盖「speccore iteration create」这类输入。
  //   （宽 trigger「新建/创建」故意不收录：那是 task new 的词，靠共现加权决胜，见 recognizeIntent）
  {
    id: 'iteration create',
    intent: 'iteration_create',
    priority: 92,
    triggers: [
      '创建迭代', '新建迭代', '创建sprint', '新建sprint', '开新迭代', '新开迭代',
      '创建一个迭代', '新建一个迭代', '创建新迭代', '新建新迭代',
      '创建个迭代', '新建个迭代', '开一个新迭代', '新开一个迭代', '开个新迭代',
      '创建期次', '新建期次', '创建一个期次', '新建一个期次',
      'iteration create', 'create iteration', 'create sprint', 'new iteration', 'new sprint',
    ],
    patterns: ['创建(.+)迭代', '新建(.+)迭代', '创建一个(.+)迭代', '新建一个(.+)迭代', '创建一个叫(.+)的迭代', '创建sprint(.+)', '开(.+)迭代', '迭代叫(.+)'],
    description: '创建新迭代 — 生成 STAFFING + 产品需求 + 需求文档目录',
    args: '--name=<name> --owner=<owner>',
  },
  // 全局层分析（v8.3.255+：speccore global 独立命令，源码→技术文档 / 源码→需求文档）
  // 优先级高于 analyze，避免「全局分析」误落迭代层
  {
    id: 'global',
    intent: 'global_analyze',
    priority: 92,
    triggers: [
      '全局分析', '全局层分析', '分析全局层', '分析全局',
      '全量分析', '全量层分析', '分析全量层', '分析全量',
      '项目分析', '分析项目', '分析整体架构',
      '分析所有端', '分析所有工程', '跨端分析', '全局架构分析',
      '整体分析', '全项目分析', '项目架构分析',
      '分析整个系统', '分析整个项目', '分析所有源码',
      // v8.3.255+: 源码反推需求 → global from-source
      '从源码反推', '源码反推', '从代码反推', '代码反推', '反推需求',
      '逆向分析', '逆向生成', '反推', '逆向工程',
      // v8.3.301+: 反推口语变体（端/模块/工程口径，不带「反推/逆向」字眼也能命中）
      '按端反推', '按端生成需求', '根据端生成需求', '端生成需求',
      '生成需求文档', '需求文档反推', '代码生成需求', '从代码生成需求',
      '根据代码生成需求', '按模块反推', '反推文档', '从工程生成需求',
    ],
    patterns: [
      '全局分析(.+)', '全量分析(.+)', '分析所有(.+)',
      '分析项目(.+)', '项目(.+)分析', '整体(.+)分析',
      '跨端(.+)分析', '架构(.+)分析',
      '全局深度分析(.+)', '全量深入分析(.+)',
    ],
    description: '全局层分析 — 源码→技术文档（global analyze）/ 源码→需求文档（global from-source），产物 .speccore/GLOBAL/，独立于迭代层 analyze',
  },
  // 需求分析（纯迭代层 + 重新/补充分析）
  {
    id: 'analyze',
    intent: 'analyze',
    priority: 90,
    triggers: [
      // 迭代级
      '分析需求', '需求分析', 'AI分析', '代码分析', '分析代码',
      '迭代分析', '分析迭代', '本迭代分析', '当前迭代分析',
      // v8.3.263+: 分析落盘类短语——「对当前迭代执行需求分析并落盘」等 run 门禁
      // 指引/宿主 AI 转述语，须优先于 execute 的「执行」宽 trigger 命中 analyze
      '执行需求分析', '需求分析并落盘', '分析并落盘', '执行分析',
      '执行迭代分析', '对当前迭代执行需求分析',
      // 重新/补充分析（v6.97.0+ 新增：覆盖 --supplement）
      '重新分析', '再分析', '重新生成分析', '重新跑分析',
      '补充分析', '追加分析', '更新分析', '修正分析',
      '完善分析', '刷新分析', '重新评估', '重新审查',
      // v7.2.0+: 深度分析 — --deep / --iterative
      '深度分析', '深入分析', '详细分析', '深度生成',
      '逐节分析', '大纲分析', '分步分析',
      '慢慢分析', '一步一步分析',
      // v7.2.0+: 按需分析 — --filter
      '按需分析', '只分析', '仅分析', '过滤分析',
      '聚焦分析', '限定分析', '针对分析',
      // v7.2.0+: 代码关联 — --with-code
      '带代码分析', '连代码分析', '源码分析', '结构化分析',
    ],
    patterns: [
      '分析(.+)需求', '分析(.+)代码',
      '迭代(.+)分析', '本迭代(.+)分析',
      // v8.3.263+: 执行分析/分析落盘类——压过 execute「执行」宽 trigger
      '执行(.+)分析', '(.+)分析并落盘', '执行需求(.+)',
      // 重新/补充分析匹配模式
      '重新(.+)分析', '再(.+)分析', '补充(.+)分析',
      '更新(.+)分析', '修正(.+)分析', '完善(.+)分析',
      // v7.2.0+: 细粒度分析 — 分析某文档的某功能
      '分析(.+)中的(.+)', '分析(.+)的(.+)', '深入(.+)的(.+)',
      '查看(.+)中的(.+)', '查看(.+)的(.+)',
      // v7.2.0+: 深度分析模式 — 指定文档 + 深度意愿
      '深度分析(.+)', '深入分析(.+)', '详细分析(.+)',
      '逐节分析(.+)', '大纲分析(.+)',
      // v7.2.0+: 按需分析模式 — 指定模块/关键词
      '只分析(.+)', '仅分析(.+)', '过滤分析(.+)',
      '聚焦(.+)分析', '针对(.+)分析',
      // v7.2.0+: 迭代 + 细粒度组合
      '迭代(.+)深度分析(.+)', '分析迭代(.+)中的(.+)',
    ],
    description: 'AI 分析 — 需求完整性 + 改动范围 + 风险矩阵（迭代层 020-specs/；全局层用 speccore global）',
    args: '-I <iteration> 或 --scope overview --deep <doc> --iterative --filter <keywords> --with-code --supplement',
  },
  // 切分功能单元（单元化，区别于下面的 taskify 拆任务）
  {
    id: 'unitize',
    intent: 'split-units',
    priority: 89,
    triggers: ['切分功能单元', '切分单元', '切需求文档', '切需求', '单元化', '功能单元', 'unitize'],
    patterns: ['切分(.+)文档', '切(.+)需求文档', '把(.+)切分'],
    description: '单元化 — 需求文档 → 功能单元（SOURCE.md 切片 + 类型标记 + 端覆盖矩阵）',
    args: '--file <md路径> [--iter <迭代>] [--platform <端名>] [--files "a.md=端1,b.md"]',
  },
  // 任务拆分（任务化）
  {
    id: 'iteration taskify',
    intent: 'split',
    priority: 88,
    triggers: ['拆分任务', '拆分需求', '任务拆分', '智能拆分', '任务化', 'split'],
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
    triggers: ['调研', '评估', '选型', '对比', '分析怎么实现', '有什么方案', '技术方案', '实现方案'],
    patterns: ['调研(.+)方案', '调研(.+)技术', '评估(.+)技术', '对比(.+)', '(.+)怎么实现', '(.+)有什么方案'],
    description: '技术调研 — 评估技术方案、对比工具选项',
  },
  // 需求文档化
  {
    id: 'req-doc',
    intent: 'req_doc',
    priority: 89,
    triggers: ['整理需求', '专业化', '规范化', '整理一下', '写成PRD', '润色需求', '需求整理', '整理成文档', '需求文档化', '需求专业化'],
    patterns: ['整理需求', '写成PRD', '整理(.+)需求', '把(.+)整理成PRD', '润色(.+)', '需求(.+)文档化'],
    description: '需求文档化 — 将口语化/非专业需求整理为 PRD 级文档',
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
    triggers: ['归档', '存档', '清理'],
    patterns: ['归档(.+)', '清理(.+)'],
    description: '归档任务 — 将已完成任务移动到归档目录',
  },
  // 参考查找（v8.3.257: 无独立 reference 命令，路由到 search 全文检索）
  {
    id: 'search',
    intent: 'reference',
    priority: 75,
    triggers: ['参考', '借鉴', '类似', '有没有', '之前', '以前'],
    patterns: ['参考(.+)', '借鉴(.+)', '有没有(.+)示例'],
    description: '参考查找 — 在 Spec 文档/PATTERNS 中搜索相关技术参考（search）',
  },
  // 同步（含全量层双向同步，--global 模式，原 sync-global）
  {
    id: 'sync',
    intent: 'sync',
    priority: 70,
    triggers: ['同步', '反向同步', '更新Spec', '对齐', '同步全量', '同步全局', '更新全量层', '同步到全量'],
    patterns: ['同步(.+)', '更新(.+)Spec', '对齐(.+)', '同步(.*)到全量层', '更新全量层', '同步全量'],
    description: '双向同步 — 代码↔Spec；--global 同步到全局层（原 sync-global）',
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
    triggers: ['交接', '转交', '移交', '交接文档', '交接一下'],
    patterns: ['交接(.+)', '转交(.+)', '生成交接文档'],
    description: '生成交接文档 — 汇总迭代关键信息和待办事项',
  },
  // 健康度（v8.3.257: 无独立 health 命令，路由到 doctor）
  {
    id: 'doctor',
    intent: 'health',
    priority: 65,
    triggers: ['健康', '质量', '评分'],
    patterns: ['健康度(.+)', '质量(.+)', '评分(.+)'],
    description: '项目健康诊断 — doctor 命令 4 维度质量评估与风险预警',
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
  // 模板（v8.3.257: template-add 无对应 CLI 命令，已移除 mapping）
  // 帮助
  {
    id: 'help',
    intent: 'help',
    priority: 50,
    triggers: ['帮助', '怎么用', '教程', '不会用', '如何使用'],
    patterns: ['帮助(.+)', '怎么用(.+)', '教程(.+)'],
    description: '命令帮助 — 查看所有可用命令和参数说明',
  },
  // 体验（v8.3.257: 无独立 demo 命令，路由到 welcome 引导页）
  {
    id: 'welcome',
    intent: 'demo',
    priority: 45,
    triggers: ['示例', '体验', '试一下', 'demo'],
    patterns: ['示例(.+)', '体验(.+)', '试一下(.+)'],
    description: '快速体验 — 欢迎页引导 5 分钟体验 SpecCore 完整流程（welcome）',
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
  // 导入到全量层（v8.3.257: import-to-global 无对应 CLI 命令，已移除 mapping）
  // 从全量生成迭代
  {
    id: 'iteration-from-global',
    intent: 'iteration_from_global',
    priority: 80,
    triggers: ['从全量生成', '基于全局创建', '选择需求生成迭代'],
    patterns: ['从全量(.*)生成迭代创建迭代', '选择(.*)需求生成迭代'],
    description: '从全量层生成迭代 — 按需求 ID 选择并生成新的迭代',
  },
  // 同步全量（v8.3.257: 已合并到上方 sync mapping，避免同 intent 双 mapping 歧义平手）
  // 全量状态（v8.3.257: 无独立 global-status 命令，路由到 dashboard）
  {
    id: 'dashboard',
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
  // 新建多平台 Task (v4.0)（v8.3.257: 无独立 new-task 命令，id 正名 task new）
  {
    id: 'task new',
    intent: 'new_task',
    priority: 84,
    triggers: ['新建任务', '创建任务', '多端任务', '全平台任务'],
    patterns: ['新建(.*)任务', '创建(.*)任务', '做一个(.*)任务', '为(.*)创建任务'],
    description: '创建多平台任务 — 支持 --platforms 指定前端平台（task new）',
  },
  // 添加平台 (v4.0)（v8.3.257: platform-add 无对应 CLI 命令，已移除 mapping）
  // 更新索引 (v4.0) → v8.3.138: 映射到 refresh 命令，覆盖四层架构全部目录
  {
    id: 'refresh',
    intent: 'index_update',
    priority: 58,
    triggers: ['更新索引', '重建索引', '刷新索引', '重新扫描', '刷新rag', '刷新知识图谱', '重建rag', 'refresh index', 'reindex'],
    patterns: ['更新索引', '重建索引', '刷新索引', '重新扫描', '刷新.rag', '重建.rag', 'refresh.*index', 'reindex'],
    description: '统一刷新所有检索层 — 代码索引 + 文档 RAG（GLOBAL/RULES/SKILLS/PATTERNS）+ 知识图谱',
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
  // 需求文档智能合成（已整合到 analyze --full，v8.3.257: id 正名 analyze，避免路由到已删的 synthesize 命令）
  {
    id: 'analyze',
    intent: 'analyze',
    priority: 44,
    triggers: ['合成需求', '合并需求', '需求合成', '智能合成', '需求合并'],
    patterns: ['合成.*需求', '合并.*需求', '需求.*合成', '多端.*合并', '.*综合需求', '.*功能单元.*合成'],
    description: '需求文档智能合成 — 已整合到 analyze --full（多端全量分析 → 跨端综合 → 功能单元合成）',
  },
  // v8.3.24+: 契约冲突裁决
  {
    id: 'verdict',
    intent: 'verdict',
    priority: 82,
    triggers: ['裁决', '仲裁', '冲突裁决', '契约裁决', 'verdict', '查看冲突', '待裁决', '人工裁决', '裁决书', '解决冲突'],
    patterns: ['裁决(.+)', '仲裁(.+)', '查看(.+)冲突', '解决(.+)冲突', '(.+)裁决'],
    description: '契约冲突裁决 — 查看待裁决冲突、进行人工裁决、查看裁决书',
    args: '--list | --conflict <id> --decide <outcome> | --report',
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
  // v8.3.286+: 创建迭代在活跃迭代场景下同样常见（新迭代衔接），补上上下文加成，
  // 避免「新建一个迭代」在有活跃迭代时被 execute 的上下文 +15 反超。
  'iteration create': {
    intent: 'iteration_create',
    noContextMessage: '',
    withContextEnhancement: (ctx) =>
      `当前迭代: ${ctx.currentIteration}，新迭代创建后按需切换活跃迭代`,
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
 * 口语虚词归一化（v8.3.287+）
 * 剥离口语填充短语，让词组 trigger 在被「一下/一个/帮我」隔断时仍能连续命中。
 * 保守原则：只剥完整短语，不剥单字歧义词（的/再/下/请/个/先——「再分析」是 trigger、
 * 「下一步」是 next trigger、单字剥离会误伤「优先/个别」等）。
 * 参数提取（extractParams）仍用原输入，捕获组内容不受归一化污染。
 */
const ORAL_FILLERS = ['请帮我', '麻烦你', '帮我', '给我', '一下', '一个', '一项', '一条', '一份'];

function normalizeInput(input: string): string {
  let out = input;
  for (const filler of ORAL_FILLERS) {
    out = out.split(filler).join('');
  }
  return out;
}

// ============================================================
// 名词锚点共现规则（v8.3.287+：体系化 v8.3.286 的三处硬编码补丁）
// 中文口语里名词比动词可靠：宽 trigger（做/创建/新建）互相抢分时，
// 名词锚点（迭代/项目/任务/功能/文档）与动词家族共现才是真信号。
// ============================================================

type AnchorRule =
  | {
      kind: 'anchor';        // 共现加权：锚点 + 动词 → 受益意图加分
      intent: IntentType;
      anchors: RegExp;       // 名词锚点（对原输入测试）
      verbs: RegExp;         // 动词家族
      bonus: number;
    }
  | {
      kind: 'capturePenalty'; // 宽捕获让位：捕获组含锚点名词 → 受罚意图减分
      intents: IntentType[];
      anchors: RegExp;        // 对「创建(.+)」类宽捕获组测试
      bonus: number;          // 正数，实际为减分
    }
  | {
      kind: 'phrasePenalty';  // 短语让位：句中明确短语 → 受罚意图减分
      intent: IntentType;
      anchors: RegExp;        // 对原输入测试
      bonus: number;
    };

const ANCHOR_RULES: AnchorRule[] = [
  // 迭代锚点：创建类动词 + 迭代/sprint/期次 → iteration_create 强信号
  // （排除「XX迭代的功能模块」：迭代后紧跟「的」时迭代是定语不是宾语）
  {
    kind: 'anchor', intent: 'iteration_create',
    anchors: /(?:迭代|sprint|期次)(?!的)/,
    verbs: /(?:创建|新建|新开|开新|开启|建立|建|开)/,
    bonus: 35,
  },
  // 项目锚点：句子以「项目」结尾 + 初始化类动词 → init
  // （「项目管理/项目计划」等定语结构不以「项目」结尾，不受影响）
  {
    kind: 'anchor', intent: 'init',
    anchors: /项目[，。\s]*$/,
    verbs: /(?:创建|新建|建立|初始化|迁移)/,
    bonus: 20,
  },
  // 任务锚点：创建类动词 + 任务名词 → new_task（多端任务）
  {
    kind: 'anchor', intent: 'new_task',
    anchors: /任务/,
    verbs: /(?:新建|创建|做一个?|添加)/,
    bonus: 25,
  },
  // 功能锚点：做一个/添加/实现 + 功能类名词 → create
  // （修「做一个支付模块」被 execute 宽 trigger「做」抢走）
  {
    kind: 'anchor', intent: 'create',
    anchors: /(?:功能|模块|页面|接口|服务|系统)/,
    verbs: /(?:做一个?|添加|实现|新增)/,
    bonus: 20,
  },
  // 文档锚点：导入/转换 + 文档类名词 → doc2spec
  // （修「导入一下文档」只靠 pattern 分导致低置信度；25 分使其跨过 85 high 线）
  {
    kind: 'anchor', intent: 'doc2spec',
    anchors: /(?:文档|PRD|word|docx)/,
    verbs: /(?:导入|转换|转)/,
    bonus: 25,
  },
  // 需求文档锚点：切分 + 需求文档/功能单元 → unitize
  {
    kind: 'anchor', intent: 'split-units',
    anchors: /(?:需求文档|功能单元)/,
    verbs: /(?:切分|切)/,
    bonus: 20,
  },
  // 反向让位：task new 的宽 pattern「创建(.+)」吞掉迭代名词 → 夺回误加分
  {
    kind: 'capturePenalty', intents: ['create', 'new_task'],
    anchors: /(?:迭代|sprint|期次)(?!的)/,
    bonus: 35,
  },
  // 反向让位：宽捕获以「项目」结尾 → 项目初始化优先（「项目管理」定语不受影响）
  {
    kind: 'capturePenalty', intents: ['create', 'new_task'],
    anchors: /项目[，。\s]*$/,
    bonus: 35,
  },
  // 短语让位：「创建任务/新建任务」短语明确 → 多端任务优先于通用创建
  // （-40：须同时抵消 287 功能锚点 +20 与上下文加成，否则「新建任务，做一个支付模块」
  //   中 create 仍与 new_task 并列封顶 100，按 priority 反而排前）
  {
    kind: 'phrasePenalty', intent: 'create',
    anchors: /(?:创建|新建|做一个?|添加).{0,2}任务/,
    bonus: 40,
  },
];

/** 迭代工作意图集（v8.3.287+）：活跃迭代场景下统一享 +15 上下文加成，此前仅 4 个意图有 */
const ITERATION_CONTEXT_INTENTS = new Set<IntentType>([
  'execute', 'iteration_create', 'analyze', 'split', 'split-units',
  'plan', 'review', 'change', 'create', 'new_task', 'bugfix',
  'req_doc', 'doc2spec', 'research', 'query_progress', 'done',
]);

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
  // v8.3.287+: 口语虚词归一化——词组 trigger 被隔断时在归一化副本恢复连续命中
  const normInput = normalizeInput(input);
  const normInputLower = normInput.toLowerCase();

  for (const mapping of COMMAND_MAPPINGS) {
    let totalScore = 0;
    const matched: string[] = [];

    // 1. 关键词直接匹配（原输入 + 归一化副本双集合，任一命中计分一次，绝不双计）
    for (const trigger of mapping.triggers) {
      const tl = trigger.toLowerCase();
      const hit =
        input.includes(trigger) || inputLower.includes(tl) ||
        (normInput !== input && (normInput.includes(trigger) || normInputLower.includes(tl)));
      if (hit) {
        // v8.3.287+: 宽触发词（≤2 字符）降权 20→12，长词组保持 20——
        // 「做/跑/开」等单字词不再轻松碾压「做一个/跑流水线」
        totalScore += trigger.length <= 2 ? 12 : 20;
        matched.push(`关键词: "${trigger}"`);
      }
    }

    // 2. 正则模式匹配（双集合，任一命中计分一次）
    for (const pattern of mapping.patterns) {
      try {
        const regex = new RegExp(pattern);
        if (regex.test(input) || (normInput !== input && regex.test(normInput))) {
          totalScore += 30;
          matched.push(`模式: "${pattern}"`);
        }
      } catch {
        // 忽略无效正则
      }
    }

    // 2.5 名词锚点共现规则（v8.3.287+：统一表，体系化 286 的硬编码补丁）
    for (const rule of ANCHOR_RULES) {
      if (rule.kind === 'anchor') {
        if (mapping.intent !== rule.intent) continue;
        if (!rule.anchors.test(input) || !rule.verbs.test(input)) continue;
        totalScore += rule.bonus;
        matched.push(`锚点共现: +${rule.bonus}`);
      } else if (rule.kind === 'capturePenalty') {
        if (!rule.intents.includes(mapping.intent)) continue;
        const wideCapture = input.match(/(?:创建|新建|新增|添加|做一个?)(.+)/);
        if (!wideCapture || !rule.anchors.test(wideCapture[1] || '')) continue;
        totalScore -= rule.bonus;
        matched.push(`锚点让位: -${rule.bonus}`);
      } else {
        // phrasePenalty
        if (mapping.intent !== rule.intent) continue;
        if (!rule.anchors.test(input)) continue;
        totalScore -= rule.bonus;
        matched.push(`锚点让位: -${rule.bonus}`);
      }
    }

    if (totalScore > 0) {
      // 3. 优先级加成
      totalScore += mapping.priority * 0.3;

      // 4. 上下文感知增强（v8.3.287+：迭代工作意图集统一享 +15，不再只限 4 个意图）
      let contextAware = false;
      const contextRule = CONTEXT_RULES[mapping.id];
      const ctxIntent = contextRule?.intent || mapping.intent;
      // v6.97.0+ 修复：用户明确说全局分析时，不因活跃迭代给迭代级意图加分
      const hasGlobalScope = /全局|全量|所有项目|所有工程|整体架构|跨端|整个系统/.test(input);
      if (activeIteration && !hasGlobalScope && ITERATION_CONTEXT_INTENTS.has(ctxIntent)) {
        totalScore += 15;
        contextAware = true;
        matched.push('上下文感知: 有活跃迭代');
      } else if (!activeIteration && (ctxIntent === 'execute' || ctxIntent === 'query_progress')) {
        totalScore -= 20; // 无上下文降权
        matched.push('上下文感知: 无活跃迭代');
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

      // v8.3.263: 命中 trigger 总长度——同分决胜层，精确短语优先于宽泛词
      const triggerSpecificity = matched
        .filter((m) => m.startsWith('关键词:'))
        .reduce((sum, m) => sum + ((m.split('"')[1] || '').length), 0);

      results.push({
        intent: mapping.intent,
        command: mapping.id,
        confidence,
        priority: mapping.priority,
        matchedTriggers: matched,
        extractedParams,
        contextAware,
        triggerSpecificity,
      });
    }
  }

  // 按置信度降序排列；同分时 trigger 精确度（命中短语总长）降序；再同则 priority 降序
  const sorted = results.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if ((b.triggerSpecificity || 0) !== (a.triggerSpecificity || 0)) {
      return (b.triggerSpecificity || 0) - (a.triggerSpecificity || 0);
    }
    return b.priority - a.priority;
  });

  // v8.3.287+: 同 (intent, command) 对去重——analyze 有双映射（真重复）；
  // 但 task new（create/new_task）、welcome（demo/welcome）、dashboard（global_status/dashboard）
  // 是不同意图共享命令名，必须保留，否则 new_task 会被 create 吞掉。
  const seenCandidates = new Set<string>();
  return sorted.filter((r) => {
    const key = `${r.intent}|${r.command}`;
    if (seenCandidates.has(key)) return false;
    seenCandidates.add(key);
    return true;
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

  // 检测是否指定了迭代（排除「本迭代/当前迭代」——映射到上下文当前迭代，不需显式 --iter）
  if (!/本迭代|当前迭代|该迭代/.test(input)) {
    const iterMatch = input.match(/迭代[：:]*\s*(\S+)/);
    if (iterMatch) {
      params.iteration = iterMatch[1];
    }
  }

  // 检测 scope 参数（全局 vs 迭代；任务层分析已废弃 v8.3.254）
  const scopeKeywords: Record<string, string> = {
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

  // 检测 --from-code 参数（从源码反推需求，spec-source-to-global 工作流）
  // 注意：与 --with-code 互斥，反推是更强信号（反推 > 扫描）
  const fromCodeKeywords = ['从源码反推', '源码反推', '从代码反推', '代码反推', '反推需求', '反推', '逆向分析', '逆向生成', '逆向工程', '按端反推', '按端生成需求', '根据端生成需求', '端生成需求', '生成需求文档', '需求文档反推', '代码生成需求', '从代码生成需求', '根据代码生成需求', '按模块反推', '反推文档', '从工程生成需求'];
  if (fromCodeKeywords.some(k => input.includes(k)) || (/从.{0,4}(?:代码|工程|源码).{0,8}(?:生成|推导).{0,4}需求/.test(input))) {
    params.fromCode = 'true';
  } else {
    // 检测 --with-code 参数（源码扫描）
    const codeKeywords = ['源码', '代码', '结合源码', '扫描代码', '读代码', '看代码', 'with-code', 'with code'];
    if (codeKeywords.some(k => input.includes(k))) {
      params.withCode = 'true';
    }
  }

  // 检测澄清步骤三态（v8.3.190+：ask 单次覆盖 analyze 的 optional_steps.clarify）
  if (/强制.{0,4}澄清|必须.{0,4}澄清|一定要.{0,4}澄清|务必.{0,4}澄清/.test(input)) {
    params.clarify = 'on';
  } else if (/跳过.{0,4}澄清|不做.{0,4}澄清|不要.{0,4}澄清|无需.{0,4}澄清|不澄清/.test(input)) {
    params.clarify = 'off';
  }

  // 检测 run 流水线意图（v8.3.190+）：起止点优先，其次 preset 名
  if (mapping.intent === 'run') {
    // 口语阶段名 → 流水线阶段 key（与 run.ts PIPELINE_PHASES 对齐）
    // 注意：切分功能单元（split-units，需求→功能单元，命令 unitize）与拆分任务（taskify，Spec→Task）是两个不同阶段，勿混淆
    const stageNameMap: Record<string, string> = {
      '需求': 'req-doc', 'req-doc': 'req-doc', 'reqdoc': 'req-doc',
      '导入': 'doc2spec', 'doc2spec': 'doc2spec', '导需求': 'doc2spec',
      '切分': 'split-units', '切分功能单元': 'split-units', '切分单元': 'split-units', '功能单元': 'split-units', 'split-units': 'split-units', 'split_units': 'split-units', 'unitize': 'split-units', 'unitz': 'split-units',
      '分析': 'analyze', 'analyze': 'analyze',
      '校验': 'validate', 'validate': 'validate',
      '拆分': 'taskify', '拆分任务': 'taskify', '任务拆分': 'taskify', '任务化': 'taskify', 'taskify': 'taskify', 'split': 'taskify',
      '计划': 'plan', 'plan': 'plan',
      '执行': 'execute', 'execute': 'execute', '开发': 'execute',
      '验证': 'verify', 'verify': 'verify',
      // v8.3.218+: 冒烟节点归一化——冒烟不是独立阶段，依附 verify（本地冒烟）/ pipeline（部署前/后冒烟）
      '冒烟': 'verify', '本地冒烟': 'verify', '本地验证': 'verify', '开发完冒烟': 'verify',
      '环境冒烟': 'pipeline', '部署冒烟': 'pipeline', '部署后冒烟': 'pipeline', '上线冒烟': 'pipeline', '上线后冒烟': 'pipeline', '部署前冒烟': 'pipeline', '上线前冒烟': 'pipeline',
      '部署': 'pipeline', 'pipeline': 'pipeline', '上线': 'pipeline',
      '提交': 'pr', 'pr': 'pr', '提代码': 'pr',
      '归档': 'done', 'done': 'done', '复盘': 'done',
      '导出': 'spec2doc', 'spec2doc': 'spec2doc',
    };
    const normalizeStage = (s: string) => stageNameMap[s] || s;

    // 起止点优先（更精确）："从 X [执行/跑] 到/至 Y"
    // v8.3.195+: 先剥离闸口/全自动等后缀修饰词，避免污染 from/to 提取
    //   （否则「从X到开发，全自动执行」会把 to 提取成「开发，全自动」）
    const cleanInput = input.replace(/[,，]?\s*(?:全自动|无人值守|无人干预|自动执行|一条龙|不中断|不需确认|无需确认|不用确认)(?:执行|跑)?[\s，。]*/g, '');
    const rangeMatch = cleanInput.match(/从(.+?)(?:开始|执行|跑|自动)?(?:到|至)(.+?)(?:执行|跑|自动|结束|为止)?$/);
    if (rangeMatch) {
      params.from = normalizeStage(rangeMatch[1].trim());
      params.to = normalizeStage(rangeMatch[2].trim());
    } else {
      // preset 名 → 内置 preset（与 run.ts 的 PRESETS 对齐）
      const presetMap: Record<string, string[]> = {
        deploy: ['deploy', '部署', '上线', '发布'],
        deliver: ['deliver', '交付', '提交代码', '提代码'],
        full: ['full', '全流程', '完整流程', '端到端', '全量'],
        develop: ['develop', '开发流程', '开发到验证', '开发到执行', '跑开发', '分析到开发', '需求到开发', '开发完成', '开发完', '本地冒烟'],
        spec: ['spec', '生成spec', '出spec', '生成规格', '出规格', '到拆分', '生成拆分'],
        import: ['import', '导入需求', '导入'],
        docs: ['docs', '导出文档', '生成文档', '文档导出', '导出'],
        analyze: ['analyze', '只分析', '仅分析'],
      };
      const lowerRun = input.toLowerCase();
      for (const [preset, keywords] of Object.entries(presetMap)) {
        if (keywords.some(k => lowerRun.includes(k.toLowerCase()))) {
          params.preset = preset;
          break;
        }
      }
    }

    // v8.3.195+: 闸口模式检测（全自动/无人值守 → 跳过闸口 A/B，保留 C）
    if (/全自动|无人值守|不用确认|无需确认|不需确认|不用人工|无需人工|无人干预|一条龙|自动执行|不中断/.test(input)) {
      params.gate = 'auto';
    }
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

  // 检测是否要求传统拆分模式（不走 AI 增强路径）
  if (input.includes('直接拆分') || input.includes('按章节') || input.includes('传统拆分') || input.includes('不用ai拆分')) {
    params.splitDirect = 'true';
  }

  // v7.2.0+: 细粒度分析参数提取 — 文档名 + 功能名
  const knownDocs = /TECH|ANALYSIS|REQUIREMENT|SCHEMA|TEST|ARCHITECTURE|FUNCTION_MAP|API_CONTRACT|DATA_FLOW|SECURITY|DEPLOYMENT/i;
  const docFeaturePatterns = [
    /分析(.+?)中的(.+)/,
    /分析(.+?)的(.+)/,
    /深入(.+?)的(.+)/,
    /查看(.+?)中的(.+)/,
    /查看(.+?)的(.+)/,
  ];
  for (const pattern of docFeaturePatterns) {
    const match = input.match(pattern);
    if (match && match[1] && match[2]) {
      const docName = match[1].trim();
      const featureName = match[2].trim();
      // 如果第一部分是文档名（含 .md 或已知文档名），则提取
      if (docName.endsWith('.md') || docName.endsWith('.yaml') || knownDocs.test(docName)) {
        params.docName = docName;
        params.featureName = featureName;
      }
      break;
    }
  }

  // v7.2.0+: 检测单文档深度分析意图
  const deepDocPatterns = [
    /深度分析(.+)/, /深入分析(.+)/, /详细分析(.+)/,
    /分析(.+?)文档/, /分析(.+?)的详细/,
  ];
  for (const pattern of deepDocPatterns) {
    const match = input.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      if (name.endsWith('.md') || name.endsWith('.yaml') || knownDocs.test(name)) {
        params.deepDoc = name;
        break;
      }
    }
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
  // v8.3.255+: 源码反推 → global from-source
  '反推', '逆向', '生成需求', '从源码', '源码反推',
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
  // 澄清/调研（v8.3.0+）
  '澄清', '整理需求', '专业化', '写成PRD', '调研',
];

/** 容易与"普通 AI 对话"混淆的意图 */
export const AMBIGUOUS_INTENTS = new Set<IntentType>([
  'analyze', 'global_analyze', 'split', 'execute', 'plan', 'review',
  'req_doc', 'research', // v8.3.0+: 文档化/调研也容易和普通AI对话混淆
]);

/**
 * 判断用户输入是否明确与 speccore CLI 操作相关
 * v6.97.0+ 新增：避免"分析代码""讨论需求"等普通聊天被误判为 speccore 操作
 * v8.3.0+ 新增：文件路径 + 操作词联合检测
 */
export function isSpeccoreOperation(input: string): boolean {
  const lower = input.toLowerCase();
  if (SPECCORE_CONTEXT_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()))) {
    return true;
  }
  // v8.3.0+: 文件路径 + 操作词 → 高概率是 speccore 操作
  if (hasFileOperationIntent(input)) {
    return true;
  }
  return false;
}

/**
 * v8.3.0+: 检测文件操作意图
 * 含文件路径 + 操作词时，即使缺少 speccore 上下文，也判定为 speccore 操作
 */
export function hasFileOperationIntent(input: string): boolean {
  const hasFilePath = /[\w\-./\\]+\.(md|txt|doc|docx|pdf)/i.test(input);
  const operationWords = ['澄清', '整理', '分析', '调研', '专业化', '规范化', '写成PRD', '导入', '转换'];
  return hasFilePath && operationWords.some(w => input.includes(w));
}
