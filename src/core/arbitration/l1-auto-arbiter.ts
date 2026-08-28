/**
 * l1-auto-arbiter.ts — L1 机器契约自动裁决器
 *
 * v8.3.24+: 全自动裁决，无需人工参与
 */

import type { Conflict } from './conflict-types';
import type { Verdict } from './verdict-types';

export interface L1ArbitrationResult {
  verdict: Verdict;
  conflict: Conflict;
  passed: boolean;
}

/**
 * L1 裁决：机器自动裁决
 * 当前实现：L1 冲突（编译失败等）直接裁决为 reject，因为编译器已尝试修复
 * 未来可扩展：集成 AI 自动修复循环
 */
export async function arbitrateL1(conflict: Conflict): Promise<L1ArbitrationResult> {
  const verdict: Verdict = {
    id: `V-${conflict.id}`,
    taskId: conflict.taskId,
    conflictId: conflict.id,
    level: 'L1',
    outcome: conflict.violation.severity === 'fatal' ? 'reject' : 'pass',
    reasoning: conflict.violation.severity === 'fatal'
      ? 'L1 机器契约被违反且为致命错误，自动裁决驳回。修复后需重新执行。'
      : 'L1 机器契约警告级别，自动裁决通过但需关注。',
    arbiter: 'L1-Auto-Arbiter',
    timestamp: new Date().toISOString(),
  };

  const updatedConflict: Conflict = {
    ...conflict,
    status: conflict.violation.severity === 'fatal' ? 'resolved' : 'overridden',
    resolvedAt: new Date().toISOString(),
    resolvedBy: 'machine',
    resolution: verdict.reasoning,
    arbiter: verdict.arbiter,
  };

  return {
    verdict,
    conflict: updatedConflict,
    passed: conflict.violation.severity !== 'fatal',
  };
}
