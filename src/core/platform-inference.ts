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
import { pathExists, readFile, readdir, writeFile } from 'fs-extra';
import * as yaml from 'js-yaml';
import { resolveUnitSourcePath } from './feature-source';

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

  const matchedGroups: string[][] = [];
  for (const rule of keywordMap) {
    if (rule.keywords.some(kw => text.includes(kw.toLowerCase()))) {
      matchedGroups.push(rule.platforms);
    }
  }

  // v8.3.279: 多组命中取交集——union 会让「通知+列表」这类常见组合膨胀成全端（收敛形同虚设）。
  // 「用户/设置」组为全端集合，取交集等于保留其余组的结论；交集为空则放弃关键词推断，
  // 交给 Layer 5 AI 判断（宁少勿滥：宁可全端兜底，不瞎收敛）。
  if (matchedGroups.length === 0) return [];
  const intersected = matchedGroups.reduce((acc, group) => acc.filter(p => group.includes(p)));
  return intersected;
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

// ================================================================
// v8.3.279+: 推断结果持久化（写回 _matrix.md）
// ================================================================

/**
 * v8.3.279: 把高置信度推断结果写回 _matrix.md 的 platforms 字段（持久化）。
 * 只替换 platforms 块（保持 feature/type/dependencies/apis 其余字段不变），
 * 并在块上方标注推断来源与置信度注释（可人工修改）；重复写回时旧注释不叠加。
 */
export async function persistInferredPlatforms(
  featureDir: string,
  platforms: string[],
  source: PlatformInferenceSource,
  confidence: number,
): Promise<boolean> {
  const matrixPath = join(featureDir, '_matrix.md');
  if (!(await pathExists(matrixPath))) return false;
  try {
    const NL = String.fromCharCode(10); // 避免正则在工具链路中转义损坏，用字符码拼换行
    const raw = await readFile(matrixPath, 'utf-8');
    const lines = raw.split(NL);
    // 定位 platforms: 行；块结束于 dependencies/apis/interfaces 行或文件尾
    let pIdx = -1;
    let endIdx = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === 'platforms:' && pIdx === -1) pIdx = i;
      else if (pIdx >= 0 && /^(dependencies|apis|interfaces):/.test(lines[i].trim())) { endIdx = i; break; }
    }
    if (pIdx === -1) return false;
    // 去掉紧邻 platforms: 前的旧「推断来源」注释行，避免重复叠加
    if (pIdx > 0 && lines[pIdx - 1].includes('推断来源')) {
      lines.splice(pIdx - 1, 1);
      pIdx--;
      endIdx--;
    }
    const listLines = platforms.map(p => `  - ${p}`);
    const note = `# 推断来源: ${source}（置信度 ${confidence}，自动填充，可人工修改）`;
    const block = [note, 'platforms:', ...listLines];
    lines.splice(pIdx, endIdx - pIdx, ...block);
    await writeFile(matrixPath, lines.join(NL), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * v8.3.279: 对「声明为空」的单元批量跑六层推断，高置信度结果写回 _matrix.md。
 * 返回合并后的「单元 → 声明端」映射与推断过程清单。
 * 已声明单元不重复推断（幂等）；前四层无结果（需 AI/人工）的单元记入 pending，全端兜底。
 */
export async function inferAndPersistFeaturePlatforms(
  featuresDir: string,
  features: string[],
  allPlatforms: string[],
  existingMap: Map<string, string[]>,
): Promise<{
  map: Map<string, string[]>;
  inferred: { feature: string; platforms: string[]; source: PlatformInferenceSource; confidence: number }[];
  pending: string[];
}> {
  const map = new Map(existingMap);
  const inferred: { feature: string; platforms: string[]; source: PlatformInferenceSource; confidence: number }[] = [];
  const pending: string[] = [];
  for (const feature of features) {
    if (map.has(feature)) continue; // 已有声明，不重复推断
    const featureDir = join(featuresDir, feature);
    let requirementContent = '';
    try {
      const srcPath = await resolveUnitSourcePath(featureDir);
      if (await pathExists(srcPath)) requirementContent = await readFile(srcPath, 'utf-8');
    } catch { /* 读不到需求切片不阻断 */ }
    const inference = await inferFeaturePlatforms({
      featureName: feature,
      featureDir,
      requirementContent,
      allPlatforms,
    });
    // 高置信度确定性来源（显式声明 1.0 / 目录结构 0.9 / 关键词 0.75）→ 写回持久化
    if (inference.platforms.length > 0 && ['explicit', 'directory', 'keyword'].includes(inference.source)) {
      const ok = await persistInferredPlatforms(featureDir, inference.platforms, inference.source, inference.confidence);
      if (ok) {
        map.set(feature, inference.platforms);
        inferred.push({ feature, platforms: inference.platforms, source: inference.source, confidence: inference.confidence });
        continue;
      }
    }
    // 推断无结果或写回失败 → 全端兜底 + 待 AI/人工
    pending.push(feature);
  }
  return { map, inferred, pending };
}

// ================================================================
// v8.3.362+: 切分后端分析（方案 A）——端与依赖分析前移到 unitize 层
// ================================================================

/**
 * AI/人工确认后的单元矩阵回写：platforms + 可选 dependencies/apis。
 * platforms 走 persistInferredPlatforms（source=explicit，置信度 1.0，
 * 带「推断来源」注释可人工改）；dependencies/apis 行级替换（保留其余字段）。
 */
export async function persistConfirmedUnitMatrix(
  featureDir: string,
  platforms: string[],
  dependencies?: string[],
  apis?: string[],
): Promise<boolean> {
  const okPlatforms = await persistInferredPlatforms(featureDir, platforms, 'explicit', 1.0);
  if (!okPlatforms) return false;
  if (!dependencies?.length && !apis?.length) return true;
  try {
    const matrixPath = join(featureDir, '_matrix.md');
    const raw = await readFile(matrixPath, 'utf-8');
    const lines = raw.split('\n');
    // 块级替换：从 `{key}:` 行到下一个列表项结束（支持已有值的覆盖与空值填充）
    const replaceList = (key: string, values: string[]): void => {
      const idx = lines.findIndex(l => l.trim().startsWith(`${key}:`));
      if (idx === -1) return;
      let end = idx + 1;
      while (end < lines.length && /^\s+[-*]/.test(lines[end])) end++;
      lines.splice(idx, end - idx, `${key}:`, ...values.map(v => `  - ${v}`));
    };
    if (dependencies?.length) replaceList('dependencies', dependencies);
    if (apis?.length) replaceList('apis', apis);
    await writeFile(matrixPath, lines.join('\n'), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/** 切分后端分析结果 */
export interface PostUnitizePlatformAnalysis {
  /** 确定性来源自动回写的单元 */
  autoWritten: { feature: string; platforms: string[]; source: PlatformInferenceSource; confidence: number }[];
  /** 已声明单端、但检出额外可能端的单元（不自动覆盖，交宿主 AI 确认） */
  expandCandidates: { feature: string; declared: string[]; extra: string[]; aiPrompt: string }[];
  /** 前四层无果、需 AI 语义判断的单元 */
  pending: { feature: string; aiPrompt: string }[];
}

/**
 * v8.3.362+: 切分完成后立即分析功能单元的涉及端（方案 A 落地）。
 * - 声明为空 → 六层推断，确定性来源（explicit/directory/keyword）自动回写 _matrix；
 * - 声明非空 → keyword 层检出声明外的额外端 → 超集候选，不自动覆盖单端声明；
 * - 前四层无果 → 输出 AI 判断 prompt，宿主 AI 判断后经 unitize --confirm-platforms 回写。
 */
export async function analyzeUnitPlatformsAfterUnitize(
  featuresDir: string,
  unitNames: string[],
  allPlatforms: string[],
): Promise<PostUnitizePlatformAnalysis> {
  const result: PostUnitizePlatformAnalysis = { autoWritten: [], expandCandidates: [], pending: [] };
  for (const unitName of unitNames) {
    const featureDir = join(featuresDir, unitName);
    let requirementContent = '';
    try {
      const srcPath = await resolveUnitSourcePath(featureDir);
      if (await pathExists(srcPath)) requirementContent = await readFile(srcPath, 'utf-8');
    } catch { /* 读不到需求切片不阻断 */ }
    const declared = [...new Set(
      (await readMatrixPlatforms(featureDir))
        .map(p => normalizePlatformToken(p, allPlatforms))
        .filter((p): p is string => !!p),
    )];
    if (declared.length > 0) {
      // 已声明（切分文档所属端）→ 超集检测：直接调关键词层 + 目录层检出声明外的
      // 额外端（不能走 inferFeaturePlatforms——其 Layer 2 会采信 matrix 声明短路
      // 关键词层，超集永远检不出）；检出仅提示，不自动覆盖单端声明。
      const extra = [...new Set([
        ...inferPlatformsByKeywords(unitName, requirementContent, allPlatforms),
        ...(await detectDirectoryPlatforms(featureDir, allPlatforms)),
      ].filter(p => !declared.includes(p)))];
      if (extra.length > 0) {
        result.expandCandidates.push({
          feature: unitName,
          declared,
          extra,
          aiPrompt: buildAiInferencePrompt(unitName, requirementContent, allPlatforms),
        });
      }
      continue;
    }
    // 声明为空 → 六层推断
    const inference = await inferFeaturePlatforms({ featureName: unitName, featureDir, requirementContent, allPlatforms });
    if (inference.platforms.length > 0 && ['explicit', 'directory', 'keyword'].includes(inference.source)) {
      const ok = await persistInferredPlatforms(featureDir, inference.platforms, inference.source, inference.confidence);
      if (ok) {
        result.autoWritten.push({ feature: unitName, platforms: inference.platforms, source: inference.source, confidence: inference.confidence });
        continue;
      }
    }
    result.pending.push({ feature: unitName, aiPrompt: inference.aiPrompt || buildAiInferencePrompt(unitName, requirementContent, allPlatforms) });
  }
  return result;
}
