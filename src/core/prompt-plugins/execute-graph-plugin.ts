/**
 * Execute 命令 — 代码图谱感知插件
 * v6.94.0: 为 execute 阶段注入相关代码节点上下文
 */
import { join } from 'path';
import { readFile, pathExists } from 'fs-extra';
import { loadCodeGraph } from '../code-graph';
import type { PromptPlugin, PromptContext, PromptEnhancement } from './types';

export const executeGraphPlugin: PromptPlugin = {
  name: 'execute-graph-awareness',
  commands: ['execute'],
  priority: 65,
  async enhance(ctx: PromptContext): Promise<PromptEnhancement> {
    try {
      const cg = await loadCodeGraph(ctx.cwd);
      if (!cg) return {};

      const taskName = ctx.task || '';
      const platform = ctx.platform || '';

      // 1. 提取任务关键词（camelCase / snake_case 拆分）
      const keywords = extractKeywords(taskName + ' ' + platform);

      // 2. 匹配相关节点
      const matchedNodes = cg.nodes
        .map(n => {
          let score = 0;
          const nameLower = n.name.toLowerCase();
          const fileLower = n.filePath.toLowerCase();
          for (const kw of keywords) {
            if (nameLower.includes(kw)) score += 3;
            if (fileLower.includes(kw)) score += 1;
          }
          // God node 加成
          if (cg.godNodes.includes(n.id)) score += 2;
          return { node: n, score };
        })
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 15);

      if (matchedNodes.length === 0) return {};

      // 3. 获取相关社区
      const communityIds = new Set(matchedNodes.map(m => m.node.community).filter(Boolean));
      const relatedCommunities = cg.communities
        .filter(c => communityIds.has(c.id))
        .slice(0, 5);

      // 4. 尝试加载需求↔代码关联
      let reqLinks: string[] = [];
      try {
        const linkPath = join(ctx.cwd, '.speccore', 'code-graph', 'REQ_CODE_LINK.json');
        if (await pathExists(linkPath)) {
          const raw = await readFile(linkPath, 'utf-8');
          const report = JSON.parse(raw);
          if (report.links) {
            for (const link of report.links) {
              const hasOverlap = link.linkedNodeIds.some((id: string) =>
                matchedNodes.some(m => m.node.id === id)
              );
              if (hasOverlap) {
                reqLinks.push(link.requirement);
              }
            }
          }
        }
      } catch { /* 忽略 */ }

      // 5. 构建注入文本
      const lines: string[] = [];
      lines.push('');
      lines.push('## 🗺️ 代码图谱上下文（相关节点）');
      lines.push('> 以下节点基于当前 Task 名称从代码知识图谱中智能匹配');
      lines.push('');

      if (relatedCommunities.length > 0) {
        lines.push('### 相关子系统');
        for (const comm of relatedCommunities) {
          lines.push(`- **${comm.label}** (${comm.nodes.length} 节点)`);
        }
        lines.push('');
      }

      lines.push('### 关键节点');
      for (const { node, score } of matchedNodes.slice(0, 10)) {
        const godMark = cg.godNodes.includes(node.id) ? ' ⭐' : '';
        lines.push(`- \`${node.name}\` (${node.type})${godMark} — ${node.filePath}:${node.line} (score=${score})`);
      }
      lines.push('');

      if (reqLinks.length > 0) {
        lines.push('### 关联需求');
        for (const req of reqLinks.slice(0, 5)) {
          lines.push(`- ${req}`);
        }
        lines.push('');
      }

      lines.push('> 提示：实现时请注意与上述节点的关系，避免重复定义或破坏已有接口契约。');

      return { instruction: lines.join('\n') };
    } catch {
      return {};
    }
  },
};

/** 从字符串提取关键词（支持 camelCase / snake_case 拆分） */
function extractKeywords(input: string): string[] {
  const set = new Set<string>();
  // camelCase / PascalCase 拆分
  const words = input
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length >= 2);
  for (const w of words) set.add(w);
  return [...set];
}
