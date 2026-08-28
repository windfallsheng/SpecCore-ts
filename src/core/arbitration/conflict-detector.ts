/**
 * conflict-detector.ts — 冲突检测引擎
 *
 * v8.3.24+: 包装现有 verify-engine，将 CheckResult 转换为 Conflict
 */

import { runQualityGate, type QualityGateResult } from '../verify-engine';
import { mapCheckNameToContractId, getContractById } from './contract-registry';
import type { Conflict, ConflictDetectionResult } from './conflict-types';

/**
 * 运行质量门禁并转换为冲突检测 result
 */
export async function detectConflicts(
  taskId: string,
  codePath: string,
  taskDir: string,
  options?: { timeout?: number; withAgents?: boolean; projectRoot?: string }
): Promise<ConflictDetectionResult> {
  const gateResult = await runQualityGate(taskId, codePath, taskDir, options);

  const conflicts: Conflict[] = [];
  let L1 = 0, L2 = 0, L3 = 0;
  let fatal = 0, critical = 0, warning = 0, info = 0;

  for (const check of gateResult.report.checks) {
    // pass / skip 不生成冲突
    if (check.status === 'pass' || check.status === 'skip') continue;

    const contractId = mapCheckNameToContractId(check.name);
    if (!contractId) continue; // 未映射的检查项跳过

    const contract = getContractById(contractId);
    if (!contract) continue;

    const severity = check.status === 'fail' && check.blocking
      ? 'fatal'
      : check.status === 'fail'
        ? 'critical'
        : 'warning';

    const conflict: Conflict = {
      id: `${contract.level}-${contractId.split('-')[1]}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      taskId,
      contractId,
      violation: {
        contractId,
        severity,
        message: check.details,
        evidence: check.output || check.details,
        suggestedFix: undefined,
      },
      status: 'detected',
      detectedAt: gateResult.report.timestamp,
    };

    conflicts.push(conflict);

    if (contract.level === 'L1') L1++;
    else if (contract.level === 'L2') L2++;
    else if (contract.level === 'L3') L3++;

    if (severity === 'fatal') fatal++;
    else if (severity === 'critical') critical++;
    else if (severity === 'warning') warning++;
    else info++;
  }

  return {
    conflicts,
    summary: {
      total: conflicts.length,
      L1,
      L2,
      L3,
      fatal,
      critical,
      warning,
      info,
    },
  };
}
