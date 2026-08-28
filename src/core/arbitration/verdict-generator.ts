/**
 * verdict-generator.ts — 裁决书生成器
 *
 * v8.3.24+: 生成标准化的 ARBITRATION_REPORT.md
 */

import { join } from 'path';
import { writeFile } from 'fs-extra';
import { getContractById } from './contract-registry';
import type { Conflict, ConflictDetectionResult } from './conflict-types';
import type { Verdict, ArbitrationReport } from './verdict-types';

/**
 * 生成裁决书对象
 */
export function generateArbitrationReport(
  taskId: string,
  detection: ConflictDetectionResult,
  resolvedConflicts: Conflict[],
  verdicts: Verdict[]
): ArbitrationReport {
  const conflictMap = new Map<string, Conflict>();
  for (const c of resolvedConflicts) {
    conflictMap.set(c.id, c);
  }

  const verdictMap = new Map<string, Verdict>();
  for (const v of verdicts) {
    verdictMap.set(v.conflictId, v);
  }

  // v8.3.24+: 使用 resolvedConflicts（已裁决状态）而非 detection.conflicts（原始 detected 状态）
  const l1List = resolvedConflicts.filter((c) => c.contractId.startsWith('L1-'));
  const l2List = resolvedConflicts.filter((c) => c.contractId.startsWith('L2-'));
  const l3List = resolvedConflicts.filter((c) => c.contractId.startsWith('L3-'));

  const L1Passed = l1List.filter((c) => c.status === 'overridden' || c.status === 'resolved').length;
  const L2Passed = l2List.filter((c) => c.status === 'overridden' || c.status === 'resolved').length;
  const L3Passed = l3List.filter((c) => c.status === 'overridden' || c.status === 'resolved').length;

  const status: ArbitrationReport['status'] =
    detection.summary.total === 0
      ? 'resolved'
      : resolvedConflicts.some((c) => c.status === 'pending-review')
        ? 'pending'
        : resolvedConflicts.some((c) => c.status === 'pending-fix')
          ? 'partial'
          : 'resolved';

  return {
    taskId,
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    status,
    L1: {
      total: detection.summary.L1,
      passed: L1Passed,
      failed: detection.summary.L1 - L1Passed,
    },
    L2: {
      total: detection.summary.L2,
      passed: L2Passed,
      pending: l2List.filter((c) => c.status === 'pending-fix').length,
      failed: detection.summary.L2 - L2Passed - l2List.filter((c) => c.status === 'pending-fix').length,
    },
    L3: {
      total: detection.summary.L3,
      passed: L3Passed,
      pending: l3List.filter((c) => c.status === 'pending-review').length,
      failed: detection.summary.L3 - L3Passed - l3List.filter((c) => c.status === 'pending-review').length,
    },
    conflicts: resolvedConflicts.map((c) => {
      const contract = getContractById(c.contractId);
      return {
        id: c.id,
        level: contract?.level || 'unknown',
        contractName: contract?.name || c.contractId,
        status: c.status,
        message: c.violation.message,
        verdict: verdictMap.get(c.id),
      };
    }),
  };
}

/**
 * 生成并写入 ARBITRATION_REPORT.md
 */
export async function writeArbitrationReport(
  report: ArbitrationReport,
  taskDir: string
): Promise<void> {
  const lines: string[] = [];

  lines.push(`# 冲突裁决书 — ${report.taskId}`);
  lines.push('');
  lines.push(`> 裁决时间: ${report.timestamp}`);

  const statusIcon =
    report.status === 'resolved' ? '✅ 全部通过'
      : report.status === 'partial' ? '🟡 部分通过'
        : report.status === 'pending' ? '⏳ 等待裁决'
          : '❌ 已驳回';
  lines.push(`> 裁决状态: ${statusIcon}`);
  lines.push('');

  // L1
  lines.push('---');
  lines.push('');
  lines.push('## 一、L1 机器契约裁决（⚙️ 全自动）');
  lines.push('');
  if (report.L1.total === 0) {
    lines.push('**全部通过，机器契约履行完毕。**');
  } else {
    lines.push(`| 契约 | 状态 | 详情 |`);
    lines.push(`| :--- | :--- | :--- |`);
    for (const c of report.conflicts.filter((c) => c.level === 'L1')) {
      const icon = c.status === 'resolved' ? '❌' : c.status === 'overridden' ? '⚠️' : '⏳';
      lines.push(`| ${c.contractName} | ${icon} ${c.status} | ${c.message} |`);
    }
    lines.push('');
    lines.push(`**L1 裁决结论: ${report.L1.failed > 0 ? '存在致命错误，已阻断。' : '全部通过。'}**`);
  }
  lines.push('');

  // L2
  lines.push('---');
  lines.push('');
  lines.push('## 二、L2 规范契约裁决（🤖 AI 辅助）');
  lines.push('');
  if (report.L2.total === 0) {
    lines.push('**全部通过，规范契约履行完毕。**');
  } else {
    for (const c of report.conflicts.filter((c) => c.level === 'L2')) {
      lines.push(`### ${c.contractName}`);
      lines.push(`- **状态**: ${c.status}`);
      lines.push(`- **说明**: ${c.message}`);
      if (c.verdict) {
        lines.push(`- **裁决**: ${c.verdict.outcome} (${c.verdict.arbiter})`);
      }
      lines.push('');
    }
  }
  lines.push('');

  // L3
  lines.push('---');
  lines.push('');
  lines.push('## 三、L3 架构契约裁决（👤 人工最终）');
  lines.push('');
  if (report.L3.total === 0) {
    lines.push('**全部通过，架构契约履行完毕。**');
  } else {
    for (const c of report.conflicts.filter((c) => c.level === 'L3')) {
      lines.push(`### ${c.contractName}`);
      lines.push(`- **状态**: ${c.status}`);
      lines.push(`- **说明**: ${c.message}`);
      if (c.status === 'pending-review') {
        lines.push(`- **⚠️ 此冲突需人工裁决，请执行: \`speccore verdict --conflict ${c.id} --decide\`**`);
      }
      if (c.verdict) {
        lines.push(`- **裁决**: ${c.verdict.outcome}`);
        lines.push(`- **理由**: ${c.verdict.reasoning}`);
      }
      lines.push('');
    }
  }
  lines.push('');

  // 汇总
  lines.push('---');
  lines.push('');
  lines.push('## 四、裁决汇总');
  lines.push('');
  lines.push(`| 层级 | 冲突数 | 已通过 | 待确认 | 待裁决 | 已驳回 |`);
  lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- |`);
  lines.push(`| L1 机器契约 | ${report.L1.total} | ${report.L1.passed} | — | — | ${report.L1.failed} |`);
  lines.push(`| L2 规范契约 | ${report.L2.total} | ${report.L2.passed} | ${report.L2.pending} | — | ${report.L2.failed} |`);
  lines.push(`| L3 架构契约 | ${report.L3.total} | ${report.L3.passed} | — | ${report.L3.pending} | ${report.L3.failed} |`);
  lines.push('');
  lines.push(`**当前任务状态**: ${statusIcon}`);
  lines.push('');

  const content = lines.join('\n');
  await writeFile(join(taskDir, 'ARBITRATION_REPORT.md'), content, 'utf-8');
}
