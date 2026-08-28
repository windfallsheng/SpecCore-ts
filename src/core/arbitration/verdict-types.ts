/**
 * verdict-types.ts — 裁决书类型定义
 *
 * v8.3.24+: 契约冲突裁决模型核心类型
 */

export type VerdictOutcome =
  | 'pass'
  | 'pass-with-conditions'
  | 'reject'
  | 'defer'
  | 'escalate';

export interface Verdict {
  id: string;
  taskId: string;
  conflictId: string;
  level: 'L1' | 'L2' | 'L3';
  outcome: VerdictOutcome;
  reasoning: string;
  conditions?: string[];
  arbiter: string;
  timestamp: string;
  signature?: string;
}

export interface ArbitrationReport {
  taskId: string;
  timestamp: string;
  status: 'pending' | 'partial' | 'resolved' | 'rejected';
  L1: { total: number; passed: number; failed: number };
  L2: { total: number; passed: number; pending: number; failed: number };
  L3: { total: number; passed: number; pending: number; failed: number };
  conflicts: Array<{
    id: string;
    level: string;
    contractName: string;
    status: string;
    message: string;
    verdict?: Verdict;
  }>;
}
