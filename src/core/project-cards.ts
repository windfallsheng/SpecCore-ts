/**
 * 项目名片（Project Cards）— 模糊端名 → 项目信息映射
 *
 * 用户自然语言里提到某个端（端名/业务名/中文描述/类型词「前端」「后端」等）时，
 * 按需解析出对应工程，并把源码路径/Git 仓库等「名片」信息注入给 AI。
 * 设计原则：
 *  - 按需：用户没提项目就完全不注入；
 *  - 克制：每端一张小名片（1-2 行），多端命中也不膨胀；
 *  - 确定性：纯词典/正则匹配，不依赖 LLM（意图识别的 LLM 兜底是占位符）。
 */
import { PlatformConfig } from './unified-config';

/** 类型词 → 命中该类型下全部端（「前端」「后端」这类笼统称呼） */
const TYPE_KEYWORDS: Record<string, string[]> = {
  frontend: ['前端', '前台', 'web端', 'web 端', '网页端', '界面端', '客户端'],
  backend: ['后端', '服务端', '后台服务', '接口端'],
  infra: ['基础设施', 'infra'],
};

/** 命中置信度：exact=端名/业务名全量/类型词/3字段完整；partial=滑窗 2 字部分提及（疑似） */
export type MatchConfidence = 'exact' | 'partial';

export interface ProjectCard {
  /** 端名/工程标识（如 booking-service） */
  name: string;
  /** 工程类型 */
  type: 'frontend' | 'backend' | 'infra';
  /** 业务名（description 或 project_name，如「预订服务」） */
  businessName?: string;
  /** 源码路径（相对项目根，如 ./backend/booking-service） */
  codePath?: string;
  /** Git 仓库地址 */
  gitRepo?: string;
  /** 默认分支 */
  defaultBranch?: string;
  /** 命中置信度（仅匹配结果携带；速查区/全量表不参与） */
  confidence?: MatchConfidence;
}

function toCard(p: PlatformConfig): ProjectCard {
  return {
    name: p.name,
    type: p.type,
    businessName: p.project_name || p.description,
    codePath: p.code_path,
    gitRepo: p.git_repo,
    defaultBranch: p.default_branch,
  };
}

/**
 * 端名词边界匹配。
 * - 全名：「h5-mobile」命中；
 * - 连字符/下划线/点分段：「H5端」「H5」命中 h5-mobile（取 h5 段）；
 * - 词边界保证 app 不会误中 application。
 */
function nameHit(text: string, name: string): boolean {
  if (!name || name.length < 2) return false;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`, 'i').test(text)) return true;
  // 带分隔符的复合名（h5-mobile / admin_web / api.service）→ 各段（长度≥2）均可命中
  const segs = name.split(/[-_.]+/);
  if (segs.length > 1) {
    for (const seg of segs) {
      if (seg.length < 2) continue;
      const segEsc = seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^|[^a-z0-9])${segEsc}($|[^a-z0-9])`, 'i').test(text)) return true;
    }
  }
  return false;
}

/** 归一化：小写 + 去空白/连字符/下划线（「h5 移动端」「H5-移动端」→「h5移动端」） */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s\-_]+/g, '');
}

/** 提取中文连续段（去英文/数字/符号后的中文字串列表） */
function chineseSegments(text: string): string[] {
  return text.match(/[\u4e00-\u9fa5]+/g) || [];
}

/**
 * 业务名/描述模糊命中，返回置信度：
 * - 'exact'：归一化全量包含（大小写/空格/连字符容差）或 3 字段完整出现；
 * - 'partial'：≥4 字中文段滑窗——提到任意连续 2 字即视为「疑似提及」
 *    （「预订」→「预订服务」、「后台」→「管理后台」）；
 * - null：<3 字段不参与（防「移动」等泛词误命中）。
 */
function fuzzyLabelHit(text: string, label: string): MatchConfidence | null {
  if (!label || label.length < 2) return null;
  const nt = normalize(text);
  const nl = normalize(label);
  if (!nl) return null;
  if (nt.includes(nl)) return 'exact';
  for (const seg of chineseSegments(label)) {
    if (seg.length === 3) {
      if (nt.includes(seg)) return 'exact';
    } else if (seg.length >= 4) {
      for (let i = 0; i + 2 <= seg.length; i++) {
        if (nt.includes(seg.slice(i, i + 2))) return 'partial';
      }
    }
  }
  return null;
}

/**
 * 从用户自然语言中解析命中的端（可多端并行命中），携带置信度：
 * - 端名包含（词边界 + 复合名分段）：「booking-service」「booking」「h5」→ exact
 * - 业务名模糊命中：「预订服务」「移动端」→ exact；「预订」「后台」（滑窗 2 字）→ partial（疑似）
 * - 类型词：「前端」→ 全部 frontend 端；「后端」→ 全部 backend 端 → exact
 * 返回保持 platforms 声明顺序；全无命中返回空数组。
 */
export function matchProjectsFromText(text: string, platforms: PlatformConfig[]): ProjectCard[] {
  if (!text || !platforms || platforms.length === 0) return [];
  const lower = text.toLowerCase();
  const hits: ProjectCard[] = [];
  for (const p of platforms) {
    const card = toCard(p);
    let conf: MatchConfidence | null = null;
    // 1. 端名（词边界，防短名误匹配）
    if (nameHit(lower, p.name)) conf = 'exact';
    // 2. 业务名/项目名（模糊：归一化包含 + 中文滑窗部分提及）
    if (!conf) {
      for (const label of [p.project_name, p.description]) {
        const c = label ? fuzzyLabelHit(text, label) : null;
        if (c) { conf = c; break; }
      }
    }
    // 3. 类型词
    if (!conf) {
      const aliases = TYPE_KEYWORDS[p.type] || [];
      if (aliases.some(kw => text.includes(kw))) conf = 'exact';
    }
    if (conf) hits.push({ ...card, confidence: conf });
  }
  return hits;
}

/** 名片单行（注入格式）：booking-service（预订服务 · backend）→ 源码 ./x · Git git@...（main） */
export function formatCardLine(card: ProjectCard): string {
  const parts: string[] = [];
  const label = card.businessName ? `${card.businessName} · ` : '';
  const partialTag = card.confidence === 'partial' ? ' · ⚠️疑似' : '';
  parts.push(`**${card.name}**（${label}${card.type}${partialTag}）`);
  if (card.codePath) parts.push(`源码 \`${card.codePath}\``);
  const git = card.gitRepo ? (card.defaultBranch ? `${card.gitRepo}（${card.defaultBranch}）` : card.gitRepo) : '';
  if (git) parts.push(`Git \`${git}\``);
  return `- ${parts.join(' → ')}`;
}

/**
 * 命中端名片的注入块（约 40 token/端）。未命中返回空串。
 * 用于 ask 意图块 / prompt 上下文——只注入被提到的那几端；
 * 滑窗「疑似」端做轻标注，引导 AI 按需核实 + 按需读全量表。
 */
export function formatProjectCardInjection(hits: ProjectCard[]): string {
  if (hits.length === 0) return '';
  const lines = ['## 📇 项目信息（按需注入）', ''];
  for (const h of hits) lines.push(formatCardLine(h));
  const hasPartial = hits.some(h => h.confidence === 'partial');
  if (hasPartial) {
    lines.push('',
      '> ⚠️ 带「疑似」标注的端为部分提及推断，请结合上下文核实；',
      '> 各端完整配置（分支策略/部署/备注）按需 Read `.speccore/GLOBAL/PROJECTS.md`（数据源 `.speccore/PROJECT.yaml` platforms 段）');
  } else {
    lines.push('',
      '> 以上为本次对话提到的端；完整配置（分支策略/部署/备注）按需 Read `.speccore/GLOBAL/PROJECTS.md`（数据源 `.speccore/PROJECT.yaml` platforms 段）');
  }
  return lines.join('\n');
}

/** AGENTS.md 速查区：每端一行映射（约 15-20 token/端，宿主 AI 常驻可见） */
export function buildQuickIndex(platforms: PlatformConfig[]): string {
  if (!platforms || platforms.length === 0) return '';
  const lines = ['## 项目速查', '',
    '> 用户提到某个端/项目名时，对应信息如下；详细信息 Read `.speccore/GLOBAL/PROJECTS.md`', '',
    '| 端名 | 业务名 | 源码路径 | Git 仓库 |', '| :--- | :--- | :--- | :--- |'];
  for (const p of platforms) {
    const card = toCard(p);
    lines.push(`| \`${card.name}\` | ${card.businessName || '-'} | \`${card.codePath || '-'}\` | ${card.gitRepo || '-'} |`);
  }
  return lines.join('\n');
}

/** 生成 .speccore/GLOBAL/PROJECTS.md（全量名片落盘，不占对话 token，AI 按需 Read） */
export async function writeGlobalProjectsDoc(cwd: string, platforms: PlatformConfig[]): Promise<string | null> {
  if (!platforms || platforms.length === 0) return null;
  const { ensureDir, writeFile } = await import('fs-extra');
  const path = await import('path');
  const globalDir = path.join(cwd, '.speccore', 'GLOBAL');
  await ensureDir(globalDir);
  const lines = ['# 项目名片（PROJECTS）', '',
    '> 本文件为各端工程的名片汇总，数据源 `.speccore/PROJECT.yaml` 的 `platforms` 段（机器事实源）。',
    '> AI 按需 Read：用户提到某个端时，从这里取源码路径/Git 配置，无需用户重复说明。', '',
    '| 端名 | 业务名 | 类型 | 源码路径 | Git 仓库 | 默认分支 |', '| :--- | :--- | :--- | :--- | :--- | :--- |'];
  for (const p of platforms) {
    const card = toCard(p);
    lines.push(`| \`${card.name}\` | ${card.businessName || '-'} | ${card.type} | \`${card.codePath || '-'}\` | ${card.gitRepo || '-'} | ${card.defaultBranch || '-'} |`);
  }
  const docPath = path.join(globalDir, 'PROJECTS.md');
  await writeFile(docPath, lines.join('\n') + '\n', 'utf-8');
  return docPath;
}
