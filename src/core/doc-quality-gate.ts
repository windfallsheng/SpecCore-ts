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

export interface QualityIssue {
  file: string;
  line?: number;
  type: 'placeholder' | 'empty-table' | 'too-short' | 'missing-chart' | 'missing-section';
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

  // 7. 计算质量分
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const score = Math.max(0, 100 - errorCount * 20 - warningCount * 5);

  return { file: filePath, issues, wordCount, lineCount, hasMermaid, score };
}

/**
 * 扫描全局分析目录，检查所有文档质量
 */
export async function runGlobalQualityGate(globalDir?: string): Promise<QualityReport[]> {
  const dir = globalDir || join(process.cwd(), '.speccore', 'GLOBAL');
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

  return reports;
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
    logger.info('   speccore analyze --scope global --layer 4 --deep <文档名>');
    logger.info('   或使用 --iterative 逐节补全');
  }
}
