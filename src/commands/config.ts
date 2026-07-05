import { pathExists, readFile, writeFile, ensureDir } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../utils/logger';

export interface ConfigOptions {
  get?: string;
  set?: string;
  reset?: boolean;
}

interface ConfigData {
  [key: string]: string | boolean | number;
}

const CONFIG_PATH = '.speccore/SETTINGS.md';

export async function configCommand(options: ConfigOptions): Promise<void> {
  const spinner = new Spinner('Processing configuration');
  spinner.start();

  try {
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
