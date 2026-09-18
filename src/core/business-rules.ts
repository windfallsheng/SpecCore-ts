/**
 * business-rules.ts — 业务规则三层统一加载
 *
 * 三层结构（按分析/执行阶段声明式加载）：
 *   Layer 1 全局（跨端共享）: GLOBAL/BUSINESS_RULES.md + GLOBAL/BUSINESS_RULES/*-common.md
 *   Layer 2 端级（该端特有）: GLOBAL/BUSINESS_RULES/{端}.md + 兼容 platforms/{端}/BUSINESS_RULES.md
 *   Layer 3 功能级（该功能特有）: Iteration-{iter}/020-specs/{feature}/overview/BUSINESS_RULES.md
 *
 * 职责：只做「确定性加载」——按层/端/功能定位文件并读取，返回结构化列表；
 *       语义（规则的约束性判断、冲突检测）由宿主 AI 完成。
 *
 * v8.3.184+
 */

import { join } from 'path';
import { pathExists, readFile, readdir } from 'fs-extra';

export type BusinessRuleLayer = 'global' | 'platform' | 'feature';

export interface BusinessRuleItem {
  layer: BusinessRuleLayer;
  /** 相对项目根的路径（展示 + 追溯用） */
  path: string;
  content: string;
}

export interface LoadBusinessRulesOptions {
  /** 项目根目录，默认 process.cwd() */
  cwd?: string;
  /** 迭代名（功能级需要，如 Iteration-001） */
  iteration?: string;
  /** 端名（端级过滤，如 backend/admin/h5），缺省加载全部 */
  platform?: string;
  /** 功能单元（功能级）：功能名（如 用户认证）或相对路径（含 020-specs） */
  feature?: string;
  /** 每文件最大注入字符数，默认 4000 */
  maxPerFile?: number;
}

export async function loadBusinessRules(options: LoadBusinessRulesOptions): Promise<BusinessRuleItem[]> {
  const cwd = options.cwd || process.cwd();
  const maxPerFile = options.maxPerFile || 4000;
  const result: BusinessRuleItem[] = [];

  // ── Layer 1: 全局 ──
  // 1a. 单文件 legacy: GLOBAL/BUSINESS_RULES.md
  const legacyPath = join(cwd, '.speccore', 'GLOBAL', 'BUSINESS_RULES.md');
  if (await pathExists(legacyPath)) {
    const content = await readFile(legacyPath, 'utf-8');
    result.push({ layer: 'global', path: 'GLOBAL/BUSINESS_RULES.md', content: content.slice(0, maxPerFile) });
  }

  // 1b. 目录模式: GLOBAL/BUSINESS_RULES/*.md（common = 全局，{端} = 端级）
  const rulesDir = join(cwd, '.speccore', 'GLOBAL', 'BUSINESS_RULES');
  if (await pathExists(rulesDir)) {
    const files = (await readdir(rulesDir)).filter(f => f.endsWith('.md') && !f.startsWith('_')).sort();
    for (const file of files) {
      const base = file.replace(/\.md$/, '');
      const isCommon = base === 'common' || base.endsWith('-common');
      const isPlatformMatch = options.platform
        ? (base === options.platform || base.endsWith(`-${options.platform}`) || base.includes(`-${options.platform}-`))
        : false;

      let layer: BusinessRuleLayer;
      if (isCommon) {
        layer = 'global';
      } else if (options.platform && isPlatformMatch) {
        layer = 'platform';
      } else if (!options.platform) {
        layer = 'global'; // 无 platform 过滤：全部按全局加载
      } else {
        continue; // 有 platform 但既不 common 也不匹配 → 跳过
      }

      const content = await readFile(join(rulesDir, file), 'utf-8');
      result.push({ layer, path: `GLOBAL/BUSINESS_RULES/${file}`, content: content.slice(0, maxPerFile) });
    }
  }

  // ── Layer 2 兼容: platforms/{端}/BUSINESS_RULES.md（streaming-analyzer 等使用的路径）──
  if (options.platform) {
    const platformRulesPath = join(cwd, '.speccore', 'GLOBAL', 'platforms', options.platform, 'BUSINESS_RULES.md');
    if (await pathExists(platformRulesPath)) {
      const content = await readFile(platformRulesPath, 'utf-8');
      result.push({ layer: 'platform', path: `GLOBAL/platforms/${options.platform}/BUSINESS_RULES.md`, content: content.slice(0, maxPerFile) });
    }
  }

  // ── Layer 3: 功能级 ──
  if (options.feature) {
    const featurePath = resolveFeatureRulesPath(cwd, options.iteration, options.feature);
    if (featurePath && await pathExists(featurePath)) {
      const content = await readFile(featurePath, 'utf-8');
      // path 统一用相对项目根的路径（与 global/platform 一致）
      const relPath = featurePath.replace(cwd.replace(/\/$/, ''), '').replace(/^\//, '');
      result.push({ layer: 'feature', path: relPath, content: content.slice(0, maxPerFile) });
    }
  }

  return result;
}

/** 解析功能级业务规则路径：功能名 → Iteration-{iter}/020-specs/{feature}/overview/BUSINESS_RULES.md */
function resolveFeatureRulesPath(cwd: string, iteration: string | undefined, feature: string): string | null {
  // 已是路径（含 020-specs 或 /）：直接拼接 BUSINESS_RULES.md
  if (feature.includes('/') || feature.includes('020-specs')) {
    const base = join(cwd, feature);
    // 尝试 {feature}/BUSINESS_RULES.md 或 {feature}/overview/BUSINESS_RULES.md
    if (feature.endsWith('overview')) return join(base, 'BUSINESS_RULES.md');
    return join(base, 'BUSINESS_RULES.md');
  }
  // 功能名：需要 iteration
  if (!iteration) return null;
  return join(cwd, `Iteration-${iteration}`, '020-specs', feature, 'overview', 'BUSINESS_RULES.md');
}

/** 把三层规则格式化为 prompt 注入文本 */
export function formatBusinessRules(items: BusinessRuleItem[]): string {
  if (items.length === 0) return '';
  const layerLabel: Record<BusinessRuleLayer, string> = {
    global: '全局规则',
    platform: '端级规则',
    feature: '功能级规则',
  };
  const lines: string[] = ['### 📋 业务规则（三层）', ''];
  for (const item of items) {
    lines.push(`#### ${layerLabel[item.layer]}: ${item.path}`, '');
    lines.push(item.content, '');
  }
  return lines.join('\n');
}
