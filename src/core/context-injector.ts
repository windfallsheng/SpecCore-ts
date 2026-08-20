/**
 * Context Injector — 统一注入框架
 *
 * v6.89.0+: 将 RULES / AGENTS / COMMANDS / SKILLS / HOOKS 的注入逻辑
 * 统一到一个入口，避免各命令文件重复实现。
 *
 * 使用方式：
 * ```ts
 * const injected = await injectAll(basePrompt, {
 *   projectRoot,
 *   command: 'execute',
 *   phase: 'code-gen',
 *   techStack: { language: 'typescript', framework: 'react' },
 *   agentContext: { iteration: 'Iteration-001' },
 * });
 * ```
 */

import { resolveRulesForTechStack, formatRulesPrompt } from './rule-loader';
import { resolveAgentsForPhase } from './agents';
import type { AgentContext } from './agents';
import { loadCommandTemplate, renderTemplate } from './command-loader';
import { resolveSkillsForTask, formatSkillsPrompt } from './skill-loader';
import { runHooks, type HookContext } from './hook-runner';

export interface InjectOptions {
  projectRoot: string;
  command?: string;
  phase?: string;
  agentContext?: AgentContext;
  techStack?: {
    language?: string;
    framework?: string;
    database?: string;
    cache?: string;
    frontend?: string;
  };
  platform?: string;
  taskKeywords?: string[];
  commandTemplate?: {
    name: string;
    vars: Record<string, string>;
  };
  hooks?: {
    trigger: 'pre' | 'post';
    hookContext: HookContext;
  };
}

/**
 * 统一注入入口：按需注入 RULES / AGENTS / COMMANDS / SKILLS / HOOKS
 */
export async function injectAll(prompt: string, options: InjectOptions): Promise<string> {
  let result = prompt;

  // 1. RULES 编码规范注入
  if (options.techStack) {
    const identifiers: string[] = [];
    if (options.techStack.language) identifiers.push(options.techStack.language.toLowerCase());
    if (options.techStack.framework) identifiers.push(options.techStack.framework.toLowerCase());
    if (options.techStack.database) identifiers.push(options.techStack.database.toLowerCase());
    if (options.techStack.frontend) identifiers.push(options.techStack.frontend.toLowerCase());
    if (options.techStack.cache) identifiers.push(options.techStack.cache.toLowerCase());
    if (options.platform) identifiers.push(options.platform.toLowerCase());

    if (identifiers.length > 0) {
      try {
        const rules = await resolveRulesForTechStack(identifiers, options.projectRoot);
        if (rules.length > 0) {
          result += '\n\n';
          result += formatRulesPrompt(rules);
        }
      } catch {
        // 静默跳过
      }
    }
  }

  // 2. AGENTS 角色注入
  if (options.command && options.phase && options.agentContext) {
    try {
      const agents = await resolveAgentsForPhase(options.command, options.phase, options.agentContext, options.projectRoot);
      if (agents.length > 0) {
        result += '\n\n## 专业角色指引\n\n';
        for (const ra of agents) {
          result += ra.definition.rolePrompt;
          result += '\n\n';
        }
      }
    } catch {
      // 静默跳过
    }
  }

  // 3. COMMANDS 命令模板注入
  if (options.commandTemplate) {
    try {
      const template = await loadCommandTemplate(options.commandTemplate.name, options.projectRoot);
      if (template) {
        result += '\n\n';
        result += renderTemplate(template.content, options.commandTemplate.vars);
      }
    } catch {
      // 静默跳过
    }
  }

  // 4. SKILLS 技能注入
  if (options.taskKeywords && options.taskKeywords.length > 0) {
    try {
      const skills = await resolveSkillsForTask(options.taskKeywords, options.projectRoot);
      if (skills.length > 0) {
        result += '\n\n';
        result += formatSkillsPrompt(skills);
      }
    } catch {
      // 静默跳过
    }
  }

  // 5. HOOKS 钩子执行（返回结果由调用方处理）
  // HOOKS 不修改 prompt，而是返回执行结果，所以不在此处处理
  // 调用方需要单独调用 runHooks

  return result;
}

/**
 * 简化版：只注入 AGENTS
 */
export async function injectAgents(
  prompt: string,
  command: string,
  phase: string,
  agentContext: AgentContext,
  projectRoot: string
): Promise<string> {
  return injectAll(prompt, { projectRoot, command, phase, agentContext });
}

/**
 * 简化版：只注入 RULES
 */
export async function injectRules(
  prompt: string,
  techStack: NonNullable<InjectOptions['techStack']>,
  projectRoot: string,
  platform?: string
): Promise<string> {
  return injectAll(prompt, { projectRoot, techStack, platform });
}

export { runHooks, type HookContext, type HookResult } from './hook-runner';
