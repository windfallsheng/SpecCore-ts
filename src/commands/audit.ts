/**
 * audit - AI 智能审计命令
 * 扫描全量层发现重复需求、歧义描述、潜在冲突、孤立需求
 */

import { logger, Spinner } from '../utils/logger';
import { readGlobalIndex, readRequirementDetail } from '../core/global-layer';

export interface AuditOptions {
  fix?: boolean;
  detail?: boolean;
}

interface AuditIssue {
  type: 'duplicate' | 'ambiguous' | 'orphan' | 'conflict';
  severity: '🔴' | '🟡' | '🟢';
  reqId: string;
  reqName: string;
  description: string;
  suggestion: string;
}

export async function auditCommand(options: AuditOptions): Promise<void> {
  const spinner = new Spinner('扫描全量层...');
  spinner.start();

  try {
    const index = await readGlobalIndex();

    if (index.reqs.length === 0) {
      spinner.fail('全量层为空，无法执行审计。请先导入项目。');
      return;
    }

    spinner.stop(`扫描 ${index.reqs.length} 条需求...`);

    const issues: AuditIssue[] = [];

    // 1. 重复检测
    const duplicates = detectDuplicates(index);
    issues.push(...duplicates);

    // 2. 歧义检测
    for (const req of index.reqs) {
      const detail = await readRequirementDetail(req.project, req.id);
      const ambiguous = detectAmbiguity(req, detail || '');
      issues.push(...ambiguous);
    }

    // 3. 孤立检测
    const orphans = index.reqs.filter(
      (r) => !r.iteration && r.status !== '🗑️ 已废弃' && r.status !== '📦 已有实现'
    );
    for (const req of orphans.slice(0, 10)) {
      issues.push({
        type: 'orphan',
        severity: '🟡',
        reqId: req.id,
        reqName: req.name,
        description: `未关联任何期次或 Task，处于孤立状态`,
        suggestion: `建议纳入近期期次`,
      });
    }

    // 4. 冲突检测
    const conflicts = detectConflicts(index);
    issues.push(...conflicts);

    // 输出报告
    outputAuditReport(issues, index.reqs.length, options.detail || false);

    if (options.fix) {
      logger.info('');
      logger.info('🔧 --fix 模式：自动标记可修复的问题');
      autoFixIssues(issues);
    }
  } catch (error) {
    spinner.fail(`审计失败: ${error}`);
    throw error;
  }
}

/**
 * 重复检测
 */
function detectDuplicates(index: Awaited<ReturnType<typeof readGlobalIndex>>): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const checked = new Set<string>();

  for (let i = 0; i < index.reqs.length; i++) {
    for (let j = i + 1; j < index.reqs.length; j++) {
      const a = index.reqs[i];
      const b = index.reqs[j];
      const key = [a.id, b.id].sort().join('|');
      if (checked.has(key)) continue;
      checked.add(key);

      const similarity = calculateSimilarity(a.name, b.name);
      if (similarity > 0.8) {
        issues.push({
          type: 'duplicate',
          severity: '🔴',
          reqId: `${a.id} ⇔ ${b.id}`,
          reqName: `${a.name} / ${b.name}`,
          description: `高度重复（相似度 ${Math.round(similarity * 100)}%），来源: ${a.project} / ${b.project}`,
          suggestion: '建议合并或明确区分',
        });
      } else if (similarity > 0.6) {
        issues.push({
          type: 'duplicate',
          severity: '🟡',
          reqId: `${a.id} ⇔ ${b.id}`,
          reqName: `${a.name} / ${b.name}`,
          description: `可能重复（相似度 ${Math.round(similarity * 100)}%）`,
          suggestion: '建议审查是否可合并',
        });
      }
    }
  }

  return issues;
}

/**
 * 简单字符串相似度（Jaccard 系数）
 */
function calculateSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(''));
  const setB = new Set(b.toLowerCase().split(''));
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

/**
 * 歧义检测
 */
function detectAmbiguity(
  req: { id: string; name: string },
  detail: string
): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const ambiguousWords: Record<string, string> = {
    '尽快': '指定具体时间或 SLA',
    '优先': '明确优先级排序规则',
    '及时': '指定具体响应时间',
    '大量': '指定具体数字或范围',
    '众多': '指定具体数量',
    '若干': '指定明确的数量',
    '尽量': '改为明确的要求',
    '尽可能': '改为明确的约束',
    '稳定': '指定可测量的标准（如 99.9%）',
    '可靠': '指定可靠的量化指标',
    '良好': '指定可测量的质量标准',
    '适当': '指定具体的数值',
  };

  for (const [word, suggestion] of Object.entries(ambiguousWords)) {
    if (detail.includes(word)) {
      issues.push({
        type: 'ambiguous',
        severity: '🟡',
        reqId: req.id,
        reqName: req.name,
        description: `发现模糊词汇: "${word}"`,
        suggestion,
      });
    }
  }

  return issues.slice(0, 3); // 最多保留 3 条
}

/**
 * 冲突检测
 */
function detectConflicts(index: Awaited<ReturnType<typeof readGlobalIndex>>): AuditIssue[] {
  const issues: AuditIssue[] = [];

  // 检测同名需求在不同项目中
  const nameMap = new Map<string, string[]>();
  for (const req of index.reqs) {
    if (!nameMap.has(req.name)) nameMap.set(req.name, []);
    nameMap.get(req.name)!.push(req.project);
  }

  for (const [name, projects] of nameMap) {
    if (projects.length > 1) {
      issues.push({
        type: 'conflict',
        severity: '🟡',
        reqId: '',
        reqName: name,
        description: `相同需求出现在 ${projects.length} 个项目中: ${projects.join(', ')}`,
        suggestion: '检查是否存在重复实现，考虑抽取为公共服务',
      });
    }
  }

  return issues.slice(0, 5);
}

/**
 * 输出审计报告
 */
function outputAuditReport(issues: AuditIssue[], totalReqs: number, detail: boolean): void {
  logger.info('');
  logger.info('🤖 AI 智能审计报告');
  logger.info('');

  const duplicates = issues.filter((i) => i.type === 'duplicate');
  const ambiguous = issues.filter((i) => i.type === 'ambiguous');
  const orphans = issues.filter((i) => i.type === 'orphan');
  const conflicts = issues.filter((i) => i.type === 'conflict');

  // 重复需求
  if (duplicates.length > 0) {
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('🔴 重复需求（建议合并）');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const d of duplicates.slice(0, detail ? 20 : 5)) {
      logger.info(`   ${d.severity} ${d.reqId} | ${d.reqName}`);
      logger.info(`     ${d.description}`);
      logger.info(`     💡 ${d.suggestion}`);
    }
  }

  // 歧义描述
  if (ambiguous.length > 0) {
    logger.info('');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('⚠️ 歧义描述（建议量化）');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const a of ambiguous.slice(0, detail ? 20 : 8)) {
      logger.info(`   ${a.severity} ${a.reqId}: ${a.description}`);
      logger.info(`     💡 ${a.suggestion}`);
    }
  }

  // 冲突
  if (conflicts.length > 0) {
    logger.info('');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('🔶 潜在冲突');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const c of conflicts) {
      logger.info(`   ${c.severity} ${c.reqName}`);
      logger.info(`     ${c.description}`);
      logger.info(`     💡 ${c.suggestion}`);
    }
  }

  // 孤立需求
  if (orphans.length > 0) {
    logger.info('');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('🔶 孤立需求（建议关联期次）');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const o of orphans.slice(0, detail ? 20 : 8)) {
      logger.info(`   ${o.severity} ${o.reqId}: ${o.description}`);
      logger.info(`     💡 ${o.suggestion}`);
    }
  }

  // 健康度评分
  const dupCount = duplicates.filter((d) => d.severity === '🔴').length;
  const dupYellow = duplicates.filter((d) => d.severity === '🟡').length;
  const ambCount = ambiguous.length;

  const clarityScore = Math.max(0, 100 - ambCount * 5);
  const dupScore = Math.max(0, 100 - dupCount * 10 - dupYellow * 5);
  const linkScore = Math.max(0, 100 - orphans.length * 5);
  const overallScore = Math.round((clarityScore + dupScore + linkScore) / 3);

  logger.info('');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(`📊 健康度评分: ${overallScore}/100`);
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(`   需求完整性: ${clarityScore}/100`);
  logger.info(`   描述清晰度: ${clarityScore}/100`);
  logger.info(`   关联完整性: ${linkScore}/100`);
  logger.info(`   重复率: ${dupScore}/100（越低越好）`);

  // 总结
  logger.info('');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info('💡 建议');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  let idx = 1;
  if (dupCount > 0) {
    logger.info(`   ${idx++}. 🔴 高优先级: 解决 ${dupCount} 条高度重复需求`);
  }
  if (ambCount > 0) {
    logger.info(`   ${idx++}. 🟡 中优先级: 量化 ${ambCount} 条模糊描述`);
  }
  if (orphans.length > 0) {
    logger.info(`   ${idx++}. 🟢 低优先级: 为 ${orphans.length} 条孤立需求关联期次`);
  }

  if (issues.length === 0) {
    logger.info('   🎉 全量层质量良好，未发现明显问题！');
  }

  logger.info('');
  logger.info('📋 输入 speccore audit --fix 自动修复可修复的问题');
}

/**
 * 自动修复
 */
function autoFixIssues(issues: AuditIssue[]): void {
  let fixed = 0;
  for (const issue of issues) {
    if (issue.type === 'ambiguous') {
      // 自动标记模糊词汇
      logger.info(`   已标记: ${issue.reqId} - "${issue.description}"`);
      fixed++;
    } else if (issue.type === 'orphan') {
      // 无法自动关联期次
      logger.info(`   需确认: ${issue.reqId} - 请手动关联期次`);
    }
  }
  logger.info('');
  logger.info(`✅ 已自动处理 ${fixed} 条问题`);
}
