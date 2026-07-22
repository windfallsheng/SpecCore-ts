/**
 * unified-config — .speccore.yml 统一配置入口
 * 
 * 合并 SETTINGS.md / CONSTITUTION.md / TEAM.md 的配置到单一 YAML
 * 向后兼容：现有项目继续用旧文件，新项目自动用 .speccore.yml
 */
import { readFile, writeFile, pathExists } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';

export interface SpecConfig {
  project: {
    name: string;
    description?: string;
    version?: string;
  };
  tech_stack: {
    backend?: string;
    frontend?: string;
    database?: string;
    cache?: string;
    mq?: string;
  };
  team: {
    members: { name: string; role: string; assignee?: string }[];
  };
  platforms: string[];
  git: {
    default_base: string;
    branch_prefix: string;
  };
  code_scope: string[];
  conventions: {
    commit?: string;
    naming?: string;
    review?: string;
  };
  quality_gates: {
    enforce_testing: boolean;
    enforce_review: boolean;
    require_pr: boolean;
  };
}

const DEFAULT_CONFIG: SpecConfig = {
  project: { name: 'my-project' },
  tech_stack: {},
  team: { members: [] },
  platforms: [],
  git: { default_base: 'main', branch_prefix: 'feature/' },
  code_scope: ['src/'],
  conventions: {},
  quality_gates: { enforce_testing: true, enforce_review: true, require_pr: true },
};

const CONFIG_PATH = join('.speccore.yml');

export async function loadConfig(): Promise<SpecConfig> {
  if (await pathExists(CONFIG_PATH)) {
    try {
      const raw = await readFile(CONFIG_PATH, 'utf-8');
      return { ...DEFAULT_CONFIG, ...parseYaml(raw) };
    } catch (e) {
      logger.warn(`⚠️ .speccore.yml 解析失败，使用默认配置`);
    }
  }
  return DEFAULT_CONFIG;
}

export async function saveConfig(config: SpecConfig): Promise<void> {
  const yaml = toYaml(config);
  await writeFile(CONFIG_PATH, yaml, 'utf-8');
}

/**
 * 初始化时生成 .speccore.yml
 */
export async function initConfig(projectName?: string): Promise<void> {
  const config = { ...DEFAULT_CONFIG };
  if (projectName) config.project.name = projectName;
  await saveConfig(config);
  logger.info(`  📄 .speccore.yml 已生成`);
}

/**
 * 简易 YAML 解析器（只处理简单 key-value + list）
 */
function parseYaml(content: string): Partial<SpecConfig> {
  const result: any = {};
  const lines = content.split('\n');
  let currentSection: string | null = null;
  let currentList: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Top-level section
    if (!trimmed.startsWith('-') && trimmed.endsWith(':')) {
      currentSection = trimmed.slice(0, -1).trim();
      if (!result[currentSection]) result[currentSection] = {};
      currentList = null;
      continue;
    }

    // List item
    if (trimmed.startsWith('- ') && currentSection) {
      const value = trimmed.slice(2).trim();
      if (!Array.isArray(result[currentSection])) {
        result[currentSection] = [];
      }
      result[currentSection].push(value);
      currentList = currentSection;
      continue;
    }

    // Sub-section
    if (!trimmed.startsWith('-') && trimmed.endsWith(':') && currentSection) {
      const subSection = trimmed.slice(0, -1).trim();
      if (typeof result[currentSection] === 'object' && !Array.isArray(result[currentSection])) {
        result[currentSection][subSection] = result[currentSection][subSection] || {};
      }
      currentList = null;
      continue;
    }

    // Key: value
    if (trimmed.includes(':') && !trimmed.endsWith(':')) {
      const [key, ...rest] = trimmed.split(':');
      const value = rest.join(':').trim();
      if (currentSection && typeof result[currentSection] === 'object') {
        result[currentSection][key.trim()] = value;
      } else {
        result[key.trim()] = value;
      }
    }
  }

  return result;
}

function toYaml(config: SpecConfig): string {
  let yaml = '# SpecCore Configuration\n';
  yaml += `# ${new Date().toISOString().split('T')[0]}\n\n`;

  yaml += `project:\n  name: ${config.project.name}\n`;
  if (config.project.description) yaml += `  description: ${config.project.description}\n\n`;
  else yaml += '\n';

  yaml += 'tech_stack:\n';
  for (const [k, v] of Object.entries(config.tech_stack)) {
    if (v) yaml += `  ${k}: ${v}\n`;
  }
  yaml += '\n';

  yaml += 'team:\n  members:\n';
  for (const m of config.team.members) {
    yaml += `    - name: ${m.name}\n      role: ${m.role}\n`;
  }
  yaml += '\n';

  yaml += 'platforms:\n';
  for (const p of config.platforms) {
    yaml += `  - ${p}\n`;
  }
  yaml += '\n';

  yaml += `git:\n  default_base: ${config.git.default_base}\n  branch_prefix: ${config.git.branch_prefix}\n\n`;
  yaml += 'code_scope:\n';
  for (const s of config.code_scope) {
    yaml += `  - ${s}\n`;
  }
  yaml += '\n';

  yaml += 'quality_gates:\n';
  yaml += `  enforce_testing: ${config.quality_gates.enforce_testing}\n`;
  yaml += `  enforce_review: ${config.quality_gates.enforce_review}\n`;
  yaml += `  require_pr: ${config.quality_gates.require_pr}\n`;

  return yaml;
}
