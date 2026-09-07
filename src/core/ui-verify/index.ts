/**
 * UI Verify — 统一导出
 */

export * from './types';
export { runSmokeTest } from './smoke-engine';
export { runVisualCheck, isVisualModelAvailable } from './visual-engine';
export { generateHtmlReport } from './report-generator';

// v8.3.57+: 路由/页面自动发现 + 模块过滤
export { scanRoutes, detectFramework, flattenRoutes } from './route-scanner';
export type { DiscoveredRoute, RouteScanResult, ScanRoutesOptions } from './route-scanner';
export { scanPages } from './page-scanner';
export type { PageEntry, PageScanResult } from './page-scanner';
export { generateSpecFromRoutes, generateSpecFromPages, writeVerifySpec } from './spec-generator';
export type { SpecGenerationOptions } from './spec-generator';
export { filterSpec, parseFilterArgs, logFilterSummary } from './module-filter';
export type { FilterOptions } from './module-filter';
