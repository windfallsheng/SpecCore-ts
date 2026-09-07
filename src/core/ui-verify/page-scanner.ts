/**
 * page-scanner — 页面目录结构扫描
 *
 * 扫描 src/views/、src/pages/、src/screens/ 等目录
 * 按目录层级推断模块划分，生成页面清单
 *
 * v8.3.57+ 新增
 */

import { readdir, pathExists, stat } from 'fs-extra';
import { join } from 'path';

export interface PageEntry {
  name: string;           // 页面文件名（不含扩展名）
  filePath: string;       // 相对路径
  fullPath: string;       // 绝对路径
  module: string;         // 所属模块（目录名）
  routePath?: string;     // 推断的路由路径
}

export interface PageScanResult {
  rootDir: string;        // 扫描的根目录（如 src/views）
  pages: PageEntry[];
  modules: string[];      // 去重后的模块列表
}

// 常见的前端页面目录名
const PAGE_DIR_CANDIDATES = [
  'src/views',
  'src/pages',
  'src/screens',
  'src/routes',
  'views',
  'pages',
  'screens',
];

// 页面文件扩展名
const PAGE_EXTENSIONS = ['.vue', '.tsx', '.jsx', '.ts', '.js'];

// ── 扫描页面目录 ──
export async function scanPages(projectRoot: string): Promise<PageScanResult | null> {
  const rootDir = await findPageDir(projectRoot);
  if (!rootDir) return null;

  const pages: PageEntry[] = [];
  await scanDirRecursive(rootDir, rootDir, '', pages);

  const modules = [...new Set(pages.map(p => p.module))].sort();

  return { rootDir, pages, modules };
}

// 查找页面目录
async function findPageDir(projectRoot: string): Promise<string | null> {
  for (const dir of PAGE_DIR_CANDIDATES) {
    const full = join(projectRoot, dir);
    if (await pathExists(full)) return full;
  }
  return null;
}

// 递归扫描目录
async function scanDirRecursive(
  rootDir: string,
  currentDir: string,
  relativePath: string,
  pages: PageEntry[]
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryRelPath = relativePath ? join(relativePath, entry.name) : entry.name;
    const entryFullPath = join(currentDir, entry.name);

    if (entry.isDirectory()) {
      // 跳过常见非页面目录
      if (shouldSkipDir(entry.name)) continue;
      await scanDirRecursive(rootDir, entryFullPath, entryRelPath, pages);
    } else if (entry.isFile()) {
      const ext = PAGE_EXTENSIONS.find(e => entry.name.endsWith(e));
      if (ext) {
        const name = entry.name.slice(0, -ext.length);
        // 模块名 = 相对路径的第一层目录（如果没有子目录，则用文件名作为模块）
        const module = relativePath
          ? relativePath.split('/')[0]
          : name;

        const routePath = inferRoutePath(entryRelPath, name, ext);

        pages.push({
          name,
          filePath: entryRelPath,
          fullPath: entryFullPath,
          module,
          routePath,
        });
      }
    }
  }
}

// 跳过不需要扫描的目录
function shouldSkipDir(name: string): boolean {
  const skipList = new Set([
    'components', 'composables', 'hooks', 'utils', 'helpers',
    'assets', 'styles', 'css', 'scss', 'less',
    '__tests__', '__mocks__', 'test', 'tests', 'spec',
    'node_modules', '.git', 'dist', 'build', 'public',
  ]);
  return skipList.has(name.toLowerCase());
}

// 从文件路径推断路由路径
function inferRoutePath(relativePath: string, fileName: string, ext: string): string {
  const parts = relativePath.split('/');

  // 如果文件叫 Index.vue / index.vue / Home.vue，使用目录名作为路径
  if (/^(index|home)$/i.test(fileName) && parts.length > 1) {
    return '/' + parts.slice(0, -1).join('/');
  }

  // 常规情况：目录 + 文件名（去掉扩展名）
  const routeParts = [...parts];
  routeParts[routeParts.length - 1] = fileName;

  // 处理动态路由 [id].vue → :id
  const normalized = routeParts.map(p =>
    p.replace(/^\[(\.\.\.)?(.+?)\]$/, (match, rest, name) => rest ? `:${name}+` : `:${name}`)
  );

  return '/' + normalized.join('/');
}
