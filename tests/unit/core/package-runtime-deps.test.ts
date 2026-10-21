/**
 * 运行时依赖声明机器锁（v8.3.337）
 *
 * 背景：dist 产物顶层静态 import typescript / zod，但两者不在 dependencies
 * （typescript 在 devDependencies、zod 纯传递依赖侥幸解析），npm 全局安装/
 * 生产安装不装 devDependencies → 运行时 MODULE_NOT_FOUND（Node 版本无关）。
 * 本测试锁定「源码静态 import + dist require 的外部模块必须 ∈ dependencies/
 * optionalDependencies」，防止新增运行时引用漏声明依赖（phantom dependency 事故）。
 *
 * 白名单：inquirer / xlsx 为 try/catch 保护的动态加载（缺失时优雅降级），允许不声明。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

// node 内置模块（require 可解析，无需声明）
const BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'crypto', 'dgram', 'dns',
  'events', 'fs', 'http', 'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'process',
  'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'timers',
  'tls', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib', 'inspector',
]);

// try/catch 保护的动态加载（缺失时优雅降级，允许不声明为依赖）
const PROTECTED_DYNAMIC = new Set(['inquirer', 'xlsx']);

interface PkgInfo {
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

function loadPkg(): PkgInfo {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
}

/** 递归收集目录下所有文件路径 */
function walk(dir: string, excludeDirs: Set<string>): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (!excludeDirs.has(entry)) out.push(...walk(p, excludeDirs));
    } else {
      out.push(p);
    }
  }
  return out;
}

/** 提取 src 顶层静态 import 的外部模块名（排除 type-only / 相对路径 / node: 前缀） */
function extractStaticImports(srcRoot: string): Set<string> {
  const mods = new Set<string>();
  for (const f of walk(srcRoot, new Set(['templates']))) {
    if (!f.endsWith('.ts') || f.endsWith('.d.ts')) continue;
    const content = readFileSync(f, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*import\s+(type\s+)?[^;]*?\sfrom\s+['"]([^'"]+)['"]/);
      if (!m || m[1]) continue; // 跳过非 import 行与 type-only import
      const name = m[2];
      if (name.startsWith('.') || name.startsWith('node:')) continue;
      mods.add(name);
    }
  }
  return mods;
}

/** 提取 dist 产物 require 的外部模块名（过滤行注释） */
function extractDistRequires(distRoot: string): Set<string> {
  const mods = new Set<string>();
  for (const f of walk(distRoot, new Set())) {
    if (!f.endsWith('.js')) continue;
    const content = readFileSync(f, 'utf-8').replace(/\/\/.*$/gm, '');
    for (const m of content.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const name = m[1];
      if (name.startsWith('.') || name.startsWith('node:')) continue;
      mods.add(name);
    }
  }
  return mods;
}

describe('运行时依赖声明机器锁（v8.3.337）', () => {
  const pkg = loadPkg();
  const runtimeDeps = new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.optionalDependencies || {}),
  ]);

  it('typescript / zod 必须声明在 dependencies（防回归 devDependencies 事故）', () => {
    expect(pkg.dependencies, 'typescript 必须在 dependencies').toHaveProperty('typescript');
    expect(pkg.dependencies, 'zod 必须在 dependencies').toHaveProperty('zod');
    expect(pkg.devDependencies, 'typescript 不得残留在 devDependencies').not.toHaveProperty('typescript');
  });

  it('src 顶层静态 import 的外部模块全部 ∈ 运行时依赖', () => {
    const srcRoot = join(ROOT, 'src');
    if (!existsSync(srcRoot)) return;
    const missing: string[] = [];
    for (const name of extractStaticImports(srcRoot)) {
      const base = name.split('/')[0];
      if (BUILTINS.has(name) || BUILTINS.has(base) || PROTECTED_DYNAMIC.has(name)) continue;
      if (!runtimeDeps.has(name) && !runtimeDeps.has(base)) missing.push(name);
    }
    expect(missing, `以下模块被静态 import 但未声明运行时依赖:\n${missing.join('\n')}`).toEqual([]);
  });

  it('dist 产物 require 的外部模块全部 ∈ 运行时依赖（白名单除外）', () => {
    const distRoot = join(ROOT, 'dist');
    if (!existsSync(distRoot)) return; // 未构建时跳过（src 扫描已覆盖声明面）
    const missing: string[] = [];
    for (const name of extractDistRequires(distRoot)) {
      const base = name.split('/')[0];
      if (BUILTINS.has(name) || BUILTINS.has(base) || PROTECTED_DYNAMIC.has(name)) continue;
      if (!runtimeDeps.has(name) && !runtimeDeps.has(base)) missing.push(name);
    }
    expect(missing, `以下模块被 dist require 但未声明运行时依赖:\n${missing.join('\n')}`).toEqual([]);
  });
});
