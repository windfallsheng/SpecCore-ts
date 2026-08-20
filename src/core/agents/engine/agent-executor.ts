/**
 * AGENTS 引擎 — 执行器
 *
 * 负责：
 * 1. 构建 Agent 专用 Prompt（角色定义 + 检查清单 + 输入上下文）
 * 2. 执行 Agent 分析（生成 prompt 字符串，供外层 AI 调用）
 * 3. 结果解析与聚合
 *
 * v6.84.0+
 */

import { AgentDefinition, AgentContext, AgentTask, AgentResult, AgentFinding } from './types';

/**
 * 为指定 Agent 构建完整的分析 Prompt
 *
 * 将 Agent 的角色定义与当前上下文组合，生成可直接发给 AI 的 prompt 字符串
 */
export function buildAgentPrompt(agent: AgentDefinition, context: AgentContext): string {
  const sections: string[] = [];

  // 1. 角色注入
  sections.push(agent.rolePrompt);
  sections.push('');

  // 2. 输入上下文
  sections.push('---');
  sections.push('# 输入上下文');
  sections.push('');

  if (context.iteration) {
    sections.push(`- 迭代: ${context.iteration}`);
  }
  if (context.platform) {
    sections.push(`- 端: ${context.platform}`);
  }
  if (context.project?.industry) {
    sections.push(`- 行业: ${context.project.industry}`);
  }
  sections.push('');

  // 3. 任务特定输入
  if (context.docContent) {
    sections.push('## 需求文档内容');
    sections.push('');
    sections.push('```');
    const content = String(context.docContent);
    sections.push(content.slice(0, 8000));
    if (content.length > 8000) {
      sections.push('\n... (文档过长，已截断，请继续读取完整文档)');
    }
    sections.push('```');
    sections.push('');
  }

  if (context.qualityIssues && Array.isArray(context.qualityIssues) && context.qualityIssues.length > 0) {
    sections.push('## 已识别的质量问题');
    sections.push('');
    for (const issue of context.qualityIssues) {
      sections.push(`- ${issue}`);
    }
    sections.push('');
  }

  if (context.codeContent) {
    sections.push('## 代码内容');
    sections.push('');
    sections.push('```');
    const code = String(context.codeContent);
    sections.push(code.slice(0, 6000));
    if (code.length > 6000) {
      sections.push('\n... (代码过长，已截断)');
    }
    sections.push('```');
    sections.push('');
  }

  // 4. 输出格式要求
  if (agent.outputFormat) {
    sections.push('---');
    sections.push('# 输出要求');
    sections.push('');
    sections.push(agent.outputFormat);
    sections.push('');
  }

  // 5. 通用输出格式（结构化）
  sections.push('---');
  sections.push('# 输出格式（必须严格遵守）');
  sections.push('');
  sections.push('请以以下结构输出分析结果：');
  sections.push('');
  sections.push('## 总体评估');
  sections.push('通过 / 不通过');
  sections.push('');
  sections.push('## 发现的问题');
  sections.push('对每个问题，按以下格式：');
  sections.push('- [严重级别] [类别]: [问题描述] → [修改建议]');
  sections.push('');
  sections.push('## 改进建议');
  sections.push('（可选）具体的修改方案');
  sections.push('');

  return sections.join('\n');
}

/**
 * 模拟执行 Agent 任务
 *
 * 注意：此函数不直接调用 AI API，而是构建 prompt 并返回给外层调用者。
 * 外层调用者（如 analyze.ts）将 prompt 发送给 AI，然后将 AI 的响应传回给 parseAgentResponse。
 *
 * 返回 { prompt: string, metadata: { agent, context } }
 */
export function prepareAgentTask(agent: AgentDefinition, context: AgentContext): {
  prompt: string;
  metadata: { agentName: string; agentDefinition: AgentDefinition; context: AgentContext };
} {
  const prompt = buildAgentPrompt(agent, context);
  return {
    prompt,
    metadata: {
      agentName: agent.name,
      agentDefinition: agent,
      context,
    },
  };
}

/**
 * 解析 Agent 的 AI 响应为结构化结果
 *
 * 这是一个启发式解析器，从 AI 返回的 Markdown 文本中提取结构化信息。
 */
export function parseAgentResponse(
  agentName: string,
  response: string,
  duration: number = 0
): AgentResult {
  const findings: AgentFinding[] = [];
  let passed = true;

  // 1. 解析总体评估
  const overallMatch = response.match(/##\s+总体评估\s*\n\s*(通过|不通过|PASS|FAIL|✅|❌)/i);
  if (overallMatch) {
    const verdict = overallMatch[1].toLowerCase();
    passed = !verdict.includes('不') && !verdict.includes('fail') && !verdict.includes('❌');
  }

  // 2. 解析问题列表
  // 格式: - [严重级别] [类别]: [问题描述] → [修改建议]
  const issuePattern = /^\s*[-*]\s*\[?(critical|major|minor|info|严重|重要|一般|提示)\]?\s*\[?([^\]]+)\]?\s*[:：]\s*(.+?)(?:→|->|\s-\s)(.+)$/gim;
  let m;
  while ((m = issuePattern.exec(response)) !== null) {
    const severity = mapSeverity(m[1]);
    findings.push({
      severity,
      category: m[2].trim(),
      message: m[3].trim(),
      suggestion: m[4].trim(),
    });
    if (severity === 'critical' || severity === 'major') {
      passed = false;
    }
  }

  // 3. 备用解析：简单列表项
  if (findings.length === 0) {
    const listPattern = /^\s*[-*]\s*(.+)$/gm;
    while ((m = listPattern.exec(response)) !== null) {
      const text = m[1].trim();
      if (text.length < 5) continue;
      if (text.startsWith('[') && text.includes(']:')) continue; // 跳过已解析的

      // 尝试推断严重级别
      let severity: AgentFinding['severity'] = 'info';
      if (/critical|严重|致命|阻塞/i.test(text)) severity = 'critical';
      else if (/major|重要|严重/i.test(text)) severity = 'major';
      else if (/minor|一般|轻微/i.test(text)) severity = 'minor';

      findings.push({
        severity,
        category: 'general',
        message: text,
      });

      if (severity === 'critical' || severity === 'major') {
        passed = false;
      }
    }
  }

  return {
    agent: agentName,
    passed,
    findings,
    duration,
    output: response,
  };
}

function mapSeverity(text: string): AgentFinding['severity'] {
  const lower = text.toLowerCase();
  if (lower.includes('critical') || lower.includes('严重') || lower.includes('致命')) return 'critical';
  if (lower.includes('major') || lower.includes('重要')) return 'major';
  if (lower.includes('minor') || lower.includes('一般') || lower.includes('轻微')) return 'minor';
  return 'info';
}

/**
 * 将多个 Agent 的结果聚合为统一报告
 */
export function mergeAgentResults(results: AgentResult[]): {
  allPassed: boolean;
  totalFindings: number;
  criticalCount: number;
  majorCount: number;
  report: string;
} {
  const allPassed = results.every(r => r.passed);
  const totalFindings = results.reduce((s, r) => s + r.findings.length, 0);
  const criticalCount = results.reduce(
    (s, r) => s + r.findings.filter(f => f.severity === 'critical').length,
    0
  );
  const majorCount = results.reduce(
    (s, r) => s + r.findings.filter(f => f.severity === 'major').length,
    0
  );

  let report = `# Multi-Agent 审查报告\n\n`;
  report += `| Agent | 结果 | 发现数 | 耗时 |\n`;
  report += `| :--- | :--- | :--- | :--- |\n`;
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    report += `| ${r.agent} | ${icon} ${r.passed ? '通过' : '不通过'} | ${r.findings.length} | ${(r.duration / 1000).toFixed(1)}s |\n`;
  }
  report += '\n';

  for (const r of results) {
    if (r.findings.length === 0) continue;
    report += `## ${r.agent}\n\n`;
    for (const f of r.findings) {
      const icon = f.severity === 'critical' ? '🔴' : f.severity === 'major' ? '🟠' : f.severity === 'minor' ? '🟡' : '🔵';
      report += `- ${icon} **[${f.severity.toUpperCase()}]** ${f.category}: ${f.message}\n`;
      if (f.suggestion) {
        report += `  → ${f.suggestion}\n`;
      }
    }
    report += '\n';
  }

  return { allPassed, totalFindings, criticalCount, majorCount, report };
}
