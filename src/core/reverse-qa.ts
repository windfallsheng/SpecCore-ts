/**
 * reverse-qa.ts — 反推需求 QA 环：验证（verify）→ 审查（review）→ 修订（revise）
 *
 * 方法论对齐业内最优 recipe-reverse-engineer（shinpr/claude-code-workflows）五阶段配方：
 *   discover（单元清单）→ generate（生成 PRD）→ verify（code-verifier 对照代码验证）
 *   → review（document-reviewer 语义审查）→ revision（有条件修订 + re-validation）。
 *
 * SpecCore 架构映射（CLI 确定性分层 + 宿主 AI 语义抽象）：
 *   - CLI 确定性：完整性基线统计（counts balance）、剧本与 JSON 模板落盘、裁决门禁判定、修订轮次记录。
 *   - 宿主 AI 语义：code-verifier 逐条 AC 对照代码验证、document-reviewer 语义审查、apply findings 修订。
 *
 * 三个质量门禁（recipe 原样移植）：
 *   1. Quality Gate（Step 3 Verify）：summary.status = blocked / 覆盖缺失 / 计数不平衡 → 重跑或升级；
 *      needs_review / inconsistent → 成为 Step 4 审查的显式证据。
 *   2. Review Resolution Gate（Step 5）：每条 finding 必须裁决 apply / decline；
 *      仅当 ≥1 条 apply 时才修订，decline-only 即闭环完成。
 *   3. Unit Completion Gate：无 apply findings 剩余 + 人工审查通过 → 反推闭环完成。
 *
 * 产物（.speccore/GLOBAL/_reverse/_qa/，v8.3.368 反推域与全局分析 requirements/ 域隔离）：
 *   INVENTORY.md        完整性基线报告（CLI 生成）
 *   VERIFY_PLAYBOOK.md  验证剧本（code-verifier 角色） + verify.json 模板
 *   REVIEW_PLAYBOOK.md  审查剧本（document-reviewer 角色） + review.json 模板
 *   REVISION_PLAYBOOK.md 修订剧本（prd-creator update 模式，按需生成）
 *   REVISION_LOG.md     修订轮次记录
 *
 * v8.3.367+
 */

import { join } from 'path';
import { ensureDir, writeFile, readFile, pathExists, readdir } from 'fs-extra';
import { logger } from '../utils/logger';
import { verifyReverseAnchors, extractFilledAnchors, sanitize } from './reverse-requirement';

// ════════════════════════════════════════════════════════════════
// 阶段 A：完整性基线（Quality Gate 的 counts balance，CLI 确定性）
// ════════════════════════════════════════════════════════════════

export interface InventoryCoverage {
  /** IR 模块总数（discover 单元清单） */
  totalModules: number;
  /** 被 UR 锚点引用的 IR 模块（规范化 id） */
  coveredModules: string[];
  /** 未被任何锚点引用的 IR 模块（unaccounted items → 审查证据） */
  uncoveredModules: string[];
  /** 覆盖率 0~1 */
  coverageRatio: number;
  /** Quality Gate 判定：无法验证（IR 非空但零已填锚点） */
  blocked: boolean;
}

/** 读取 IR 模块 id 白名单（IR 文件名 = sanitize(moduleId)） */
async function loadIrWhitelist(outputDir: string): Promise<Set<string>> {
  const irDir = join(outputDir, '_ir');
  if (!(await pathExists(irDir))) return new Set();
  const files = await readdir(irDir);
  return new Set(files.filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, '')));
}

/**
 * 完整性基线：UR 溯源锚点覆盖 vs IR 单元清单。
 * recipe 的 counts balance——清单里没有被任何需求引用的模块，
 * 要么是遗漏（该模块业务未进需求），要么是锚点写错（unaccounted items）。
 */
export async function checkInventoryCoverage(outputDir: string): Promise<InventoryCoverage | null> {
  const urPath = join(outputDir, 'REQUIREMENT.md');
  if (!(await pathExists(urPath))) return null;

  const whitelist = await loadIrWhitelist(outputDir);
  if (whitelist.size === 0) return null;

  const content = await readFile(urPath, 'utf-8');
  const filled = extractFilledAnchors(content);
  const covered = new Set<string>();
  for (const a of filled) {
    const norm = sanitize(a);
    if (whitelist.has(norm)) covered.add(norm);
  }
  const coveredModules = [...covered];
  const uncoveredModules = [...whitelist].filter(id => !covered.has(id)).sort();

  return {
    totalModules: whitelist.size,
    coveredModules,
    uncoveredModules,
    coverageRatio: whitelist.size > 0 ? coveredModules.length / whitelist.size : 0,
    blocked: filled.length === 0,
  };
}

/** 完整性基线报告（INVENTORY.md） */
function buildInventoryReport(cov: InventoryCoverage): string {
  const lines: string[] = [];
  lines.push('# 完整性基线报告（INVENTORY）');
  lines.push('');
  lines.push(`> 生成时间: ${new Date().toISOString()}`);
  lines.push(`> 对应 recipe-reverse-engineer Step 3 Quality Gate 的 counts balance：`);
  lines.push(`> UR 溯源锚点必须覆盖 discover 单元清单（IR 模块），未被引用的模块即遗漏或锚点错误。`);
  lines.push('');
  lines.push('## 统计');
  lines.push('');
  lines.push(`- IR 模块总数: ${cov.totalModules}`);
  lines.push(`- 已覆盖模块: ${cov.coveredModules.length}（覆盖率 ${(cov.coverageRatio * 100).toFixed(0)}%）`);
  lines.push(`- 未覆盖模块: ${cov.uncoveredModules.length}`);
  lines.push(`- Quality Gate: ${cov.blocked ? '❌ blocked（无已填锚点，无法验证）' : '✅ 可进入验证'}`);
  lines.push('');
  if (cov.uncoveredModules.length > 0) {
    lines.push('## 未覆盖模块（unaccounted items → 审查证据）');
    lines.push('');
    lines.push('> 这些 IR 模块没有被任何 UR 锚点引用：要么需求遗漏了它们的业务，要么锚点写错。');
    lines.push('> 进入审查阶段时须逐条核实，属于审查维度「完整性 completeness」。');
    lines.push('');
    cov.uncoveredModules.forEach(id => lines.push(`- \`${id}\``));
    lines.push('');
  }
  lines.push('## 结论');
  lines.push('');
  lines.push(cov.blocked
    ? '❌ blocked：宿主 AI 尚未完成两跳语义抽象（无已填锚点），请先完成 REQUIREMENT.md 再验证。'
    : cov.uncoveredModules.length > 0
      ? '⚠️ 覆盖不完整：未覆盖模块进入审查证据，验证与审查阶段须核实。'
      : '✅ 覆盖完整：所有 IR 模块均被 UR 锚点引用。');
  lines.push('');
  return lines.join('\n');
}

// ════════════════════════════════════════════════════════════════
// 阶段 B：验证（Step 3 Verify）——锚点门禁 + 完整性基线 + code-verifier 剧本
// ════════════════════════════════════════════════════════════════

/** verify.json 模板（结构化验证结果，宿主 AI 填写） */
function buildVerifyJsonTemplate(cov: InventoryCoverage | null): string {
  const inv = cov
    ? {
        total: cov.totalModules,
        covered: cov.coveredModules.length,
        ratio: `${(cov.coverageRatio * 100).toFixed(0)}%`,
        uncovered: cov.uncoveredModules,
      }
    : null;
  return JSON.stringify({
    status: 'pending',
    note: '宿主 AI 扮演 code-verifier 填写本文件；status: pending|done，done 前须过 Quality Gate。',
    summary: {
      gate: 'pending',
      totalACs: 0,
      verified: 0,
      needs_review: 0,
      inconsistent: 0,
      unverified: 0,
      inventoryCoverage: inv,
    },
    items: [
      {
        acId: 'AC-01',
        status: 'verified',
        evidence: '文件路径#符号（如 core/auth-service.ts#login）',
        note: '代码证据如何支持该验收标准（或矛盾/缺失说明）',
      },
    ],
  }, null, 2) + '\n';
}

/** 验证剧本（code-verifier 角色） */
function buildVerifyPlaybook(outputDir: string, cov: InventoryCoverage | null): string {
  const lines: string[] = [];
  lines.push('# 验证剧本（VERIFY）—— code-verifier 角色');
  lines.push('');
  lines.push('> 对应 recipe-reverse-engineer Step 3 Verify：逐条对照代码验证 UR 验收标准，产出结构化 verification JSON。');
  lines.push('> 你只查事实、不改文档。语义质量审查是下一步 document-reviewer 的职责。');
  lines.push('');
  lines.push('## 输入');
  lines.push('');
  lines.push(`- 验证对象: ${join(outputDir, 'REQUIREMENT.md')}`);
  lines.push(`- 完整性基线: ${join(outputDir, '_qa', 'INVENTORY.md')}（discover 单元清单，覆盖统计）`);
  lines.push(`- 代码证据: ${join(outputDir, '_ir', '*.md')}（IR 骨架含业务切片）`);
  lines.push('');
  lines.push('## 执行步骤');
  lines.push('');
  lines.push('1. 提取 REQUIREMENT.md 中所有 `**AC-xx**` 验收标准；');
  lines.push('2. 对每条 AC：找到其溯源锚点对应的 IR 模块，对照业务切片/代码原文逐条验证；');
  lines.push('3. 判定状态（四选一）：');
  lines.push('   - `verified`：代码证据完全支持该 AC；');
  lines.push('   - `needs_review`：代码证据部分支持，存在边界/细节待确认；');
  lines.push('   - `inconsistent`：与代码证据矛盾；');
  lines.push('   - `unverified`：锚点缺失或无法定位代码证据；');
  lines.push('4. 填写 `_qa/verify.json`：每条 AC 一个 items 条目，evidence 写 `文件路径#符号`；');
  lines.push('5. 更新 summary 并置 status: done。');
  lines.push('');
  lines.push('## Quality Gate（不满足则重跑，不得进入审查）');
  lines.push('');
  lines.push('- summary.gate 置 `blocked`（如 AC 为空、无法验证）→ 升级人工处理；');
  lines.push('- 计数不平衡（totalACs ≠ items 数组长度）→ 重跑；');
  lines.push(`- 锚点引用清单外模块 / 清单内有未覆盖模块（unaccounted items）→ 已在 INVENTORY.md 标出，须带入审查证据${cov && cov.uncoveredModules.length > 0 ? '（本次未覆盖: ' + cov.uncoveredModules.join(', ') + '）' : ''}。`);
  lines.push('- `needs_review` / `inconsistent` 条目 = 审查阶段 document-reviewer 的显式证据。');
  lines.push('');
  lines.push('## 产出');
  lines.push('');
  lines.push('- `_qa/verify.json`（结构化验证结果，审查阶段的证据输入）');
  lines.push('');
  return lines.join('\n');
}

/**
 * 完整验证环（--verify）：
 * 1. 锚点一致性校验（verifyReverseAnchors，悬空锚点=疑似幻觉）；
 * 2. 完整性基线（counts balance，未覆盖模块=遗漏证据）；
 * 3. 生成 code-verifier 验证剧本 + verify.json 模板。
 */
export async function runReverseVerify(outputDir: string): Promise<void> {
  // 1. 锚点门禁（沿用 v8.3.301 验证环）
  await verifyReverseAnchors(outputDir);

  // 2. 完整性基线
  const cov = await checkInventoryCoverage(outputDir);
  if (cov) {
    const qaDir = join(outputDir, '_qa');
    await ensureDir(qaDir);
    await writeFile(join(qaDir, 'INVENTORY.md'), buildInventoryReport(cov));
    logger.info(`   📊 完整性基线: ${cov.coveredModules.length}/${cov.totalModules} 模块被 UR 锚点覆盖`);
    if (cov.uncoveredModules.length > 0) {
      logger.warn(`   ⚠️ 未覆盖模块 ${cov.uncoveredModules.length} 个（unaccounted items → 审查证据）: ${cov.uncoveredModules.slice(0, 8).join(', ')}${cov.uncoveredModules.length > 8 ? ' ...' : ''}`);
    }
    if (cov.blocked) {
      logger.warn('   🚫 Quality Gate: blocked（无已填锚点，宿主 AI 尚未完成两跳语义抽象）');
    }
  }

  // 3. code-verifier 验证剧本 + verify.json 模板
  const qaDir = join(outputDir, '_qa');
  await ensureDir(qaDir);
  await writeFile(join(qaDir, 'VERIFY_PLAYBOOK.md'), buildVerifyPlaybook(outputDir, cov));
  const verifyJsonPath = join(qaDir, 'verify.json');
  if (!(await pathExists(verifyJsonPath))) {
    await writeFile(verifyJsonPath, buildVerifyJsonTemplate(cov));
  }
  logger.info('   📝 验证剧本: _qa/VERIFY_PLAYBOOK.md（宿主 AI 扮演 code-verifier → 填 _qa/verify.json）');
}

// ════════════════════════════════════════════════════════════════
// 阶段 C：语义审查（Step 4 Review）——document-reviewer 剧本
// ════════════════════════════════════════════════════════════════

/** review.json 模板（findings + Review Resolution 裁决，宿主 AI 填写） */
function buildReviewJsonTemplate(): string {
  return JSON.stringify({
    status: 'draft',
    note: '宿主 AI 扮演 document-reviewer 填写本文件；status: draft|resolved，每条 finding 须裁决 disposition: apply|decline。',
    summary: {
      totalFindings: 0,
      critical: 0,
      major: 0,
      minor: 0,
      apply: 0,
      decline: 0,
    },
    findings: [
      {
        id: 'F-01',
        severity: 'major',
        category: 'testability',
        finding: '发现的问题描述（写得不好在哪里）',
        evidence: '证据（verify.json 条目 / 文档片段 / 代码位置）',
        suggestion: '修订建议',
        disposition: 'pending',
      },
    ],
  }, null, 2) + '\n';
}

/** 审查剧本（document-reviewer 角色） */
function buildReviewPlaybook(outputDir: string): string {
  const lines: string[] = [];
  lines.push('# 审查剧本（REVIEW）—— document-reviewer 角色');
  lines.push('');
  lines.push('> 对应 recipe-reverse-engineer Step 4 Review：语义级审查——发现「写得不好」，而非仅事实一致。');
  lines.push('> 输入 verification JSON（_qa/verify.json）作为证据，产出 findings + Review Resolution 裁决。');
  lines.push('');
  lines.push('## 输入');
  lines.push('');
  lines.push(`- 审查对象: ${join(outputDir, 'REQUIREMENT.md')}`);
  lines.push(`- 验证证据: ${join(outputDir, '_qa', 'verify.json')}（code-verifier 的验证结果）`);
  lines.push(`- 完整性基线: ${join(outputDir, '_qa', 'INVENTORY.md')}（未覆盖模块清单）`);
  lines.push('');
  lines.push('## 审查维度（六类）');
  lines.push('');
  lines.push('| 维度 | 问的问题 |');
  lines.push('| :--- | :--- |');
  lines.push('| completeness 完整性 | 代码中存在的业务规则被遗漏了吗？未覆盖模块是否真遗漏？ |');
  lines.push('| correctness 正确性 | 需求与 verify.json 中 needs_review / inconsistent 证据矛盾吗？ |');
  lines.push('| testability 可测试性 | AC 有歧义吗？可验证吗？有明确验收条件吗？ |');
  lines.push('| translation 翻译腔 | 函数名/类名/接口名等技术词汇泄漏进需求文本了吗？ |');
  lines.push('| granularity 粒度 | 功能单元边界过大/过小/重叠/遗漏了吗？ |');
  lines.push('| traceability 可追溯性 | 锚点悬空了吗？evidence 缺失了吗？ |');
  lines.push('');
  lines.push('## 执行步骤');
  lines.push('');
  lines.push('1. 读 REQUIREMENT.md + verify.json + INVENTORY.md；');
  lines.push('2. 逐条产出 finding：id（F-01 起）/ severity / category / finding / evidence / suggestion；');
  lines.push('3. severity 三档：`critical`（阻断，须修订）/ `major`（显著缺陷）/ `minor`（打磨项）；');
  lines.push('4. 对每条 finding 做 Review Resolution 裁决：`apply`（必须修订）/ `decline`（拒绝，现状可接受）；');
  lines.push('5. 填 review.json 并置 status: resolved。');
  lines.push('');
  lines.push('## Review Resolution Gate（强制）');
  lines.push('');
  lines.push('- 每条 finding 必须有裁决（disposition ≠ pending），否则 --revise 会拒绝推进；');
  lines.push('- 仅当 ≥1 条 apply 才触发修订；decline-only（无 apply）即闭环完成；');
  lines.push('- 修订只改 apply findings 指向的条目，保留相邻内容（Operation Mode: update）。');
  lines.push('');
  lines.push('## 产出');
  lines.push('');
  lines.push('- `_qa/review.json`（findings + 裁决，修订阶段的输入）');
  lines.push('');
  return lines.join('\n');
}

/**
 * 语义审查（--review）：生成 document-reviewer 审查剧本 + review.json 模板。
 * 若 verify.json 尚未完成（status ≠ done），提示先跑验证环。
 */
export async function runReverseReview(outputDir: string): Promise<void> {
  const qaDir = join(outputDir, '_qa');
  await ensureDir(qaDir);

  // 前置检查：verify.json 是否已完成（recipe: review 的输入是 Step 3 输出）
  const verifyJsonPath = join(qaDir, 'verify.json');
  if (!(await pathExists(verifyJsonPath))) {
    logger.warn('   ⚠️ 未找到 _qa/verify.json，请先运行 --verify 完成验证环（review 须以验证结果为证据）。');
    await writeFile(verifyJsonPath, buildVerifyJsonTemplate(await checkInventoryCoverage(outputDir)));
  } else {
    try {
      const v = JSON.parse(await readFile(verifyJsonPath, 'utf-8'));
      if (v.status !== 'done') {
        logger.warn('   ⚠️ verify.json 状态为 ' + (v.status || '未知') + '，审查应以完成状态的验证结果为证据（recipe: review 输入 = Step 3 输出）。');
      }
    } catch {
      logger.warn('   ⚠️ verify.json 解析失败，可能是宿主 AI 尚未填写或格式损坏，审查证据可能缺失。');
    }
  }

  await writeFile(join(qaDir, 'REVIEW_PLAYBOOK.md'), buildReviewPlaybook(outputDir));
  const reviewJsonPath = join(qaDir, 'review.json');
  if (!(await pathExists(reviewJsonPath))) {
    await writeFile(reviewJsonPath, buildReviewJsonTemplate());
  }
  logger.info('   📝 审查剧本: _qa/REVIEW_PLAYBOOK.md（宿主 AI 扮演 document-reviewer → 填 _qa/review.json）');
}

// ════════════════════════════════════════════════════════════════
// 阶段 D：有条件修订（Step 5 Revision）——裁决门禁 + 修订剧本 + re-validation
// ════════════════════════════════════════════════════════════════

export interface RevisionResolution {
  total: number;
  apply: number;
  decline: number;
  pending: number;
  /** Unit Completion Gate：无 apply findings 剩余 → 闭环完成 */
  completed: boolean;
  applyFindings: unknown[];
}

/** 修订剧本（prd-creator update 模式，apply findings 全文作修订范围） */
function buildRevisionPlaybook(outputDir: string, applyFindings: unknown[]): string {
  const lines: string[] = [];
  lines.push('# 修订剧本（REVISION）—— prd-creator update 模式');
  lines.push('');
  lines.push('> 对应 recipe-reverse-engineer Step 5 Revision（conditional）：');
  lines.push('> Review Resolution Gate 已裁决出 apply findings，仅修订这些条目，不得扩改。');
  lines.push('');
  lines.push(`## 修订范围（Review Resolution Gate 裁决结果）`);
  lines.push('');
  lines.push('以下 apply findings 是本次修订的完整范围（逐条修复，勿扩勿漏）：');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(applyFindings, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## 修订原则');
  lines.push('');
  lines.push(`- Operation Mode: update——只改 findings 指向的条目，保留相邻内容；`);
  lines.push(`- 修订对象: ${join(outputDir, 'REQUIREMENT.md')}；`);
  lines.push('- 每条修订后同步更新溯源锚点（如涉及）；');
  lines.push('- 修订完成后必须 re-validation（用原 IR 单元清单重跑验证，带 prior_feedback 重跑审查）：');
  lines.push('  1. `speccore global from-source --verify`（code-verifier 重跑）；');
  lines.push('  2. `speccore global from-source --review`（document-reviewer 带 prior_feedback 重跑）；');
  lines.push('  3. `speccore global from-source --revise`（无 apply findings 即闭环完成）。');
  lines.push('');
  return lines.join('\n');
}

/**
 * 有条件修订（--revise）：读 review.json 做 Review Resolution Gate + Unit Completion Gate。
 * - review.json 缺失 / 未裁决（pending > 0）→ 拒绝推进（recipe: Review Resolution Gate MANDATORY）；
 * - apply = 0 → 闭环完成（Unit Completion Gate 通过）；
 * - apply > 0 → 生成修订剧本 + 追加修订轮次。
 */
export async function runReverseRevision(outputDir: string): Promise<RevisionResolution> {
  const qaDir = join(outputDir, '_qa');
  const reviewJsonPath = join(qaDir, 'review.json');
  if (!(await pathExists(reviewJsonPath))) {
    throw new Error(`未找到 _qa/review.json，请先运行 --review 完成语义审查与裁决。`);
  }

  let review: any;
  try {
    review = JSON.parse(await readFile(reviewJsonPath, 'utf-8'));
  } catch {
    throw new Error('_qa/review.json 解析失败，请修复 JSON 格式（宿主 AI 填写损坏）后重试。');
  }

  const findings: any[] = Array.isArray(review.findings) ? review.findings : [];
  const applyFindings = findings.filter(f => f.disposition === 'apply');
  const declineFindings = findings.filter(f => f.disposition === 'decline');
  const pendingFindings = findings.filter(f => !f.disposition || f.disposition === 'pending');

  const resolution: RevisionResolution = {
    total: findings.length,
    apply: applyFindings.length,
    decline: declineFindings.length,
    pending: pendingFindings.length,
    completed: false,
    applyFindings,
  };

  // Review Resolution Gate：未裁决则拒绝推进（recipe: MANDATORY）
  if (review.status !== 'resolved' || pendingFindings.length > 0) {
    throw new Error(
      `Review Resolution Gate 未通过：review.json 有 ${pendingFindings.length} 条 finding 未裁决（disposition 须为 apply/decline，status 须为 resolved）。请宿主 AI 完成裁决后重试。`,
    );
  }

  // Unit Completion Gate：无 apply findings → 闭环完成
  if (applyFindings.length === 0) {
    resolution.completed = true;
    logger.info('');
    logger.info('🏁 修订裁决门禁（Unit Completion Gate）');
    logger.info(`   📋 findings: ${resolution.total} | apply: 0 | decline: ${resolution.decline}`);
    logger.info('   ✅ 无 apply findings，反推需求闭环完成（decline-only 结果）。');
    logger.info('');
    return resolution;
  }

  // 有条件修订：生成修订剧本 + 追加修订轮次
  await ensureDir(qaDir);
  await writeFile(join(qaDir, 'REVISION_PLAYBOOK.md'), buildRevisionPlaybook(outputDir, applyFindings));
  await appendRevisionLog(qaDir, applyFindings.length);

  logger.info('');
  logger.info('🔧 修订裁决门禁（Review Resolution Gate）');
  logger.info(`   📋 findings: ${resolution.total} | apply: ${resolution.apply} | decline: ${resolution.decline}`);
  logger.info(`   ⚠️ ${resolution.apply} 条 apply findings → 生成修订剧本（修订范围为裁决结果，勿扩改）`);
  logger.info('   📝 修订剧本: _qa/REVISION_PLAYBOOK.md');
  logger.info('   📜 修订轮次: _qa/REVISION_LOG.md');
  logger.info('   修订完成后 re-validation: --verify → --review → --revise（直到无 apply findings）');
  logger.info('');

  return resolution;
}

/** 修订轮次记录（REVISION_LOG.md 追加） */
async function appendRevisionLog(qaDir: string, applyCount: number): Promise<void> {
  const logPath = join(qaDir, 'REVISION_LOG.md');
  const round = await countRounds(logPath) + 1;
  const entry = [
    `## Round ${round}（${new Date().toISOString().split('T')[0]}）`,
    '',
    `- apply findings: ${applyCount} 条（见 REVISION_PLAYBOOK.md 修订范围）`,
    '- 修订后须 re-validation: --verify → --review → --revise',
    '',
  ].join('\n');
  const existing = (await pathExists(logPath)) ? await readFile(logPath, 'utf-8') : '# 修订轮次记录（REVISION_LOG）\n\n> 每轮有条件修订追加一条；无 apply findings 时闭环完成。\n\n';
  await writeFile(logPath, existing + entry);
}

async function countRounds(logPath: string): Promise<number> {
  if (!(await pathExists(logPath))) return 0;
  const content = await readFile(logPath, 'utf-8');
  const matches = content.match(/^## Round (\d+)/gm);
  return matches ? matches.length : 0;
}
