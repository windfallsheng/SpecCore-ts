/**
 * stage-aliases — 流水线阶段别名表（语法糖单一事实源）
 *
 * v8.3.290+: run 范围语法（run split to smoke / run split..smoke）、
 * 智能续跑面板与 help 文案共用本表。别名只做「语义 → 规范阶段」映射，
 * 不做任何逻辑判定——消费方统一走 resolveStageToken / parseRunRange。
 *
 * 书写纪律：
 *  1. 一个别名只映射一个规范阶段；一个规范阶段可有多个别名（validate 暂未设别名）；
 *  2. 别名不得与规范阶段名重复（启动自检 validateStageAliases 兜底）；
 *  3. 新增别名须同步 spec-run SKILL 剧本与 run --help 展示。
 */

// 规范阶段 key（与 run.ts PIPELINE_PHASES 顺序一致）
export const PIPELINE_STAGE_KEYS = [
  'req-doc', 'doc2spec', 'split-units', 'analyze', 'validate',
  'taskify', 'plan', 'execute', 'verify', 'pipeline', 'pr', 'done', 'spec2doc',
] as const;

// 语义别名 → 规范阶段名
export const STAGE_ALIASES: Record<string, string> = {
  // 需求入口
  req: 'req-doc',
  import: 'doc2spec',
  // 结构化
  split: 'split-units',
  // 主流程
  tasks: 'taskify',
  code: 'execute',
  smoke: 'verify',
  deploy: 'pipeline',
  // 收尾
  ship: 'pr',
  archive: 'done',
  docs: 'spec2doc',
};

/** 解析阶段 token：先试规范名，再试别名；都不命中返回 undefined */
export function resolveStageToken(token: string): string | undefined {
  const t = token.trim().toLowerCase();
  if ((PIPELINE_STAGE_KEYS as readonly string[]).includes(t)) return t;
  return STAGE_ALIASES[t];
}

/** 别名表展示（help / 报错提示共用），如 split→split-units, smoke→verify, ... */
export function formatStageAliases(): string {
  return Object.entries(STAGE_ALIASES).map(([a, s]) => `${a}→${s}`).join(', ');
}

export interface RunRange { from: string; to: string }

/**
 * 解析范围语法：
 *   run split to smoke      → 自然语言式（首 token 命中阶段/别名才解析）
 *   run split..smoke        → 紧凑式
 *   规范名混写均可（run split-units to verify）
 *
 * 返回约定：
 *   range 有值 → 范围解析成功；
 *   error 有值 → 用户明显想写范围但写错了（首 token 命中、末 token 不命中）→ 调用方报错，不静默降级；
 *   两者皆空 → 不是范围语法（如一句话需求 "fix login to support OTP" 首 token 非阶段）→ 调用方按需求处理。
 */
export function parseRunRange(text: string): { range?: RunRange; error?: string } {
  const trimmed = text.trim();
  // 紧凑式：A..B
  const dot = trimmed.match(/^(\S+)\.\.(\S+)$/);
  if (dot) {
    const f = resolveStageToken(dot[1]);
    const t = resolveStageToken(dot[2]);
    if (!f) return { error: `未知起始阶段 "${dot[1]}"，可用: ${formatStageAliases()}` };
    if (!t) return { error: `未知结束阶段 "${dot[2]}"，可用: ${formatStageAliases()}` };
    return { range: { from: f, to: t } };
  }
  // 自然语言式：A to B
  const to = trimmed.match(/^(\S+)\s+to\s+(\S+)$/i);
  if (to) {
    const f = resolveStageToken(to[1]);
    const t = resolveStageToken(to[2]);
    if (!f) return {}; // 首 token 非阶段 → 交回一句话需求
    if (!t) return { error: `未知结束阶段 "${to[2]}"，可用: ${formatStageAliases()}` };
    return { range: { from: f, to: t } };
  }
  return {};
}

/** 启动自检：别名不撞规范名、不指向未知阶段、阶段不被重复映射（防书写漂移） */
export function validateStageAliases(): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const [alias, stage] of Object.entries(STAGE_ALIASES)) {
    if ((PIPELINE_STAGE_KEYS as readonly string[]).includes(alias)) {
      problems.push(`别名 "${alias}" 与规范阶段名重复`);
    }
    if (!(PIPELINE_STAGE_KEYS as readonly string[]).includes(stage)) {
      problems.push(`别名 "${alias}" 指向未知阶段 "${stage}"`);
    }
    if (seen.has(stage)) {
      problems.push(`阶段 "${stage}" 被多个别名映射（${seen.get(stage)} 与 ${alias}）`);
    } else {
      seen.set(stage, alias);
    }
  }
  return problems;
}
