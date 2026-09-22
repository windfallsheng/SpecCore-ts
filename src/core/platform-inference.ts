/**
 * platform-inference.ts — 功能单元端推断（六层机制）
 *
 * 六层递进（确定性 → 概率性）：
 *   Layer 1 显式声明   —— 需求文档中「涉及端」字段（置信度 1.0）
 *   Layer 2 _matrix 声明 —— 010-requirements/features/{feature}/_matrix.md（置信度 0.95）
 *   Layer 3 目录结构   —— 功能单元目录下的端子目录（置信度 0.9）
 *   Layer 4 关键词映射 —— 功能名/需求里的端关键词（置信度 0.75）
 *   Layer 5 宿主 AI   —— 前四层都无法确定时，生成判断 prompt（置信度 0.5）
 *   Layer 6 人工确认   —— 置信度 < 0.8 或端数 > 3 时，标记需确认
 *
 * 原则：优先确定性机制，AI 只作补充，人工确认兜底。确认后写入 _matrix.md 持久化。
 *
 * v8.3.185+
 */

import { join } from 'path';
import { pathExists, readFile, readdir } from 'fs-extra';
import * as yaml from 'js-yaml';

export type PlatformInferenceSource =
  | 'explicit'    // 显式声明
  | 'matrix'      // _matrix.md 声明
  | 'directory'   // 目录结构
  | 'keyword'     // 关键词
  | 'ai-required' // 需要 AI 判断
  | 'none';       // 无任何线索

export interface PlatformInferenceResult {
  platforms: string[];
  confidence: number;          // 0-1
  source: PlatformInferenceSource;
  uncertainties: string[];      // 不确定项（供 AI/人工关注）
  needsConfirm: boolean;        // 是否需要人工确认
  aiPrompt?: string;            // Layer5 时的 AI 判断 prompt
}

export interface InferFeaturePlatformsOptions {
  featureName: string;
  /** 功能单元目录（010-requirements/features/{feature}/），用于读 _matrix.md + 目录结构 */
  featureDir?: string;
  /** 需求文档内容（显式声明检测 + 关键词） */
  requirementContent?: string;
  /** CONSTITUTION 端列表（全部标准端名） */
  allPlatforms: string[];
}

const CONFIRM_CONFIDENCE = 0.8; // 置信度低于此值需人工确认
const CONFIRM_PLATFORM_COUNT = 3; // 端数超过此值需人工确认

export async function inferFeaturePlatforms(
  options: InferFeaturePlatformsOptions,
): Promise<PlatformInferenceResult> {
  const { featureName, featureDir, requirementContent, allPlatforms } = options;
  if (allPlatforms.length === 0) {
    return { platforms: [], confidence: 0, source: 'none', uncertainties: ['未配置端列表'], needsConfirm: true };
  }

  // ── Layer 1: 显式声明（需求文档「涉及端」字段）──
  const explicit = detectExplicitPlatforms(requirementContent, allPlatforms);
  if (explicit.length > 0) {
    return finalize(explicit, 1.0, 'explicit', []);
  }

  // ── Layer 2: _matrix.md 声明 ──
  if (featureDir) {
    const matrixPlatforms = await readMatrixPlatforms(featureDir);
    if (matrixPlatforms.length > 0) {
      // v8.3.224+: matrix 端名必须归一化到 CONSTITUTION 标准端名（旧数据可能写了 backend 等简写）
      const normalized = [...new Set(
        matrixPlatforms
          .map(p => normalizePlatformToken(p, allPlatforms))
          .filter((p): p is string => !!p),
      )];
      if (normalized.length > 0) {
        return finalize(normalized, 0.95, 'matrix', []);
      }
      // 全部非标准端名（如旧数据全标 backend）→ 不采信，继续下层推断
    }

    // ── Layer 3: 目录结构推断 ──
    const dirPlatforms = await detectDirectoryPlatforms(featureDir, allPlatforms);
    if (dirPlatforms.length > 0) {
      return finalize(dirPlatforms, 0.9, 'directory', []);
    }
  }

  // ── Layer 4: 关键词映射 ──
  const keywordPlatforms = inferPlatformsByKeywords(featureName, requirementContent || '', allPlatforms);
  if (keywordPlatforms.length > 0) {
    const uncertainties = [`关键词推断（置信度 0.75）: 匹配到「${featureName}」的端特征`];
    return finalize(keywordPlatforms, 0.75, 'keyword', uncertainties);
  }

  // ── Layer 5: 宿主 AI 判断 ──
  const aiPrompt = buildAiInferencePrompt(featureName, requirementContent || '', allPlatforms);
  return {
    platforms: [],
    confidence: 0.5,
    source: 'ai-required',
    uncertainties: ['前四层均无法确定，需宿主 AI 语义判断'],
    needsConfirm: true,
    aiPrompt,
  };
}

/** 统一收尾：置信度/端数判断 + needsConfirm */
function finalize(
  platforms: string[],
  confidence: number,
  source: PlatformInferenceSource,
  uncertainties: string[],
): PlatformInferenceResult {
  const needsConfirm = confidence < CONFIRM_CONFIDENCE || platforms.length > CONFIRM_PLATFORM_COUNT;
  return { platforms, confidence, source, uncertainties, needsConfirm };
}

// ── Layer 1: 显式声明 ──

function detectExplicitPlatforms(content: string | undefined, allPlatforms: string[]): string[] {
  if (!content) return [];
  // 匹配「涉及端：backend, h5-mobile」「涉及端: 后端、H5」等
  const m = content.match(/涉及端[:：]\s*([^\n|]+)/i);
  if (!m) return [];
  const raw = m[1].split(/[,，、;；\s]+/).map(s => s.trim()).filter(Boolean);
  const matched = new Set<string>();
  for (const token of raw) {
    const p = normalizePlatformToken(token, allPlatforms);
    if (p) matched.add(p);
  }
  return [...matched];
}

/** 把「后端/H5/admin」等简写规范化到标准端名 */
function normalizePlatformToken(token: string, allPlatforms: string[]): string | null {
  const t = token.toLowerCase();
  if (allPlatforms.includes(token)) return token;
  // 简写映射
  const aliasMap: Record<string, RegExp> = {
    backend: /后端|backend|服务端|server|api/i,
    'h5-mobile': /h5|移动端|mobile|手机/i,
    'admin-web': /admin|管理端|后台|web|pc|桌面/i,
    miniapp: /小程序|miniapp|mini|微信/i,
  };
  for (const p of allPlatforms) {
    const re = aliasMap[p] || new RegExp(`^${p}$`, 'i');
    if (re.test(t) || t === p.toLowerCase()) return p;
  }
  // 通用匹配：token 与某个端名相似
  for (const p of allPlatforms) {
    if (p.toLowerCase().includes(t) || t.includes(p.toLowerCase())) return p;
  }
  return null;
}

// ── Layer 2: _matrix.md ──

async function readMatrixPlatforms(featureDir: string): Promise<string[]> {
  const matrixPath = join(featureDir, '_matrix.md');
  if (!(await pathExists(matrixPath))) return [];
  try {
    const content = await readFile(matrixPath, 'utf-8');
    const yamlContent = content.replace(/^#.*\n+/, '');
    const data = yaml.load(yamlContent) as any;
    return Array.isArray(data?.platforms) ? data.platforms : [];
  } catch {
    return [];
  }
}

// ── Layer 3: 目录结构 ──

async function detectDirectoryPlatforms(featureDir: string, allPlatforms: string[]): Promise<string[]> {
  if (!(await pathExists(featureDir))) return [];
  try {
    const entries = await readdir(featureDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    return allPlatforms.filter(p => dirs.includes(p));
  } catch {
    return [];
  }
}

// ── Layer 4: 关键词映射（从 split.ts 抽离，统一维护）──

function inferPlatformsByKeywords(featureName: string, requirementContent: string, allPlatforms: string[]): string[] {
  const text = `${featureName} ${requirementContent}`.toLowerCase();

  const backendPlatforms = allPlatforms.filter(p => /service|api|backend|server|core/i.test(p));
  const adminPlatforms = allPlatforms.filter(p => /admin|web|pc|manage|dashboard|portal/i.test(p) && !/mobile|h5|mini|app/i.test(p));
  const mobilePlatforms = allPlatforms.filter(p => /h5|mobile|app|mini|ios|android|wechat/i.test(p));

  const keywordMap: { keywords: string[]; platforms: string[] }[] = [
    { keywords: ['接口', 'api', '服务', 'service', '数据表', 'entity', '数据库', 'db', '迁移', 'migration', '脚本', 'job', '定时', 'cron', '缓存', 'cache', '队列', 'queue'], platforms: backendPlatforms },
    { keywords: ['报表', '统计', '管理', '配置', '审核', '审批', '后台', 'admin', 'dashboard', '运营', '数据看板', '权限分配', '角色管理'], platforms: [...backendPlatforms, ...adminPlatforms] },
    { keywords: ['扫码', '定位', '地图', '推送', '通知', '分享', '支付', '下单', '预约', '签到', '打卡', '拍照', '扫码点餐'], platforms: [...backendPlatforms, ...mobilePlatforms] },
    { keywords: ['登录', '认证', '注册', '鉴权', 'auth', 'login', 'logout', '用户', 'user', '个人中心', 'profile', '设置', 'setting'], platforms: allPlatforms },
    { keywords: ['页面', 'ui', '组件', '展示', '列表', '详情', '首页', '导航', '菜单', '主题', '样式', '布局'], platforms: [...adminPlatforms, ...mobilePlatforms] },
  ];

  const matched = new Set<string>();
  for (const rule of keywordMap) {
    if (rule.keywords.some(kw => text.includes(kw.toLowerCase()))) {
      for (const p of rule.platforms) matched.add(p);
    }
  }

  // 注意：不兜底。没匹配到时返回空，让六层机制自然走到 Layer5（AI 判断）。
  return [...matched];
}

// ── Layer 5: AI 判断 prompt ──

function buildAiInferencePrompt(featureName: string, requirementContent: string, allPlatforms: string[]): string {
  return [
    `请判断功能单元「${featureName}」涉及哪些端。`,
    `候选端: ${allPlatforms.join(', ')}`,
    '',
    requirementContent ? `需求描述:\n${requirementContent.slice(0, 500)}` : '（无需求文档）',
    '',
    '输出格式（JSON）:',
    '{"platforms": ["backend", "h5-mobile"], "confidence": 0.8, "uncertainties": []}',
  ].join('\n');
}
