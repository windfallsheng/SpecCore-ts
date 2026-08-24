/**
 * workspace-manager — 临时工作区管理
 *
 * v8.3.0+: 管理独立内容处理的临时产出（不绑定迭代/任务）
 * 目录: .speccore/local/workspace/
 */

import { readFile, writeFile, pathExists, ensureDir, copy, readdir } from 'fs-extra';
import { join } from 'path';
import { createHash } from 'crypto';

export type WorkspaceType = 'clarify' | 'research';

export interface WorkspaceEntry {
  id: string;
  type: WorkspaceType;
  source: 'file' | 'direct';
  sourcePath?: string;
  createdAt: string;
  wordCount: number;
  hash: string;
  status: 'pending' | 'done' | 'promoted';
  promotedTo?: string;
}

export interface WorkspacePaths {
  base: string;
  inbox: string;
  clarify: string;
  research: string;
  index: string;
}

/** 获取工作区路径 */
export function getWorkspacePaths(cwd: string): WorkspacePaths {
  const base = join(cwd, '.speccore', 'local', 'workspace');
  return {
    base,
    inbox: join(base, 'inbox'),
    clarify: join(base, 'clarify'),
    research: join(base, 'research'),
    index: join(base, 'index.json'),
  };
}

/** 生成短ID */
function shortId(): string {
  return Math.random().toString(36).slice(2, 6);
}

/** 生成工作区条目ID */
function generateEntryId(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${shortId()}`;
}

/** 计算内容哈希 */
function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/** 初始化工作区目录 */
export async function initWorkspace(cwd: string): Promise<WorkspacePaths> {
  const paths = getWorkspacePaths(cwd);
  await ensureDir(paths.inbox);
  await ensureDir(paths.clarify);
  await ensureDir(paths.research);
  if (!(await pathExists(paths.index))) {
    await writeFile(paths.index, JSON.stringify({ entries: [] }, null, 2));
  }
  return paths;
}

/** 读取索引 */
export async function loadIndex(cwd: string): Promise<{ entries: WorkspaceEntry[] }> {
  const paths = getWorkspacePaths(cwd);
  if (!(await pathExists(paths.index))) {
    return { entries: [] };
  }
  try {
    const data = await readFile(paths.index, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { entries: [] };
  }
}

/** 写入索引 */
async function saveIndex(cwd: string, index: { entries: WorkspaceEntry[] }): Promise<void> {
  const paths = getWorkspacePaths(cwd);
  await writeFile(paths.index, JSON.stringify(index, null, 2));
}

/**
 * 将原始内容存入临时工作区（inbox）
 * @returns 生成的条目ID
 */
export async function stageContent(
  cwd: string,
  content: string,
  options: {
    type: WorkspaceType;
    source?: 'file' | 'direct';
    sourcePath?: string;
  }
): Promise<string> {
  const paths = await initWorkspace(cwd);
  const id = generateEntryId();
  const entry: WorkspaceEntry = {
    id,
    type: options.type,
    source: options.source || 'direct',
    sourcePath: options.sourcePath,
    createdAt: new Date().toISOString(),
    wordCount: content.length,
    hash: hashContent(content),
    status: 'pending',
  };

  // 写入 inbox
  const inboxDir = join(paths.inbox, id);
  await ensureDir(inboxDir);
  await writeFile(join(inboxDir, 'source.md'), content);
  await writeFile(join(inboxDir, 'meta.json'), JSON.stringify(entry, null, 2));

  // 更新索引
  const index = await loadIndex(cwd);
  index.entries.push(entry);
  await saveIndex(cwd, index);

  return id;
}

/**
 * 将处理后的产出写入工作区
 */
export async function writeWorkspaceOutput(
  cwd: string,
  id: string,
  type: WorkspaceType,
  files: Record<string, string>
): Promise<void> {
  const paths = getWorkspacePaths(cwd);
  const outDir = join(paths[type], id);
  await ensureDir(outDir);

  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(outDir, name), content);
  }

  // 更新索引状态
  const index = await loadIndex(cwd);
  const entry = index.entries.find(e => e.id === id);
  if (entry) {
    entry.status = 'done';
    await saveIndex(cwd, index);
  }
}

/**
 * 将工作区内容提升到迭代层
 * @param entryId 工作区条目ID
 * @param iteration 目标迭代名
 * @param iterDir 目标迭代目录
 * @returns 提升后的文件路径
 */
export async function promoteToIteration(
  cwd: string,
  entryId: string,
  iteration: string,
  iterDir: string
): Promise<string[]> {
  const paths = getWorkspacePaths(cwd);
  const index = await loadIndex(cwd);
  const entry = index.entries.find(e => e.id === entryId);
  if (!entry) {
    throw new Error(`未找到工作区条目: ${entryId}`);
  }

  const written: string[] = [];
  const sourceDir = entry.type === 'clarify'
    ? join(paths.clarify, entryId)
    : join(paths.research, entryId);

  if (!(await pathExists(sourceDir))) {
    throw new Error(`工作区目录不存在: ${sourceDir}`);
  }

  // 目标路径: Iteration-xxx/020-specs/requirements/ 或 Iteration-xxx/020-specs/research/
  const targetDir = entry.type === 'clarify'
    ? join(iterDir, '020-specs', 'requirements')
    : join(iterDir, '020-specs', 'research');
  await ensureDir(targetDir);

  // 复制所有文件
  const files = await readdir(sourceDir);
  for (const f of files) {
    if (f === 'meta.json') continue; // 不复制 meta.json
    const src = join(sourceDir, f);
    const dest = join(targetDir, `${entryId}-${f}`);
    await copy(src, dest);
    written.push(dest);
  }

  // 更新索引
  entry.status = 'promoted';
  entry.promotedTo = iteration;
  await saveIndex(cwd, index);

  return written;
}

/**
 * 列出工作区中的所有条目
 */
export async function listWorkspaceEntries(
  cwd: string,
  filter?: { type?: WorkspaceType; status?: WorkspaceEntry['status'] }
): Promise<WorkspaceEntry[]> {
  const index = await loadIndex(cwd);
  return index.entries.filter(e => {
    if (filter?.type && e.type !== filter.type) return false;
    if (filter?.status && e.status !== filter.status) return false;
    return true;
  });
}
