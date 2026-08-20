/**
 * AGENTS 引擎 — 类型定义
 *
 * v6.84.0+: 规范数据库驱动的 Multi-Agent 调度架构
 */

export interface AgentDefinition {
  name: string;
  description: string;
  responsibilities: string[];
  inputSpec: string;
  checkList: string[];
  outputFormat: string;
  rolePrompt: string;
  source: 'builtin' | 'user-defined';
  activations: AgentActivation[]; // v6.84.0+: 自描述激活规则
}

export interface AgentActivation {
  command: string;
  phase: string;
  priority: number;
  condition?: string; // 简单条件表达式，如 "project.industry == 'finance'"
}

export interface AgentRegistryEntry {
  agent: string;
  priority: number;
  condition?: string;
  description?: string;
}

export interface AgentRegistry {
  phases: Record<string, AgentRegistryEntry[]>;
}

export interface AgentContext {
  iteration?: string;
  iterationDir?: string;
  taskDir?: string;
  codePath?: string;
  platform?: string; // 'backend' | 'frontend' | 'h5' | 'admin' | ...
  project?: {
    industry?: string; // 'finance' | 'healthcare' | 'ecommerce' | ...
    securityLevel?: number;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface AgentTask {
  agent: string;
  input: AgentContext;
  priority?: number;
}

export interface AgentResult {
  agent: string;
  passed: boolean;
  findings: AgentFinding[];
  rewrite?: string;
  nextAgents?: string[];
  duration: number;
  output?: string;
}

export interface AgentFinding {
  severity: 'critical' | 'major' | 'minor' | 'info';
  category: string;
  message: string;
  suggestion?: string;
  location?: string;
}

export interface ResolvedAgent {
  name: string;
  definition: AgentDefinition;
  priority: number;
}
