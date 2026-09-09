/**
 * pattern-detector — 可复用模式候选检测引擎
 *
 * v8.2.0+: 从代码目录启发式检测可复用模式候选
 * 供 done/execute/pattern 命令共用
 */

import { readFile, pathExists, readdir } from 'fs-extra';
import { join, relative } from 'path';

export interface PatternCandidate {
  name: string;
  category: string;
  /** v8.3.0+: 所属端 — backend | frontend | shared | unknown */
  platform: string;
  file: string;
  reason: string;
}

/**
 * 启发式检测代码中的可复用模式候选
 * @param codeDirs 要扫描的代码目录列表
 * @param sourceLabel 来源标签（用于日志）
 */
export async function detectPatternCandidates(
  codeDirs: string[],
  sourceLabel?: string
): Promise<PatternCandidate[]> {
  const candidates: PatternCandidate[] = [];

  // 1. 扫描代码文件
  const codeFiles: { path: string; relPath: string; content: string }[] = [];
  const codeExts = ['.ts', '.js', '.tsx', '.jsx', '.java', '.go', '.py', '.vue'];

  for (const baseDir of codeDirs) {
    if (!(await pathExists(baseDir))) continue;
    await scanCodeDir(baseDir, baseDir, codeFiles, codeExts);
  }

  if (codeFiles.length === 0) return candidates;

  // 2. 加载已有 PATTERNS 模式名（避免重复推荐）
  const existingPatterns = await loadExistingPatternNames();

  // 3. 启发式规则检测
  for (const cf of codeFiles) {
    const content = cf.content;
    const relPath = cf.relPath;

    // 推断所属端
    const platform = inferPlatform(relPath);

    // 规则 A: 通用工具目录下的导出
    const isUtilDir = /\/(utils|helpers|common|shared)\//i.test(relPath);
    if (isUtilDir) {
      const exports = extractNamedExports(content);
      for (const name of exports.slice(0, 3)) {
        if (isGenericName(name) && !existingPatterns.has(name.toLowerCase())) {
          candidates.push({
            name,
            category: 'utility',
            platform,
            file: relPath,
            reason: '通用工具函数，位于 utils/ 目录',
          });
        }
      }
    }

    // 规则 B: 中间件/装饰器/Hook 目录
    const isMiddlewareDir = /\/(middleware|decorators|hooks|interceptors|filters)\//i.test(relPath);
    if (isMiddlewareDir) {
      const exports = extractNamedExports(content);
      for (const name of exports.slice(0, 2)) {
        if (!existingPatterns.has(name.toLowerCase())) {
          const category = relPath.includes('middleware') ? 'middleware' :
            relPath.includes('decorator') ? 'decorator' :
            relPath.includes('hook') ? 'hook' : 'interceptors';
          candidates.push({
            name,
            category,
            platform,
            file: relPath,
            reason: `可复用${category}，位于专用目录`,
          });
        }
      }
    }

    // 规则 C: 组件目录下的通用组件（前端）
    const isComponentDir = /\/(components|ui|widgets)\//i.test(relPath);
    if (isComponentDir && /\.(tsx|jsx|vue)$/.test(relPath)) {
      const exports = extractNamedExports(content);
      for (const name of exports.slice(0, 2)) {
        if (name.startsWith('Base') || name.startsWith('App') || name.startsWith('Common')) {
          if (!existingPatterns.has(name.toLowerCase())) {
            candidates.push({
              name,
              category: 'component',
              platform,
              file: relPath,
              reason: '通用 UI 组件',
            });
          }
        }
      }
    }

    // 规则 D: 有 JSDoc/详细注释的导出（表明是有意设计的可复用模块）
    const hasJSDoc = /\/\*\*[\s\S]*?\*\/\s*(export|class|function|const)/.test(content);
    if (hasJSDoc && !isUtilDir && !isMiddlewareDir && !isComponentDir) {
      const exports = extractNamedExports(content);
      for (const name of exports.slice(0, 1)) {
        if (isGenericName(name) && !existingPatterns.has(name.toLowerCase())) {
          candidates.push({
            name,
            category: 'module',
            platform,
            file: relPath,
            reason: '有详细 JSDoc 注释的可复用模块',
          });
        }
      }
    }
  }

  // 去重
  const seen = new Set<string>();
  const unique = candidates.filter(c => {
    const key = `${c.name}:${c.file}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // v8.3.0+: 跨端同名模式检测
  // 如果同一个 name 同时出现在 backend 和 frontend，标记为 shared（跨端共享）
  const namePlatforms = new Map<string, Set<string>>();
  for (const c of unique) {
    if (!namePlatforms.has(c.name)) namePlatforms.set(c.name, new Set());
    namePlatforms.get(c.name)!.add(c.platform);
  }
  for (const c of unique) {
    const platforms = namePlatforms.get(c.name);
    if (platforms && platforms.has('backend') && platforms.has('frontend')) {
      if (c.platform !== 'shared') {
        c.platform = 'shared';
        c.reason = c.reason + '（跨端共享：前后端均存在同名导出）';
      }
    }
  }

  return unique;
}

async function scanCodeDir(
  dir: string, baseDir: string, results: { path: string; relPath: string; content: string }[], exts: string[]
): Promise<void> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const fullPath = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
        await scanCodeDir(fullPath, baseDir, results, exts);
      } else if (exts.some(ext => e.name.endsWith(ext))) {
        const content = await readFile(fullPath, 'utf-8');
        results.push({ path: fullPath, relPath: relative(baseDir, fullPath), content });
      }
    }
  } catch { /* skip */ }
}

/** 从代码中提取命名导出 */
function extractNamedExports(content: string): string[] {
  const names: string[] = [];
  const patterns = [
    /export\s+(?:async\s+)?function\s+(\w+)/g,
    /export\s+class\s+(\w+)/g,
    /export\s+const\s+(\w+)\s*=/g,
    /export\s+default\s+class\s+(\w+)/g,
    /export\s+default\s+function\s+(\w+)/g,
  ];
  for (const p of patterns) {
    let m: RegExpExecArray | null;
    while ((m = p.exec(content)) !== null) {
      names.push(m[1]);
    }
  }
  return [...new Set(names)];
}

/**
 * v8.3.23+: 根据文件路径推断所属端（适配端平铺结构）
 */
function inferPlatform(filePath: string): string {
  const lower = filePath.toLowerCase();
  // 后端标识
  if (/[\\/](backend|api|server|service|controller|model|dao|repository|entity|dto|mapper|handler|modules)[\\/]/i.test(lower)) {
    return 'backend';
  }
  // 前端标识
  if (/[\\/](frontend|h5|admin|web|app|mobile|pages|views|components|ui|widgets|hooks|composables)[\\/]/i.test(lower)) {
    return 'frontend';
  }
  // 共享标识
  if (/[\\/](shared|common|_shared|types|interfaces|constants|enums|utils)[\\/]/i.test(lower)) {
    return 'shared';
  }
  return 'unknown';
}

/** 判断是否为通用命名 */
function isGenericName(name: string): boolean {
  const genericPrefixes = ['with', 'use', 'create', 'format', 'validate', 'handle', 'parse', 'build', 'make', 'get', 'set', 'is', 'has', 'to', 'from', 'transform', 'merge', 'split', 'compose', 'pipe'];
  const genericNames = ['utils', 'helpers', 'common', 'shared', 'base', 'core', 'helper', 'util', 'factory', 'provider', 'service', 'manager', 'controller', 'middleware', 'interceptor', 'filter', 'guard', 'decorator', 'hook', 'mixin'];
  const lower = name.toLowerCase();
  if (genericNames.includes(lower)) return true;
  for (const prefix of genericPrefixes) {
    if (lower.startsWith(prefix) && name.length > prefix.length + 1) return true;
  }
  return false;
}

/**
 * v8.3.23+: 从任务目录动态发现代码目录（适配端平铺结构）
 * 扫描 taskDir 下的端目录及子任务目录，寻找 src/ 或 code/ 子目录
 */
export async function resolveCodeDirsFromTask(taskDir: string): Promise<string[]> {
  const dirs: string[] = [];
  if (!(await pathExists(taskDir))) return dirs;

  // 直接检查 taskDir 本身是否有 src/ 或 code/
  for (const sub of ['src', 'code']) {
    const d = join(taskDir, sub);
    if (await pathExists(d)) dirs.push(d);
  }

  // 扫描 taskDir 下的一级子目录（端目录）
  try {
    const entries = await readdir(taskDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const name = e.name;
      // 排除特殊目录: .meta, _shared, 00-specs, node_modules, dist 等
      if (name.startsWith('.') || name.startsWith('_') || /^\d{2,}-/.test(name) || name === 'node_modules' || name === 'dist') continue;

      const platformDir = join(taskDir, name);

      // 检查端目录本身是否有 src/ 或 code/
      for (const sub of ['src', 'code']) {
        const d = join(platformDir, sub);
        if (await pathExists(d)) dirs.push(d);
      }

      // 检查端目录下的子任务目录（如 Task-001-api/）是否有 src/ 或 code/
      try {
        const subEntries = await readdir(platformDir, { withFileTypes: true });
        for (const se of subEntries) {
          if (!se.isDirectory() || se.name.startsWith('.') || se.name === 'node_modules' || se.name === 'dist') continue;
          for (const sub of ['src', 'code']) {
            const d = join(platformDir, se.name, sub);
            if (await pathExists(d)) dirs.push(d);
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return [...new Set(dirs)];
}

/**
 * v8.3.0+: 按端分组展示模式候选
 * @returns 分组后的记录，键为端名，值为该端的候选列表
 */
export function groupCandidatesByPlatform(
  candidates: PatternCandidate[]
): Record<string, PatternCandidate[]> {
  const groups: Record<string, PatternCandidate[]> = {};
  const order = ['shared', 'backend', 'frontend', 'unknown'];

  for (const c of candidates) {
    const p = c.platform || 'unknown';
    if (!groups[p]) groups[p] = [];
    groups[p].push(c);
  }

  // 按固定顺序返回（shared 在前，unknown 在后）
  const result: Record<string, PatternCandidate[]> = {};
  for (const key of order) {
    if (groups[key] && groups[key].length > 0) {
      result[key] = groups[key];
    }
  }
  // 补充任何未在 order 中的端
  for (const [key, value] of Object.entries(groups)) {
    if (!result[key]) result[key] = value;
  }
  return result;
}

// ═══════════════════════════════════════════════════════════
// v8.3.23+: PATTERNS 自动写入三档策略
// ═══════════════════════════════════════════════════════════

export type PatternAutoSaveMode = 'off' | 'smart' | 'aggressive';

/**
 * 读取 patterns.auto_save 配置（从 .speccore.yml）
 * 默认: 'smart'
 */
export async function getPatternAutoSaveMode(): Promise<PatternAutoSaveMode> {
  try {
    const { loadConfig } = await import('./unified-config');
    const config = await loadConfig();
    const v = config.settings?.patterns?.auto_save;
    if (v === 'off' || v === 'smart' || v === 'aggressive') return v;
  } catch { /* 静默失败 */ }
  return 'smart';
}

/**
 * 判断是否为高置信度候选（smart 档位自动保存）
 */
export function isHighConfidenceCandidate(candidate: PatternCandidate): boolean {
  // 跨端共享 = 最高置信度
  if (candidate.platform === 'shared') return true;
  // 框架级中间件/装饰器/Hook
  if (['middleware', 'decorator', 'hook', 'interceptor', 'filter'].includes(candidate.category)) return true;
  // 有 JSDoc 的可复用模块
  if (candidate.category === 'module' && candidate.reason.includes('JSDoc')) return true;
  // Base 开头的基础组件
  if (candidate.category === 'component' && candidate.name.startsWith('Base')) return true;
  return false;
}

export interface AutoSaveResult {
  saved: boolean;
  path?: string;
  confidence: 'EXTRACTED' | 'INFERRED';
}

/**
 * 自动保存单个模式候选到 .speccore/PATTERNS/
 */
export async function autoSavePattern(
  candidate: PatternCandidate,
  sourceLabel: string,
  mode: PatternAutoSaveMode
): Promise<AutoSaveResult> {
  if (mode === 'off') return { saved: false, confidence: 'INFERRED' };

  const isHigh = isHighConfidenceCandidate(candidate);
  if (mode === 'smart' && !isHigh) return { saved: false, confidence: 'INFERRED' };

  const confidence = isHigh ? 'EXTRACTED' : 'INFERRED';
  const patternsDir = join(process.cwd(), '.speccore', 'PATTERNS');
  const categoryDir = join(patternsDir, candidate.category);

  try {
    await import('fs-extra').then(m => m.ensureDir(categoryDir));
  } catch {
    return { saved: false, confidence };
  }

  const fileName = `${candidate.name}.md`;
  const filePath = join(categoryDir, fileName);

  // 如果已存在，跳过（避免覆盖）
  if (await pathExists(filePath)) return { saved: false, confidence };

  const content = `# ${candidate.name}

> 类型: pattern | 来源: ${sourceLabel} | 检测时间: ${new Date().toISOString()}
> 置信度: ${confidence}
> 所属端: ${candidate.platform}

## 描述
${candidate.reason}

## 代码参考
\`${candidate.file}\`

## 使用场景
- ${candidate.platform === 'shared' ? '跨端复用' : candidate.platform === 'backend' ? '后端复用' : candidate.platform === 'frontend' ? '前端复用' : '通用复用'}

## 自动检测
此模式由 SpecCore 自动检测到。如需调整，请手动编辑或删除此文件。
`;

  try {
    await import('fs-extra').then(m => m.writeFile(filePath, content, 'utf-8'));
    return { saved: true, path: filePath, confidence };
  } catch {
    return { saved: false, confidence };
  }
}

/** 加载已有 PATTERNS 中的模式名 */
async function loadExistingPatternNames(): Promise<Set<string>> {
  const names = new Set<string>();
  try {
    const patternsDir = join(process.cwd(), '.speccore', 'PATTERNS');
    if (!(await pathExists(patternsDir))) return names;
    const entries = await readdir(patternsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subEntries = await readdir(join(patternsDir, entry.name), { withFileTypes: true });
        for (const sub of subEntries) {
          if (sub.name.endsWith('.md')) {
            names.add(sub.name.replace('.md', '').toLowerCase());
          }
        }
      } else if (entry.name.endsWith('.md')) {
        names.add(entry.name.replace('.md', '').toLowerCase());
      }
    }
  } catch { /* 静默失败 */ }
  return names;
}
