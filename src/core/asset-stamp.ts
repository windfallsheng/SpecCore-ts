/**
 * asset-stamp — 内置资产版本戳工具
 *
 * 背景：.speccore/ 下的内置资产（AGENTS 角色定义、_INDEX 注册表、
 * RULES/*.inline.md 投影模板等）由 CLI 生成。旧版 CLI 生成的文件格式
 * 与新版不同（如缺 frontmatter 字段），升级时需要区分三类文件：
 *   1. 新版 CLI 生成（有当前版本戳）→ 跳过
 *   2. 旧版 CLI 生成（有旧版本戳，或无戳但命中旧版特征）→ 备份刷新
 *   3. 用户自定义（无戳且无旧版特征）→ 保留
 *
 * 此前靠 OBSOLETE_MARKERS 特征检测兜底，每次升级都要枚举「旧特征」，
 * 漏一个就是一个盲区。版本戳把「检测旧特征」变成「对齐版本」：
 * CLI 内置内容在加载时注入当前版本戳，同步时比对即可。
 */

import { version as PKG_VERSION } from '../../package.json';

/** 版本戳注释格式：<!-- speccore-asset-version: 8.3.315 --> */
const STAMP_PATTERN = /^<!--\s*speccore-asset-version:\s*([\w.-]+)\s*-->/m;

/** 给内置资产内容注入当前 CLI 版本戳（幂等：已有戳则替换） */
export function stampContent(content: string): string {
  const stamp = `<!-- speccore-asset-version: ${PKG_VERSION} -->`;
  if (STAMP_PATTERN.test(content)) {
    return content.replace(STAMP_PATTERN, stamp);
  }
  // 注入到 frontmatter 之后（保留 YAML frontmatter 在文件最顶部）
  const fmEnd = content.match(/^---\s*\n[\s\S]*?\n---\s*\n/);
  if (fmEnd) {
    return fmEnd[0] + stamp + '\n' + content.slice(fmEnd[0].length);
  }
  return stamp + '\n' + content;
}

/** 读取资产内容里的版本戳；无戳返回 null */
export function readAssetStamp(content: string): string | null {
  const m = content.match(STAMP_PATTERN);
  return m ? m[1] : null;
}

/**
 * 同步决策（统一决策表）：现有文件是否该刷新为内置新内容。
 * AGENTS 角色 / 注册表 / RULES inline 投影模板等四类内置资产共用此函数，
 * 决策规则只有一份，新增资产类别不引入新的分支逻辑。
 *
 * 决策顺序：
 *   1. 内容完全相同 → skip（幂等，不产生备份噪音）
 *   2. 剥戳后与内置一致 → restamp（8.3.314 及以前生成的无戳同内容文件，
 *      直接补戳进入版本戳体系；内容零变化，无需备份）
 *   3. 有版本戳 → CLI 生成物：同版本 skip（用户改过也保留），旧戳 overwrite
 *      （v8.3.349+: 带戳即可确定是 CLI 生成物，直接覆盖不备份——备份只会
 *      堆积时间戳文件；用户自定义应走 _TEMPLATE 或新文件而非改内置角色）
 *   4. 无戳 → 交给 isLegacy 特征判定：旧版特征命中 refresh（特征检测有误判
 *      可能，保留备份保底），否则视为用户自定义 skip
 *
 * @param isLegacy 旧版 CLI 生成物的特征判定（无戳时兜底），如旧版角色缺 systemPrompt
 * @returns 'overwrite' 直接覆盖 | 'refresh' 备份刷新 | 'restamp' 直接补戳 | 'skip' 保留现有
 */
export function decideStampedSync(
  existingContent: string,
  builtinContent: string,
  isLegacy: (existing: string) => boolean,
): 'overwrite' | 'refresh' | 'restamp' | 'skip' {
  if (existingContent === builtinContent) return 'skip';
  if (stripAssetStamp(builtinContent) === existingContent) return 'restamp';
  const existingStamp = readAssetStamp(existingContent);
  if (existingStamp) {
    // 有版本戳 → 是 CLI 生成物：旧戳直接覆盖（v8.3.349+ 不再备份），同版本跳过
    return existingStamp === PKG_VERSION ? 'skip' : 'overwrite';
  }
  // 无戳：旧版 CLI 生成（命中旧版特征）→ 备份刷新；否则视为用户自定义 → 保留
  return isLegacy(existingContent) ? 'refresh' : 'skip';
}

/**
 * 剥离内容中的版本戳（投影消费点用）。
 * inline 模板内容带戳，投影到 AGENTS.md 前需剥掉，避免戳注释污染用户文档。
 */
export function stripAssetStamp(content: string): string {
  return content.replace(/^<!--\s*speccore-asset-version:\s*[\w.-]+\s*-->\s*\n?/m, '');
}
