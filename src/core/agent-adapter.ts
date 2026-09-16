/**
 * AgentAdapter — 子 Agent 统一适配层
 *
 * v8.3.160+: 实现子 Agent 隔离，解决上下文漂移问题。
 * v8.3.169+: 真正集成 Qoder Agent SDK，支持多工具动态适配：
 *   - Qoder: 通过 @qoder-ai/qoder-agent-sdk 直接调度子 Agent
 *   - Cursor/Windsurf/Claude/CodeBuddy/Trae: Headless 模式（文本标记）
 *   - 所有工具默认兜底 Headless
 *
 * 每个 Pipeline 步骤可以指定 subagent，由适配层负责：
 *   1. 准备该 subagent 所需的紧凑上下文
 *   2. 控制上下文大小（Token 预算）
 *   3. 输出子 Agent 激活标记和指令（Headless）
 *   4. 或直接通过 SDK 调度子 Agent 执行（Qoder SDK）
 */

import { readFile, pathExists } from 'fs-extra';
import { join } from 'path';
import { ContextSnapshot } from './pipeline-engine';
import { logger } from '../utils/logger';
import { detectHostAi, type HostAiTool } from './ask-host-ai';

// ── 子 Agent 上下文 ──
export interface AgentContext {
  /** 子 Agent 名称 */
  subagent: string;
  /** 迭代名 */
  iteration: string;
  /** 任务 ID */
  task?: string;
  /** 端名 */
  platform?: string;
  /** 上下文快照 */
  contextSnapshot?: ContextSnapshot;
  /** 上下文预算（tokens） */
  contextBudget: number;
  /** 上下文加载类型 */
  contextType: 'full' | 'incremental' | 'platform-only' | 'contract-only';
  /** 工作区根目录 */
  cwd: string;
}

// ── 子 Agent 配置 ──
export interface SubagentConfig {
  /** 子 Agent 标识名 */
  name: string;
  /** 职责描述 */
  description: string;
  /** 系统级 Prompt（角色定义） */
  systemPrompt: string;
  /** 默认上下文类型 */
  defaultContextType: 'full' | 'incremental' | 'platform-only' | 'contract-only';
  /** 默认 Token 预算 */
  defaultContextBudget: number;
  /** 关联技能文件路径 */
  skills: string[];
}

// ── 适配器模式 ──
export type AgentAdapterMode =
  | 'headless'
  | 'qoder-sdk'
  | 'cursor-sdk'
  | 'windsurf-sdk'
  | 'claude-sdk'
  | 'codebuddy-sdk';

// ── 子 Agent 调度结果 ──
export interface SubagentDispatchResult {
  /** 是否成功执行 */
  success: boolean;
  /** Agent 的文本回复 */
  content?: string;
  /** 被修改/创建的文件路径列表 */
  filesChanged?: string[];
  /** 错误信息 */
  error?: string;
}

// ── AgentAdapter 接口 ──
export interface AgentAdapter {
  /** 注册子 Agent 配置 */
  registerSubagent(name: string, config: SubagentConfig): void;
  /** 根据 subagent 名获取配置 */
  getSubagentConfig(name: string): SubagentConfig | undefined;
  /** 准备子 Agent 的紧凑上下文文本 */
  prepareContext(ctx: AgentContext): Promise<string>;
  /** 构建子 Agent 激活标记和指令 */
  buildActivationPrompt(ctx: AgentContext, nextPrompt: string): string;
  /** 获取支持的适配模式 */
  getMode(): AgentAdapterMode;
  /** v8.3.169+: 直接调度子 Agent 执行任务（SDK 模式）
   * 返回 null 表示当前适配器不支持直接调度，需由外层 AI 接管 */
  dispatchSubagent?(ctx: AgentContext, taskPrompt: string): Promise<SubagentDispatchResult | null>;
}

// ── 全局子 Agent 注册表 ──
const subagentRegistry = new Map<string, SubagentConfig>();

// ── 默认子 Agent 配置（以 _INDEX.md 角色定义为准） ──
const DEFAULT_SUBAGENTS: SubagentConfig[] = [
  // analyze / clarify 阶段
  {
    name: 'product-analyst',
    description: '产品分析师：业务流程完整性、遗漏识别、术语统一',
    systemPrompt: '你是 SpecCore 产品分析师。你的职责是审查业务流程完整性、识别需求遗漏、检查术语统一性。输出格式：Markdown 产品分析报告。',
    defaultContextType: 'full',
    defaultContextBudget: 4000,
    skills: ['.speccore/AGENTS/product-analyst.md'],
  },
  {
    name: 'interaction-designer',
    description: '交互设计师：信息架构、状态矩阵、前后端一致性',
    systemPrompt: '你是 SpecCore 交互设计师。你的职责是设计页面信息架构、定义交互状态矩阵、检查前后端交互一致性。输出格式：Markdown 交互审查报告。',
    defaultContextType: 'full',
    defaultContextBudget: 4000,
    skills: ['.speccore/AGENTS/interaction-designer.md'],
  },
  {
    name: 'security-reviewer',
    description: '安全审查员：认证授权、输入验证、数据保护',
    systemPrompt: '你是 SpecCore 安全审查员。你的职责是识别需求/代码中的安全风险，检查认证、授权、输入验证、数据保护。输出格式：安全问题列表。',
    defaultContextType: 'full',
    defaultContextBudget: 4000,
    skills: ['.speccore/AGENTS/security-reviewer.md'],
  },
  // analyze 阶段
  {
    name: 'spec-analyzer',
    description: '需求分析专家：逐端分析、架构设计、技术方案',
    systemPrompt: '你是 SpecCore 需求分析专家。你的职责是根据需求文档和契约，为指定端生成完整的技术规格。必须遵循 CONSTITUTION.md 中的命名规范和端名标准。输出格式：Markdown 技术文档。',
    defaultContextType: 'platform-only',
    // v8.3.160+: 配合按需加载优化，降至 10K
    defaultContextBudget: 10000,
    skills: ['.speccore/AGENTS/product-analyst-backend.md', '.speccore/AGENTS/product-analyst-frontend.md'],
  },
  // execute 阶段
  {
    name: 'spec-executor',
    description: '代码生成专家：读取规格、生成代码、遵循规范',
    systemPrompt: '你是 SpecCore 代码生成专家。你的职责是根据 TASK.md 和技术规格，生成符合项目规范的代码实现。必须遵循 CONSTITUTION.md 的命名规范、端名标准和错误码体系。输出格式：JSON 文件列表。',
    defaultContextType: 'incremental',
    defaultContextBudget: 10000,
    skills: ['.speccore/SKILLS/execute.md'],
  },
  // execute / quality-gate 阶段
  // v8.3.160+: compiler 合并 test-engineer 职责（quality-gate-build）
  {
    name: 'compiler',
    description: '构建质量检查员：编译检查 + 测试覆盖',
    systemPrompt: '你是 SpecCore 构建质量检查员。你的职责是：1) 检查代码编译可行性，识别语法错误和类型错误；2) 检查单元测试和集成测试覆盖率，确保新增代码有配套测试。输出格式：构建质量报告（含编译结果 + 测试覆盖）。',
    defaultContextType: 'incremental',
    defaultContextBudget: 8000,
    skills: ['.speccore/AGENTS/compiler.md', '.speccore/AGENTS/test-engineer.md'],
  },
  // v8.3.160+: security-reviewer 合并 performance-expert 职责（quality-gate-nfr）
  {
    name: 'security-reviewer',
    description: '非功能质量检查员：安全审查 + 性能检测',
    systemPrompt: '你是 SpecCore 非功能质量检查员。你的职责是：1) 识别代码中的安全风险（认证、授权、输入验证、数据保护）；2) 检查性能瓶颈（N+1 查询、内存泄漏、不必要的重渲染）。输出格式：非功能质量报告（含安全 + 性能）。',
    defaultContextType: 'incremental',
    defaultContextBudget: 6000,
    skills: ['.speccore/AGENTS/security-reviewer.md', '.speccore/AGENTS/performance-expert.md'],
  },
  {
    name: 'doc-sync-agent',
    description: '文档同步检查员：代码与文档一致性',
    systemPrompt: '你是 SpecCore 文档同步检查员。你的职责是检查代码与文档的一致性，确保 API 文档与实际接口匹配，注释和文档未过时。输出格式：文档同步报告。',
    defaultContextType: 'incremental',
    defaultContextBudget: 3000,
    skills: ['.speccore/AGENTS/doc-sync-agent.md'],
  },
  // split 阶段
  {
    name: 'task-decomposer',
    description: '任务拆分专家：功能模块拆分为原子级开发任务',
    systemPrompt: '你是 SpecCore 任务拆分专家。你的职责是将功能模块拆分为原子级开发任务，确保每个任务可独立执行、可验收，工时控制在 2h-8h。输出格式：任务列表。',
    defaultContextType: 'full',
    defaultContextBudget: 8000,
    skills: ['.speccore/AGENTS/task-decomposer.md'],
  },
  {
    name: 'dependency-analyst',
    description: '依赖关系分析师：任务间依赖、循环依赖检测',
    systemPrompt: '你是 SpecCore 依赖关系分析师。你的职责是识别任务间的依赖关系，构建任务依赖图，发现循环依赖，推荐任务执行顺序。输出格式：依赖分析报告。',
    defaultContextType: 'incremental',
    defaultContextBudget: 5000,
    skills: ['.speccore/AGENTS/dependency-analyst.md'],
  },
  {
    name: 'effort-estimator',
    description: '工时估算专家：任务工时估算',
    systemPrompt: '你是 SpecCore 工时估算专家。你的职责是根据任务复杂度和历史数据，为每个任务估算工时。输出格式：工时估算表。',
    defaultContextType: 'incremental',
    defaultContextBudget: 4000,
    skills: [],
  },
  // global-analyze 阶段
  {
    name: 'spec-global-analyzer',
    description: '全局分析专家：跨迭代依赖、全局架构、一致性检查',
    systemPrompt: '你是 SpecCore 全局分析专家。你的职责是分析跨迭代的依赖关系、全局架构一致性和技术债务。必须识别所有跨端关联和重复实现。输出格式：Markdown 全局报告。',
    defaultContextType: 'full',
    // v8.3.160+: 配合按需加载优化，降至 10K
    defaultContextBudget: 10000,
    skills: ['.speccore/SKILLS/global-analyze.md'],
  },
  // plan 阶段（预留）
  {
    name: 'schedule-planner',
    description: '排期规划专家：任务排期、资源分配',
    systemPrompt: '你是 SpecCore 排期规划专家。你的职责是根据任务列表和人员配置，生成执行计划，识别可并行的任务批次。输出格式：执行计划。',
    defaultContextType: 'full',
    defaultContextBudget: 6000,
    skills: ['.speccore/AGENTS/schedule-planner.md'],
  },
  {
    name: 'risk-assessor',
    description: '风险评估专家：技术风险、依赖风险识别',
    systemPrompt: '你是 SpecCore 风险评估专家。你的职责是评估任务执行中的技术风险和依赖风险，参考 RISK.md 和 .issues.md。输出格式：风险评估报告。',
    defaultContextType: 'incremental',
    defaultContextBudget: 4000,
    skills: ['.speccore/AGENTS/risk-assessor.md'],
  },
  // change 阶段（预留）
  {
    name: 'impact-analyst',
    description: '影响范围分析师：变更影响分析',
    systemPrompt: '你是 SpecCore 影响范围分析师。你的职责是分析变更对现有代码、文档、测试的影响范围，识别需要同步修改的关联模块。输出格式：影响范围分析报告。',
    defaultContextType: 'full',
    defaultContextBudget: 6000,
    skills: ['.speccore/AGENTS/impact-analyst.md'],
  },
  {
    name: 'regression-tester',
    description: '回归测试专家：回归测试范围确定',
    systemPrompt: '你是 SpecCore 回归测试专家。你的职责是根据变更内容确定回归测试范围，确保变更不会破坏已有功能。输出格式：回归测试计划。',
    defaultContextType: 'incremental',
    defaultContextBudget: 4000,
    skills: ['.speccore/AGENTS/regression-tester.md'],
  },
  // pr 阶段（预留）
  {
    name: 'code-reviewer',
    description: '代码审查员：代码质量、可读性、可维护性',
    systemPrompt: '你是 SpecCore 代码审查员。你的职责是审查代码质量、可读性、可维护性，检查是否符合项目编码规范。输出格式：代码审查报告。',
    defaultContextType: 'incremental',
    defaultContextBudget: 6000,
    skills: ['.speccore/AGENTS/code-reviewer.md'],
  },
  {
    name: 'test-reviewer',
    description: '测试审查员：测试完整性审查',
    systemPrompt: '你是 SpecCore 测试审查员。你的职责是审查测试代码的完整性和有效性，确保测试覆盖所有场景。输出格式：测试审查报告。',
    defaultContextType: 'incremental',
    defaultContextBudget: 4000,
    skills: ['.speccore/AGENTS/test-reviewer.md'],
  },
];

// ═══════════════════════════════════════════════════════════
// HeadlessAdapter — 基于文件/状态机的子 Agent 模拟
// ═══════════════════════════════════════════════════════════

export class HeadlessAdapter implements AgentAdapter {
  private registry: Map<string, SubagentConfig>;

  constructor() {
    this.registry = new Map(subagentRegistry);
    // 注册默认子 Agent
    for (const config of DEFAULT_SUBAGENTS) {
      if (!this.registry.has(config.name)) {
        this.registry.set(config.name, config);
      }
    }
  }

  getMode(): AgentAdapterMode {
    return 'headless';
  }

  /** v8.3.169+: Headless 模式不支持直接调度，返回 null 由外层 AI 接管 */
  async dispatchSubagent(_ctx: AgentContext, _taskPrompt: string): Promise<SubagentDispatchResult | null> {
    return null;
  }

  registerSubagent(name: string, config: SubagentConfig): void {
    this.registry.set(name, config);
    logger.debug(`[AgentAdapter] 注册子 Agent: ${name}`);
  }

  getSubagentConfig(name: string): SubagentConfig | undefined {
    return this.registry.get(name);
  }

  /** 准备子 Agent 的紧凑上下文 */
  async prepareContext(ctx: AgentContext): Promise<string> {
    const config = this.registry.get(ctx.subagent);
    const lines: string[] = [];

    // 1. 子 Agent 角色定义
    if (config) {
      lines.push(`## 🤖 子 Agent: ${config.name}`);
      lines.push(`> ${config.description}`);
      lines.push('');
      lines.push('### 角色定义');
      lines.push(config.systemPrompt);
      lines.push('');
    }

    // 2. 上下文预算提醒
    lines.push(`### 上下文预算`);
    lines.push(`- 可用 Token: ~${ctx.contextBudget}`);
    lines.push(`- 加载模式: ${ctx.contextType}`);
    lines.push('');

    // 3. 根据 contextType 加载不同范围的上下文
    if (ctx.contextSnapshot) {
      lines.push('### 已完成步骤');
      for (const step of ctx.contextSnapshot.completedSteps) {
        lines.push(`- ✅ ${step}`);
      }
      lines.push('');

      if (ctx.contextSnapshot.completedOutputs.length > 0) {
        lines.push('### 已完成产出（文件路径）');
        for (const output of ctx.contextSnapshot.completedOutputs) {
          lines.push(`- 📄 ${output}`);
        }
        lines.push('');
      }
    }

    // 4. 增量模式下只加载路径引用
    if (ctx.contextType === 'incremental') {
      lines.push('> 💡 增量模式：已完成的产出文件已在上方列出，需要时按需 Read，不要全文加载到上下文中。');
      lines.push('');
    }

    // 5. platform-only 模式下提示只加载当前端
    if (ctx.contextType === 'platform-only' && ctx.platform) {
      lines.push(`> 💡 平台隔离模式：只加载 ${ctx.platform} 端的规格，其他端的内容通过文件路径引用。`);
      lines.push('');
    }

    // 6. contract-only 模式下提示只加载契约
    if (ctx.contextType === 'contract-only') {
      lines.push('> 💡 契约模式：只加载跨端 API 契约，不涉及具体实现细节。');
      lines.push('');
    }

    // 7. v8.3.160+: 按角色裁剪上下文 —— 告诉 AI 哪些文件需要全文读取，哪些只需路径引用
    lines.push('### 上下文裁剪策略');
    const roleHints: Record<string, string[]> = {
      'product-analyst': [
        '📖 **全文读取**：迭代目录 010-requirements/ 下的所有需求文档',
        '📖 **全文读取**：已有的 CLARIFY_REPORT.md（如有）',
        '🔗 **路径引用**：020-specs/ 下的已有规格（按需 Read）',
        '❌ **不加载**：代码实现、构建配置、测试用例',
      ],
      'interaction-designer': [
        '📖 **全文读取**：需求文档中的交互流程、页面描述',
        '📖 **全文读取**：原型图文件（010-requirements/prototypes/）',
        '🔗 **路径引用**：技术栈交互约束（.speccore/RULES/frontend-*.md）',
        '❌ **不加载**：后端 API 实现细节、数据库设计',
      ],
      'security-reviewer': [
        '📖 **全文读取**：安全规则（.speccore/RULES/security.md）',
        ctx.contextType === 'incremental'
          ? '📖 **全文读取**：当前代码实现（重点检查输入验证、认证授权）'
          : '📖 **全文读取**：需求文档中的安全相关描述',
        '🔗 **路径引用**：OWASP 检查清单',
      ],
      'compiler': [
        '📖 **全文读取**：新生成的代码文件',
        '📖 **全文读取**：构建配置文件（tsconfig.json / pom.xml / build.gradle 等）',
        '🔗 **路径引用**：技术栈编译规则（.speccore/RULES/{技术栈}.md）',
        '❌ **不加载**：需求文档、测试用例',
      ],
      'test-engineer': [
        '📖 **全文读取**：代码实现（重点检查可测试性）',
        '📖 **全文读取**：TEST.md 中的测试用例',
        '📖 **全文读取**：覆盖率报告（如有）',
        '🔗 **路径引用**：技术栈测试规范',
      ],
      'performance-expert': [
        '📖 **全文读取**：代码实现（重点检查数据库查询、循环、渲染）',
        '📖 **全文读取**：性能基准数据（如有）',
        '🔗 **路径引用**：技术栈性能规范',
        '❌ **不加载**：需求文档全文',
      ],
      'doc-sync-agent': [
        '📖 **全文读取**：代码中的 API 定义、注释',
        '📖 **全文读取**：文档中的 API 规格',
        '🔗 **路径引用**：技术栈文档格式规范',
        '❌ **不加载**：测试用例、性能数据',
      ],
      'spec-analyzer': [
        '📖 **全文读取**：需求文档、跨端契约',
        '📖 **全文读取**：CONSTITUTION.md（命名规范、端名标准）',
        '🔗 **路径引用**：已有端的规格（参考但不全文加载）',
      ],
      'spec-executor': [
        '📖 **全文读取**：TASK.md、TECH.md',
        '📖 **全文读取**：结构化代码事实卡片（匹配相关部分）',
        '🔗 **路径引用**：已有代码文件（按需 Read，不全文加载）',
      ],
      'task-decomposer': [
        '📖 **全文读取**：需求文档全文（010-requirements/）',
        '📖 **全文读取**：功能模块清单',
        '🔗 **路径引用**：端列表（CONSTITUTION.md）',
      ],
      'dependency-analyst': [
        '📖 **全文读取**：任务列表、需求文档中的依赖描述',
        '🔗 **路径引用**：已有代码的模块结构',
      ],
      'code-reviewer': [
        '📖 **全文读取**：代码变更（diff）',
        '📖 **全文读取**：编码规范（.speccore/RULES/{技术栈}.md）',
        '🔗 **路径引用**：需求文档（按需确认）',
      ],
      'test-reviewer': [
        '📖 **全文读取**：测试代码',
        '📖 **全文读取**：测试规范（.speccore/RULES/testing.md）',
        '🔗 **路径引用**：被测代码文件',
      ],
      'impact-analyst': [
        '📖 **全文读取**：变更内容、依赖图谱',
        '🔗 **路径引用**：模块结构文档',
      ],
      'regression-tester': [
        '📖 **全文读取**：变更内容、测试策略',
        '🔗 **路径引用**：已有测试用例',
      ],
    };

    const hints = roleHints[ctx.subagent];
    if (hints) {
      for (const hint of hints) {
        lines.push(`- ${hint}`);
      }
    } else {
      lines.push('- 按上下文类型默认加载');
    }
    lines.push('');

    return lines.join('\n');
  }

  /** 构建子 Agent 激活标记 */
  buildActivationPrompt(ctx: AgentContext, nextPrompt: string): string {
    const config = this.registry.get(ctx.subagent);
    const lines: string[] = [];

    lines.push(`[SPECCORE_SUBAGENT: ${ctx.subagent}]`);
    if (config) {
      lines.push(`[SPECCORE_SUBAGENT_DESC: ${config.description}]`);
    }
    lines.push(`[SPECCORE_CONTEXT_BUDGET: ${ctx.contextBudget}]`);
    lines.push(`[SPECCORE_CONTEXT_TYPE: ${ctx.contextType}]`);
    lines.push('');
    lines.push('--- 子 Agent 上下文 ---');
    lines.push('');

    return lines.join('\n');
  }
}

// ═══════════════════════════════════════════════════════════
// QoderSdkAdapter — Qoder Agent SDK 深度集成（v8.3.169+）
// ═══════════════════════════════════════════════════════════

/** SpecCore subagent → Qoder AgentDefinition 的映射 */
function buildQoderAgentDefinition(config: SubagentConfig): any {
  return {
    description: config.description,
    prompt: config.systemPrompt,
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    maxTurns: 30,
    permissionMode: 'acceptEdits',
  };
}

/** 内置 subagent 名称映射（优先使用 Qoder 内置 Agent） */
function mapToQoderAgentName(subagent: string): string | undefined {
  const builtinMap: Record<string, string> = {
    'general-purpose': 'general-purpose',
    'Explore': 'Explore',
    'Plan': 'Plan',
  };
  // 如果 SpecCore subagent 名与 Qoder 内置 Agent 匹配，直接返回
  if (builtinMap[subagent]) return builtinMap[subagent];
  // 否则使用自定义 Agent（通过 agents 选项注册）
  return undefined;
}

export class QoderSdkAdapter implements AgentAdapter {
  private registry: Map<string, SubagentConfig>;
  private sdkModule: any | null = null;

  constructor() {
    this.registry = new Map(subagentRegistry);
    for (const config of DEFAULT_SUBAGENTS) {
      if (!this.registry.has(config.name)) {
        this.registry.set(config.name, config);
      }
    }
  }

  getMode(): AgentAdapterMode {
    return 'qoder-sdk';
  }

  registerSubagent(name: string, config: SubagentConfig): void {
    this.registry.set(name, config);
  }

  getSubagentConfig(name: string): SubagentConfig | undefined {
    return this.registry.get(name);
  }

  /** 上下文准备：回退到 Headless（Prompt 构建阶段统一使用） */
  async prepareContext(ctx: AgentContext): Promise<string> {
    const headless = new HeadlessAdapter();
    return headless.prepareContext(ctx);
  }

  /** 激活标记：回退到 Headless（SDK 模式下也输出标记作为备用） */
  buildActivationPrompt(ctx: AgentContext, nextPrompt: string): string {
    const headless = new HeadlessAdapter();
    return headless.buildActivationPrompt(ctx, nextPrompt);
  }

  /** v8.3.169+: 通过 Qoder Agent SDK 直接调度子 Agent */
  async dispatchSubagent(ctx: AgentContext, taskPrompt: string): Promise<SubagentDispatchResult | null> {
    try {
      // 1. 动态加载 SDK（optional dependency）
      if (!this.sdkModule) {
        try {
          this.sdkModule = await import('@qoder-ai/qoder-agent-sdk');
          logger.info('[QoderSdkAdapter] SDK 加载成功');
        } catch (sdkErr: any) {
          logger.warn(`[QoderSdkAdapter] SDK 加载失败: ${sdkErr.message}，回退到 Headless`);
          return null;
        }
      }

      const { query, accessTokenFromEnv } = this.sdkModule;
      if (!query) {
        logger.warn('[QoderSdkAdapter] SDK 不可用（缺少 query 函数），回退到 Headless');
        return null;
      }

      const config = this.registry.get(ctx.subagent);

      // 2. 构建自定义 agents 定义
      const customAgents: Record<string, any> = {};
      if (config) {
        customAgents[ctx.subagent] = buildQoderAgentDefinition(config);
      }

      // 3. 确定使用的 agent 名称
      const qoderAgentName = mapToQoderAgentName(ctx.subagent) || ctx.subagent;

      // 4. 构建 options
      const options: any = {
        auth: accessTokenFromEnv ? accessTokenFromEnv() : undefined,
        cwd: ctx.cwd,
        allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'Agent'],
        permissionMode: 'acceptEdits',
      };

      // 如果有自定义 agent 定义，注入 agents
      if (Object.keys(customAgents).length > 0) {
        options.agents = customAgents;
      }
      // 如果映射到内置 agent，使用 agent 选项
      if (mapToQoderAgentName(ctx.subagent)) {
        options.agent = qoderAgentName;
      }

      logger.info(`[QoderSdkAdapter] 调度子 Agent: ${ctx.subagent} (Qoder agent: ${qoderAgentName})`);

      // 5. 调用 SDK query()
      const stream = query({ prompt: taskPrompt, options });

      // 6. 消费消息流，收集结果
      let content = '';
      const filesChanged: string[] = [];
      let error: string | undefined;

      for await (const message of stream) {
        if (message.type === 'assistant') {
          for (const block of message.message?.content || []) {
            if (block.type === 'text') {
              content += block.text;
            } else if (block.type === 'tool_use') {
              logger.debug(`[QoderSdkAdapter] 工具调用: ${block.name}`);
              if (block.name === 'Write' || block.name === 'Edit') {
                const path = block.input?.path || block.input?.file_path;
                if (path && !filesChanged.includes(path)) {
                  filesChanged.push(path);
                }
              }
            }
          }
        } else if (message.type === 'result') {
          if (message.subtype === 'error') {
            error = message.result?.message || '子 Agent 执行出错';
          }
          logger.info(`[QoderSdkAdapter] 子 Agent ${ctx.subagent} 执行完成: ${message.subtype}`);
        }
      }

      return {
        success: !error,
        content: content || undefined,
        filesChanged: filesChanged.length > 0 ? filesChanged : undefined,
        error,
      };
    } catch (e: any) {
      logger.warn(`[QoderSdkAdapter] 调度失败: ${e.message}，回退到 Headless`);
      return null;
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 工具能力检测
// ═══════════════════════════════════════════════════════════

/** 判断当前工具是否支持 SDK 级子 Agent 调度 */
export function isSdkDispatchSupported(tool?: HostAiTool): boolean {
  const t = tool || detectHostAi();
  return t === 'qoder';
}

/** 判断当前环境是否支持直接子 Agent 调度（SDK 或 Headless） */
export function isSubagentDispatchSupported(): boolean {
  return true; // Headless 始终支持（通过标记模式）
}

// ═══════════════════════════════════════════════════════════
// 统一调度入口（v8.3.169+）
// ═══════════════════════════════════════════════════════════

/**
 * 调度子 Agent 执行任务
 *
 * - Qoder 环境：通过 @qoder-ai/qoder-agent-sdk 直接调用
 * - 其他环境：返回 null（由外层 AI 通过 [SPECCORE_SUBAGENT] 标记接管）
 */
export async function dispatchSubagent(
  ctx: AgentContext,
  taskPrompt: string
): Promise<SubagentDispatchResult | null> {
  const tool = detectHostAi();

  // Qoder 环境：尝试 SDK 调度
  if (tool === 'qoder') {
    const adapter = new QoderSdkAdapter();
    const result = await adapter.dispatchSubagent!(ctx, taskPrompt);
    if (result) return result;
  }

  // 其他环境：Headless 模式，返回 null 让外层 AI 接管
  logger.debug(`[dispatchSubagent] 工具 ${tool} 不支持 SDK 直接调度，使用 Headless 模式`);
  return null;
}

// ═══════════════════════════════════════════════════════════
// 工厂函数
// ═══════════════════════════════════════════════════════════

/**
 * 创建适配器
 * v8.3.169+: 根据检测到的宿主工具自动选择适配器
 */
export function createAgentAdapter(mode?: AgentAdapterMode): AgentAdapter {
  const envMode = process.env.SPECCORE_AGENT_MODE as AgentAdapterMode | undefined;
  const effectiveMode = mode || envMode;

  // 如果显式指定了模式，按模式创建
  if (effectiveMode) {
    if (effectiveMode === 'qoder-sdk') {
      logger.info('[AgentAdapter] 使用 Qoder SDK 模式（显式指定）');
      return new QoderSdkAdapter();
    }
    logger.debug(`[AgentAdapter] 使用 Headless 模式（显式指定: ${effectiveMode}）`);
    return new HeadlessAdapter();
  }

  // 自动检测：根据宿主工具选择
  const tool = detectHostAi();
  switch (tool) {
    case 'qoder':
      logger.info('[AgentAdapter] 自动检测到 Qoder 环境，使用 QoderSdkAdapter');
      return new QoderSdkAdapter();
    case 'workbuddy':
    case 'trae':
    case 'cursor':
    case 'windsurf':
    case 'claude':
    case 'codebuddy':
    default:
      logger.debug(`[AgentAdapter] 工具 ${tool} 使用 Headless 模式`);
      return new HeadlessAdapter();
  }
}

// 默认导出 HeadlessAdapter（向后兼容：prepareContext 阶段所有工具通用）
export const defaultAdapter = new HeadlessAdapter();
