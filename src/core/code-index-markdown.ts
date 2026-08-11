/**
 * code-index-markdown — 将 CodeIndex 输出为 Markdown 索引文件
 *
 * 输出:
 *   .speccore/cache/CODE_INDEX.md        ← 总索引（端级摘要 + 联动规律）
 *   .speccore/cache/endpoints/<name>.md  ← 各端详情（模块清单 + 导出 + 依赖）
 */
import { writeFile, ensureDir } from 'fs-extra';
import { join } from 'path';
import type { CodeIndex, EndpointInfo, ModuleInfo, GitCorrelation } from './code-scanner';

const CACHE_DIR = join('.speccore', 'cache');

/**
 * 生成所有 Markdown 索引文件
 * 返回生成的文件路径列表
 */
export async function generateMarkdownIndex(index: CodeIndex): Promise<string[]> {
  const generated: string[] = [];

  // 1. 总索引 CODE_INDEX.md
  const mainMd = buildMainIndex(index);
  const mainPath = join(CACHE_DIR, 'CODE_INDEX.md');
  await ensureDir(join(CACHE_DIR, 'endpoints'));
  await writeFile(mainPath, mainMd);
  generated.push(mainPath);

  // 2. 各端 endpoints/<name>.md
  for (const ep of index.endpoints) {
    const epMd = buildEndpointMd(ep, index.modules.filter(m => m.endpoint === ep.name));
    const epPath = join(CACHE_DIR, 'endpoints', `${ep.name}.md`);
    await writeFile(epPath, epMd);
    generated.push(epPath);
  }

  return generated;
}

// ── 总索引 ──

function buildMainIndex(index: CodeIndex): string {
  const lines: string[] = [];
  lines.push('# 项目代码索引');
  lines.push('');
  lines.push(`> 自动生成于 ${new Date(index.updatedAt).toLocaleString('zh-CN')}`);
  lines.push(`> 共 ${index.files.length} 个源码文件，${index.endpoints.length} 个端，${index.modules.length} 个模块`);
  lines.push('');

  // 端识别
  lines.push('## 端识别');
  lines.push('');
  lines.push('| 端 | 路径 | 技术栈 | 入口 | 文件数 |');
  lines.push('|:---|:---|:---|:---|:---|');
  for (const ep of index.endpoints) {
    lines.push(`| **${ep.name}** | \`${ep.rootPath}\` | ${ep.techStack} | \`${ep.entryFile}\` | ${ep.fileCount} |`);
  }
  lines.push('');

  // 端间依赖（从模块依赖推导）
  const crossDeps = new Map<string, Set<string>>();
  for (const mod of index.modules) {
    const epKey = mod.endpoint;
    if (!crossDeps.has(epKey)) crossDeps.set(epKey, new Set());
    for (const dep of mod.dependencies) {
      const targetMod = index.modules.find(m => m.name === dep && m.endpoint !== epKey);
      if (targetMod) crossDeps.get(epKey)!.add(targetMod.endpoint);
    }
  }
  if (crossDeps.size > 0) {
    lines.push('## 端间依赖');
    lines.push('');
    for (const [from, tos] of crossDeps) {
      if (tos.size > 0) {
        lines.push(`- **${from}** → ${[...tos].map(t => `**${t}**`).join(', ')}`);
      }
    }
    lines.push('');
  }

  // 模块概览
  lines.push('## 模块概览');
  lines.push('');
  lines.push('| 模块 | 端 | 文件数 | 核心导出 | 依赖 |');
  lines.push('|:---|:---|:---|:---|:---|');
  for (const mod of index.modules.slice(0, 30)) {
    const topExports = mod.exports.slice(0, 3).map(e => `\`${e}\``).join(', ');
    const deps = mod.dependencies.slice(0, 3).map(d => `\`${d}\``).join(', ');
    lines.push(`| **${mod.name}** | ${mod.endpoint} | ${mod.fileCount} | ${topExports || '—'} | ${deps || '—'} |`);
  }
  lines.push('');

  // git 变更联动规律
  if (index.correlations.length > 0) {
    lines.push('## 变更联动规律（git 统计）');
    lines.push('');
    lines.push(`> 基于最近 ${index.gitStats.analyzedCommits} 次提交分析`);
    lines.push('');
    for (const corr of index.correlations) {
      lines.push(`- ${corr.pattern}`);
    }
    lines.push('');
  }

  // 详情链接
  lines.push('## 各端详情');
  lines.push('');
  for (const ep of index.endpoints) {
    lines.push(`- [${ep.name}](${join('endpoints', ep.name + '.md')})`);
  }
  lines.push('');

  return lines.join('\n');
}

// ── 单端详情 ──

function buildEndpointMd(ep: EndpointInfo, modules: ModuleInfo[]): string {
  const lines: string[] = [];
  lines.push(`# ${ep.name} 端模块索引`);
  lines.push('');
  lines.push(`- **路径**: \`${ep.rootPath}\``);
  lines.push(`- **技术栈**: ${ep.techStack}`);
  lines.push(`- **入口**: \`${ep.entryFile}\``);
  lines.push(`- **文件数**: ${ep.fileCount}`);
  if (ep.frameworks.length > 0) {
    lines.push(`- **框架**: ${ep.frameworks.join(', ')}`);
  }
  lines.push('');

  // 模块清单
  lines.push('## 模块清单');
  lines.push('');
  lines.push('| 模块 | 路径 | 文件数 | 核心文件 | 对外导出 |');
  lines.push('|:---|:---|:---|:---|:---|');
  for (const mod of modules) {
    const coreFiles = mod.coreFiles.map(f => `\`${f.split('/').pop()}\``).join(', ');
    const topExports = mod.exports.slice(0, 5).map(e => `\`${e}\``).join(', ');
    lines.push(`| **${mod.name}** | \`${mod.path}\` | ${mod.fileCount} | ${coreFiles || '—'} | ${topExports || '—'} |`);
  }
  lines.push('');

  // 依赖关系
  const depLines: string[] = [];
  for (const mod of modules) {
    if (mod.dependencies.length > 0) {
      depLines.push(`${mod.name} → ${mod.dependencies.map(d => `**${d}**`).join(', ')}`);
    }
  }
  if (depLines.length > 0) {
    lines.push('## 依赖关系');
    lines.push('');
    for (const d of depLines) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }

  // 核心文件详情
  lines.push('## 核心文件');
  lines.push('');
  for (const mod of modules) {
    if (mod.coreFiles.length > 0) {
      lines.push(`### ${mod.name}`);
      lines.push('');
      for (const f of mod.coreFiles) {
        const expList = mod.exports.slice(0, 5).join(', ');
        lines.push(`- \`${f}\` — 导出: ${expList || '—'}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
