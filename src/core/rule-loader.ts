/**
 * RULES 规范库加载器
 *
 * 负责：
 * 1. 扫描 .speccore/RULES/ 目录下的规范定义文件
 * 2. 根据技术栈（从 CONSTITUTION.md 解析）匹配对应的规范
 * 3. 按优先级合并规范内容
 * 4. 注入到代码生成 prompt 中
 *
 * v6.85.0+
 */

import { join } from 'path';
import { pathExists, readFile, readdir } from 'fs-extra';

const BUILTIN_RULES_DIR = join(__dirname, 'rules', 'defaults');

export interface RuleDefinition {
  name: string;
  content: string;
  appliesTo: string[]; // 适用的技术栈标识，如 ['typescript', 'react', 'nodejs']
  priority: number;
}

/**
 * 扫描目录下的规则文件
 * 文件名即规则名（不含 .md），内容即规则定义
 */
async function scanRuleFiles(dir: string): Promise<{ name: string; content: string }[]> {
  if (!(await pathExists(dir))) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const rules: { name: string; content: string }[] = [];

  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    if (e.name.startsWith('_')) continue; // _INDEX.md, _TEMPLATE.md 跳过

    const content = await readFile(join(dir, e.name), 'utf-8');
    rules.push({
      name: e.name.replace(/\.md$/, ''),
      content,
    });
  }

  return rules;
}

/**
 * 解析规则文件中的元信息
 * 从 frontmatter 或特定章节提取 appliesTo 和 priority
 */
function parseRuleMeta(content: string): { appliesTo: string[]; priority: number } {
  const appliesTo: string[] = [];
  let priority = 50;

  // 尝试从 frontmatter 解析
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (frontmatterMatch) {
    const fm = frontmatterMatch[1];
    const appliesMatch = fm.match(/appliesTo:\s*\n((\s+-\s+.+\n)+)/);
    if (appliesMatch) {
      for (const line of appliesMatch[1].matchAll(/-\s+(.+)/g)) {
        appliesTo.push(line[1].trim().toLowerCase());
      }
    }
    const priorityMatch = fm.match(/priority:\s*(\d+)/);
    if (priorityMatch) priority = parseInt(priorityMatch[1], 10);
  }

  // 如果没有 frontmatter，尝试从标题推断 appliesTo
  if (appliesTo.length === 0) {
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch) {
      const title = headingMatch[1].toLowerCase();
      // 简单推断：文件名/标题中的技术关键词
      const techKeywords = ['typescript', 'react', 'vue', 'angular', 'nodejs', 'java', 'go', 'python', 'spring', 'nestjs', 'gin', 'fastapi'];
      for (const kw of techKeywords) {
        if (title.includes(kw)) appliesTo.push(kw);
      }
    }
  }

  return { appliesTo, priority };
}

/**
 * 加载所有可用规则（内置 + 用户自定义，用户自定义覆盖）
 */
async function loadAllRules(projectRoot: string): Promise<RuleDefinition[]> {
  const userRulesDir = join(projectRoot, '.speccore', 'RULES');
  const ruleMap = new Map<string, RuleDefinition>();

  // 1. 加载内置默认
  const builtinFiles = await scanRuleFiles(BUILTIN_RULES_DIR);
  for (const f of builtinFiles) {
    const meta = parseRuleMeta(f.content);
    ruleMap.set(f.name, {
      name: f.name,
      content: f.content,
      appliesTo: meta.appliesTo,
      priority: meta.priority,
    });
  }

  // 2. 用户自定义覆盖
  const userFiles = await scanRuleFiles(userRulesDir);
  for (const f of userFiles) {
    const meta = parseRuleMeta(f.content);
    ruleMap.set(f.name, {
      name: f.name,
      content: f.content,
      appliesTo: meta.appliesTo,
      priority: meta.priority,
    });
  }

  return Array.from(ruleMap.values());
}

/**
 * 根据技术栈标识符匹配适用的规则
 *
 * 技术栈标识符来自 CONSTITUTION.md 的解析结果，如：
 * - 'typescript', 'react', 'nodejs', 'mysql'
 * - 'java', 'spring-boot'
 * - 'vue', 'pinia'
 */
export async function resolveRulesForTechStack(
  techStackIdentifiers: string[],
  projectRoot: string
): Promise<RuleDefinition[]> {
  const allRules = await loadAllRules(projectRoot);
  const identifiers = techStackIdentifiers.map(s => s.toLowerCase());

  const matched = allRules.filter(rule => {
    // 规则匹配：任一标识符匹配即生效
    return rule.appliesTo.some(tag => identifiers.includes(tag));
  });

  // 按优先级排序（高优先级在前）
  matched.sort((a, b) => b.priority - a.priority);

  return matched;
}

/**
 * 将匹配的规则合并为单个 prompt 字符串
 */
export function formatRulesPrompt(rules: RuleDefinition[]): string {
  if (rules.length === 0) return '';

  const sections: string[] = [];
  sections.push('## 编码规范');
  sections.push('');
  sections.push('> 以下规范来自项目配置，必须严格遵守。');
  sections.push('');

  for (const rule of rules) {
    // 只提取规则内容（去掉 frontmatter）
    let content = rule.content;
    content = content.replace(/^---\n[\s\S]*?\n---\n/, ''); // 移除 frontmatter
    content = content.trim();

    sections.push(`### ${rule.name}`);
    sections.push('');
    sections.push(content);
    sections.push('');
  }

  return sections.join('\n');
}

/**
 * 获取内置规则的原始内容（用于 init 时复制到项目）
 */
export async function getBuiltinRuleContents(): Promise<{ name: string; content: string }[]> {
  return scanRuleFiles(BUILTIN_RULES_DIR);
}
