/**
 * 用例核对闸（v8.3.399+）
 *
 * 「确定性层 ↔ 语义层」结构化交棒：CLI 出卷 → AI 答卷 → CLI 判卷。
 * - 出卷（确定性）：从 TEST.md 提取 TC-XXX 用例清单，生成逐条判定答卷模板
 * - 答卷（语义）  ：宿主 AI / 子 Agent 逐用例给出 判定 + 证据
 * - 判卷（确定性）：只校验答卷完整性（每条用例必有判定、证据非空），判定对错不归 CLI 管
 * - 汇总（确定性）：矩阵打印 + TEST_REVIEW.md 落盘 + 未实现/部分用例登记 .issues.md
 *
 * 设计依据：按用例核对代码逻辑是语义判断，CLI 无法替代 AI 裁决；
 * 但出卷、判卷、汇总全是机器可判定的，把它们确定性化后，整条闸每一棒都显式可溯。
 * 核对时机选在 execute 收尾（AI 上下文尚热），修复成本远低于事后 verify 阶段。
 */

import { join } from 'path';
import { writeFile } from 'fs-extra';
import { logIssue } from './issue-tracker';

export type CaseVerdictStatus = 'pass' | 'fail' | 'partial';

export interface CaseVerdict {
  id: string;
  status: CaseVerdictStatus;
  evidence: string;
}

export const CASE_STATUS_LABEL: Record<CaseVerdictStatus, string> = {
  pass: '✅ 通过',
  fail: '❌ 未实现',
  partial: '⚠️ 部分',
};

/** 从 TEST.md 提取 TC-XXX 用例编号（优先标题锚点，回退全文匹配；保序去重） */
export function extractTestCaseIds(testMd: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (id: string) => { if (!seen.has(id)) { seen.add(id); out.push(id); } };
  // 优先：标题锚点 `### [TC-XXX] 标题`（analyze 新约定 v8.3.399+）
  for (const m of testMd.matchAll(/^\s*#{2,5}\s+\[?(TC-[\w-]+)\]?/gm)) push(m[1]);
  if (out.length > 0) return out;
  // 回退：全文 TC-NNN 匹配（旧文档兜底，仍保序去重）
  for (const m of testMd.matchAll(/\b(TC-\d{2,})\b/g)) push(m[1]);
  return out;
}

/** 出卷：生成逐条判定答卷模板 */
export function buildCaseReviewSheet(taskId: string, tcs: string[], testMd: string, codePath: string): string {
  const lines: string[] = [
    `# 用例核对答卷 — ${taskId}`,
    '',
    `> 任务: ${taskId}`,
    `> 代码位置: ${codePath}`,
    `> 用例总数: ${tcs.length}`,
    '',
    '请逐条核对当前代码实现是否满足 TEST.md 中的测试用例，按「答卷格式」逐行回填判定。',
    '',
    '**判定取值**：',
    '- ✅ 通过（已实现且符合预期）',
    '- ❌ 未实现（缺失或逻辑不符）',
    '- ⚠️ 部分（有实现但未完全覆盖，如仅覆盖正常路径）',
    '',
    '**证据列必填**：给出实现该用例的代码文件与行号（如 src/service.ts:42）；❌ 时写明缺失点。',
    '',
    '## 答卷格式（严格逐行，禁止省略任何用例）',
    '```',
    'TC-001 | ✅ | src/service.ts:42 校验逻辑',
    'TC-002 | ❌ | 未找到超时重试实现',
    'TC-003 | ⚠️ | 仅覆盖正常路径，异常路径缺失',
    '```',
    '',
    '## TEST.md 用例原文',
    '',
    testMd,
  ];
  return lines.join('\n');
}

/** 判卷：解析答卷行，过滤未知编号、去重，返回判定与缺漏清单 */
export function parseCaseReview(content: string, knownIds: string[]): { verdicts: CaseVerdict[]; missing: string[] } {
  const verdicts: CaseVerdict[] = [];
  const seen = new Set<string>();
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*(TC-[\w-]+)\s*[|｜]\s*(✅|❌|⚠️|pass|fail|partial)\s*[|｜]\s*(.+?)\s*$/i);
    if (!m) continue;
    const id = m[1];
    if (!knownIds.includes(id) || seen.has(id)) continue;
    seen.add(id);
    const raw = m[2].toLowerCase();
    const status: CaseVerdictStatus = raw === 'pass' || raw === '✅' ? 'pass' : raw === 'fail' || raw === '❌' ? 'fail' : 'partial';
    verdicts.push({ id, status, evidence: m[3] });
  }
  const missing = knownIds.filter(id => !seen.has(id));
  return { verdicts, missing };
}

/** 矩阵打印（控制台） */
export function formatCaseMatrix(verdicts: CaseVerdict[]): string {
  const lines: string[] = [];
  for (const v of verdicts) {
    const evidence = v.evidence.length > 44 ? v.evidence.slice(0, 44) + '…' : v.evidence;
    lines.push(`   ${v.id}  ${CASE_STATUS_LABEL[v.status]}   ${evidence}`);
  }
  return lines.join('\n');
}

/** 落盘 TEST_REVIEW.md 核对报告 */
export async function writeCaseReviewReport(taskDir: string, taskId: string, tcs: string[], verdicts: CaseVerdict[]): Promise<void> {
  const pass = verdicts.filter(v => v.status === 'pass').length;
  const fail = verdicts.filter(v => v.status === 'fail').length;
  const partial = verdicts.filter(v => v.status === 'partial').length;
  const lines: string[] = [
    `# 用例核对报告 — ${taskId}`,
    '',
    `> 生成时间: ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`,
    `> 用例总数: ${tcs.length} | 通过: ${pass} | 未实现: ${fail} | 部分: ${partial}`,
    '',
    '## 核对矩阵',
    '',
    '| 用例 | 判定 | 证据 |',
    '|:---|:---|:---|',
    ...verdicts.map(v => `| ${v.id} | ${CASE_STATUS_LABEL[v.status]} | ${v.evidence} |`),
    '',
  ];
  await writeFile(join(taskDir, 'TEST_REVIEW.md'), lines.join('\n'));
}

/** 从既有 TEST_REVIEW.md 读取判定（幂等：已核对过则复用，不重复出卷）；
 * 覆盖不全（用例数对不上）时返回 null，由调用方重新核对 */
export function readVerdictsFromReport(reportMd: string, knownIds: string[]): CaseVerdict[] | null {
  const verdicts: CaseVerdict[] = [];
  const seen = new Set<string>();
  for (const line of reportMd.split('\n')) {
    const m = line.match(/^\|\s*(TC-[\w-]+)\s*\|\s*(?:✅|❌|⚠️)?\s*(通过|未实现|部分)\s*\|\s*(.+?)\s*\|$/);
    if (!m) continue;
    const id = m[1];
    if (!knownIds.includes(id) || seen.has(id)) continue;
    seen.add(id);
    const status: CaseVerdictStatus = m[2] === '通过' ? 'pass' : m[2] === '未实现' ? 'fail' : 'partial';
    verdicts.push({ id, status, evidence: m[3] });
  }
  return verdicts.length === knownIds.length ? verdicts : null;
}

/** 未实现/部分用例登记 .issues.md（供 retro 汇总与修复指引） */
export async function registerCaseIssues(taskDir: string, taskId: string, verdicts: CaseVerdict[]): Promise<void> {
  for (const v of verdicts) {
    if (v.status === 'pass') continue;
    const isFail = v.status === 'fail';
    await logIssue(taskDir, {
      type: isFail ? 'error' : 'technical',
      severity: isFail ? 'critical' : 'warning',
      summary: `用例核对未通过: ${v.id}（${isFail ? '未实现' : '部分实现'}）`,
      detail: `任务: ${taskId}，证据: ${v.evidence}`,
    });
  }
}
