import { pathExists, readFile, readdir, writeFile } from 'fs-extra';
import { join } from 'path';

/**
 * 骨架残留体检（v8.3.313+）
 * execute 完成时核对端级文档是否仍含骨架占位——覆盖指令是软约束，
 * 此体检把「残留」从一句 warn 升级为可追溯的待办账本。
 */

/** 骨架占位标记（两类空洞：SKELETON 标记 + _待AI分析_/AI-FILL 占位注释） */
export const SKELETON_MARKERS = ['SPEC-SKELETON', '_待AI分析_', 'AI-FILL'] as const;

/** 端级待覆盖文档名单（REQ/TECH + 前端四文档，与 buildAgentContext 覆盖指令对齐） */
export const SKELETON_DOC_NAMES = [
  'REQ.md',
  'TECH.md',
  'STATE.md',
  'ROUTES.md',
  'COMPONENT_TREE.md',
  'STYLE_GUIDE.md',
] as const;

export interface SkeletonResidue {
  /** 相对任务目录的路径 */
  rel: string;
  /** 命中的骨架标记（去重） */
  markers: string[];
}

/** 递归扫描目录树的跳过项（模块级共享文档不归 execute 覆盖义务，不体检） */
const SKIP_DIRS = new Set(['.meta', '00-specs', '_shared', 'node_modules', '.git', 'tests', 'src', 'dist', 'build']);

/**
 * 收集任务目录（组级或子任务级）下所有仍含骨架占位的端级文档。
 * 组级目录会递归到 {端}/{子任务}/ 层；00-specs/_shared 等模块级共享文档跳过。
 */
export async function collectSkeletonResidues(taskDir: string): Promise<SkeletonResidue[]> {
  const residues: SkeletonResidue[] = [];

  const scanDir = async (dir: string, rel: string): Promise<void> => {
    for (const fn of SKELETON_DOC_NAMES) {
      const p = join(dir, fn);
      if (await pathExists(p)) {
        const c = await readFile(p, 'utf-8');
        const markers = SKELETON_MARKERS.filter(m => c.includes(m));
        if (markers.length > 0) {
          residues.push({ rel: rel ? `${rel}/${fn}` : fn, markers });
        }
      }
    }
    try {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        await scanDir(join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
      }
    } catch { /* 目录不可读时跳过，体检不阻断 */ }
  };

  await scanDir(taskDir, '');
  return residues;
}

/**
 * 把骨架残留写入双账本待办（TASK.md 节 + .issues.md 行），幂等：重复执行不叠旧账。
 */
export async function appendSkeletonTodos(taskDir: string, residues: SkeletonResidue[]): Promise<void> {
  if (residues.length === 0) return;

  // 1. TASK.md 追加/刷新「骨架待补清单」节（先摘旧节再写新节）
  const taskMdPath = join(taskDir, 'TASK.md');
  if (await pathExists(taskMdPath)) {
    let md = await readFile(taskMdPath, 'utf-8');
    const sectionTitle = '## ⚠️ 骨架待补清单';
    const idx = md.indexOf(sectionTitle);
    if (idx >= 0) md = md.slice(0, idx).trimEnd();
    const lines = [
      `${md ? '\n\n' : ''}${sectionTitle}`,
      '',
      '> 完成骨架体检发现以下端级文档仍含骨架占位（SPEC-SKELETON / _待AI分析_ / AI-FILL），下游审查与回归将缺依据，请覆盖为专业规格：',
      '',
      ...residues.map(r => `- [ ] \`${r.rel}\`（含 ${r.markers.join(' / ')}）`),
      '',
    ];
    await writeFile(taskMdPath, md + lines.join('\n'));
  }

  // 2. .issues.md 追加 issue（先摘旧 [骨架待补] 行再写新行）
  const issuesPath = join(taskDir, '.issues.md');
  let issues: string;
  if (await pathExists(issuesPath)) {
    issues = await readFile(issuesPath, 'utf-8');
    issues = issues
      .split('\n')
      .filter(l => !l.includes('[骨架待补]'))
      .join('\n')
      .trimEnd();
  } else {
    issues = '# 问题追踪\n\n> 执行过程中发现的问题记录于此。';
  }
  const issueLines = residues.map(r => `- [ ] [骨架待补] \`${r.rel}\`（含 ${r.markers.join(' / ')}）— 完成骨架体检发现，请覆盖为专业规格`);
  await writeFile(issuesPath, issues + '\n' + issueLines.join('\n') + '\n');
}
