/**
 * spec-generator — 从扫描结果生成 VERIFY_SPEC.yaml
 *
 * v8.3.57+ 新增
 */

import { writeFile, ensureDir } from 'fs-extra';
import { join } from 'path';
import type { DiscoveredRoute } from './route-scanner';
import type { PageEntry } from './page-scanner';
import type { VerifySpec, Scenario, Action, Assertion } from './types';

export interface SpecGenerationOptions {
  baseUrl: string;
  platform: string;
  name?: string;
}

// ── 从路由扫描结果生成规格 ──
export function generateSpecFromRoutes(
  routes: DiscoveredRoute[],
  options: SpecGenerationOptions
): VerifySpec {
  const scenarios: Scenario[] = [];

  for (const route of routes) {
    if (route.path.includes(':') || route.path.includes('*')) {
      // 跳过动态路由和通配符（需要手动配置具体参数）
      continue;
    }

    const scenario = createScenarioForRoute(route, options.baseUrl);
    if (scenario) scenarios.push(scenario);

    if (route.children) {
      for (const child of route.children) {
        if (child.path.includes(':') || child.path.includes('*')) continue;
        const childScenario = createScenarioForRoute(child, options.baseUrl);
        if (childScenario) scenarios.push(childScenario);
      }
    }
  }

  return {
    name: options.name || `${options.platform} UI 验证`,
    platform: options.platform,
    url: options.baseUrl,
    scenarios,
  };
}

// ── 从页面扫描结果生成规格 ──
export function generateSpecFromPages(
  pages: PageEntry[],
  options: SpecGenerationOptions
): VerifySpec {
  const scenarios: Scenario[] = [];

  for (const page of pages) {
    if (!page.routePath || page.routePath.includes(':') || page.routePath.includes('*')) {
      continue;
    }

    const scenarioName = page.module
      ? `${page.module} - ${page.name}`
      : page.name;

    const pageSelector = generatePageSelector(
      slugify(page.module),
      slugify(page.name),
      page.routePath || ''
    );

    scenarios.push({
      name: scenarioName,
      description: `页面: ${page.filePath}`,
      actions: [
        { type: 'navigate' },
        { type: 'wait', delay: 1000 },
      ],
      assertions: [
        { type: 'visible', selector: pageSelector, description: '页面核心容器已加载' },
        { type: 'visible', selector: 'body', description: '页面已加载' },
      ],
    });
  }

  return {
    name: options.name || `${options.platform} UI 验证`,
    platform: options.platform,
    url: options.baseUrl,
    scenarios,
  };
}

// ── 为单个路由创建 scenario ──
function createScenarioForRoute(route: DiscoveredRoute, baseUrl: string): Scenario | null {
  const path = route.path;
  if (!path || path === '/') return null;

  const displayName = route.name || route.component || path;
  const moduleName = route.module || 'default';
  const safeName = slugify(displayName);
  const safeModule = slugify(moduleName);

  // 生成 data-testid 风格的智能 selector
  const pageSelector = generatePageSelector(safeModule, safeName, path);

  return {
    name: `${moduleName} - ${displayName}`,
    description: `路由: ${path}`,
    actions: [
      { type: 'navigate' },
      { type: 'wait', delay: 1000 },
    ],
    assertions: [
      { type: 'visible', selector: pageSelector, description: '页面核心容器已加载' },
      { type: 'visible', selector: 'body', description: '页面已加载' },
    ],
  };
}

/** 生成页面级智能 selector，优先 data-testid 风格 */
function generatePageSelector(moduleName: string, pageName: string, path: string): string {
  // 策略1: data-testid="module-page"（推荐实践）
  const testId = `[data-testid="${moduleName}-${pageName}-page"]`;

  // 策略2: 路由路径作为 id
  const pathId = path.replace(/^\//, '').replace(/\//g, '-');
  const pathSelector = pathId ? `#page-${pathId}` : '';

  // 策略3: 通用容器
  const fallback = `[data-testid="page-container"]`;

  // 返回最佳 selector（实际执行时按顺序匹配，但 YAML 中只写最推荐的一个）
  return testId;
}

/** 将字符串转为安全的 slug */
function slugify(str: string): string {
  return str
    .replace(/^[^a-zA-Z0-9\u4e00-\u9fa5]+/, '')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, '-')
    .toLowerCase()
    .slice(0, 40);
}

// ── 写入规格文件 ──
export async function writeVerifySpec(
  spec: VerifySpec,
  outputPath: string
): Promise<string> {
  await ensureDir(join(outputPath, '..'));

  const yaml = specToYaml(spec);
  await writeFile(outputPath, yaml, 'utf-8');
  return outputPath;
}

// ── VerifySpec → YAML 字符串 ──
function specToYaml(spec: VerifySpec): string {
  const lines: string[] = [];
  lines.push(`name: ${spec.name}`);
  lines.push(`platform: ${spec.platform}`);
  lines.push(`url: ${spec.url}`);
  lines.push('');
  lines.push('scenarios:');

  for (const s of spec.scenarios) {
    lines.push(`  - name: ${s.name}`);
    if (s.description) lines.push(`    description: ${s.description}`);
    lines.push('    actions:');
    for (const a of s.actions) {
      lines.push(`      - type: ${a.type}`);
      if (a.selector) lines.push(`        selector: ${a.selector}`);
      if (a.value) lines.push(`        value: ${a.value}`);
      if (a.delay) lines.push(`        delay: ${a.delay}`);
      if (a.key) lines.push(`        key: ${a.key}`);
      if (a.waitFor) lines.push(`        waitFor: ${a.waitFor}`);
    }
    lines.push('    assertions:');
    for (const ass of s.assertions) {
      lines.push(`      - type: ${ass.type}`);
      if (ass.selector) lines.push(`        selector: ${ass.selector}`);
      if (ass.description) lines.push(`        description: ${ass.description}`);
      if (ass.contains) lines.push(`        contains: ${ass.contains}`);
      if (ass.equals) lines.push(`        equals: ${ass.equals}`);
      if (ass.threshold) lines.push(`        threshold: ${ass.threshold}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
