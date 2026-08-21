/**
 * Execute 命令 — RULES 编码规范注入插件
 * v6.93.0: 从 prompt-builder.ts 解耦
 */
import { resolveRulesForTechStack, formatRulesPrompt } from '../rule-loader';
import type { PromptPlugin, PromptContext, PromptEnhancement } from './types';

export const executeRulesPlugin: PromptPlugin = {
  name: 'execute-rules',
  commands: ['execute'],
  priority: 80,
  async enhance(ctx: PromptContext): Promise<PromptEnhancement> {
    const identifiers: string[] = [];
    if (ctx.techStack?.language) identifiers.push(ctx.techStack.language.toLowerCase());
    if (ctx.techStack?.framework) identifiers.push(ctx.techStack.framework.toLowerCase());
    if (ctx.techStack?.database) identifiers.push(ctx.techStack.database.toLowerCase());
    if (ctx.techStack?.frontend) identifiers.push(ctx.techStack.frontend.toLowerCase());
    if (ctx.techStack?.cache) identifiers.push(ctx.techStack.cache.toLowerCase());
    if (ctx.platform) identifiers.push(ctx.platform.toLowerCase());

    if (identifiers.length === 0) return {};

    try {
      const rules = await resolveRulesForTechStack(identifiers, ctx.cwd);
      if (rules.length > 0) {
        return { rulesContent: formatRulesPrompt(rules) };
      }
    } catch {
      // RULES 加载失败静默跳过
    }

    return {};
  },
};
