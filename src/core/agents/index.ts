/**
 * Agents Module — 专业 AI 角色定义
 *
 * v6.83.0+: 从单一 AGENTS.md 总纲 → 多角色专业化分离
 * v6.84.0+: 规范数据库驱动（.speccore/AGENTS/）+ 混合调度器
 * 每个角色包含：角色定义、专业 prompt 构建、领域特定检查清单
 */

// ── 向后兼容：保留 v6.83.0 硬编码角色（内部使用，不鼓励新代码直接引用）──
export {
  PRODUCT_ANALYST_ROLE,
  INTERACTION_DESIGNER_ROLE,
  buildProductAnalystPrompt,
  buildInteractionDesignerPrompt,
} from './product-analyst';

// ── v6.84.0+: AGENTS 引擎核心 API ──
export {
  AgentDefinition,
  AgentActivation,
  AgentRegistryEntry,
  AgentRegistry,
  AgentContext,
  AgentTask,
  AgentResult,
  AgentFinding,
  ResolvedAgent,
} from './engine/types';

export {
  loadAllAgents,
  loadRegistry,
  resolveAgentsForPhase,
  loadAgentDefinition,
  resolveAgentName,
  getBuiltinAgentContents,
  getBuiltinRegistryContent,
  getBuiltinTemplateContent,
} from './engine/agent-loader';

export {
  buildAgentPrompt,
  prepareAgentTask,
  parseAgentResponse,
  mergeAgentResults,
} from './engine/agent-executor';
