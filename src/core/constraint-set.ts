/**
 * constraint-set.ts — TaskChain 约束集加载器（v8.3.307+）
 *
 * 「共同前提约束」的落地机制：用户在任务 spec 中声明约束集（如
 * constraints: [common-rules, frontend-rules]），同类任务每次执行时都
 * 重新加载这些约束文件并注入执行 prompt，保证上下文不随会话漂移。
 *
 * 约束来源（按优先级）：
 *   1. 任务 spec 显式声明（00-specs/REQ.md 或 TASK.md 中的 constraints 字段）
 *   2. 任务类型默认约束（task-type-registry.ts 的 defaultConstraints）
 *
 * 约束文件位置：.speccore/GLOBAL/CONSTRAINTS/{约束名}.md
 *  - init 时生成内置约束（coding-standards / doc-standards / script-standards /
 *    data-standards / research-standards）
 *  - 用户可按团队规范增改（如 common-rules.md、frontend-rules.md）
 *
 * 与业务规则（business-rules.ts）的分工：
 *  - BUSINESS_RULES = 项目事实（协议、报价规则），分析阶段读
 *  - CONSTRAINTS = 执行纪律（怎么做事），执行阶段每次重新注入
 */

import { join } from 'path';
import { pathExists, readFile, readdir } from 'fs-extra';
import { getProjectRoot } from '../utils/task-utils';
import { resolveTaskTypeDefinition } from './task-type-registry';

export interface ConstraintItem {
  /** 约束名（文件名去 .md） */
  name: string;
  /** 相对项目根的路径（展示 + 追溯用） */
  path: string;
  /** 约束内容（截断至 maxChars） */
  content: string;
}

export interface LoadConstraintSetOptions {
  /** 项目根，默认 getProjectRoot() */
  cwd?: string;
  /** 任务类型（如 doc/feature），用于加载类型默认约束 */
  taskType?: string;
  /** 任务 spec 显式声明的约束名列表 */
  declared?: string[];
  /** 每约束最大注入字符数，默认 2000 */
  maxChars?: number;
}

/** 约束文件目录（相对项目根） */
export const CONSTRAINTS_DIR = '.speccore/GLOBAL/CONSTRAINTS';

/**
 * 从任务 spec 文本中解析声明的约束集
 *
 * 支持两种声明格式：
 *  - YAML frontmatter: constraints: [common-rules, frontend-rules]
 *  - 行内声明:        - 约束集: common-rules, frontend-rules
 */
export function parseDeclaredConstraints(specContent: string): string[] {
  const result: string[] = [];

  // YAML frontmatter
  const fmMatch = specContent.match(/^---\n([\s\S]*?)\n---\n/);
  if (fmMatch) {
    const fm = fmMatch[1];
    const inline = fm.match(/^constraints?\s*:\s*\[(.+?)\]/m);
    if (inline) {
      for (const name of inline[1].split(',')) {
        const trimmed = name.trim().replace(/['"]/g, '');
        if (trimmed) result.push(trimmed);
      }
      return result;
    }
    // 每项以 \n 或字符串尾结束（frontmatter 最后一项后可能无换行，被 `\n---` 消费）
    const listMatch = fm.match(/^constraints?\s*:\s*\n((?:\s+-\s+.+(?:\n|$))+)/m);
    if (listMatch) {
      for (const line of listMatch[1].matchAll(/^\s+-\s+(.+)$/gm)) {
        const name = line[1].trim().replace(/['"]/g, '');
        if (name) result.push(name);
      }
      return result;
    }
  }

  // 行内声明（正文中）
  const inlineMatch = specContent.match(/^[-•]\s*\*{0,2}约束集\*{0,2}\s*[：:]\s*(.+)$/m);
  if (inlineMatch) {
    for (const name of inlineMatch[1].split(/[,，]/)) {
      const trimmed = name.trim();
      if (trimmed && !trimmed.includes('{')) result.push(trimmed);
    }
  }

  return result;
}

/**
 * 加载约束集 — 任务声明 ∪ 类型默认（按声明顺序去重）
 *
 * 声明文件不存在时静默跳过（约束集是「锦上添花」的纪律注入，缺失不应阻断执行），
 * 但会通过 missing 返回值让调用方决定是否提示。
 */
export async function loadConstraintSet(
  options: LoadConstraintSetOptions
): Promise<{ items: ConstraintItem[]; missing: string[] }> {
  const cwd = options.cwd || getProjectRoot();
  const maxChars = options.maxChars || 2000;
  const items: ConstraintItem[] = [];
  const missing: string[] = [];

  // 合并声明 + 类型默认（v8.3.308: resolveTaskTypeDefinition 支持用户自定义类型），保持顺序去重
  const typeDef = await resolveTaskTypeDefinition(options.taskType || '', cwd);
  const names: string[] = [];
  for (const name of [...(options.declared || []), ...typeDef.defaultConstraints]) {
    if (name && !names.includes(name)) names.push(name);
  }

  const constraintsDir = join(cwd, CONSTRAINTS_DIR);
  for (const name of names) {
    const filePath = join(constraintsDir, `${name}.md`);
    if (!(await pathExists(filePath))) {
      missing.push(name);
      continue;
    }
    try {
      const content = await readFile(filePath, 'utf-8');
      items.push({
        name,
        path: `${CONSTRAINTS_DIR}/${name}.md`,
        content: content.slice(0, maxChars),
      });
    } catch {
      missing.push(name);
    }
  }

  return { items, missing };
}

/** 列出已安装的全部约束集（chain status / help 展示用） */
export async function listConstraintSets(cwd?: string): Promise<string[]> {
  const constraintsDir = join(cwd || getProjectRoot(), CONSTRAINTS_DIR);
  if (!(await pathExists(constraintsDir))) return [];
  try {
    const files = await readdir(constraintsDir);
    return files
      .filter(f => f.endsWith('.md') && !f.startsWith('_'))
      .map(f => f.replace(/\.md$/, ''))
      .sort();
  } catch {
    return [];
  }
}

/**
 * 格式化约束集为 prompt 注入文本
 *
 * 标题刻意强调「每次执行前重新读取」——这是长任务链防记忆漂移的关键信号。
 */
export function formatConstraints(items: ConstraintItem[]): string {
  if (items.length === 0) return '';
  const lines: string[] = [
    '### 📐 执行前提约束（本次执行已重新加载，请严格遵守）',
    '',
  ];
  for (const item of items) {
    lines.push(`#### 约束: ${item.name} \`${item.path}\``, '');
    lines.push(item.content.trim(), '');
  }
  return lines.join('\n');
}
