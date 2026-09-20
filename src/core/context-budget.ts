/**
 * context-budget.ts — 统一内容分级 + 预算（单一事实源）
 *
 * 目的：收敛「给 AI 组装上下文时，什么内容优先、各占多少预算」这一散点逻辑。
 * 此前 prompt-builder（P0-P3）、unit-context-assembler（核心/关联/全局）、
 * content-delivery（L0-L3）、analyze-context-guard（LEVEL 阈值）各自维护一套
 * 分级/预算，改了这层没同步那层，反复出现「两层矛盾」——
 * 例如需求文档一层说不截断、另一层却按低优先级砍掉。
 *
 * 本模块是唯一入口：所有上下文组装处都引用这里的分级标准与预算常量。
 * 以后调整「什么内容优先 / 各占多少预算」只改这一处。
 *
 * v8.3.194+ 落地，替代 prompt-builder 本地的 isSpecContent / getPriority。
 */

/** 内容优先级：0=需求/Spec（不裁剪） 1=代码卡片/源码 2=知识图谱/任务链 3=其他 */
export type ContentPriority = 0 | 1 | 2 | 3;

/** 每档预算（字符数）。P0 需求/Spec 不裁剪（已在上游限流）。 */
export const TIER_BUDGETS = {
  P0: Infinity, // 需求/Spec：无条件完整保留
  P1: 10000,    // 代码卡片 / 关联源码 / 前端结构 / INFO_GAP
  P2: 5000,     // 知识图谱 / 任务关联链
  P3: 3000,     // 其他（一致性检查 / 可选清单 / 工程路径）
} as const;

/**
 * 判断内容是否属于「需求/Spec」内容（最高优先级 P0，不裁剪）。
 * 依据 name 判断（前缀 + 关键词）。
 * 覆盖：需求/规格/数据库设计/技术方案/开发指南/分析/契约/任务上下文/
 *       统一检索文档块(📄)/阅读清单(📚)/用户补充。
 */
export function isSpecContent(name: string): boolean {
  const n = name;
  // 统一检索文档块 / 阅读清单 / 用户补充文档
  if (n.startsWith('📄') || n.startsWith('📚')) return true;
  if (n.includes('用户补充')) return true;
  const nn = n.toLowerCase();
  const keywords = [
    '需求', '规格', 'requirement', 'req.md', 'schema',
    '数据库', '数据模型', 'tech', '技术', 'design', '设计',
    '契约', 'api_contract', '开发指南', 'dev_guide', 'analysis', '分析',
    'constitution', '已知问题', '任务上下文', '子任务', 'context.md',
  ];
  for (const k of keywords) {
    if (nn.includes(k)) return true;
  }
  return false;
}

/**
 * 统一内容分级（唯一实现，替代各处散落的 getPriority）。
 *   P0 需求/Spec → P1 代码卡片/源码/前端结构/INFO_GAP → P2 知识图谱/任务链 → P3 其他
 */
export function classifyContent(name: string): ContentPriority {
  const n = name;
  if (isSpecContent(n)) return 0;
  if (n.includes('结构化代码事实') || n.includes('INFO_GAP') || n.includes('关联源码')
    || n.startsWith('🔍') || n.startsWith('💻')
    || n.includes('组件树') || n.includes('路由') || n.includes('状态管理')) return 1;
  if (n.includes('知识图谱') || n.includes('任务关联上下文') || n.includes('任务关联链')) return 2;
  return 3;
}

/** 可被统一预算裁剪的内容项（与 TaskExtraSpec 结构兼容） */
export interface BudgetItem {
  name: string;
  path: string;
  content: string;
}

/** 预算裁剪结果 */
export interface BudgetResult {
  kept: BudgetItem[];
  used: { p0: number; p1: number; p2: number; p3: number };
}

/**
 * 统一的按分级 + 预算裁剪。
 * 先按优先级排序，再逐档预算裁剪：P0 无条件保留，P1/P2/P3 超预算时截断或丢弃。
 * 预算可通过 opts 覆盖（默认取 TIER_BUDGETS）。
 */
export function applyTierBudget(
  items: BudgetItem[],
  opts?: { budgetP1?: number; budgetP2?: number; budgetP3?: number },
): BudgetResult {
  const B1 = opts?.budgetP1 ?? TIER_BUDGETS.P1;
  const B2 = opts?.budgetP2 ?? TIER_BUDGETS.P2;
  const B3 = opts?.budgetP3 ?? TIER_BUDGETS.P3;

  const sorted = [...items].sort((a, b) => classifyContent(a.name) - classifyContent(b.name));
  const kept: BudgetItem[] = [];
  const used = { p0: 0, p1: 0, p2: 0, p3: 0 };

  for (const item of sorted) {
    const p = classifyContent(item.name);
    const len = item.content.length;
    let keep = true;
    let content = item.content;

    if (p === 0) {
      used.p0 += len; // 需求/Spec 无条件完整保留
    } else if (p === 1) {
      if (used.p1 + len > B1) {
        const remain = Math.max(0, B1 - used.p1);
        if (remain < 200) keep = false;
        else content = content.slice(0, remain) + '\n> ... (P1预算截断)';
      }
      if (keep) used.p1 += content.length;
    } else if (p === 2) {
      if (used.p2 + len > B2) {
        const remain = Math.max(0, B2 - used.p2);
        if (remain < 200) keep = false;
        else content = content.slice(0, remain) + '\n> ... (P2预算截断)';
      }
      if (keep) used.p2 += content.length;
    } else {
      if (used.p3 + len > B3) {
        const remain = Math.max(0, B3 - used.p3);
        if (remain < 200) keep = false;
        else content = content.slice(0, remain) + '\n> ... (P3预算截断)';
      }
      if (keep) used.p3 += content.length;
    }

    if (keep) kept.push({ ...item, content });
  }

  return { kept, used };
}
