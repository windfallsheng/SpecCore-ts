/**
 * doc-validator — 文档质量验证引擎
 *
 * 不依赖外部 AI，纯启发式规则校验文档质量。
 * 用于 doc2spec 转换后和 spec2doc 导出前的质量把关。
 */
import { pathExists } from 'fs-extra';
import { join, dirname } from 'path';

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  category: 'encoding' | 'structure' | 'table' | 'api_table' | 'image' | 'content';
  line?: number;
  description: string;
  suggestion?: string;
  fixed: boolean;
}

export interface ValidationReport {
  score: number;
  totalIssues: number;
  errors: number;
  warnings: number;
  infos: number;
  fixed: number;
  issues: ValidationIssue[];
  sections: { heading: string; level: number; lineCount: number }[];
  apiCount: number;
  tableCount: number;
  imageCount: number;
  summary: string;
}

/**
 * 对转换后的 Markdown 内容进行质量验证
 */
export async function validateContent(
  content: string,
  outputDir: string,
  iterDir: string
): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];
  const lines = content.split('\n');

  // ── 1. 编码质量检测 ──
  checkEncoding(lines, issues);

  // ── 2. 标题结构检测 ──
  const sections = checkStructure(lines, issues);

  // ── 3. 表格完整性检测 ──
  const { tableCount, apiCount } = checkTables(lines, issues);

  // ── 4. 图片引用检测 ──
  const imageCount = await checkImages(content, outputDir, iterDir, issues);

  // ── 5. 内容完整性检测 ──
  checkContentCompleteness(content, lines, issues);

  // ── 6. 计算评分 ──
  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const infos = issues.filter(i => i.severity === 'info').length;
  const fixed = issues.filter(i => i.fixed).length;

  // 基础分 100，每个 error -10, warning -3, info -1
  const score = Math.max(0, Math.min(100, 100 - errors * 10 - warnings * 3 - infos * 1));

  const summary = generateSummary(score, issues, sections, apiCount, tableCount, imageCount);

  return {
    score,
    totalIssues: issues.length,
    errors,
    warnings,
    infos,
    fixed,
    issues,
    sections,
    apiCount,
    tableCount,
    imageCount,
    summary,
  };
}

/**
 * 检测编码问题：乱码字符、异常 Unicode
 */
function checkEncoding(lines: string[], issues: ValidationIssue[]): void {
  // 常见 pandoc 转换乱码模式
  const garbledPatterns = [
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/,  // 控制字符（除了 tab、换行）
    /\?{3,}/,                           // 连续问号（常见乱码表现）
    /[锟斤拷]/,                         // 经典 UTF-8 乱码
    /\ufffd/,                           // Unicode replacement character
    /[　]{3,}/,                         // 连续全角空格
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of garbledPatterns) {
      if (pattern.test(line)) {
        issues.push({
          severity: 'error',
          category: 'encoding',
          line: i + 1,
          description: `检测到可能的编码问题: ${line.substring(0, 40)}...`,
          suggestion: '建议用 AI 双路验证模式重新转换，或检查原始文档编码格式',
          fixed: false,
        });
        break; // 一行只报告一次
      }
    }
  }

  // 检测中文引号不匹配
  const leftQuotes = (content: string) => (content.match(/["""]/g) || []).length;
  const rightQuotes = (content: string) => (content.match(/["""]/g) || []).length;
  const allText = lines.join('\n');
  if (Math.abs(leftQuotes(allText) - rightQuotes(allText)) > 3) {
    issues.push({
      severity: 'warning',
      category: 'encoding',
      description: '中文引号可能不匹配，pandoc 转换中文引号时可能丢失',
      suggestion: '检查转换后的中文引号是否完整',
      fixed: false,
    });
  }
}

/**
 * 检测标题层级结构
 */
function checkStructure(
  lines: string[],
  issues: ValidationIssue[]
): { heading: string; level: number; lineCount: number }[] {
  const headings: { heading: string; level: number; line: number }[] = [];
  const sections: { heading: string; level: number; lineCount: number }[] = [];

  // 提取所有标题
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (match) {
      headings.push({ level: match[1].length, heading: match[2], line: i + 1 });
    }
  }

  // 检测层级跳跃 (H1 → H3 中间没有 H2)
  for (let i = 1; i < headings.length; i++) {
    if (headings[i].level - headings[i - 1].level > 1) {
      issues.push({
        severity: 'warning',
        category: 'structure',
        line: headings[i].line,
        description: `标题层级跳跃: H${headings[i-1].level} "${headings[i-1].heading}" → H${headings[i].level} "${headings[i].heading}"`,
        suggestion: `建议在中间添加 H${headings[i-1].level + 1} 级别标题`,
        fixed: false,
      });
    }
  }

  // 检测是否缺少必要的章节
  const hasAPI = headings.some(h => /api|接口|endpoint/i.test(h.heading));
  const hasDataModel = headings.some(h => /数据|模型|model|entity|schema/i.test(h.heading));
  const hasOverview = headings.some(h => /概述|概览|overview|简介|背景/i.test(h.heading));

  if (!hasOverview) {
    issues.push({
      severity: 'info',
      category: 'structure',
      description: '未检测到概述章节，建议添加项目/需求概述',
      fixed: false,
    });
  }

  // 计算每个章节的行数
  for (let i = 0; i < headings.length; i++) {
    const startLine = headings[i].line;
    const endLine = i + 1 < headings.length ? headings[i + 1].line - 1 : lines.length;
    sections.push({
      heading: headings[i].heading,
      level: headings[i].level,
      lineCount: endLine - startLine + 1,
    });
  }

  return sections;
}

/**
 * 检测表格完整性
 */
function checkTables(
  lines: string[],
  issues: ValidationIssue[]
): { tableCount: number; apiCount: number } {
  let tableCount = 0;
  let apiCount = 0;
  let inTable = false;
  let headerColumns = 0;
  let tableStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 表格行检测
    if (line.startsWith('|') && line.endsWith('|')) {
      if (!inTable) {
        inTable = true;
        tableStartLine = i + 1;
        tableCount++;
      }

      // 表头行
      if (!line.includes('---')) {
        const cols = line.split('|').filter(c => c.trim()).length;
        if (i === tableStartLine - 1) {
          headerColumns = cols;
        }

        // 检测是否是 API 表格
        const lowerLine = line.toLowerCase();
        if (/method|方法|verb|请求方式/i.test(lowerLine) &&
            /path|路径|url|endpoint/i.test(lowerLine)) {
          apiCount++;
          // 检查 API 表格是否缺少必要列
          if (!/说明|描述|description|备注/i.test(lowerLine)) {
            issues.push({
              severity: 'warning',
              category: 'api_table',
              line: i + 1,
              description: 'API 表格可能缺少"说明"列',
              suggestion: '建议在 API 表格中添加接口说明列',
              fixed: false,
            });
          }
        }
      }

      // 分隔行，跳过
      if (line.match(/^\|[\s\-:]+\|/)) continue;

      // 数据行：检查列数是否与表头一致
      const dataCols = line.split('|').filter(c => c.trim()).length;
      if (dataCols !== headerColumns && headerColumns > 0) {
        issues.push({
          severity: 'error',
          category: 'table',
          line: i + 1,
          description: `表格列数不一致: 表头 ${headerColumns} 列，当前行 ${dataCols} 列`,
          suggestion: 'pandoc 转换可能损坏了表格格式，建议检查原始文档',
          fixed: false,
        });
      }
    } else {
      inTable = false;
      headerColumns = 0;
    }
  }

  return { tableCount, apiCount };
}

/**
 * 检测图片引用
 */
async function checkImages(
  content: string,
  outputDir: string,
  iterDir: string,
  issues: ValidationIssue[]
): Promise<number> {
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const images: { alt: string; path: string }[] = [];
  let match;

  while ((match = imgRegex.exec(content)) !== null) {
    images.push({ alt: match[1], path: match[2] });
  }

  let missingCount = 0;
  for (const img of images) {
    // 跳过外部 URL
    if (img.path.startsWith('http://') || img.path.startsWith('https://')) continue;

    // 尝试在多个可能的位置查找图片
    const possiblePaths = [
      join(outputDir, img.path),
      join(iterDir, '010-requirements', 'assets', 'extracted', img.path.replace(/.*\//, '')),
      join(iterDir, img.path),
    ];

    let found = false;
    for (const p of possiblePaths) {
      if (await pathExists(p)) {
        found = true;
        break;
      }
    }

    if (!found) {
      missingCount++;
      issues.push({
        severity: 'error',
        category: 'image',
        description: `图片引用可能失效: ${img.path}`,
        suggestion: '检查 pandoc 是否正确提取了图片，或手动将图片放入 assets/extracted/ 目录',
        fixed: false,
      });
    }
  }

  return images.length;
}

/**
 * 检测内容完整性
 */
function checkContentCompleteness(
  content: string,
  lines: string[],
  issues: ValidationIssue[]
): void {
  // 检测空文件
  if (lines.length < 5) {
    issues.push({
      severity: 'error',
      category: 'content',
      description: '文档内容过少，可能转换失败或原始文件为空',
      fixed: false,
    });
    return;
  }

  // 检测 pandoc 常见截断标记
  const lastFewLines = lines.slice(-5).join('\n');
  if (/\b(page\s+\d+\s+of\s+\d+)\b/i.test(lastFewLines)) {
    issues.push({
      severity: 'warning',
      category: 'content',
      description: '文档末尾可能包含页码残留，pandoc 未完全过滤页眉页脚',
      fixed: false,
    });
  }

  // 检测是否有 TODO/TBD 占位符
  const todoCount = (content.match(/TODO|TBD|FIXME|XXX/g) || []).length;
  if (todoCount > 0) {
    issues.push({
      severity: 'info',
      category: 'content',
      description: `发现 ${todoCount} 个 TODO/TBD 占位符，可能需要补充`,
      fixed: false,
    });
  }

  // 检测过长的空白区间（可能表示内容丢失）
  let consecutiveBlank = 0;
  for (const line of lines) {
    if (line.trim() === '') {
      consecutiveBlank++;
      if (consecutiveBlank > 10) {
        issues.push({
          severity: 'warning',
          category: 'content',
          description: '文档中存在大段空白（>10连续空行），可能有内容丢失',
          suggestion: '检查原始文档对应位置是否有图表或分页导致的内容丢失',
          fixed: false,
        });
        break;
      }
    } else {
      consecutiveBlank = 0;
    }
  }
}

/**
 * 生成验证摘要
 */
function generateSummary(
  score: number,
  issues: ValidationIssue[],
  sections: { heading: string; level: number; lineCount: number }[],
  apiCount: number,
  tableCount: number,
  imageCount: number
): string {
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D';

  let summary = '';
  summary += `📊 文档质量: ${grade} (${score}/100)\n`;
  summary += `📋 章节数: ${sections.length} | 表格数: ${tableCount} | API表: ${apiCount} | 图片: ${imageCount}\n`;

  const byCategory: Record<string, ValidationIssue[]> = {};
  for (const issue of issues) {
    if (!byCategory[issue.category]) byCategory[issue.category] = [];
    byCategory[issue.category].push(issue);
  }

  for (const [cat, catIssues] of Object.entries(byCategory)) {
    const catErrors = catIssues.filter(i => i.severity === 'error').length;
    const catWarns = catIssues.filter(i => i.severity === 'warning').length;
    const icon = catErrors > 0 ? '❌' : catWarns > 0 ? '⚠️' : 'ℹ️';
    summary += `${icon} ${catLabels[cat] || cat}: ${catErrors}错误 ${catWarns}警告\n`;
  }

  return summary;
}

const catLabels: Record<string, string> = {
  encoding: '编码质量',
  structure: '章节结构',
  table: '表格完整性',
  api_table: 'API表格',
  image: '图片引用',
  content: '内容完整性',
};

/**
 * 生成 VALIDATION.md 报告文件内容
 */
export function generateReport(report: ValidationReport, sourceFile: string): string {
  const lines: string[] = [];

  lines.push(`# 🔍 文档质量验证报告`);
  lines.push('');
  lines.push(`> 源文件: ${sourceFile}`);
  lines.push(`> 验证时间: ${new Date().toISOString()}`);
  lines.push(`> 质量评分: ${report.score}/100`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 📊 质量总览');
  lines.push('');
  lines.push(report.summary);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 📋 章节结构');
  lines.push('');
  lines.push('| 章节 | 级别 | 行数 |');
  lines.push('| :--- | :--- | :--- |');
  for (const s of report.sections) {
    lines.push(`| ${s.heading} | H${s.level} | ${s.lineCount} |`);
  }
  lines.push('');

  if (report.issues.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## 🔍 发现的问题');
    lines.push('');
    lines.push('| 严重度 | 类别 | 位置 | 描述 | 修复建议 |');
    lines.push('| :--- | :--- | :--- | :--- | :--- |');
    for (const issue of report.issues) {
      const sev = issue.severity === 'error' ? '❌ 错误' : issue.severity === 'warning' ? '⚠️ 警告' : 'ℹ️ 提示';
      const loc = issue.line ? `L${issue.line}` : '-';
      const desc = issue.description.length > 60 ? issue.description.substring(0, 57) + '...' : issue.description;
      const sug = (issue.suggestion || '-').length > 40 ? (issue.suggestion || '-').substring(0, 37) + '...' : (issue.suggestion || '-');
      lines.push(`| ${sev} | ${catLabels[issue.category] || issue.category} | ${loc} | ${desc} | ${sug} |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## 💡 建议');
  lines.push('');
  if (report.score >= 90) {
    lines.push('✅ 文档质量良好，可以直接用于后续流程。');
  } else if (report.score >= 75) {
    lines.push('⚠️ 文档存在一些问题，建议修复后再进入 analyze 阶段。');
    lines.push('💡 推荐在 WorkBuddy 中使用 AI 双路验证模式重新转换以获得更高质量。');
  } else {
    lines.push('❌ 文档质量较差，强烈建议：');
    lines.push('1. 检查原始文档格式是否正确');
    lines.push('2. 在 WorkBuddy 中使用 AI 双路验证模式重新转换');
    lines.push('3. 手动校对关键章节');
  }
  lines.push('');

  return lines.join('\n');
}
