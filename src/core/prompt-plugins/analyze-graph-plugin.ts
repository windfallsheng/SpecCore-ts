/**
 * Analyze 命令 — 代码知识图谱摘要注入插件
 * v6.93.0: 从 prompt-builder.ts 解耦
 */
import { loadCodeGraph } from '../code-graph';
import type { PromptPlugin, PromptContext, PromptEnhancement } from './types';

export const analyzeGraphPlugin: PromptPlugin = {
  name: 'analyze-graph',
  commands: ['analyze'],
  priority: 70,
  async enhance(ctx: PromptContext): Promise<PromptEnhancement> {
    try {
      const cg = await loadCodeGraph(ctx.cwd);
      if (!cg) return {};

      const lines: string[] = [];
      lines.push('## 📊 代码知识图谱摘要');
      lines.push(`> 基于本地 AST 解析（${cg.metadata.scannedFiles} 文件, ${cg.metadata.totalNodes} 节点, ${cg.metadata.totalEdges} 边）`);
      lines.push('');
      lines.push('### 子系统（自动检测）');
      for (const comm of cg.communities.slice(0, 8)) {
        const sample = comm.nodes
          .map(id => cg.nodes.find(n => n.id === id))
          .filter(Boolean)
          .slice(0, 5)
          .map(n => n!.name);
        lines.push(`- **${comm.label}** (${comm.nodes.length} 节点, 密度 ${(comm.density * 100).toFixed(0)}%): ${sample.join(', ')}`);
      }
      lines.push('');
      lines.push('### 核心节点（God Nodes）');
      for (const id of cg.godNodes.slice(0, 10)) {
        const n = cg.nodes.find(node => node.id === id);
        if (n) lines.push(`- ${n.name} (${n.type}, degree=${n.degree})`);
      }
      lines.push('');
      lines.push('> 提示：如需深入查看完整图谱，运行 `speccore code-index --graph` 后打开 `.speccore/code-graph/graph.html`');

      return { codeGraphSummary: lines.join('\n') };
    } catch {
      // 图谱不存在时静默跳过
      return {};
    }
  },
};
