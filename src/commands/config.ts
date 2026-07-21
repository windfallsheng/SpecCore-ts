import { pathExists, readFile, writeFile, ensureDir } from 'fs-extra';
import { logger, Spinner } from '../utils/logger';

export interface ConfigOptions {
  get?: string;
  set?: string;
  reset?: boolean;
  rule?: string;
  tech?: string;
}

interface ConfigData {
  [key: string]: string | boolean | number;
}

const CONFIG_PATH = '.speccore/SETTINGS.md';

export async function configCommand(options: ConfigOptions): Promise<void> {
  const spinner = new Spinner('Processing configuration');
  spinner.start();

  try {
    // CONSTITUTION.md spec-rule 配置
    if (options.rule && options.set) {
      spinner.stop();
      await setSpecRule(options.rule, options.set);
      return;
    }

    // TECH_STACK.md 技术栈配置
    if (options.tech && options.set) {
      spinner.stop();
      await setTechStack(options.tech, options.set);
      return;
    }

    if (options.get) {
      const value = await getConfig(options.get);
      spinner.stop(`Config value: ${value}`);
      return;
    }

    if (options.set) {
      const [key, value] = options.set.split('=');
      if (!key || value === undefined) {
        spinner.fail('Invalid format. Use --set key=value');
        return;
      }
      await setConfig(key, value);
      spinner.stop(`Set ${key} = ${value}`);
      return;
    }

    if (options.reset) {
      await resetConfig();
      spinner.stop('Configuration reset to defaults');
      return;
    }

    // Show all config
    const config = await loadConfig();
    spinner.stop('Current configuration');
    console.log(config);
  } catch (error) {
    spinner.fail(`Config operation failed: ${error}`);
    throw error;
  }
}

async function loadConfig(): Promise<ConfigData> {
  if (!(await pathExists(CONFIG_PATH))) {
    return {};
  }

  const content = await readFile(CONFIG_PATH, 'utf-8');
  const config: ConfigData = {};
  
  // Parse markdown table
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/\|\s*(\S+)\s*\|\s*(\S+)\s*\|\s*(\S+)\s*\|/);
    if (match && !match[1].includes('---') && !match[1].includes('配置项')) {
      const key = match[1].trim();
      const value = match[2].trim();
      config[key] = parseValue(value);
    }
  }

  return config;
}

function parseValue(value: string): string | boolean | number {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const num = parseFloat(value);
  if (!isNaN(num)) return num;
  return value;
}

async function getConfig(key: string): Promise<string> {
  const config = await loadConfig();
  return String(config[key] ?? 'Not set');
}

async function setConfig(key: string, value: string): Promise<void> {
  let content = '';
  if (await pathExists(CONFIG_PATH)) {
    content = await readFile(CONFIG_PATH, 'utf-8');
  } else {
    content = '# 框架配置\n\n## 功能开关\n| 配置项 | 值 | 说明 |\n| :--- | :--- | :--- |\n';
  }

  // Update or add the config line
  const lines = content.split('\n');
  const configLine = `| ${key} | ${value} | |`;
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`| ${key} `)) {
      lines[i] = configLine;
      found = true;
      break;
    }
  }

  if (!found) {
    lines.push(configLine);
  }

  await ensureDir('.speccore');
  await writeFile(CONFIG_PATH, lines.join('\n'));
}

async function resetConfig(): Promise<void> {
  const defaultConfig = `# 框架配置

## 功能开关
| 配置项 | 值 | 说明 |
| :--- | :--- | :--- |
| assignee.enabled | true | 是否启用执行人追踪 |
| assignee.mode | loose | 执行人追踪强制程度 |
`;

  await ensureDir('.speccore');
  await writeFile(CONFIG_PATH, defaultConfig);
}

// ============================================================
// CONSTITUTION.md spec-rule 写入
// ============================================================
const CONSTITUTION_PATH = '.speccore/CONSTITUTION.md';

async function setSpecRule(ruleName: string, value: string): Promise<void> {
  if (!(await pathExists(CONSTITUTION_PATH))) {
    logger.error('CONSTITUTION.md 不存在，请先运行 speccore init');
    return;
  }

  let content = await readFile(CONSTITUTION_PATH, 'utf-8');
  // 标准化口语描述
  const normalized = normalizeRuleValue(ruleName, value);
  const ruleBlock = `<!-- spec-rule: ${ruleName} -->\n- ${normalized}\n<!-- /spec-rule -->`;

  // 查找已有 spec-rule 区块并更新
  const ruleRegex = new RegExp(`<!--\\s*spec-rule:\\s*${ruleName}\\s*-->[\\s\\S]*?<!--\\s*/spec-rule\\s*-->`, 'i');
  if (ruleRegex.test(content)) {
    content = content.replace(ruleRegex, ruleBlock);
    logger.info(`已更新 spec-rule: ${ruleName}`);
  } else {
    // 找到 ## 代码规范 章节并追加
    if (content.includes('## 代码规范')) {
      content = content.replace(/(## 代码规范[^\n]*\n)/, `$1${ruleBlock}\n`);
    } else {
      // 追加到文件末尾
      content += `\n\n## 代码规范\n\n${ruleBlock}\n`;
    }
    logger.info(`已新增 spec-rule: ${ruleName}`);
  }

  await writeFile(CONSTITUTION_PATH, content);
  logger.info(`  规则: ${ruleName} → "${normalized}"`);
  logger.info('  💡 下次 speccore execute 将自动应用此规则');
}

function normalizeRuleValue(ruleName: string, value: string): string {
  // 去掉语气词 + 口语前缀
  let v = value.replace(/[了啦啊呢嗯哈哦]$/, '').trim();
  v = v.replace(/^(改成|换成?|用|用的是|统一用|使用)\s*/i, '').trim();

  switch (ruleName) {
    case 'exception-handler':
      return `统一异常: ${v}`;
    case 'response-format':
      return `统一返回: ${v}`;
    case 'orm':
      return `ORM 框架: ${v}`;
    case 'naming':
      return v;
    case 'validation':
      return `参数校验: ${v}`;
    default:
      return v;
  }
}

// ============================================================
// TECH_STACK.md 技术栈写入
// ============================================================
const TECH_STACK_PATH = '.speccore/GLOBAL/TECH_STACK.md';

async function setTechStack(target: string, value: string): Promise<void> {
  if (!(await pathExists(TECH_STACK_PATH))) {
    logger.error('TECH_STACK.md 不存在，请先运行 speccore init');
    return;
  }

  let content = await readFile(TECH_STACK_PATH, 'utf-8');
  const tag = `tech-stack: ${target}`;
  const entry = `<!-- ${tag} -->\n- ${value}\n<!-- /tech-stack -->`;
  const regex = new RegExp(`<!--\\s*${tag}\\s*-->[\\s\\S]*?<!--\\s*/tech-stack\\s*-->`, 'i');

  if (regex.test(content)) {
    content = content.replace(regex, entry);
    logger.info(`已更新技术栈: ${target}`);
  } else {
    logger.warn(`未找到 tech-stack: ${target} 区块，请在 TECH_STACK.md 中手动添加`);
  }

  await writeFile(TECH_STACK_PATH, content);
  logger.info(`  ${target}: ${value}`);
  logger.info('  💡 下次 speccore execute 将显示此技术栈');
}
