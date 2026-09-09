/**
 * route-scanner — 前端路由自动发现
 *
 * 支持 Vue Router / React Router 配置扫描
 * 从源码中提取路由清单，自动生成测试规格
 *
 * v8.3.57+ 新增
 */

import { readFile, pathExists, readdir } from 'fs-extra';
import { join, dirname, basename, isAbsolute } from 'path';
import { logger } from '../../utils/logger';

export interface DiscoveredRoute {
  path: string;
  name?: string;
  component?: string;
  module?: string;        // 所属模块（从路径推断）
  isLayout?: boolean;     // 是否是布局路由
  children?: DiscoveredRoute[];
}

export interface RouteScanResult {
  framework: 'vue' | 'react' | 'unknown';
  routerFile: string;
  routes: DiscoveredRoute[];
  modules: string[];      // 去重后的模块列表
}

// ── 路由器配置文件候选路径 ──
const VUE_ROUTER_CANDIDATES = [
  'src/router/index.ts',
  'src/router/index.js',
  'src/router/routes.ts',
  'src/router/routes.js',
  'src/router.ts',
  'src/router.js',
];

const REACT_ROUTER_CANDIDATES = [
  'src/App.tsx',
  'src/App.jsx',
  'src/routes.tsx',
  'src/routes.jsx',
  'src/router.tsx',
  'src/router.jsx',
  'src/App.ts',
  'src/App.js',
];

// ── 检测前端框架类型 ──
export async function detectFramework(projectRoot: string): Promise<'vue' | 'react' | 'unknown'> {
  const pkgPath = join(projectRoot, 'package.json');
  if (await pathExists(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['vue-router'] || deps['vue']) return 'vue';
      if (deps['react-router-dom'] || deps['react-router'] || deps['react']) return 'react';
    } catch { /* ignore */ }
  }

  // 根据文件存在性推断
  for (const p of VUE_ROUTER_CANDIDATES) {
    if (await pathExists(join(projectRoot, p))) return 'vue';
  }
  for (const p of REACT_ROUTER_CANDIDATES) {
    if (await pathExists(join(projectRoot, p))) return 'react';
  }

  return 'unknown';
}

export interface ScanRoutesOptions {
  routerFile?: string;  // 显式指定路由文件路径（覆盖自动发现）
}

// ── 扫描路由（入口）──
export async function scanRoutes(
  projectRoot: string,
  options: ScanRoutesOptions = {}
): Promise<RouteScanResult> {
  // 如果用户显式指定了路由文件，直接用它
  if (options.routerFile) {
    const explicitPath = isAbsolute(options.routerFile)
      ? options.routerFile
      : join(projectRoot, options.routerFile);
    if (await pathExists(explicitPath)) {
      const framework = await detectFramework(projectRoot);
      const routes = framework === 'vue'
        ? await parseVueRoutes(explicitPath, projectRoot)
        : await parseReactRoutes(explicitPath, projectRoot);
      return {
        framework: framework === 'unknown' ? 'vue' : framework,
        routerFile: explicitPath,
        routes,
        modules: extractModules(routes),
      };
    }
    logger.warn(`⚠️  指定的路由文件不存在: ${explicitPath}`);
  }

  const framework = await detectFramework(projectRoot);

  if (framework === 'vue') {
    const routerFile = await findRouterFile(projectRoot, VUE_ROUTER_CANDIDATES);
    if (routerFile) {
      const routes = await parseVueRoutes(routerFile, projectRoot);
      return { framework, routerFile, routes, modules: extractModules(routes) };
    }
  }

  if (framework === 'react') {
    const routerFile = await findRouterFile(projectRoot, REACT_ROUTER_CANDIDATES);
    if (routerFile) {
      const routes = await parseReactRoutes(routerFile, projectRoot);
      return { framework, routerFile, routes, modules: extractModules(routes) };
    }
  }

  return { framework: 'unknown', routerFile: '', routes: [], modules: [] };
}

// ── 查找路由配置文件 ──
async function findRouterFile(projectRoot: string, candidates: string[]): Promise<string | null> {
  for (const p of candidates) {
    const full = join(projectRoot, p);
    if (await pathExists(full)) return full;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// Vue Router 解析
// ═══════════════════════════════════════════════════════════

async function parseVueRoutes(routerFile: string, projectRoot: string): Promise<DiscoveredRoute[]> {
  const content = await readFile(routerFile, 'utf-8');
  const routes: DiscoveredRoute[] = [];

  // 策略1：直接提取路由数组字面量（最常用）
  // const routes = [ { path: '...', component: ... }, ... ]
  const arrayMatch = content.match(/(?:const|let|var)\s+routes\s*=\s*(\[[\s\S]*?\]);?\s*(?:export|const|function|new|createRouter|$)/);
  if (arrayMatch) {
    const routeArray = extractRouteObjects(arrayMatch[1], projectRoot);
    routes.push(...routeArray);
  }

  // 策略2：提取从其他文件导入的路由
  // import routes from './routes'
  const importMatch = content.match(/import\s+routes\s+from\s+['"]([^'"]+)['"]/);
  if (importMatch && routes.length === 0) {
    const importedPath = resolveImportPath(importMatch[1], dirname(routerFile));
    if (importedPath && await pathExists(importedPath)) {
      const importedRoutes = await parseVueRoutes(importedPath, projectRoot);
      routes.push(...importedRoutes);
    }
  }

  // 策略3：提取 createRouter({ routes: [...] }) 中的 routes
  const createRouterMatch = content.match(/routes\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
  if (createRouterMatch && routes.length === 0) {
    const routeArray = extractRouteObjects(createRouterMatch[1], projectRoot);
    routes.push(...routeArray);
  }

  return routes;
}

// 从数组文本中提取路由对象
function extractRouteObjects(arrayText: string, projectRoot: string): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];

  // 匹配单个路由对象：{ path: '...', ... }
  const routeRegex = /\{\s*path\s*:\s*['"]([^'"]*?)['"]\s*,?/g;
  let match: RegExpExecArray | null;

  while ((match = routeRegex.exec(arrayText)) !== null) {
    const startIdx = match.index;
    const path = match[1];

    // 找到这个对象的结束位置（匹配花括号）
    const endIdx = findObjectEnd(arrayText, startIdx);
    const objText = arrayText.slice(startIdx, endIdx);

    const route = parseRouteObject(objText, projectRoot);
    if (route) routes.push(route);
  }

  return routes;
}

// 解析单个路由对象文本
function parseRouteObject(objText: string, projectRoot: string): DiscoveredRoute | null {
  const pathMatch = objText.match(/path\s*:\s*['"]([^'"]*?)['"]/);
  if (!pathMatch) return null;

  const path = pathMatch[1];
  if (path === '*' || path === '' || path === '/') {
    // 跳过通配符和根路由（通常重定向）
    return null;
  }

  const nameMatch = objText.match(/name\s*:\s*['"]([^'"]*?)['"]/);
  const name = nameMatch ? nameMatch[1] : undefined;

  // 提取 component（直接引用或动态导入）
  let component: string | undefined;
  const compMatch = objText.match(/component\s*:\s*([A-Za-z0-9_]+)/);
  if (compMatch) {
    component = compMatch[1];
  } else {
    const lazyMatch = objText.match(/component\s*:\s*\(\)\s*=>\s*import\(['"]([^'"]+)['"]\)/);
    if (lazyMatch) {
      component = lazyMatch[1];
    }
  }

  // 从 component 路径推断模块
  let module: string | undefined;
  if (component) {
    module = inferModuleFromPath(component);
  }
  if (!module) {
    module = inferModuleFromRoutePath(path);
  }

  const route: DiscoveredRoute = { path, name, component, module };

  // 处理 children
  const childrenMatch = objText.match(/children\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
  if (childrenMatch) {
    route.children = extractRouteObjects(childrenMatch[1], projectRoot);
    route.children.forEach(c => {
      if (!c.module && module) c.module = module;
      // 子路由路径拼接
      if (!c.path.startsWith('/')) {
        c.path = path.replace(/\/$/, '') + '/' + c.path;
      }
    });
  }

  return route;
}

// ═══════════════════════════════════════════════════════════
// React Router 解析
// ═══════════════════════════════════════════════════════════

async function parseReactRoutes(routesFile: string, projectRoot: string): Promise<DiscoveredRoute[]> {
  const content = await readFile(routesFile, 'utf-8');
  const routes: DiscoveredRoute[] = [];

  // 策略1：createBrowserRouter/createHashRouter 数组参数
  const routerMatch = content.match(/create(?:Browser|Hash|Memory)Router\s*\((\[[\s\S]*?\])\s*\)/);
  if (routerMatch) {
    const routeArray = extractRouteObjects(routerMatch[1], projectRoot);
    routes.push(...routeArray);
  }

  // 策略2：JSX Route 组件
  // <Route path="..." element={<Xxx />} />
  const jsxRouteRegex = /<Route\s+[^>]*path\s*=\s*['"]([^'"]*?)['"][^>]*>/g;
  let jsxMatch: RegExpExecArray | null;
  while ((jsxMatch = jsxRouteRegex.exec(content)) !== null) {
    const path = jsxMatch[1];
    const fullTag = jsxMatch[0];

    if (path === '*' || path === '') continue;

    const elementMatch = fullTag.match(/element\s*=\s*\{<([A-Za-z0-9_]+)/);
    const lazyMatch = fullTag.match(/element\s*=\s*\{<(?:React\.)?Suspense[^>]*>[^<]*<([A-Za-z0-9_]+)/);

    let component: string | undefined;
    if (elementMatch) component = elementMatch[1];
    else if (lazyMatch) component = lazyMatch[1];

    const module = inferModuleFromRoutePath(path) || (component ? inferModuleFromPath(component) : undefined);

    routes.push({ path, component, module });
  }

  return routes;
}

// ═══════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════

// 找到对象字面量的结束位置（匹配花括号）
function findObjectEnd(text: string, startIdx: number): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    const prev = text[i - 1];
    if (inString) {
      if (ch === inString && prev !== '\\') inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

// 从 component 路径推断模块名
function inferModuleFromPath(componentPath: string): string | undefined {
  // 例如：@/views/booking/List.vue → booking
  // 例如：../views/user/Profile.tsx → user
  const parts = componentPath.split('/');
  const viewsIdx = parts.findIndex(p => p === 'views' || p === 'pages' || p === 'screens');
  if (viewsIdx >= 0 && viewsIdx + 1 < parts.length) {
    return parts[viewsIdx + 1];
  }
  // 从父目录推断
  if (parts.length >= 2) {
    const dir = parts[parts.length - 2];
    if (dir && dir !== '.' && dir !== '..') return dir;
  }
  return undefined;
}

// 从路由路径推断模块名
function inferModuleFromRoutePath(routePath: string): string | undefined {
  const segments = routePath.split('/').filter(Boolean);
  if (segments.length > 0) {
    return segments[0];
  }
  return undefined;
}

// 提取所有模块名（去重）
function extractModules(routes: DiscoveredRoute[]): string[] {
  const modules = new Set<string>();
  function collect(r: DiscoveredRoute[]) {
    for (const route of r) {
      if (route.module) modules.add(route.module);
      if (route.children) collect(route.children);
    }
  }
  collect(routes);
  return Array.from(modules).sort();
}

// 解析 import 路径为绝对路径
function resolveImportPath(importPath: string, baseDir: string): string | null {
  if (importPath.startsWith('.')) {
    return join(baseDir, importPath);
  }
  if (importPath.startsWith('@/')) {
    // 简化为从 baseDir 的父目录查找 src/
    return join(baseDir, '..', importPath.replace('@/', ''));
  }
  return null;
}

// ── 扁平化路由（把嵌套路由展开为列表）──
export function flattenRoutes(routes: DiscoveredRoute[]): DiscoveredRoute[] {
  const flat: DiscoveredRoute[] = [];
  function walk(r: DiscoveredRoute[]) {
    for (const route of r) {
      flat.push(route);
      if (route.children) walk(route.children);
    }
  }
  walk(routes);
  return flat;
}
