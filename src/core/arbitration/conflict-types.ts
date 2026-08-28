/**
 * conflict-types.ts — 冲突类型定义
 *
 * v8.3.24+: 契约冲突裁决模型核心类型
 */

import type { ContractViolation } from './contract-types';

export type ConflictStatus =
  | 'detected'
  | 'auto-fixing'
  | 'pending-fix'
  | 'pending-review'
  | 'resolved'
  | 'overridden'
  | 'escalated';

export interface Conflict {
  id: string;
  taskId: string;
  contractId: string;
  violation: ContractViolation;
  status: ConflictStatus;
  detectedAt: string;
  resolvedAt?: string;
  resolvedBy?: 'machine' | 'ai' | 'human';
  resolution?: string;
  arbiter?: string;
  parentConflictId?: string;
}

export interface ConflictDetectionResult {
  conflicts: Conflict[];
  summary: {
    total: number;
    L1: number;
    L2: number;
    L3: number;
    fatal: number;
    critical: number;
    warning: number;
    info: number;
  };
}
