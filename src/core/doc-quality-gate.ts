/**
 * doc-quality-gate — 文档质量门禁
 * v7.2.0+
 *
 * 全局分析文档生成后的自动质量检查：
 *   - 检测占位符（"待导入"、"待补充"、"示例"、"_待填写_"）
 *   - 检测空表格（只有表头没有数据行）
 *   - 检测字数过浅（少于阈值）
 *   - 检测缺少 Mermaid 图表（如 ARCHITECTURE.md 要求有图表）
 *   - 检测缺少关键章节
 *
 * 输出: 质量报告，标记问题章节，建议修复命令
 */
import { readFile, pathExists, readdir } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import { getProjectRoot } from '../utils/task-utils';

export interface QualityIssue {
  file: string;
  line?: number;
  type: 'placeholder' | 'empty-table' | 'too-short' | 'missing-chart' | 'missing-section'
    | 'missing-decision' | 'missing-evidence' | 'empty-column' | 'missing-adr';
  severity: 'error' | 'warning';
  message: string;
  suggestion: string;
}

export interface QualityReport {
  file: string;
  issues: QualityIssue[];
  wordCount: number;
  lineCount: number;
  hasMermaid: boolean;
  score: number; // 0-100
}

// 占位符关键词
const PLACEHOLDER_PATTERNS = [
  /待导入|待补充|待填写|待完善|待确认|待审核/,
  /_待\w+_/,
  /示例[：:]\s*$/m,
  /TODO|FIXME|XXX|HACK/,
  /\|[\s-]*\|[\s-]*\|[\s-]*\|/, // 空表格行
];

// 需要 Mermaid 图表的文档
const CHART_REQUIRED_DOCS = [
  'ARCHITECTURE.md', 'INTERACTION_MAP.md', 'DATA_FLOW.md',
  'DEPLOYMENT.md', 'UI_FLOW.md', '_ASSOCIATION.md', '_MODULES.md',
];

// 关键章节要求
const REQUIRED_SECTIONS: Record<string, string[]> = {
  'ARCHITECTURE.md': ['服务拓扑', '数据流', '部署关系', '容错设计'],
  'API_CONTRACT.yaml': ['接口定义', '鉴权', '限流', '版本策略'],
  'REQUIREMENT.md': ['产品愿景', '用户故事', '验收标准'],
};

// ═══ v8.3.386+: 语义门禁（从量化检查升级为语义检查）═══
// 背景：行数/Mermaid 图存在与否全是量化指标，AI 用功能罗列灌水可得 100 分，
// 而「架构决策」「代码证据」等真正的内容深度完全失控。语义门禁从根上杜绝灌水。

// 架构决策最小条数（ARCHITECTURE.md）
const MIN_ARCH_DECISIONS = 3;

// 架构决策标题模式：### 决策 1：xxx / #### 决策一：xxx / - **决策 2**：xxx
const DECISION_HEADING_RE = /^#{2,4}\s*决策\s*[0-9一二三四五六七八九十]*[:：]/m;
const DECISION_BULLET_RE = /^[-*]\s*\*{0,2}决策\s*[0-9一二三四五六七八九十]*\*{0,2}\s*[:：]/m;

// 决策理由关键词：每条决策必须说明「为什么」
const DECISION_REASON_RE = /理由|原因|权衡|背景|依据|考虑|取舍|动机/;

// 代码证据路径：至少含一个 / 的源码路径引用（排除纯文件名与 Markdown 文件名误报）
const CODE_EVIDENCE_RE = /[\w@/.-]+\/(?:[\w@.-]+\/)*[\w@.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|vue|java|go|py|kt|swift|cs|rb|php|sql|proto|scala|rs)(?::\d+)?/g;

// 需要代码证据引用的技术文档（ARCHITECTURE.md 由决策检查覆盖，不重复）
const EVIDENCE_REQUIRED_DOCS = [
  'DATA_FLOW.md', 'DATA_MODEL.md', 'API_CALL_MAP.md', 'STATE_MANAGEMENT.md',
  'DEPLOYMENT.md', 'BUSINESS_RULES.md', 'PERFORMANCE.md', 'SECURITY.md',
];

// 技术文档最少证据引用条数
const MIN_EVIDENCE_REFS = 3;

// API_INVENTORY 必查非空列（表头关键词 → 显示名）
const API_REQUIRED_COLUMNS: [RegExp, string][] = [
  [/鉴权|权限|auth/i, '鉴权'],
  [/幂等|idempoten/i, '幂等'],
  [/版本|version/i, '版本'],
];

// 视为「空值」的单元格内容（「无」对鉴权列可能是合法值，不列入）
const EMPTY_CELL_VALUES = new Set(['', '-', '—', '–', 'N/A', 'NA', 'n/a', '待定', '待补充', '待填写', '待完善', '待确认', 'TBD']);

// ADR 三段式章节（上下文-决策-后果）
const ADR_REQUIRED_SECTIONS = ['上下文', '决策', '后果'];

/**
 * 解析 Markdown 表格（| a | b | 形式，含分隔行）
 */
export function parseMarkdownTables(content: string): { header: string[]; rows: string[][] }[] {
  const tables: { header: string[]; rows: string[][] }[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|') || !line.endsWith('|')) continue;
    const header = line.split('|').slice(1, -1).map(c => c.trim());
    if (header.length < 2) continue;
    const separator = (lines[i + 1] || '').trim();
    if (!/^\|[\s:|-]+\|$/.test(separator)) continue;
    const rows: string[][] = [];
    for (let j = i + 2; j < lines.length; j++) {
      const rowLine = lines[j].trim();
      if (!rowLine.startsWith('|') || !rowLine.endsWith('|')) break;
      rows.push(rowLine.split('|').slice(1, -1).map(c => c.trim()));
    }
    tables.push({ header, rows });
  }
  return tables;
}

/**
 * 统计代码证据引用（去重后的源码路径）
 */
export function countCodeEvidence(content: string): string[] {
  const refs = new Set<string>();
  const matches = content.matchAll(CODE_EVIDENCE_RE);
  for (const m of matches) {
    // 过滤 node_modules、.md 文件名、URL
    const ref = m[0];
    if (/node_modules|dist\/|\.md$/i.test(ref)) continue;
    if (/^https?:\/\//.test(ref)) continue;
    refs.add(ref);
  }
  return [...refs];
}

/**
 * 提取 ARCHITECTURE.md 中的架构决策块：[起始行号, 区块文本]
 */
export function extractDecisionBlocks(content: string): { line: number; text: string; hasReason: boolean; evidence: string[] }[] {
  const lines = content.split('\n');
  const blocks: { line: number; text: string; hasReason: boolean; evidence: string[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isDecision = DECISION_HEADING_RE.test(line) || DECISION_BULLET_RE.test(line);
    if (!isDecision) continue;
    // 向后收集到下一个标题行（## / ### / #### 或下一个决策行），最多 20 行
    let end = i + 1;
    while (end < lines.length && end - i < 20) {
      const l = lines[end];
      if (/^#{2,4}\s/.test(l) || DECISION_HEADING_RE.test(l) || DECISION_BULLET_RE.test(l)) break;
      end++;
    }
    const text = lines.slice(i, end).join('\n');
    blocks.push({
      line: i + 1,
      text,
      hasReason: DECISION_REASON_RE.test(text),
      evidence: countCodeEvidence(text),
    });
  }
  return blocks;
}

// v8.3.61+: 最小行数标准（与 analyze Prompt 中的要求对齐）
const MIN_LINE_STANDARDS: Record<string, number> = {
  '_INDEX.md': 80,
  '_ASSOCIATION.md': 100,
  '_MODULES.md': 50,
  'REQUIREMENT.md': 500,
  'ARCHITECTURE.md': 200,
  'DATA_FLOW.md': 150,
  'DEPLOYMENT.md': 100,
  'SECURITY_AUDIT.md': 80,
  'PERFORMANCE_BASELINE.md': 80,
  'OBSERVABILITY.md': 80,
  'FUNCTION_MAP.md': 50,
  'INTERACTION_MAP.md': 50,
  'CONSISTENCY_CHECK.md': 50,
  'EXTERNAL_INTEGRATIONS.md': 50,
  'API_INVENTORY.md': 150,
  'DATA_MODEL.md': 100,
  'UI_FLOW.md': 100,
  'API_CALL_MAP.md': 80,
  'STATE_MANAGEMENT.md': 80,
};

/**
 * 语义质量检查（v8.3.386+）：从「行数/图存在」升级为「内容深度」
 * - ARCHITECTURE.md：≥3 条架构决策，每条附理由 + 代码证据路径
 * - API_INVENTORY.md：鉴权/幂等/版本列必须存在且数据行非空
 * - 技术文档：关键结论标注源码路径（≥3 处）
 */
export function checkSemanticQuality(filePath: string, basename_: string, content: string): QualityIssue[] {
  const issues: QualityIssue[] = [];

  // ── 架构决策检查（ARCHITECTURE.md）──
  if (basename_ === 'ARCHITECTURE.md') {
    const blocks = extractDecisionBlocks(content);
    if (blocks.length < MIN_ARCH_DECISIONS) {
      issues.push({
        file: filePath,
        type: 'missing-decision',
        severity: 'error',
        message: `架构决策不足: 仅 ${blocks.length} 条（要求 ≥ ${MIN_ARCH_DECISIONS} 条，标题形如「### 决策 N：」或「- **决策 N**：」）`,
        suggestion: `补充架构决策章节，每条决策说明「选择了什么 + 为什么（理由/权衡） + 代码证据路径」`,
      });
    }
    const noReason = blocks.filter(b => !b.hasReason);
    if (noReason.length > 0) {
      issues.push({
        file: filePath,
        line: noReason[0].line,
        type: 'missing-decision',
        severity: 'error',
        message: `${noReason.length} 条架构决策缺少理由（无「理由/原因/权衡/背景」等依据说明）`,
        suggestion: `每条决策补充理由：为什么选这个方案、放弃/权衡了哪些替代方案`,
      });
    }
    const noEvidence = blocks.filter(b => b.evidence.length === 0);
    if (noEvidence.length > 0) {
      issues.push({
        file: filePath,
        line: noEvidence[0].line,
        type: 'missing-evidence',
        severity: 'error',
        message: `${noEvidence.length} 条架构决策缺少代码证据路径（如 src/xxx/xxx.ts 或模块目录引用）`,
        suggestion: `在决策条目中标注支撑该决策的源码路径与关键文件，如 \`src/core/xxx.ts\``,
      });
    }
  }

  // ── API 清单列非空检查（API_INVENTORY.md）──
  if (basename_ === 'API_INVENTORY.md') {
    const tables = parseMarkdownTables(content);
    for (const [colRe, colName] of API_REQUIRED_COLUMNS) {
      const table = tables.find(t => t.header.some(h => colRe.test(h)));
      if (!table) {
        issues.push({
          file: filePath,
          type: 'empty-column',
          severity: 'error',
          message: `接口表格缺少「${colName}」列`,
          suggestion: `在接口清单表格中补充「${colName}」列（如 JWT/无/API-Key、是/否、v1/v2）`,
        });
        continue;
      }
      const colIdx = table.header.findIndex(h => colRe.test(h));
      const emptyRows = table.rows
        .map((row, i) => ({ cell: (row[colIdx] || '').trim(), i }))
        .filter(({ cell }) => EMPTY_CELL_VALUES.has(cell));
      if (emptyRows.length > 0) {
        issues.push({
          file: filePath,
          type: 'empty-column',
          severity: 'error',
          message: `「${colName}」列有 ${emptyRows.length} 行数据为空（第 ${emptyRows.slice(0, 3).map(e => e.i + 1).join('/')} 行数据）`,
          suggestion: `为每个接口填写明确的「${colName}」值（鉴权: JWT/无；幂等: 是/否；版本: v1/v2）`,
        });
      }
    }
  }

  // ── 代码证据引用检查（技术文档）──
  if (EVIDENCE_REQUIRED_DOCS.includes(basename_)) {
    const refs = countCodeEvidence(content);
    if (refs.length < MIN_EVIDENCE_REFS) {
      issues.push({
        file: filePath,
        type: 'missing-evidence',
        severity: 'error',
        message: `代码证据引用不足: 仅 ${refs.length} 处（要求 ≥ ${MIN_EVIDENCE_REFS} 处源码路径标注）`,
        suggestion: `关键结论标注源码证据，如 \`src/service/order.ts:45\`，从根上杜绝灌水式罗列`,
      });
    }
  }

  return issues;
}

/**
 * 检查单个文档质量
 */
export async function checkDocumentQuality(filePath: string): Promise<QualityReport | null> {
  if (!(await pathExists(filePath))) return null;

  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const basename_ = filePath.split('/').pop() || '';
  const issues: QualityIssue[] = [];

  // 1. 检测占位符
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(line)) {
        issues.push({
          file: filePath,
          line: i + 1,
          type: 'placeholder',
          severity: 'error',
          message: `发现占位符: "${line.trim().slice(0, 40)}"`,
          suggestion: `补充具体内容，删除占位符`,
        });
        break;
      }
    }
  }

  // 2. 检测行数（v8.3.61+）
  const lineCount = lines.length;
  const minLines = MIN_LINE_STANDARDS[basename_];
  if (minLines && lineCount < minLines) {
    issues.push({
      file: filePath,
      type: 'too-short',
      severity: 'error',
      message: `文档行数不足: ${lineCount} 行（要求 ≥ ${minLines} 行）`,
      suggestion: `补充详细内容，达到最小内容标准`,
    });
  }

  // 3. 检测字数
  const wordCount = content.replace(/\s+/g, '').length;
  if (wordCount < 200) {
    issues.push({
      file: filePath,
      type: 'too-short',
      severity: 'error',
      message: `文档过短: ${wordCount} 字（建议 > 500 字）`,
      suggestion: `补充详细内容，增加分析深度`,
    });
  } else if (wordCount < 500) {
    issues.push({
      file: filePath,
      type: 'too-short',
      severity: 'warning',
      message: `文档偏短: ${wordCount} 字（建议 > 1000 字）`,
      suggestion: `补充更多细节和案例`,
    });
  }

  // 4. 检测 Mermaid 图表
  const hasMermaid = /```mermaid|:::mermaid/.test(content);
  if (CHART_REQUIRED_DOCS.includes(basename_) && !hasMermaid) {
    issues.push({
      file: filePath,
      type: 'missing-chart',
      severity: 'error',
      message: `缺少 Mermaid 图表（${basename_} 必须包含图表）`,
      suggestion: `添加 Mermaid 图表（graph/sequenceDiagram/stateDiagram 等）`,
    });
  }

  // 5. 检测关键章节
  const required = REQUIRED_SECTIONS[basename_];
  if (required) {
    for (const section of required) {
      if (!content.includes(section)) {
        issues.push({
          file: filePath,
          type: 'missing-section',
          severity: 'warning',
          message: `缺少关键章节: "${section}"`,
          suggestion: `添加 "${section}" 章节`,
        });
      }
    }
  }

  // 6. Mermaid 语法校验（v8.3.61+）
  const mermaidBlocks = content.match(/```mermaid\n([\s\S]*?)```/g) || [];
  for (const block of mermaidBlocks) {
    const mermaidContent = block.replace(/```mermaid\n/, '').replace(/```$/, '').trim();
    const mermaidLines = mermaidContent.split('\n').filter(l => l.trim());
    if (mermaidLines.length === 0) continue;

    const firstLine = mermaidLines[0].toLowerCase();

    // graph/flowchart 必须有方向
    if (firstLine.startsWith('graph ') || firstLine.startsWith('flowchart ')) {
      if (!/\b(tb|td|lr|rl|bt)\b/.test(firstLine)) {
        issues.push({
          file: filePath,
          type: 'missing-chart',
          severity: 'warning',
          message: `Mermaid graph 缺少方向声明（如 TB/LR/RL/BT）`,
          suggestion: `在第一行添加方向，如 \`graph TB\` 或 \`flowchart LR\``,
        });
      }
      // 必须包含连接符
      if (!mermaidLines.some(l => /[-=~]+>/.test(l) || /--/.test(l))) {
        issues.push({
          file: filePath,
          type: 'missing-chart',
          severity: 'warning',
          message: `Mermaid graph 缺少节点连接（如 A --> B）`,
          suggestion: `添加节点间的连接关系`,
        });
      }
    }

    // sequenceDiagram 必须有 participant
    if (firstLine.startsWith('sequencediagram')) {
      if (!mermaidLines.some(l => l.trim().toLowerCase().startsWith('participant'))) {
        issues.push({
          file: filePath,
          type: 'missing-chart',
          severity: 'warning',
          message: `Mermaid sequenceDiagram 缺少 participant 声明`,
          suggestion: `添加 participant 定义，如 \`participant A as 前端\``,
        });
      }
    }

    // 检查未闭合括号
    const openParen = (mermaidContent.match(/\(/g) || []).length;
    const closeParen = (mermaidContent.match(/\)/g) || []).length;
    if (openParen !== closeParen) {
      issues.push({
        file: filePath,
        type: 'missing-chart',
        severity: 'warning',
        message: `Mermaid 代码括号不匹配（开:${openParen} 闭:${closeParen}）`,
        suggestion: `检查括号是否成对闭合`,
      });
    }
  }

  // 7. 语义门禁（v8.3.386+）：架构决策 + 代码证据 + API 清单列非空
  issues.push(...checkSemanticQuality(filePath, basename_, content));

  // 8. 计算质量分
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const score = Math.max(0, 100 - errorCount * 20 - warningCount * 5);

  return { file: filePath, issues, wordCount, lineCount, hasMermaid, score };
}

/**
 * 扫描全局分析目录，检查所有文档质量
 */
export async function runGlobalQualityGate(globalDir?: string): Promise<QualityReport[]> {
  const dir = globalDir || join(getProjectRoot(), '.speccore', 'GLOBAL');
  const reports: QualityReport[] = [];

  // 扫描 overview/ 和 requirements/ 和 platforms/
  const subdirs = ['overview', 'requirements', 'platforms'];
  for (const sub of subdirs) {
    const subDir = join(dir, sub);
    if (!(await pathExists(subDir))) continue;

    if (sub === 'platforms') {
      // platforms/ 下有子目录
      const entries = await readdir(subDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const platformDir = join(subDir, entry.name);
          const files = await readdir(platformDir);
          for (const f of files.filter(f => f.endsWith('.md') || f.endsWith('.yaml') || f.endsWith('.yml'))) {
            const report = await checkDocumentQuality(join(platformDir, f));
            if (report) reports.push(report);
          }
        }
      }
    } else {
      const files = await readdir(subDir);
      for (const f of files.filter(f => f.endsWith('.md') || f.endsWith('.yaml') || f.endsWith('.yml'))) {
        const report = await checkDocumentQuality(join(subDir, f));
        if (report) reports.push(report);
      }
    }
  }

  // 扫描 platforms/_shared/
  const sharedDir = join(dir, 'platforms', '_shared');
  if (await pathExists(sharedDir)) {
    const files = await readdir(sharedDir);
    for (const f of files.filter(f => f.endsWith('.md'))) {
      const report = await checkDocumentQuality(join(sharedDir, f));
      if (report) reports.push(report);
    }
  }

  // v8.3.386+: ADR 门禁 — ARCHITECTURE.md 含架构决策时，decisions/ 必须存在且每份 ADR 三段完整
  await checkAdrGate(dir, reports);

  return reports;
}

/**
 * ADR 门禁（v8.3.386+）：架构决策必须同步「上下文-决策-后果」三段式 ADR
 * 结果挂载到 ARCHITECTURE.md 的报告中，不单独生成报告条目
 */
export async function checkAdrGate(globalDir: string, reports: QualityReport[]): Promise<void> {
  const architecturePath = join(globalDir, 'overview', 'ARCHITECTURE.md');
  if (!(await pathExists(architecturePath))) return;

  const archContent = await readFile(architecturePath, 'utf-8');
  const decisionBlocks = extractDecisionBlocks(archContent);
  if (decisionBlocks.length === 0) return; // 无架构决策则无 ADR 义务

  const archReport = reports.find(r => r.file === architecturePath);
  const target = archReport || {
    file: architecturePath,
    issues: [],
    wordCount: archContent.replace(/\s+/g, '').length,
    lineCount: archContent.split('\n').length,
    hasMermaid: /```mermaid|:::mermaid/.test(archContent),
    score: 100,
  };
  if (!archReport) reports.push(target);

  const decisionsDir = join(globalDir, 'overview', 'decisions');
  if (!(await pathExists(decisionsDir))) {
    target.issues.push({
      file: architecturePath,
      type: 'missing-adr',
      severity: 'error',
      message: `架构决策缺少 ADR 记录: overview/decisions/ 目录不存在`,
      suggestion: `为每条架构决策生成 ADR-NNN.md（上下文/决策/后果三段），写入 overview/decisions/`,
    });
    return;
  }

  const adrFiles = (await readdir(decisionsDir)).filter(f => f.endsWith('.md'));
  if (adrFiles.length === 0) {
    target.issues.push({
      file: architecturePath,
      type: 'missing-adr',
      severity: 'error',
      message: `架构决策缺少 ADR 记录: overview/decisions/ 目录为空（ARCHITECTURE.md 含 ${decisionBlocks.length} 条决策）`,
      suggestion: `生成 ADR 文件，如 decisions/ADR-001.md，内容为「上下文-决策-后果」三段`,
    });
    return;
  }

  for (const adrFile of adrFiles) {
    const adrContent = await readFile(join(decisionsDir, adrFile), 'utf-8');
    const missingSections = ADR_REQUIRED_SECTIONS.filter(s => !adrContent.includes(s));
    if (missingSections.length > 0) {
      target.issues.push({
        file: join(decisionsDir, adrFile),
        type: 'missing-adr',
        severity: 'error',
        message: `${adrFile} 缺少 ADR 必填章节: ${missingSections.join('、')}`,
        suggestion: `补全「## 上下文 / ## 决策 / ## 后果」三段式结构`,
      });
    }
  }

  // ADR 门禁 issue 挂载后重算质量分（保持报告一致）
  const errorCount = target.issues.filter(i => i.severity === 'error').length;
  const warningCount = target.issues.filter(i => i.severity === 'warning').length;
  target.score = Math.max(0, 100 - errorCount * 20 - warningCount * 5);
}

/**
 * 打印质量报告
 */
export function printQualityReport(reports: QualityReport[]): void {
  if (reports.length === 0) {
    logger.info('📋 未找到全局分析文档');
    return;
  }

  const totalErrors = reports.reduce((sum, r) => sum + r.issues.filter(i => i.severity === 'error').length, 0);
  const totalWarnings = reports.reduce((sum, r) => sum + r.issues.filter(i => i.severity === 'warning').length, 0);
  const avgScore = Math.round(reports.reduce((sum, r) => sum + r.score, 0) / reports.length);

  logger.info('');
  logger.info('🔍 全局分析文档质量报告');
  logger.info(`   文档数: ${reports.length} | 平均分: ${avgScore}/100 | ❌ ${totalErrors} | ⚠️ ${totalWarnings}`);
  logger.info('');

  for (const report of reports) {
    const fileName = report.file.split('/').slice(-2).join('/');
    const errors = report.issues.filter(i => i.severity === 'error');
    const warnings = report.issues.filter(i => i.severity === 'warning');

    if (errors.length === 0 && warnings.length === 0) {
      logger.info(`   ✅ ${fileName} (${report.lineCount}行, ${report.wordCount}字, ${report.score}分)`);
      continue;
    }

    const icon = errors.length > 0 ? '❌' : '⚠️';
    logger.info(`   ${icon} ${fileName} (${report.lineCount}行, ${report.wordCount}字, ${report.score}分) — ${errors.length} 错误, ${warnings.length} 警告`);

    for (const issue of report.issues.slice(0, 3)) {
      const lineInfo = issue.line ? `L${issue.line}` : '';
      const icon2 = issue.severity === 'error' ? '❌' : '⚠️';
      logger.info(`      ${icon2} ${lineInfo} ${issue.message}`);
    }
    if (report.issues.length > 3) {
      logger.info(`      ... 还有 ${report.issues.length - 3} 个问题`);
    }
  }

  if (totalErrors > 0) {
    logger.info('');
    logger.info('💡 修复建议:');
    logger.info('   speccore global analyze --layer 4 --deep <文档名>');
    logger.info('   或使用 --iterative 逐节补全');
  }
}
