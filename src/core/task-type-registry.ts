/**
 * TaskChain 任务类型注册表（v8.3.307+，v8.3.308 开放类型系统）
 *
 * 背景：SpecCore 传统任务是「代码类迭代任务」（feature/bugfix/refactor/research），
 * 但长任务链场景下用户会混排「编码 / 写文档 / 写脚本 / 数据处理 / 做 PPT」等
 * 异质任务。本注册表把任务类型泛化：每种类型声明自身的产出位置、验收方式、
 * 分支策略与默认约束集，让 taskify/execute/chain 等命令按类型差异调度。
 *
 * v8.3.308 开放类型系统：
 *  - 内置类型（8 种）由本文件定义，语义向后兼容
 *  - 用户自定义类型：在 .speccore/GLOBAL/TASK_TYPES/{类型名}.md 中声明定义，
 *    resolveTaskTypeDefinition 按「内置 → 自定义定义文件 → 通用非代码回退」解析
 *  - 关键原则：非系统定义的类型默认与代码世界绝缘——不建分支、不需要端拆分、
 *    不需要技术规格，除非任务 spec 中显式声明 code: true（parseSpecCodeDeclaration）
 *
 * 设计原则：
 *  - 原有 4 种代码类型语义完全不变（向后兼容）
 *  - 非代码类型走同一调度链路，但跳过分支/端拆分/技术规格
 *  - 约束集（constraints）是「共同前提约束」的声明载体：执行同类任务时
 *    约束集加载器（constraint-set.ts）会重新读取，保证上下文不随会话漂移
 */

import { join } from 'path';
import { pathExists, readFile } from 'fs-extra';
import { getProjectRoot } from '../utils/task-utils';

export type TaskCategory = 'code' | 'doc' | 'research' | 'script' | 'data' | 'custom';

export interface TaskTypeDefinition {
  /** 类型 ID（与 TASK_TYPES / .meta/type 对齐） */
  type: string;
  /** 泛化类别（决定执行形态） */
  category: TaskCategory;
  /** 中文显示名 */
  label: string;
  /** 产出目录（相对项目根，如 src/、docs/、scripts/、presentations/） */
  outputDir: string;
  /** 验收方式描述（写入任务 spec，供执行 AI 与 chain 校验参照） */
  acceptance: string;
  /** Git 分支类型（needsBranch=true 时用于创建分支，如 feature/bugfix/docs） */
  branchType: string;
  /** 是否创建 git 分支（v8.3.308: 非代码类型默认 false，spec code: true 可覆盖） */
  needsBranch: boolean;
  /** 是否需要端子目录（代码类需要按端拆分，文档/脚本类不需要） */
  needsPlatforms: boolean;
  /** 是否需要 00-specs 技术规格（文档/脚本类只需 REQ.md） */
  needsTechSpec: boolean;
  /** 默认约束集（执行时自动注入，任务 spec 可额外声明追加） */
  defaultConstraints: string[];
  /** 是否内置类型（false = 用户自定义） */
  builtin: boolean;
}

/**
 * 任务类型注册表 — 内置类型单一事实来源
 *
 * 约束集命名约定：`{约束名}` 对应 .speccore/GLOBAL/CONSTRAINTS/{约束名}.md，
 * 内置约束由 init 生成，用户可按团队规范增改。
 */
export const TASK_TYPE_REGISTRY: Record<string, TaskTypeDefinition> = {
  feature: {
    type: 'feature',
    category: 'code',
    label: '功能开发',
    outputDir: '{code_path}', // 由 CONSTITUTION/PROJECT.yaml 源码路径解析
    acceptance: '编译通过 + 单元测试通过 + 接口契约一致',
    branchType: 'feature',
    needsBranch: true,
    needsPlatforms: true,
    needsTechSpec: true,
    defaultConstraints: ['coding-standards'],
    builtin: true,
  },
  bugfix: {
    type: 'bugfix',
    category: 'code',
    label: '缺陷修复',
    outputDir: '{code_path}',
    acceptance: '复现步骤修复 + 回归测试通过 + 无新缺陷引入',
    branchType: 'bugfix',
    needsBranch: true,
    needsPlatforms: true,
    needsTechSpec: true,
    defaultConstraints: ['coding-standards'],
    builtin: true,
  },
  refactor: {
    type: 'refactor',
    category: 'code',
    label: '代码重构',
    outputDir: '{code_path}',
    acceptance: '行为不变（原测试全过）+ 结构改善',
    branchType: 'refactor',
    needsBranch: true,
    needsPlatforms: true,
    needsTechSpec: true,
    defaultConstraints: ['coding-standards'],
    builtin: true,
  },
  research: {
    type: 'research',
    category: 'research',
    label: '技术调研',
    outputDir: '{iteration_dir}/research/',
    acceptance: '调研报告完整（背景/假设/结论/建议）+ 结论可执行',
    branchType: 'research',
    needsBranch: true,
    needsPlatforms: false,
    needsTechSpec: false,
    defaultConstraints: ['research-standards'],
    builtin: true,
  },
  doc: {
    type: 'doc',
    category: 'doc',
    label: '文档编写',
    outputDir: 'docs/',
    acceptance: '文档结构完整 + 内容准确 + 无死链/占位符残留',
    branchType: 'docs',
    needsBranch: false,
    needsPlatforms: false,
    needsTechSpec: false,
    defaultConstraints: ['doc-standards'],
    builtin: true,
  },
  script: {
    type: 'script',
    category: 'script',
    label: '脚本开发',
    outputDir: 'scripts/',
    acceptance: '脚本可运行 + 输入校验完整 + 失败有明确退出码',
    branchType: 'feature',
    needsBranch: false,
    needsPlatforms: false,
    needsTechSpec: false,
    defaultConstraints: ['script-standards'],
    builtin: true,
  },
  data: {
    type: 'data',
    category: 'data',
    label: '数据处理',
    outputDir: 'outputs/',
    acceptance: '数据完整性校验通过 + 结果可复现 + 异常数据有隔离',
    branchType: 'feature',
    needsBranch: false,
    needsPlatforms: false,
    needsTechSpec: false,
    defaultConstraints: ['data-standards'],
    builtin: true,
  },
  // v8.3.308+: 演示文稿（PPT）——Markdown 大纲 + 逐页内容，渲染交给用户
  presentation: {
    type: 'presentation',
    category: 'doc',
    label: '演示文稿',
    outputDir: 'presentations/',
    acceptance: '页数达标（spec 声明，未声明默认 ≥8 页）+ 每页含标题与 3-5 要点 + 无占位符残留',
    branchType: '',
    needsBranch: false,
    needsPlatforms: false,
    needsTechSpec: false,
    defaultConstraints: ['doc-standards', 'presentation-standards'],
    builtin: true,
  },
};

/** 全部内置任务类型 ID 列表 */
export const ALL_TASK_TYPES = Object.keys(TASK_TYPE_REGISTRY);

/**
 * 获取任务类型定义（同步版：内置 → 通用非代码回退）
 *
 * 不读自定义定义文件（需 I/O），供 task new 等创建侧使用；执行侧请用
 * resolveTaskTypeDefinition（异步，含自定义定义文件解析）。
 */
export function getTaskTypeDefinition(type: string): TaskTypeDefinition {
  return TASK_TYPE_REGISTRY[type] || buildGenericDefinition(type);
}

/**
 * 通用非代码回退定义 —— 未知类型一律按「与代码世界绝缘」处理
 *
 * v8.3.308 核心原则：只要不是系统定义的类型，默认不建分支、不需要端拆分、
 * 不需要技术规格；spec 显式声明 code: true 才切换为代码形态。
 */
export function buildGenericDefinition(type: string): TaskTypeDefinition {
  return {
    type: type || 'custom',
    category: 'custom',
    label: type || '自定义任务',
    outputDir: 'outputs/',
    acceptance: '按任务 spec 描述的交付物与验收标准完成（见 REQ.md 验收标准节）',
    branchType: '',
    needsBranch: false,
    needsPlatforms: false,
    needsTechSpec: false,
    defaultConstraints: [],
    builtin: false,
  };
}

// ═══════════════════════════════════════════════════════════
// 用户自定义类型定义文件（v8.3.308）
// ═══════════════════════════════════════════════════════════

/** 自定义类型定义目录（相对项目根） */
export const CUSTOM_TYPES_DIR = '.speccore/GLOBAL/TASK_TYPES';

/**
 * 解析自定义类型定义文件（.speccore/GLOBAL/TASK_TYPES/{类型名}.md）
 *
 * 格式：YAML frontmatter 声明字段，正文为类型说明（可选）。示例：
 *
 *   ---
 *   label: 演示文稿
 *   category: doc
 *   outputDir: presentations/
 *   acceptance: 页数达标 + 每页含标题要点
 *   needsBranch: false
 *   needsPlatforms: false
 *   needsTechSpec: false
 *   constraints: [doc-standards, ppt-style]
 *   ---
 *   正文说明……
 */
export function parseCustomTypeDefinition(type: string, content: string): TaskTypeDefinition | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const fm = fmMatch[1];
  const pick = (key: string): string | undefined => {
    const m = fm.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : undefined;
  };
  const pickBool = (key: string): boolean | undefined => {
    const v = pick(key);
    if (v === undefined) return undefined;
    return ['true', 'yes', '1'].includes(v.toLowerCase());
  };
  const pickList = (key: string): string[] | undefined => {
    const v = pick(key);
    if (v === undefined) return undefined;
    return v.replace(/^\[|\]$/g, '').split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
  };

  const label = pick('label') || type;
  const base = buildGenericDefinition(type);
  return {
    ...base,
    category: (pick('category') as TaskCategory) || 'custom',
    label,
    outputDir: pick('outputDir') || 'outputs/',
    acceptance: pick('acceptance') || base.acceptance,
    branchType: pick('branchType') || '',
    needsBranch: pickBool('needsBranch') ?? false,
    needsPlatforms: pickBool('needsPlatforms') ?? false,
    needsTechSpec: pickBool('needsTechSpec') ?? false,
    defaultConstraints: pickList('constraints') ?? [],
  };
}

/**
 * 解析任务类型定义（异步版，执行侧使用）
 *
 * 优先级：内置注册表 → 用户自定义定义文件 → 通用非代码回退。
 * 自定义定义文件不存在/无 frontmatter 时静默回退，不阻断调度。
 */
export async function resolveTaskTypeDefinition(type: string, cwd?: string): Promise<TaskTypeDefinition> {
  if (TASK_TYPE_REGISTRY[type]) return TASK_TYPE_REGISTRY[type];
  try {
    const fp = join(cwd || getProjectRoot(), CUSTOM_TYPES_DIR, `${type}.md`);
    if (await pathExists(fp)) {
      const parsed = parseCustomTypeDefinition(type, await readFile(fp, 'utf-8'));
      if (parsed) return parsed;
    }
  } catch { /* 忽略，回退通用定义 */ }
  return buildGenericDefinition(type);
}

/**
 * 解析任务 spec 中的「写代码」显式声明（v8.3.308）
 *
 * 非系统定义类型默认与代码世界绝缘；任务 spec 声明 code: true（或 needsCode: true）
 * 时切换为代码形态（建分支、写源码路径、注入编码约束）。
 *
 * 支持两种声明：
 *  - YAML frontmatter: code: true / needsCode: true
 *  - 行内声明:        - 需要写代码: true
 */
export function parseSpecCodeDeclaration(specContent: string): boolean {
  const fmMatch = specContent.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    const m = fm.match(/^(code|needsCode)\s*:\s*true\s*$/m);
    if (m) return true;
  }
  const inline = specContent.match(/^[-•]\s*\*{0,2}(需要写代码|需要编码|写代码)\*{0,2}\s*[：:]\s*(true|是|yes)\s*$/im);
  return !!inline;
}

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

> 本约束在每次执行文档类任务（doc/presentation）前自动注入。

- 使用标准 Markdown，标题层级清晰，表格对齐
- 术语与既有文档保持一致，引用使用相对路径
- 禁止占位符残留（TODO、待补充、xxx）
- 所有链接必须有效（本地文件存在、外链可访问）
`,
  'presentation-standards': `# 演示文稿约束（内置）

> 本约束在每次执行演示文稿任务（presentation）前自动注入。

- 产出 Markdown 大纲 + 逐页内容（presentation.md），不生成二进制 PPT
- 每页必须有标题与 3-5 个要点，禁止整段文字上页
- 页数按 spec 要求（未声明时 ≥ 8 页），首页为封面、末页为总结
- 配图以文字建议描述（"此处配图：…"），不嵌入实际图片
- 演讲稿与页内容分离：页内容精简，口播内容放每页的「口播备注」小节
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
