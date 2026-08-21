/**
 * Prompt 插件系统 — 类型定义
 * v6.93.0: 将命令特定的 Prompt 增强逻辑从 prompt-builder.ts 解耦
 */

export type PromptCommand = 'execute' | 'analyze' | 'split' | 'plan';

/** Prompt 构建上下文 */
export interface PromptContext {
  cwd: string;
  command: PromptCommand;
  iteration?: string;
  task?: string;
  taskDir?: string;
  platform?: string;
  techStack?: {
    language?: string;
    framework?: string;
    database?: string;
    cache?: string;
    frontend?: string;
  };
}

/** Prompt 增强结果：只返回需要修改的字段 */
export interface PromptEnhancement {
  instruction?: string;
  rulesContent?: string;
  codeGraphSummary?: string;
  outputHint?: string;
  projectPaths?: string;
}

/** Prompt 插件接口 */
export interface PromptPlugin {
  /** 插件名称 */
  name: string;
  /** 支持的命令 */
  commands: PromptCommand[];
  /** 优先级：高优先级先执行（默认 50） */
  priority?: number;
  /** 增强 Prompt */
  enhance(ctx: PromptContext): Promise<PromptEnhancement>;
}

// ═══════════════════════════════════════════════════════════
// 插件注册表
// ═══════════════════════════════════════════════════════════

const registry: PromptPlugin[] = [];

/** 注册一个 Prompt 插件 */
export function registerPromptPlugin(plugin: PromptPlugin): void {
  registry.push(plugin);
  // 按优先级排序
  registry.sort((a, b) => (b.priority || 50) - (a.priority || 50));
}

/** 获取支持指定命令的插件 */
export function getPluginsForCommand(command: PromptCommand): PromptPlugin[] {
  return registry.filter(p => p.commands.includes(command));
}

/** 获取所有已注册的插件（调试用） */
export function getRegisteredPlugins(): PromptPlugin[] {
  return [...registry];
}
