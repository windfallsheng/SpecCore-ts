/**
 * HOOKS 生命周期钩子执行器
 *
 * 负责：
 * 1. 扫描 .speccore/HOOKS/ 目录下的钩子定义
 * 2. 在命令执行前后触发对应钩子
 * 3. 支持 pre-{command} 和 post-{command} 两种钩子
 *
 * v6.88.0+
 */

import { join } from 'path';
import { pathExists, readFile, readdir } from 'fs-extra';
import { logger } from '../utils/logger';

const BUILTIN_HOOKS_DIR = join(__dirname, 'hooks', 'defaults');

export interface HookDefinition {
  name: string;
  content: string;
  trigger: 'pre' | 'post';
  command: string;
}

async function scanHookFiles(dir: string): Promise<{ name: string; content: string }[]> {
  if (!(await pathExists(dir))) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const hooks: { name: string; content: string }[] = [];

  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    if (e.name.startsWith('_')) continue;

    const content = await readFile(join(dir, e.name), 'utf-8');
    hooks.push({
      name: e.name.replace(/\.md$/, ''),
      content,
    });
  }

  return hooks;
}

function parseHookMeta(name: string): { trigger: 'pre' | 'post'; command: string } {
  // 文件名格式：pre-execute.md 或 post-execute.md
  const match = name.match(/^(pre|post)-(.+)$/);
  if (match) {
    return { trigger: match[1] as 'pre' | 'post', command: match[2] };
  }
  return { trigger: 'pre', command: name };
}

async function loadAllHooks(projectRoot: string): Promise<HookDefinition[]> {
  const userHooksDir = join(projectRoot, '.speccore', 'HOOKS');
  const hooks: HookDefinition[] = [];

  const builtinFiles = await scanHookFiles(BUILTIN_HOOKS_DIR);
  for (const f of builtinFiles) {
    const meta = parseHookMeta(f.name);
    hooks.push({ name: f.name, content: f.content, trigger: meta.trigger, command: meta.command });
  }

  const userFiles = await scanHookFiles(userHooksDir);
  for (const f of userFiles) {
    const meta = parseHookMeta(f.name);
    // 用户自定义覆盖内置
    const idx = hooks.findIndex(h => h.trigger === meta.trigger && h.command === meta.command);
    if (idx >= 0) hooks[idx] = { name: f.name, content: f.content, trigger: meta.trigger, command: meta.command };
    else hooks.push({ name: f.name, content: f.content, trigger: meta.trigger, command: meta.command });
  }

  return hooks;
}

export interface HookContext {
  command: string;
  iteration?: string;
  task?: string;
  [key: string]: unknown;
}

export interface HookResult {
  blocked: boolean;
  reason?: string;
  messages: string[];
}

/**
 * 执行指定命令的钩子
 */
export async function runHooks(
  trigger: 'pre' | 'post',
  command: string,
  context: HookContext,
  projectRoot: string
): Promise<HookResult> {
  const allHooks = await loadAllHooks(projectRoot);
  const matched = allHooks.filter(h => h.trigger === trigger && h.command === command);

  const result: HookResult = { blocked: false, messages: [] };

  for (const hook of matched) {
    try {
      // 钩子执行：目前将钩子内容作为 prompt 输出给 AI
      // 未来可扩展为执行实际脚本
      result.messages.push(`[${trigger}-${command}] ${hook.name}`);
      // 简单解析：如果钩子内容中有 "BLOCK:" 标记，则拦截
      if (hook.content.includes('BLOCK:')) {
        const reasonMatch = hook.content.match(/BLOCK:\s*(.+)/);
        result.blocked = true;
        result.reason = reasonMatch ? reasonMatch[1] : 'Hook blocked';
      }
    } catch (e) {
      logger.warn(`钩子 ${hook.name} 执行失败: ${e}`);
    }
  }

  return result;
}

export async function getBuiltinHookContents(): Promise<{ name: string; content: string }[]> {
  return scanHookFiles(BUILTIN_HOOKS_DIR);
}
