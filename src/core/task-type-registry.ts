/**
 * TaskChain 任务类型注册表（v8.3.307+）
 *
 * 背景：SpecCore 传统任务是「代码类迭代任务」（feature/bugfix/refactor/research），
 * 但长任务链场景下用户会混排「编码 / 写文档 / 写脚本 / 数据处理」等异质任务。
 * 本注册表把任务类型泛化：每种类型声明自身的产出位置、验收方式、分支类型与
 * 默认约束集，让 taskify/execute/chain 等命令按类型差异调度，而无需硬编码判断。
 *
 * 设计原则：
 *  - 原有 4 种代码类型语义完全不变（向后兼容）
 *  - 新增 doc/script/data 三种非代码类型，走同一调度链路
 *  - 约束集（constraints）是「共同前提约束」的声明载体：执行同类任务时
 *    约束集加载器（constraint-set.ts）会重新读取，保证上下文不随会话漂移
 */

export type TaskCategory = 'code' | 'doc' | 'research' | 'script' | 'data';

export interface TaskTypeDefinition {
  /** 类型 ID（与 TASK_TYPES / .meta/type 对齐） */
  type: string;
  /** 泛化类别（决定执行形态） */
  category: TaskCategory;
  /** 中文显示名 */
  label: string;
  /** 产出目录（相对项目根，如 src/、docs/、scripts/） */
  outputDir: string;
  /** 验收方式描述（写入任务 spec，供执行 AI 与 chain 校验参照） */
  acceptance: string;
  /** Git 分支类型（创建分支时映射，如 feature/bugfix/docs） */
  branchType: string;
  /** 是否需要端子目录（代码类需要按端拆分，文档/脚本类不需要） */
  needsPlatforms: boolean;
  /** 是否需要 00-specs 技术规格（文档/脚本类只需 REQ.md） */
  needsTechSpec: boolean;
  /** 默认约束集（执行时自动注入，任务 spec 可额外声明追加） */
  defaultConstraints: string[];
}

/**
 * 任务类型注册表 — 单一事实来源
 *
 * 约束集命名约定：`{约束名}` 对应 .speccore/GLOBAL/CONSTRAINTS/{约束名}.md，
 * 内置约束（coding-standards/doc-standards/script-standards/data-standards）
 * 由 init 生成，用户可按团队规范增改。
 */
export const TASK_TYPE_REGISTRY: Record<string, TaskTypeDefinition> = {
  feature: {
    type: 'feature',
    category: 'code',
    label: '功能开发',
    outputDir: '{code_path}', // 由 CONSTITUTION/PROJECT.yaml 源码路径解析
    acceptance: '编译通过 + 单元测试通过 + 接口契约一致',
    branchType: 'feature',
    needsPlatforms: true,
    needsTechSpec: true,
    defaultConstraints: ['coding-standards'],
  },
  bugfix: {
    type: 'bugfix',
    category: 'code',
    label: '缺陷修复',
    outputDir: '{code_path}',
    acceptance: '复现步骤修复 + 回归测试通过 + 无新缺陷引入',
    branchType: 'bugfix',
    needsPlatforms: true,
    needsTechSpec: true,
    defaultConstraints: ['coding-standards'],
  },
  refactor: {
    type: 'refactor',
    category: 'code',
    label: '代码重构',
    outputDir: '{code_path}',
    acceptance: '行为不变（原测试全过）+ 结构改善',
    branchType: 'refactor',
    needsPlatforms: true,
    needsTechSpec: true,
    defaultConstraints: ['coding-standards'],
  },
  research: {
    type: 'research',
    category: 'research',
    label: '技术调研',
    outputDir: '{iteration_dir}/research/',
    acceptance: '调研报告完整（背景/假设/结论/建议）+ 结论可执行',
    branchType: 'research',
    needsPlatforms: false,
    needsTechSpec: false,
    defaultConstraints: ['research-standards'],
  },
  doc: {
    type: 'doc',
    category: 'doc',
    label: '文档编写',
    outputDir: 'docs/',
    acceptance: '文档结构完整 + 内容准确 + 无死链/占位符残留',
    branchType: 'docs',
    needsPlatforms: false,
    needsTechSpec: false,
    defaultConstraints: ['doc-standards'],
  },
  script: {
    type: 'script',
    category: 'script',
    label: '脚本开发',
    outputDir: 'scripts/',
    acceptance: '脚本可运行 + 输入校验完整 + 失败有明确退出码',
    branchType: 'feature',
    needsPlatforms: false,
    needsTechSpec: false,
    defaultConstraints: ['script-standards'],
  },
  data: {
    type: 'data',
    category: 'data',
    label: '数据处理',
    outputDir: 'outputs/',
    acceptance: '数据完整性校验通过 + 结果可复现 + 异常数据有隔离',
    branchType: 'feature',
    needsPlatforms: false,
    needsTechSpec: false,
    defaultConstraints: ['data-standards'],
  },
};

/** 获取任务类型定义（未知类型回退 feature） */
export function getTaskTypeDefinition(type: string): TaskTypeDefinition {
  return TASK_TYPE_REGISTRY[type] || TASK_TYPE_REGISTRY.feature;
}

/** 全部任务类型 ID 列表（含新增的 doc/script/data） */
export const ALL_TASK_TYPES = Object.keys(TASK_TYPE_REGISTRY);

/** 内置约束集清单（init 时生成到 .speccore/GLOBAL/CONSTRAINTS/） */
export const BUILTIN_CONSTRAINTS: Record<string, string> = {
  'coding-standards': `# 编码标准约束（内置）

> 本约束在每次执行代码类任务（feature/bugfix/refactor）前自动注入，保证上下文一致。

- 遵循 CONSTITUTION.md 的命名规范、端名标准与错误码体系
- 代码写入 PROJECT.yaml 声明的源码路径，禁止写入迭代目录
- 改动前先读对应模块的技术文档与业务规则（RULES/ + BUSINESS_RULES/）
- 每个任务完成后保证编译通过、单元测试全绿
`,
  'doc-standards': `# 文档标准约束（内置）

> 本约束在每次执行文档类任务（doc）前自动注入。

- 使用标准 Markdown，标题层级清晰，表格对齐
- 术语与既有文档保持一致，引用使用相对路径
- 禁止占位符残留（TODO、待补充、xxx）
- 所有链接必须有效（本地文件存在、外链可访问）
`,
  'script-standards': `# 脚本标准约束（内置）

> 本约束在每次执行脚本类任务（script）前自动注入。

- 脚本入口明确，支持 --help 与参数校验
- 失败时输出明确错误信息并以非零退出码退出
- 幂等可重跑，不产生脏数据
- 不在脚本内硬编码密钥/令牌
`,
  'data-standards': `# 数据处理约束（内置）

> 本约束在每次执行数据处理任务（data）前自动注入。

- 处理前校验数据完整性（行数/字段/编码）
- 结果可复现：记录输入快照与处理参数
- 异常数据隔离输出（不静默丢弃），并给出异常统计
- 产出物落盘 outputs/ 并附带说明文件
`,
  'research-standards': `# 调研约束（内置）

> 本约束在每次执行调研任务（research）前自动注入。

- 结论必须基于可验证的来源（文档/代码/实验），禁止臆测
- 每个候选方案给出利弊对比与推荐理由
- 调研产出为决策服务：结论 + 建议 + 风险
`,
};
