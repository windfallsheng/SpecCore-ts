/**
 * Split/Plan 命令 — AGENTS 角色注入插件
 * v6.93.0: 从 prompt-builder.ts 解耦
 */
import { resolveAgentsForPhase } from '../agents';
import type { AgentContext } from '../agents';
import type { PromptPlugin, PromptContext, PromptEnhancement } from './types';

export const agentsPlugin: PromptPlugin = {
  name: 'agents-injection',
  commands: ['split', 'plan'],
  priority: 60,
  async enhance(ctx: PromptContext): Promise<PromptEnhancement> {
    const agentContext: AgentContext = {
      iteration: ctx.iteration || '',
    };
    try {
      const agents = await resolveAgentsForPhase(ctx.command, 'default', agentContext, ctx.cwd);
      if (agents.length === 0) return {};

      let instruction = '\n\n## 专业角色指引\n\n';
      for (const ra of agents) {
        instruction += ra.definition.rolePrompt;
        instruction += '\n\n';
      }

      return { instruction };
    } catch {
      // AGENTS 加载失败静默跳过
      return {};
    }
  },
};
