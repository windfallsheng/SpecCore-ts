/**
 * contract-types.ts — 契约类型定义
 *
 * v8.3.24+: 契约冲突裁决模型核心类型
 */

export type ContractLevel = 'L1' | 'L2' | 'L3';

export type ContractStatus = 'active' | 'disabled' | 'experimental';

export interface Contract {
  id: string;
  name: string;
  level: ContractLevel;
  description: string;
  priority: number;
  status: ContractStatus;
}

export interface ContractViolation {
  contractId: string;
  severity: 'fatal' | 'critical' | 'warning' | 'info';
  message: string;
  location?: { file: string; line?: number };
  evidence: string;
  suggestedFix?: string;
}

export type CheckFunction = (
  codePath: string,
  taskDir: string,
  taskId: string
) => Promise<ContractViolation[]>;

export type AutoFixFunction = (
  violation: ContractViolation,
  codePath: string
) => Promise<{ success: boolean; appliedChanges?: string[]; error?: string }>;
