/**
 * module-filter — 按模块/页面过滤测试规格
 *
 * 支持：
 * - 按模块名过滤（如 --module=booking）
 * - 按页面路径过滤（如 --page=/login）
 * - 按 scenario 名称过滤（如 --scenario="预订列表"）
 *
 * v8.3.57+ 新增
 */

import type { VerifySpec, Scenario } from './types';

export interface FilterOptions {
  modules?: string[];     // --module 参数（可多个，逗号分隔）
  pages?: string[];       // --page 参数（可多个）
  scenarios?: string[];   // --scenario 参数（可多个）
}

// ── 主过滤函数 ──
export function filterSpec(spec: VerifySpec, options: FilterOptions): VerifySpec {
  if (!hasActiveFilter(options)) return spec;

  const filtered = spec.scenarios.filter(s => matchesFilter(s, options));

  return {
    ...spec,
    scenarios: filtered,
  };
}

// ── 检查是否有活跃的过滤条件 ──
function hasActiveFilter(options: FilterOptions): boolean {
  return !!(options.modules?.length || options.pages?.length || options.scenarios?.length);
}

// ── 单个 scenario 是否匹配过滤条件 ──
function matchesFilter(scenario: Scenario, options: FilterOptions): boolean {
  const name = scenario.name || '';
  const desc = scenario.description || '';

  // 模块过滤：scenario name 或 description 包含模块名
  if (options.modules && options.modules.length > 0) {
    const matchModule = options.modules.some(m =>
      name.toLowerCase().includes(m.toLowerCase()) ||
      desc.toLowerCase().includes(m.toLowerCase())
    );
    if (!matchModule) return false;
  }

  // 页面过滤：scenario name 或 description 包含页面路径
  if (options.pages && options.pages.length > 0) {
    const matchPage = options.pages.some(p =>
      name.toLowerCase().includes(p.toLowerCase()) ||
      desc.toLowerCase().includes(p.toLowerCase())
    );
    if (!matchPage) return false;
  }

  // scenario 名称过滤：精确或模糊匹配
  if (options.scenarios && options.scenarios.length > 0) {
    const matchScenario = options.scenarios.some(s =>
      name.toLowerCase() === s.toLowerCase() ||
      name.toLowerCase().includes(s.toLowerCase())
    );
    if (!matchScenario) return false;
  }

  return true;
}

// ── 解析 CLI 过滤参数 ──
export function parseFilterArgs(
  moduleArg?: string,
  pageArg?: string,
  scenarioArg?: string
): FilterOptions {
  return {
    modules: moduleArg ? moduleArg.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    pages: pageArg ? pageArg.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    scenarios: scenarioArg ? scenarioArg.split(',').map(s => s.trim()).filter(Boolean) : undefined,
  };
}

// ── 打印过滤结果摘要 ──
export function logFilterSummary(spec: VerifySpec, filtered: VerifySpec): void {
  if (spec.scenarios.length === filtered.scenarios.length) return;

  const { logger } = require('../../utils/logger');
  logger.info(`🔍 过滤后: ${filtered.scenarios.length}/${spec.scenarios.length} 个场景`);

  const removed = spec.scenarios.filter(s => !filtered.scenarios.includes(s));
  if (removed.length > 0 && removed.length <= 5) {
    logger.info('   跳过的场景:');
    for (const s of removed) {
      logger.info(`     ⏭️  ${s.name}`);
    }
  }
}
