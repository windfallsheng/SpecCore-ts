/**
 * scope-resolver — AI 验证范围解析（v8.3.350+）
 *
 * 三种范围：
 *   all      → 020-specs 下所有功能单元目录
 *   deployed → 读部署清单（deploy-manifest.json）的端名，筛选含对应端子目录的单元
 *   modules  → 精确匹配指定的功能单元目录名
 * 均可叠加端过滤（platformFilter）。
 */

import { join } from 'path';
import { readdir, readFile } from 'fs-extra';
import type { DeployManifest, ScopeUnit } from './types';

/** 非功能单元的目录名（全局规格与元数据，AGENTS.md 约定） */
const EXCLUDED_DIRS = new Set(['overview', 'requirements']);

export interface ScopeResolveInput {
  /** 迭代目录绝对路径（含 020-specs） */
  iterDir: string;
  /** scope 参数原文：all | deployed | modules:a,b */
  scope: string;
  /** 端过滤（CONSTITUTION 标准端名，逗号分隔），空为不过滤 */
  platformFilter?: string;
  /** 项目根目录（读 deploy-manifest.json 用） */
  projectRoot: string;
}

export interface ScopeResolveOutput {
  units: ScopeUnit[];
  warnings: string[];
}

/** 解析 --platform 参数为端名数组 */
export function parsePlatformFilter(filter?: string): string[] {
  if (!filter) return [];
  return filter
    .split(/[,，、\s]+/)
    .map((n) => n.trim())
    .filter(Boolean);
}

/** 判断一个目录是否为功能单元目录（含端子目录或 overview 子目录） */
async function listUnitPlatforms(unitPath: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(unitPath);
  } catch {
    return [];
  }
  // 端目录特征：包含 UI_SPEC.md / TEST.md / TECH.md 之一的子目录（overview 除外）
  const platforms: string[] = [];
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    try {
      const stats = (await import('fs-extra')).statSync(join(unitPath, entry));
      if (!stats.isDirectory()) continue;
    } catch {
      continue;
    }
    platforms.push(entry);
  }
  return platforms;
}

/** 枚举 020-specs 下全部功能单元 */
async function listAllUnits(specsDir: string): Promise<ScopeUnit[]> {
  const entries = await readdir(specsDir);
  const units: ScopeUnit[] = [];
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const unitPath = join(specsDir, entry);
    try {
      const stats = (await import('fs-extra')).statSync(unitPath);
      if (!stats.isDirectory()) continue;
    } catch {
      continue;
    }
    const platforms = await listUnitPlatforms(unitPath);
    units.push({ name: entry, path: unitPath, platforms });
  }
  return units;
}

/** 读部署清单（不存在返回 null） */
export async function loadDeployManifest(projectRoot: string): Promise<DeployManifest | null> {
  const manifestPath = join(projectRoot, '.speccore', 'local', 'deploy-manifest.json');
  try {
    const raw = await readFile(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as DeployManifest;
    if (!parsed || !Array.isArray(parsed.platforms)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 按部署清单端名筛选单元：单元含任一已部署端子目录则入选 */
function filterByDeployed(all: ScopeUnit[], manifest: DeployManifest): ScopeUnit[] {
  const deployedNames = new Set(manifest.platforms.map((p) => p.name));
  return all.filter((u) => u.platforms.some((p) => deployedNames.has(p)));
}

/** 按模块名筛选：精确匹配单元目录名 */
function filterByModules(all: ScopeUnit[], modules: string[]): ScopeUnit[] {
  const wanted = new Set(modules);
  return all.filter((u) => wanted.has(u.name));
}

/** 端过滤：单元保留 filter 中的端 */
function applyPlatformFilter(units: ScopeUnit[], filter: string[]): ScopeUnit[] {
  if (filter.length === 0) return units;
  return units
    .map((u) => ({ ...u, platforms: u.platforms.filter((p) => filter.includes(p)) }))
    .filter((u) => u.platforms.length > 0);
}

/**
 * 解析验证范围 → 功能单元列表。
 * 非法 scope 抛错（由调用方捕获提示用法）。
 */
export async function resolveScopeUnits(input: ScopeResolveInput): Promise<ScopeResolveOutput> {
  const specsDir = join(input.iterDir, '020-specs');
  const all = await listAllUnits(specsDir);
  const warnings: string[] = [];

  let units: ScopeUnit[];
  const scope = (input.scope || 'all').trim();

  if (scope === 'all') {
    units = all;
  } else if (scope === 'deployed') {
    const manifest = await loadDeployManifest(input.projectRoot);
    if (!manifest) {
      throw new Error(
        '未找到部署清单（.speccore/local/deploy-manifest.json）。请先执行 speccore deploy 部署，再使用 --scope deployed'
      );
    }
    units = filterByDeployed(all, manifest);
    if (units.length === 0) {
      warnings.push(
        `部署清单（${manifest.time}，端: ${manifest.platforms.map((p) => p.name).join(', ')}）与 020-specs 无交集，无可验证单元`
      );
    }
  } else if (scope.startsWith('modules:')) {
    const modules = parsePlatformFilter(scope.slice('modules:'.length));
    if (modules.length === 0) {
      throw new Error('--scope modules: 后需跟功能单元名（逗号分隔），如 modules:订单管理,用户管理');
    }
    units = filterByModules(all, modules);
    const found = new Set(units.map((u) => u.name));
    for (const m of modules) {
      if (!found.has(m)) warnings.push(`模块 "${m}" 在 020-specs 中不存在，已忽略`);
    }
  } else {
    throw new Error(`未知验证范围 "${scope}"，可用: all | deployed | modules:单元名(逗号分隔)`);
  }

  // 端过滤
  const filter = parsePlatformFilter(input.platformFilter);
  units = applyPlatformFilter(units, filter);

  return { units, warnings };
}
