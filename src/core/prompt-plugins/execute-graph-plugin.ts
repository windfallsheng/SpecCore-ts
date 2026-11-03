/**
 * Execute 命令 — 代码图谱感知插件
 * v8.3.356: 为 execute 阶段注入相关代码节点上下文（explainNode 影响面）
 * v8.3.357: 中文全拼映射 + 正向链路（REQ.md → REQ_CODE_LINK → 代码节点）
 *           + 公共依赖候选（跨社区桥接节点）+ god 任务相关性加权
 */
import { join } from 'path';
import { readFile, pathExists } from 'fs-extra';
import { pinyin } from 'pinyin-pro';
import { loadCodeGraph, explainNode } from '../code-graph';
import type { CodeGraph } from '../code-graph';
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

      // 1. 提取任务关键词（camelCase / snake_case 拆分 + 中文全拼映射）
      const keywords = extractKeywords(taskName + ' ' + platform);

      // 2. Task 需求文本（正向链路输入，v8.3.357+）
      // 读任务目录的 REQ.md 需求要点，让「需求语言」直接驱动代码节点检索——
      // 任务名匹配落空时需求文本仍能兜底，图谱上下文不再整体缺席
      let reqKeywords: string[] = [];
      if (ctx.taskDir) {
        try {
          const reqPath = join(ctx.taskDir, '00-specs', 'REQ.md');
          if (await pathExists(reqPath)) {
            const reqText = await readFile(reqPath, 'utf-8');
            // 标题 + 前 40 行（需求要点集中区）
            reqKeywords = extractKeywords(reqText.split('\n').slice(0, 40).join(' '));
          }
        } catch { /* REQ.md 缺失不阻断 */ }
      }
      const allKeywords = [...new Set([...keywords, ...reqKeywords])];

      // 3. 加载需求↔代码联动（双向消费：正向 需求→节点 / 反向 节点→需求）
      let links: any[] = [];
      try {
        const linkPath = join(ctx.cwd, '.speccore', 'code-graph', 'REQ_CODE_LINK.json');
        if (await pathExists(linkPath)) {
          const raw = await readFile(linkPath, 'utf-8');
          links = JSON.parse(raw).links || [];
        }
      } catch { /* 忽略 */ }

      // 3.5 正向链路（v8.3.357+）：需求关键词 → 需求标题 → 关联代码节点
      const forwardNodeIds = new Set<string>();
      if (reqKeywords.length > 0) {
        for (const link of links) {
          const reqTitle = String(link.requirement || '').toLowerCase();
          if (reqKeywords.some(kw => reqTitle.includes(kw))) {
            for (const id of link.linkedNodeIds) forwardNodeIds.add(String(id));
          }
        }
      }

      // 4. 匹配相关节点
      const matchedNodes = cg.nodes
        .map(n => {
          let score = 0;
          const nameLower = n.name.toLowerCase();
          const fileLower = n.filePath.toLowerCase();
          for (const kw of allKeywords) {
            if (nameLower.includes(kw)) score += 3;
            if (fileLower.includes(kw)) score += 1;
          }
          // God node 任务相关性加权（v8.3.357+）：仅命中关键词时加成——
          // 全局中心性不再无条件加分（全局的「大」≠当前任务的「相关」）
          if (cg.godNodes.includes(n.id) && score > 0) score += 2;
          // 正向链路命中：需求文本直接关联到的代码节点
          if (forwardNodeIds.has(n.id)) score += 4;
          return { node: n, score };
        })
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 15);

      if (matchedNodes.length === 0) return {};

      // 5. 获取相关社区
      const communityIds = new Set(matchedNodes.map(m => m.node.community).filter(Boolean));
      const relatedCommunities = cg.communities
        .filter(c => communityIds.has(c.id))
        .slice(0, 5);

      // 6. 反向联动（v8.3.356 既有）：匹配节点 → 关联需求标题
      const reqLinks: string[] = [];
      for (const link of links) {
        const hasOverlap = link.linkedNodeIds.some((id: string) =>
          matchedNodes.some(m => m.node.id === id)
        );
        if (hasOverlap) reqLinks.push(link.requirement);
      }

      // 7. 公共依赖候选（v8.3.357+）：跨社区桥接节点 = 天然公共设施
      const publicNodes = collectPublicCandidates(cg, communityIds);

      // 8. 构建注入文本
      const lines: string[] = [];
      lines.push('');
      lines.push('## 🗺️ 代码图谱上下文（相关节点）');
      lines.push('> 以下节点基于当前 Task 名称与需求文本从代码知识图谱中智能匹配');
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

      if (publicNodes.length > 0) {
        lines.push('### 公共依赖候选（跨社区桥接）');
        lines.push(`- ${publicNodes.map(n => `\`${n.name}\` (${n.type}, 桥接度 ${n.bridgeDegree})`).join(', ')}`);
        lines.push('> 这些节点被多个子系统共用，实现时优先复用而非重写。');
        lines.push('');
      }

      // v8.3.356+: 影响面查询（查询引擎 explainNode 从零接入）——
      // 展示最高分节点的直接邻接，让实现 AI 知道改动会波及哪些既有符号
      try {
        const top = matchedNodes[0].node;
        const neighborhood = explainNode(cg, top.id);
        const neighborNames = [...new Set(
          neighborhood.edges.map(e => (e.source === top.id ? e.target : e.source))
        )]
          .map(id => cg.nodes.find(n => n.id === id))
          .filter(Boolean)
          .map(n => n!.name)
          .slice(0, 8);
        if (neighborNames.length > 0) {
          lines.push('### 影响面（直接邻接）');
          lines.push(`- \`${top.name}\` 直接关联: ${neighborNames.map(n => `\`${n}\``).join(', ')}`);
          lines.push('');
        }
      } catch { /* 查询失败不阻断 */ }

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

/** 从字符串提取关键词（camelCase/snake_case 拆分 + v8.3.357+ 中文全拼映射） */
export function extractKeywords(input: string): string[] {
  const set = new Set<string>();
  // camelCase / PascalCase 拆分
  const words = input
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length >= 2);
  for (const w of words) set.add(w);

  // v8.3.357+: 中文语义 → 全拼映射（与功能单元命名规则同源：中文标题转全拼）
  // 中文任务名/需求文本（「站内信通知」）与英文/拼音节点名（inboxNotification）字面断裂，
  // 全拼连写命中拼音 slug，逐字拼音命中零散拼音命名，中文原词命中中文命名节点。
  const hanSegments = input.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  for (const seg of hanSegments) {
    set.add(seg.toLowerCase()); // 中文原词
    try {
      const pys = pinyin(seg, { toneType: 'none', type: 'array' }) as string[];
      set.add(pys.join('')); // 全拼连写
      for (const py of pys) if (py.length >= 2) set.add(py); // 逐字拼音
    } catch { /* pinyin 失败跳过 */ }
  }
  return [...set];
}

/** 收集公共依赖候选（v8.3.357+）：跨社区桥接节点，优先与任务相关社区相连 */
function collectPublicCandidates(
  cg: CodeGraph,
  relatedCommunityIds: Set<number | undefined>
): { name: string; type: string; bridgeDegree: number }[] {
  const idToNode = new Map(cg.nodes.map(n => [n.id, n]));
  const bridgeScores = new Map<string, number>();
  for (const e of cg.edges) {
    const s = idToNode.get(e.source);
    const t = idToNode.get(e.target);
    if (!s || !t || s.community === undefined || t.community === undefined) continue;
    if (s.community === t.community) continue;
    bridgeScores.set(s.id, (bridgeScores.get(s.id) || 0) + 1);
    bridgeScores.set(t.id, (bridgeScores.get(t.id) || 0) + 1);
  }
  const candidates: { name: string; type: string; community: number; bridgeDegree: number }[] = [];
  for (const [id, degree] of [...bridgeScores.entries()].sort((a, b) => b[1] - a[1])) {
    const n = idToNode.get(id);
    if (!n || n.community === undefined) continue;
    candidates.push({ name: n.name, type: n.type, community: n.community, bridgeDegree: degree });
  }
  // 优先与任务相关社区相连的桥接节点（做这个任务可能要碰的公共设施）
  const related = candidates.filter(c =>
    relatedCommunityIds.size > 0 && relatedCommunityIds.has(c.community)
  );
  const rest = candidates.filter(c => !related.includes(c));
  return [...related, ...rest].slice(0, 5).map(({ name, type, bridgeDegree }) => ({ name, type, bridgeDegree }));
}
