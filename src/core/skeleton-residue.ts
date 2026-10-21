import { pathExists, readFile, readdir, writeFile } from 'fs-extra';
import { join, dirname, basename } from 'path';

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
 * residues 为空时清账本（摘旧「骨架待补清单」节与 [骨架待补] 行）——供自动降级
 * 填充后同步账本，避免已填文件继续挂待办。
 */
export async function appendSkeletonTodos(taskDir: string, residues: SkeletonResidue[]): Promise<void> {
  // 1. TASK.md 追加/刷新「骨架待补清单」节（先摘旧节再写新节）
  const taskMdPath = join(taskDir, 'TASK.md');
  if (await pathExists(taskMdPath)) {
    let md = await readFile(taskMdPath, 'utf-8');
    const sectionTitle = '## ⚠️ 骨架待补清单';
    const idx = md.indexOf(sectionTitle);
    if (idx >= 0) md = md.slice(0, idx).trimEnd();
    if (residues.length > 0) {
      const lines = [
        `${md ? '\n\n' : ''}${sectionTitle}`,
        '',
        '> 完成骨架体检发现以下端级文档仍含骨架占位（SPEC-SKELETON / _待AI分析_ / AI-FILL），下游审查与回归将缺依据，请覆盖为专业规格：',
        '',
        ...residues.map(r => `- [ ] \`${r.rel}\`（含 ${r.markers.join(' / ')}）`),
        '',
      ];
      await writeFile(taskMdPath, md + lines.join('\n'));
    } else {
      await writeFile(taskMdPath, md);
    }
  }

  // 2. .issues.md 追加 issue（先摘旧 [骨架待补] 行再写新行；residues 空 = 只摘不写）
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
  if (residues.length > 0) {
    const issueLines = residues.map(r => `- [ ] [骨架待补] \`${r.rel}\`（含 ${r.markers.join(' / ')}）— 完成骨架体检发现，请覆盖为专业规格`);
    await writeFile(issuesPath, issues + '\n' + issueLines.join('\n') + '\n');
  } else {
    await writeFile(issuesPath, issues + '\n');
  }
}

/**
 * 从子任务/模块目录向上定位模块级规格目录（含 00-specs/REQ.md 的目录），最多上溯 4 层。
 */
async function findModuleSpecRoot(dir: string): Promise<string | null> {
  let cur = dir;
  for (let i = 0; i < 4; i++) {
    if (await pathExists(join(cur, '00-specs', 'REQ.md'))) return join(cur, '00-specs');
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

/**
 * CLI 自动降级填充（v8.3.337+）：execute 完成体检发现端级 REQ/TECH 骨架残留时，
 * 不再只挂待办——从模块级 00-specs 真实规格（analyze 产物）派生端级快照覆盖骨架，
 * 下游审查/回归至少拿到真实需求与技术依据。
 *
 * - 仅 REQ.md / TECH.md 可降级（模块级有对应真实规格）；前端四文档无模块级对应物，保持挂待办。
 * - 模块级源本身含骨架标记或内容过短（<80 字符）时不降级，避免拿骨架覆盖骨架。
 *
 * @returns 已成功填充的 rel 集合（调用方据此算剩余残留）
 */
export async function autoFillSkeletonFallback(
  taskDir: string,
  residues: SkeletonResidue[],
): Promise<Set<string>> {
  const filled = new Set<string>();
  const specRoot = await findModuleSpecRoot(taskDir);
  if (!specRoot) return filled;

  for (const r of residues) {
    const fn = basename(r.rel);
    if (fn !== 'REQ.md' && fn !== 'TECH.md') continue;
    const srcPath = join(specRoot, fn);
    if (!(await pathExists(srcPath))) continue;
    const src = (await readFile(srcPath, 'utf-8')).trim();
    if (src.length < 80 || SKELETON_MARKERS.some(m => src.includes(m))) continue;

    // 端名：子任务目录场景取其父目录名（{端}/Task-{模块名}）；组级扫描场景取 rel 第一段
    let platformName = '';
    if (basename(taskDir).startsWith('Task-')) {
      platformName = basename(dirname(taskDir));
    } else {
      const seg = r.rel.split('/')[0];
      if (seg !== fn && !seg.includes('.')) platformName = seg;
    }

    const header = `# ${platformName ? `${platformName} 端` : '本端'}规格（端级快照）\n\n` +
      `> 本文件由 CLI 在 execute 完成体检时自动降级填充：宿主 AI 未覆盖端级骨架，\n` +
      `> 内容为模块级 \`00-specs/${fn}\` 的真实规格快照，请结合本端实现补充端级细节。\n\n---\n\n`;
    await writeFile(join(taskDir, r.rel), header + src);
    filled.add(r.rel);
  }
  return filled;
}
