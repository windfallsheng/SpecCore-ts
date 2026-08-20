/**
 * SKILLS 可复用技能库加载器
 *
 * 负责：
 * 1. 扫描 .speccore/SKILLS/ 目录下的技能定义文件
 * 2. 根据任务类型/关键词匹配对应的技能
 * 3. 注入到代码生成 prompt 中
 *
 * v6.88.0+
 */

import { join } from 'path';
import { pathExists, readFile, readdir } from 'fs-extra';

const BUILTIN_SKILLS_DIR = join(__dirname, 'skills', 'defaults');

export interface SkillDefinition {
  name: string;
  content: string;
  tags: string[]; // 匹配关键词，如 ['deploy', 'aws', 'vercel']
}

async function scanSkillFiles(dir: string): Promise<{ name: string; content: string }[]> {
  if (!(await pathExists(dir))) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const skills: { name: string; content: string }[] = [];

  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    if (e.name.startsWith('_')) continue;

    const content = await readFile(join(dir, e.name), 'utf-8');
    skills.push({
      name: e.name.replace(/\.md$/, ''),
      content,
    });
  }

  return skills;
}

function parseSkillMeta(content: string): { tags: string[] } {
  const tags: string[] = [];

  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (frontmatterMatch) {
    const fm = frontmatterMatch[1];
    const tagsMatch = fm.match(/tags:\s*\n((\s+-\s+.+\n)+)/);
    if (tagsMatch) {
      for (const line of tagsMatch[1].matchAll(/-\s+(.+)/g)) {
        tags.push(line[1].trim().toLowerCase());
      }
    }
  }

  return { tags };
}

async function loadAllSkills(projectRoot: string): Promise<SkillDefinition[]> {
  const userSkillsDir = join(projectRoot, '.speccore', 'SKILLS');
  const skillMap = new Map<string, SkillDefinition>();

  const builtinFiles = await scanSkillFiles(BUILTIN_SKILLS_DIR);
  for (const f of builtinFiles) {
    const meta = parseSkillMeta(f.content);
    skillMap.set(f.name, { name: f.name, content: f.content, tags: meta.tags });
  }

  const userFiles = await scanSkillFiles(userSkillsDir);
  for (const f of userFiles) {
    const meta = parseSkillMeta(f.content);
    skillMap.set(f.name, { name: f.name, content: f.content, tags: meta.tags });
  }

  return Array.from(skillMap.values());
}

/**
 * 根据任务关键词匹配适用的技能
 */
export async function resolveSkillsForTask(
  taskKeywords: string[],
  projectRoot: string
): Promise<SkillDefinition[]> {
  const allSkills = await loadAllSkills(projectRoot);
  const keywords = taskKeywords.map(s => s.toLowerCase());

  const matched = allSkills.filter(skill => {
    return skill.tags.some(tag => keywords.some(kw => kw.includes(tag) || tag.includes(kw)));
  });

  return matched;
}

/**
 * 将匹配的技能合并为 prompt 字符串
 */
export function formatSkillsPrompt(skills: SkillDefinition[]): string {
  if (skills.length === 0) return '';

  const sections: string[] = [];
  sections.push('## 可复用技能参考');
  sections.push('');
  sections.push('> 以下技能指南供参考，按需应用。');
  sections.push('');

  for (const skill of skills) {
    let content = skill.content;
    content = content.replace(/^---\n[\s\S]*?\n---\n/, '');
    content = content.trim();

    sections.push(`### ${skill.name}`);
    sections.push('');
    sections.push(content);
    sections.push('');
  }

  return sections.join('\n');
}

export async function getBuiltinSkillContents(): Promise<{ name: string; content: string }[]> {
  return scanSkillFiles(BUILTIN_SKILLS_DIR);
}
