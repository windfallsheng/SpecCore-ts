/**
 * arbitration-engine.ts — 裁决引擎主入口
 *
 * v8.3.24+: 契约冲突裁决模型核心引擎
 * 按层级路由冲突到对应的裁决器
 */

import { join } from 'path';
import { pathExists, readFile } from 'fs-extra';
import { detectConflicts } from './conflict-detector';
import { arbitrateL1 } from './l1-auto-arbiter';
import { arbitrateL2 } from './l2-ai-arbiter';
import { initiateL3Arbitration } from './l3-human-arbiter';
import { generateArbitrationReport } from './verdict-generator';
import type { Conflict, ConflictDetectionResult } from './conflict-types';
import type { Verdict, ArbitrationReport } from './verdict-types';

export type ArbitrationMode = 'full' | 'l1-only' | 'report-only';

export interface ArbitrationConfig {
  enabled: boolean;
  mode: ArbitrationMode;
}

/**
 * 读取 arbitration 配置（从 .speccore.yml）
 * 默认: enabled=true, mode='full'
 */
export async function getArbitrationConfig(): Promise<ArbitrationConfig> {
  try {
    const { loadConfig } = await import('../unified-config');
    const config = await loadConfig();
    return {
      enabled: config.arbitration?.enabled ?? true,
      mode: ['full', 'l1-only', 'report-only'].includes(config.arbitration?.mode)
        ? config.arbitration.mode as ArbitrationMode
        : 'full',
    };
  } catch { /* 静默失败 */ }
  return { enabled: true, mode: 'full' };
}

export interface ArbitrationEngineResult {
  report: ArbitrationReport;
  allPassed: boolean;
  canProceed: boolean;      // 是否可以继续（done/下一步）
  pendingL2: Conflict[];    // 等待确认的 L2 冲突
  pendingL3: Conflict[];    // 等待人工裁决的 L3 冲突
  verdicts: Verdict[];
}

/**
 * 运行完整的契约冲突裁决流程
 */
export async function runArbitration(
  taskId: string,
  codePath: string,
  taskDir: string,
  options?: { timeout?: number; withAgents?: boolean; projectRoot?: string; mode?: ArbitrationMode }
): Promise<ArbitrationEngineResult> {
  const mode = options?.mode || 'full';

  // 1. 检测冲突
  const detection = await detectConflicts(taskId, codePath, taskDir, options);

  // 2. 按层级分组裁决（根据 mode 调整行为）
  const verdicts: Verdict[] = [];
  const resolvedConflicts: Conflict[] = [];
  const pendingL2: Conflict[] = [];
  const pendingL3: Conflict[] = [];

  for (const conflict of detection.conflicts) {
    if (conflict.contractId.startsWith('L1-')) {
      // L1 始终裁决（即使是 report-only，也至少标记状态）
      const result = await arbitrateL1(conflict);
      verdicts.push(result.verdict);
      resolvedConflicts.push(result.conflict);
    } else if (conflict.contractId.startsWith('L2-')) {
      if (mode === 'report-only') {
        // report-only: 不裁决，只保留在报告中
        resolvedConflicts.push(conflict);
      } else {
        const result = await arbitrateL2(conflict);
        resolvedConflicts.push(result.conflict);
        if (result.needsHumanConfirm && mode !== 'l1-only') {
          pendingL2.push(result.conflict);
        }
      }
    } else if (conflict.contractId.startsWith('L3-')) {
      if (mode === 'report-only') {
        // report-only: 不裁决，只保留在报告中
        resolvedConflicts.push(conflict);
      } else if (mode === 'l1-only') {
        // l1-only: 只标记为报告，不进入 pending-review
        resolvedConflicts.push(conflict);
      } else {
        const result = await initiateL3Arbitration(conflict);
        verdicts.push(result.verdict);
        resolvedConflicts.push(result.conflict);
        pendingL3.push(result.conflict);
      }
    }
  }

  // 3. 生成裁决书
  const report = generateArbitrationReport(taskId, detection, resolvedConflicts, verdicts);

  // 4. 判断是否可以继续（根据 mode 调整）
  // full: L1 fatal 阻断 + L3 pending 阻断 + L2 pending 阻断
  // l1-only: 仅 L1 fatal 阻断，L2/L3 不阻塞
  // report-only: 永不阻断，只出报告
  const l1Fatal = detection.summary.fatal > 0;
  const allPassed = mode === 'report-only'
    ? true
    : mode === 'l1-only'
      ? !l1Fatal
      : !l1Fatal && pendingL3.length === 0 && pendingL2.length === 0;
  const canProceed = mode === 'report-only'
    ? true
    : mode === 'l1-only'
      ? !l1Fatal
      : !l1Fatal && pendingL3.length === 0;

  return {
    report,
    allPassed,
    canProceed,
    pendingL2,
    pendingL3,
    verdicts,
  };
}
