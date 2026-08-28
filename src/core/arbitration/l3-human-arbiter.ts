/**
 * l3-human-arbiter.ts — L3 架构契约人工裁决器
 *
 * v8.3.24+: 人工最终裁决，AI 提供决策支持
 */

import type { Conflict } from './conflict-types';
import type { Verdict, VerdictOutcome } from './verdict-types';

export interface L3ArbitrationResult {
  verdict: Verdict;
  conflict: Conflict;
}

/**
 * L3 裁决：初始化人工裁决流程
 * 将冲突状态改为 pending-review，等待人工决策
 */
export async function initiateL3Arbitration(conflict: Conflict): Promise<L3ArbitrationResult> {
  const updatedConflict: Conflict = {
    ...conflict,
    status: 'pending-review',
    arbiter: 'L3-Human-Arbiter (pending)',
  };

  // 生成一个占位裁决，表示等待人工决策
  const verdict: Verdict = {
    id: `V-${conflict.id}`,
    taskId: conflict.taskId,
    conflictId: conflict.id,
    level: 'L3',
    outcome: 'defer',
    reasoning: 'L3 架构契约冲突需人工最终裁决。AI 已生成影响分析，请执行 speccore verdict --conflict {id} --decide 进行裁决。',
    arbiter: 'L3-Human-Arbiter (pending)',
    timestamp: new Date().toISOString(),
  };

  return {
    verdict,
    conflict: updatedConflict,
  };
}

/**
 * 人工做出裁决
 */
export function makeHumanVerdict(
  conflict: Conflict,
  outcome: VerdictOutcome,
  reasoning: string,
  options?: {
    conditions?: string[];
    signature?: string;
  }
): L3ArbitrationResult {
  const verdict: Verdict = {
    id: `V-${conflict.id}-final`,
    taskId: conflict.taskId,
    conflictId: conflict.id,
    level: 'L3',
    outcome,
    reasoning,
    conditions: options?.conditions,
    arbiter: 'Human',
    timestamp: new Date().toISOString(),
    signature: options?.signature,
  };

  const updatedConflict: Conflict = {
    ...conflict,
    status: outcome === 'reject' ? 'resolved' : outcome === 'pass' || outcome === 'pass-with-conditions' ? 'overridden' : 'escalated',
    resolvedAt: new Date().toISOString(),
    resolvedBy: 'human',
    resolution: reasoning,
    arbiter: verdict.arbiter,
  };

  return {
    verdict,
    conflict: updatedConflict,
  };
}
