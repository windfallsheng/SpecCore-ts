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
      if (a.toSelector) lines.push(`        toSelector: ${a.toSelector}`);
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

/**
 * 从 Spec/需求文档的「业务流程」章节生成流程级场景骨架（v8.3.216+）
 *
 * 提取含「→」的流程描述，把每个流程步骤拆成独立场景（导航 + 页面/关键元素断言）。
 * 选择器按 data-testid 约定生成占位（前端需按约定加 data-testid 才生效），
 * 精确的 fill/click 交互步骤由 AI/人工在骨架基础上补充。
 *
 * v8.3.293+: 传入 elementInfo（UI_SPEC「元素标识约定」提取结果）时，
 * 流程步骤命中元素清单即装配真实 data-testid，页面断言优先用页面容器 testid，
 * 实现「生成阶段元素约定 → 冒烟配置自动装配」的闭环。
 */
export function generateFlowScenariosFromSpec(
  specText: string,
  _options: SpecGenerationOptions,
  elementInfo?: ElementTestIdInfo
): Scenario[] {
  const scenarios: Scenario[] = [];
  const lines = specText.split('\n');
  let inFlowSection = false;
  let inMermaid = false;
  const seen = new Set<string>();

  // v8.3.293+: 步骤/流转标签 → 元素 data-testid 装配
  // 匹配策略：① 双向包含；② 步骤按分隔符拆 token 后与元素名包含匹配（如「新增/编辑」→「新增按钮」）。
  // 多候选时取最短元素名（更具体），避免「禁用」误配「禁用确认弹窗」而错过更贴切的短名元素。
  const matchElement = (step: string): string | null => {
    // v8.3.295+: elementInfo 结构防御（elements 缺失时优雅降级，不抛 TypeError）
    if (!elementInfo || !elementInfo.elements) return null;
    const cleaned = step.replace(/[（(][^)）]*[)）]/g, '').trim();
    let best: [number, string] | null = null;
    const consider = (name: string, tid: string) => {
      if (!best || name.length < best[0]) best = [name.length, tid];
    };
    for (const [name, tid] of Object.entries(elementInfo.elements)) {
      if (cleaned.includes(name) || name.includes(cleaned)) { consider(name, tid); continue; }
      for (const tok of cleaned.split(/[/、，,\s]+/)) {
        if (tok.length >= 2 && name.includes(tok)) { consider(name, tid); break; }
      }
    }
    return best ? best[1] : null;
  };

  // v8.3.293+: 页面容器断言：优先命中页面 testid（xxx-page 前缀匹配）；
  // preferPage（stateDiagram 初始进入流转）时兜底取第一个页面容器
  const matchPageSelector = (step: string, key: string, preferPage = false): string => {
    if (elementInfo && Array.isArray(elementInfo.pageTestIds) && elementInfo.pageTestIds.length > 0) {
      const hit = elementInfo.pageTestIds.find(p => {
        const pageKey = p.replace(/-page$/, '');
        return step.includes(pageKey) || pageKey.includes(key) || p.includes(key);
      });
      if (hit) return `[data-testid="${hit}"]`;
      if (preferPage) return `[data-testid="${elementInfo.pageTestIds[0]}"]`;
    }
    return `[data-testid="${key}-page"]`;
  };

  // v8.3.293+: 场景生成（普通流程行与 stateDiagram 流转共用）
  const pushScenario = (step: string, rawKey: string, preferPage = false) => {
    const key = slugifyFlow(rawKey);
    if (!key || seen.has(key)) return;
    seen.add(key);

    // v8.3.293+: 命中元素清单时装配真实 selector
    const elementTestId = matchElement(step);
    const assertions = elementTestId
      ? [
          { type: 'visible' as const, selector: `[data-testid="${elementTestId}"]`, description: `${step}元素可见（按 UI_SPEC 元素清单装配）` },
        ]
      : [
          { type: 'visible' as const, selector: matchPageSelector(step, key, preferPage), description: `${step}页面容器已加载` },
          { type: 'visible' as const, selector: 'body', description: '页面已加载（兜底）' },
        ];

    scenarios.push({
      name: `流程-${step}`,
      description: elementTestId
        ? '流程级场景（元素 selector 按 UI_SPEC 元素标识清单自动装配）'
        : '流程级场景骨架（从业务流程提取）；精确选择器需前端按 data-testid 约定补充',
      actions: [
        { type: 'navigate' },
        { type: 'wait', delay: 800 },
      ],
      assertions,
    });
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // 进入流程/交互章节（兼容「## 五、交互状态」的中文序号前缀）
    if (/^#{2,4}\s*(?:[一二三四五六七八九十0-9]+[、.．]\s*)?(业务流程|核心流程|用户场景|操作流程|交互状态|交互流程|状态流转|流程)/.test(line)) {
      inFlowSection = true;
      continue;
    }
    // 离开流程章节（遇到其他同级标题）
    if (inFlowSection && /^#{2,4}\s/.test(line) && !/流程|交互|场景|状态/.test(line)) {
      inFlowSection = false;
      inMermaid = false;
      continue;
    }
    if (!inFlowSection) continue;

    // v8.3.293+: mermaid 代码块（仅 stateDiagram 状态图解析流转，架构 flowchart 跳过）
    if (!inMermaid && /^```(mermaid|stateDiagram)/i.test(line)) {
      inMermaid = true;
      continue;
    }
    if (inMermaid) {
      if (line.startsWith('```')) { inMermaid = false; continue; }
      // stateDiagram 状态流转行：List --> FormDlg: 新增/编辑（含 [*] 初始伪状态）
      const tm = line.match(/^\s*(\[[\w*]+\]|[\w*]+)\s*-+>\s*([\w\u4e00-\u9fa5*]+)\s*(?::\s*(.+?))?\s*$/);
      if (tm) {
        const from = tm[1].replace(/[\[\]]/g, '');
        const to = tm[2];
        const label = (tm[3] || '').replace(/[（(][^)）]*[)）]/g, '').trim();
        if (from === '*') {
          // 初始进入流转：断言本页主容器（preferPage 兜底）
          pushScenario(label || to, `${to}-enter`, true);
        } else if (to !== '*' && from !== to) {
          // 跳过自环（状态内操作不产生新页面）与指向伪状态的边
          pushScenario(label || to, `${to}-${label || 'flow'}`);
        }
      }
      continue;
    }

    // 普通流程行：提取含箭头（→ 或 ->）的步骤链
    if (!line.includes('→') && !line.includes('->')) continue;

    // 拆分步骤（去掉序号、代码块标记、冒号后的说明）
    const steps = line
      .split(/\s*[→]\s*|\s*->\s*/)
      .map((s) => s.replace(/^[\d.、\-*>\s]+/, '').replace(/[:：].*$/, '').trim())
      .filter((s) => s.length >= 2 && s.length <= 20);

    for (const step of steps) {
      pushScenario(step, step);
    }
  }

  return scenarios;
}

/**
 * UI_SPEC 元素标识清单提取结果（v8.3.293+）
 */
export interface ElementTestIdInfo {
  /** 元素名（中文描述，如「新增按钮」）→ data-testid（如 btn-add-user） */
  elements: Record<string, string>;
  /** 页面容器类 testid（xxx-page 结尾，如 users-page） */
  pageTestIds: string[];
}

/**
 * 从 UI_SPEC 文本提取「元素标识约定」清单（v8.3.293+）
 *
 * 兼容三种写法：
 * 1. Markdown 表格（| 组件/元素 | data-testid |）
 * 2. 行内枚举（data-testid = a / b / c、data-testid：a / b）
 * 3. 代码属性（data-testid="xxx"）
 *
 * 含模板占位的 testid（如 btn-edit-{id}）无法直接作为选择器，自动跳过。
 */
export function extractElementTestIds(specText: string): ElementTestIdInfo {
  const elements: Record<string, string> = {};
  const pageTestIds: string[] = [];
  const validTestId = (tid: string) => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(tid) && !tid.includes('{') && !tid.includes('}');
  const register = (name: string, tid: string) => {
    if (!validTestId(tid)) return;
    elements[name] = tid;
    if (tid.endsWith('-page')) pageTestIds.push(tid);
  };

  const lines = specText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    // 1. Markdown 表格（表头含 data-testid 列）
    if (line.includes('|') && /test-?id/i.test(line)) {
      const cells = line.split('|').map((c) => c.trim());
      // 注意：split('|') 后索引 0 是行首空串，有效列从索引 1 开始
      const testIdCol = cells.findIndex((c) => /test-?id/i.test(c));
      if (testIdCol >= 0) {
        // 元素名列：从索引 1 起第一个非 testid 的非空列（兼容 testid 列在左/右两侧）
        let nameCol = -1;
        for (let k = 1; k < cells.length; k++) {
          if (k !== testIdCol && cells[k] && !/test-?id/i.test(cells[k])) { nameCol = k; break; }
        }
        if (nameCol < 0) continue;
        for (let j = i + 1; j < lines.length; j++) {
          const row = lines[j].trim();
          if (!row.includes('|')) break;
          const rc = row.split('|').map((c) => c.trim());
          if (rc.every((c) => /^:?-{3,}:?$/.test(c))) continue; // 表头分隔行
          const name = rc[nameCol];
          const tid = rc[testIdCol];
          if (name && tid && !/test-?id/i.test(name)) register(name, tid);
        }
      }
    }

    // 2/3. 行内枚举与代码属性
    if (/data-testid/i.test(line)) {
      const inline = line.replace(/^[*-]\s*/, '');
      // data-testid = a / b / c 或 data-testid：a / b
      const enumMatch = inline.match(/data-testid\s*[=：:]\s*([^`"']+)$/i);
      if (enumMatch) {
        const tokens = enumMatch[1].split(/\s*\/\s*|\s*,\s*/).map((s) => s.trim()).filter(Boolean);
        for (const tok of tokens) register(tok, tok);
      } else {
        // data-testid="xxx"（可多个）
        const attrRe = /data-testid\s*=\s*["']([^"']+)["']/gi;
        let m: RegExpExecArray | null;
        while ((m = attrRe.exec(line)) !== null) {
          register(m[1], m[1]);
        }
      }
    }
  }

  return { elements, pageTestIds };
}

/**
 * 从 UI_SPEC/TEST 文档生成流程级 VERIFY_SPEC（v8.3.293+，无源码时的自动装配通道）
 *
 * 装配链：UI_SPEC「元素标识约定」清单 → 业务流程步骤 → 场景 selector 自动对应，
 * 弥合「分析阶段元素约定」与「冒烟配置生成阶段」之间的断链。
 */
export function generateSpecFromUiSpec(specText: string, options: SpecGenerationOptions): VerifySpec {
  const elementInfo = extractElementTestIds(specText);
  const scenarios = generateFlowScenariosFromSpec(specText, options, elementInfo);
  return {
    name: options.name || `${options.platform} UI 验证（Spec 流程骨架）`,
    platform: options.platform,
    url: options.baseUrl,
    scenarios,
  };
}

/** 流程步骤名转 data-testid 安全 slug */
function slugifyFlow(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40);
}
