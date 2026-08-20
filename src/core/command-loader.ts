/**
 * COMMANDS 命令模板加载器
 *
 * 负责：
 * 1. 扫描 .speccore/COMMANDS/ 目录下的命令模板文件
 * 2. 为 CLI 命令提供可配置的 prompt 模板
 * 3. 支持变量替换（如 {{iteration}}、{{task}}）
 *
 * v6.87.0+
 */

import { join } from 'path';
import { pathExists, readFile, readdir } from 'fs-extra';

const BUILTIN_COMMANDS_DIR = join(__dirname, 'commands', 'defaults');

export interface CommandTemplate {
  name: string;
  content: string;
}

async function scanCommandFiles(dir: string): Promise<{ name: string; content: string }[]> {
  if (!(await pathExists(dir))) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const commands: { name: string; content: string }[] = [];

  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    if (e.name.startsWith('_')) continue;

    const content = await readFile(join(dir, e.name), 'utf-8');
    commands.push({
      name: e.name.replace(/\.md$/, ''),
      content,
    });
  }

  return commands;
}

async function loadAllCommands(projectRoot: string): Promise<Map<string, CommandTemplate>> {
  const userCommandsDir = join(projectRoot, '.speccore', 'COMMANDS');
  const commandMap = new Map<string, CommandTemplate>();

  // 1. 加载内置默认
  const builtinFiles = await scanCommandFiles(BUILTIN_COMMANDS_DIR);
  for (const f of builtinFiles) {
    commandMap.set(f.name, { name: f.name, content: f.content });
  }

  // 2. 用户自定义覆盖
  const userFiles = await scanCommandFiles(userCommandsDir);
  for (const f of userFiles) {
    commandMap.set(f.name, { name: f.name, content: f.content });
  }

  return commandMap;
}

/**
 * 加载指定命令模板
 */
export async function loadCommandTemplate(
  name: string,
  projectRoot: string
): Promise<CommandTemplate | undefined> {
  const all = await loadAllCommands(projectRoot);
  return all.get(name);
}

/**
 * 简单变量替换
 * 支持 {{key}} 格式，从 vars 对象中取值
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value);
  }
  return result;
}

/**
 * 获取内置命令模板的原始内容（用于 init 时复制到项目）
 */
export async function getBuiltinCommandContents(): Promise<{ name: string; content: string }[]> {
  return scanCommandFiles(BUILTIN_COMMANDS_DIR);
}
