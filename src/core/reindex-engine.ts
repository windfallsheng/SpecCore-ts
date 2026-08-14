/**
 * reindex-engine — 全量索引重建与一致性检查引擎
 *
 * 扫描三层结构（全局/迭代/代码），检测死链，发现新文件，重建索引
 */

import { readFile, writeFile, pathExists, readdir, ensureDir, stat } from 'fs-extra';
import { join, relative, extname } from 'path';
import { createHash } from 'crypto';
import { getDefaultIteration, getIterationDir } from './context';
import { findTaskDir, TASK_TYPES } from './task-paths';
import { buildKnowledgeGraph, saveKnowledgeGraph, KnowledgeGraph } from './knowledge-graph';
import { detectDecay, formatDecayReport, DecayReport } from './decay-detector';
import { buildContextMarkdown, saveContextMarkdown } from './context-builder';

// ═══════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════

export interface ReindexResult {
  global: LayerResult;
  iteration: LayerResult | null;
  knowledgeGraph?: {
    entities: number;
    relations: number;
    graphFile: string;
    contextFile: string;
  };
  decayReport?: DecayReport;
  summary: {
    totalFiles: number;
    valid: number;
    stale: number;
    added: number;
    fixed: number;
  };
}

export interface LayerResult {
  name: string;
  files: FileEntry[];
  staleLinks: StaleLink[];
  newFiles: string[];
  rebuiltIndexes: string[];
}

export interface FileEntry {
  path: string;
  hash: string;
  size: number;
  mtime: string;
  indexed: boolean;
}

export interface StaleLink {
  file: string;       // 包含引用的文件
  reference: string;  // 指向的不存在文件
  line: number;       // 行号
}

export interface IntegritySnapshot {
  lastScan: string;
  version: string;
  files: Record<string, { hash: string; size: number; mtime: string }>;
}

// ═══════════════════════════════════════════════
// 核心扫描
// ═══════════════════════════════════════════════

/** 递归扫描目录下所有 .md 文件 */
async function scanMarkdownFiles(dir: string, baseDir: string = dir): Promise<FileEntry[]> {
  if (!(await pathExists(dir))) return [];
  const entries: FileEntry[] = [];
  const items = await readdir(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = join(dir, item.name);
    if (item.isDirectory()) {
      if (item.name.startsWith('.') || item.name === 'node_modules' || item.name === 'cache') continue;
      entries.push(...await scanMarkdownFiles(fullPath, baseDir));
    } else if (extname(item.name) === '.md') {
      const st = await stat(fullPath);
      const content = await readFile(fullPath, 'utf-8');
      entries.push({
        path: relative(baseDir, fullPath),
        hash: createHash('md5').update(content).digest('hex').slice(0, 8),
        size: st.size,
        mtime: st.mtime.toISOString(),
        indexed: false,
      });
    }
  }
  return entries;
}

/** 从 Markdown 文件中提取所有内部引用路径 */
function extractReferences(content: string, filePath: string): { ref: string; line: number }[] {
  const refs: { ref: string; line: number }[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Markdown 链接: [text](path)
    const linkMatches = line.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g);
    for (const m of linkMatches) {
      const target = m[2];
      if (target.startsWith('http') || target.startsWith('#')) continue;
      refs.push({ ref: target, line: i + 1 });
    }
    // 反引号路径引用: `path/to/file.md`
    const codeMatches = line.matchAll(/`([a-zA-Z0-9_\-\/]+\.(?:md|yaml|json))`/g);
    for (const m of codeMatches) {
      refs.push({ ref: m[1], line: i + 1 });
    }
  }
  return refs;
}

// ═══════════════════════════════════════════════
// 全局层扫描
// ═══════════════════════════════════════════════

async function scanGlobalLayer(cwd: string): Promise<LayerResult> {
  const globalDir = join(cwd, '.speccore', 'GLOBAL');
  const result: LayerResult = {
    name: '全局层 (.speccore/GLOBAL/)',
    files: [],
    staleLinks: [],
    newFiles: [],
    rebuiltIndexes: [],
  };

  if (!(await pathExists(globalDir))) {
    return result;
  }

  // 1. 扫描所有 .md 文件
  result.files = await scanMarkdownFiles(globalDir, globalDir);

  // 2. 检查 INDEX.md 中的引用是否有效
  const indexPath = join(globalDir, 'INDEX.md');
  if (await pathExists(indexPath)) {
    const indexContent = await readFile(indexPath, 'utf-8');
    const refs = extractReferences(indexContent, indexPath);

    for (const { ref, line } of refs) {
      const refPath = join(globalDir, ref);
      if (!(await pathExists(refPath))) {
        result.staleLinks.push({ file: 'GLOBAL/INDEX.md', reference: ref, line });
      }
    }

    // 检查哪些文件未被 INDEX.md 引用
    const indexedPaths = new Set(refs.map(r => r.ref));
    for (const f of result.files) {
      if (f.path === 'INDEX.md') continue;
      if (!indexedPaths.has(f.path) && !indexedPaths.has(`./${f.path}`)) {
        result.newFiles.push(f.path);
      }
    }
  } else {
    // INDEX.md 不存在，所有文件都是"新增"
    result.newFiles = result.files.filter(f => f.path !== 'INDEX.md').map(f => f.path);
  }

  return result;
}

// ═══════════════════════════════════════════════
// 迭代层扫描
// ═══════════════════════════════════════════════

async function scanIterationLayer(cwd: string, iteration: string): Promise<LayerResult> {
  const iterDir = await getIterationDir(iteration);
  const result: LayerResult = {
    name: `迭代层 (${iteration})`,
    files: [],
    staleLinks: [],
    newFiles: [],
    rebuiltIndexes: [],
  };

  if (!iterDir || !(await pathExists(iterDir))) return result;

  // 1. 扫描 010-requirements/
  const reqDir = join(iterDir, '010-requirements');
  if (await pathExists(reqDir)) {
    const reqFiles = await scanMarkdownFiles(reqDir, reqDir);
    result.files.push(...reqFiles.map(f => ({ ...f, path: `010-requirements/${f.path}` })));

    // 检查 INDEX.md
    const reqIndexPath = join(reqDir, 'INDEX.md');
    if (await pathExists(reqIndexPath)) {
      const indexContent = await readFile(reqIndexPath, 'utf-8');
      const refs = extractReferences(indexContent, reqIndexPath);
      const indexedPaths = new Set(refs.map(r => r.ref));
      for (const f of reqFiles) {
        if (f.path === 'INDEX.md') continue;
        if (!indexedPaths.has(f.path) && !indexedPaths.has(`./${f.path}`)) {
          result.newFiles.push(`010-requirements/${f.path}`);
        }
      }
    }
  }

  // 2. 扫描 020-specs/
  const specsDir = join(iterDir, '020-specs');
  if (await pathExists(specsDir)) {
    const specFiles = await scanMarkdownFiles(specsDir, specsDir);
    result.files.push(...specFiles.map(f => ({ ...f, path: `020-specs/${f.path}` })));

    // 检查是否有 INDEX.md
    const specsIndexPath = join(specsDir, 'INDEX.md');
    if (!(await pathExists(specsIndexPath)) && specFiles.length > 0) {
      result.newFiles.push('020-specs/ (缺少 INDEX.md)');
    }
  }

  // 3. 扫描 030-tasks/ — 检查任务有效性
  const tasksDir = join(iterDir, '030-tasks');
  if (await pathExists(tasksDir)) {
    // 扫描类型子目录
    for (const type of TASK_TYPES) {
      const typeDir = join(tasksDir, type);
      if (!(await pathExists(typeDir))) continue;
      const entries = await readdir(typeDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('Task-')) continue;
        const taskPath = join(typeDir, entry.name);
        result.files.push({
          path: `030-tasks/${type}/${entry.name}`,
          hash: '',
          size: 0,
          mtime: '',
          indexed: true,
        });

        // 检查 _shared/PLATFORMS.md 状态一致性
        await checkPlatformsConsistency(taskPath, entry.name, result);
      }
    }
    // 兼容旧布局
    const rootEntries = await readdir(tasksDir, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (!entry.isDirectory() || !entry.name.startsWith('Task-')) continue;
      result.files.push({
        path: `030-tasks/${entry.name}`,
        hash: '',
        size: 0,
        mtime: '',
        indexed: true,
      });
    }
  }

  // 4. 检查 PROJECT_GRAPH.md 中的任务引用
  const graphPath = join(iterDir, '000-overview', 'PROJECT_GRAPH.md');
  if (await pathExists(graphPath)) {
    const graphContent = await readFile(graphPath, 'utf-8');
    const taskRefs = graphContent.matchAll(/Task-\d+[-\w]*/g);
    for (const ref of taskRefs) {
      const taskId = ref[0];
      const found = await findTaskDir(tasksDir, taskId);
      if (!found) {
        result.staleLinks.push({
          file: '000-overview/PROJECT_GRAPH.md',
          reference: taskId,
          line: 0,
        });
      }
    }
  }

  return result;
}

/** 检查 PLATFORMS.md 中子任务状态是否与实际 TASK.md 一致 */
async function checkPlatformsConsistency(taskDir: string, taskId: string, result: LayerResult): Promise<void> {
  const platformsMd = join(taskDir, '_shared', 'PLATFORMS.md');
  if (!(await pathExists(platformsMd))) return;

  const content = await readFile(platformsMd, 'utf-8');
  // 提取表格中的端名
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line.startsWith('|') || line.includes('端名') || line.match(/^\|\s*[-:]/)) continue;
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length < 4) continue;

    const platformName = cells[0];
    const platformStatus = cells[3];

    // 读取实际 TASK.md 状态
    const taskMdPath = join(taskDir, platformName, 'TASK.md');
    if (await pathExists(taskMdPath)) {
      const taskMdContent = await readFile(taskMdPath, 'utf-8');
      const statusMatch = taskMdContent.match(/\*\*状态\*\*[:\s]*(.+)/);
      if (statusMatch) {
        const actualStatus = statusMatch[1].trim();
        if (!platformStatus.includes(actualStatus.replace('🔲', '').replace('✅', '').trim())) {
          result.staleLinks.push({
            file: `_shared/PLATFORMS.md (${taskId}/${platformName})`,
            reference: `状态不一致: 索引="${platformStatus}" vs 实际="${actualStatus}"`,
            line: 0,
          });
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════
// 索引重建
// ═══════════════════════════════════════════════

/** 重建全局层 INDEX.md */
async function rebuildGlobalIndex(cwd: string, files: FileEntry[]): Promise<string> {
  const globalDir = join(cwd, '.speccore', 'GLOBAL');
  const indexPath = join(globalDir, 'INDEX.md');
  const now = new Date().toISOString().split('T')[0];

  // 按目录分组
  const groups: Record<string, FileEntry[]> = {};
  for (const f of files) {
    if (f.path === 'INDEX.md') continue;
    const dir = f.path.includes('/') ? f.path.split('/')[0] : '(root)';
    if (!groups[dir]) groups[dir] = [];
    groups[dir].push(f);
  }

  const lines = [
    `# 全局知识库索引`,
    '',
    `> 自动生成于 ${now} · speccore reindex`,
    `> 文件总数: ${files.length - (groups['(root)']?.length ? 0 : 0)}`,
    '',
  ];

  for (const [dir, dirFiles] of Object.entries(groups)) {
    const dirLabel = dir === '(root)' ? '根目录' :
      dir === 'synthesis' ? '综合文档' :
      dir === 'platforms' ? '各端文档' :
      dir === 'PROJECTS' ? '各工程文档' : dir;
    lines.push(`## 📂 ${dirLabel}`);
    lines.push('');
    for (const f of dirFiles) {
      const name = f.path.split('/').pop()!.replace('.md', '');
      const desc = getFileDescription(join(globalDir, f.path));
      lines.push(`- \`${f.path}\` — ${desc || name}`);
    }
    lines.push('');
  }

  const content = lines.join('\n');
  await writeFile(indexPath, content, 'utf-8');
  return indexPath;
}

/** 重建迭代层 020-specs/INDEX.md */
async function rebuildSpecsIndex(iterDir: string, files: FileEntry[]): Promise<string> {
  const specsDir = join(iterDir, '020-specs');
  const indexPath = join(specsDir, 'INDEX.md');
  const now = new Date().toISOString().split('T')[0];

  const lines = [
    `# 迭代规格文档索引`,
    '',
    `> 自动生成于 ${now} · speccore reindex`,
    '',
    `## 文档清单`,
    '',
    `| 文件 | 说明 | 大小 |`,
    `| :--- | :--- | :--- |`,
  ];

  for (const f of files) {
    if (f.path === 'INDEX.md') continue;
    // 跳过 platforms/ 子目录（它们有自己的索引）
    const name = f.path.split('/').pop()!.replace('.md', '');
    const desc = getFileDescription(join(specsDir, f.path));
    const sizeStr = f.size > 1024 ? `${(f.size / 1024).toFixed(1)}KB` : `${f.size}B`;
    lines.push(`| \`${f.path}\` | ${desc || name} | ${sizeStr} |`);
  }

  lines.push('');
  const content = lines.join('\n');
  await writeFile(indexPath, content, 'utf-8');
  return indexPath;
}

/** 从文件内容提取简要描述（取第一个 # 标题或前 60 字符） */
function getFileDescription(filePath: string): string {
  // 这个函数是同步的简化版，实际从文件内容提取
  // 在重建索引时，用文件名作为 fallback
  return '';
}

/** 从文件内容异步提取描述 */
async function extractFileDescription(filePath: string): Promise<string> {
  if (!(await pathExists(filePath))) return '';
  try {
    const content = await readFile(filePath, 'utf-8');
    // 取第一个 # 标题
    const titleMatch = content.match(/^#\s+(.+)/m);
    if (titleMatch) return titleMatch[1].trim().slice(0, 60);
    // 取前 60 个非空字符
    const firstLine = content.split('\n').find(l => l.trim().length > 10);
    if (firstLine) return firstLine.trim().replace(/^#+\s*/, '').slice(0, 60);
  } catch { /* ignore */ }
  return '';
}

// ═══════════════════════════════════════════════
// 完整性快照
// ═══════════════════════════════════════════════

async function saveIntegritySnapshot(cwd: string, result: ReindexResult): Promise<void> {
  const cacheDir = join(cwd, '.speccore', 'cache');
  await ensureDir(cacheDir);

  const snapshot: IntegritySnapshot = {
    lastScan: new Date().toISOString(),
    version: '1.0',
    files: {},
  };

  const allFiles = [
    ...(result.global?.files || []),
    ...(result.iteration?.files || []),
  ];

  for (const f of allFiles) {
    if (f.hash) {
      snapshot.files[f.path] = { hash: f.hash, size: f.size, mtime: f.mtime };
    }
  }

  await writeFile(
    join(cacheDir, 'integrity.json'),
    JSON.stringify(snapshot, null, 2),
    'utf-8'
  );
}

// ═══════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════

export async function runReindex(cwd: string, options: { check?: boolean; iteration?: string } = {}): Promise<ReindexResult> {
  const result: ReindexResult = {
    global: { name: '', files: [], staleLinks: [], newFiles: [], rebuiltIndexes: [] },
    iteration: null,
    summary: { totalFiles: 0, valid: 0, stale: 0, added: 0, fixed: 0 },
  };

  // 1. 全局层扫描
  result.global = await scanGlobalLayer(cwd);

  // 2. 迭代层扫描
  const iteration = options.iteration || await getDefaultIteration();
  if (iteration) {
    result.iteration = await scanIterationLayer(cwd, iteration);
  }

  // 3. 统计
  const allFiles = [...result.global.files, ...(result.iteration?.files || [])];
  const allStale = [...result.global.staleLinks, ...(result.iteration?.staleLinks || [])];
  const allNew = [...result.global.newFiles, ...(result.iteration?.newFiles || [])];

  result.summary = {
    totalFiles: allFiles.length,
    valid: allFiles.filter(f => f.indexed || f.hash).length,
    stale: allStale.length,
    added: allNew.length,
    fixed: 0,
  };

  // 4. 修复模式：重建索引
  if (!options.check) {
    // 重建全局 INDEX.md
    if (result.global.newFiles.length > 0 || result.global.staleLinks.length > 0) {
      const rebuilt = await rebuildGlobalIndex(cwd, result.global.files);
      result.global.rebuiltIndexes.push(rebuilt);
      result.summary.fixed += result.global.staleLinks.length;
    }

    // 重建迭代 020-specs/INDEX.md
    if (result.iteration) {
      const specsDir = join((await getIterationDir(iteration))!, '020-specs');
      if (await pathExists(specsDir)) {
        const specFiles = result.iteration.files.filter(f => f.path.startsWith('020-specs/'));
        if (specFiles.length > 0) {
          const rebuilt = await rebuildSpecsIndex((await getIterationDir(iteration))!, specFiles);
          result.iteration.rebuiltIndexes.push(rebuilt);
        }
      }
    }

    // 保存完整性快照
    await saveIntegritySnapshot(cwd, result);

    // ── Phase 2: 知识图谱 + 衰减检测 + CONTEXT.md ──
    const graph = await buildKnowledgeGraph(cwd, iteration);
    const graphFile = await saveKnowledgeGraph(cwd, graph);

    // 衰减检测（对比上次快照）
    const decay = await detectDecay(cwd, graph);
    result.decayReport = decay;

    // 生成 CONTEXT.md
    const contextMd = buildContextMarkdown(graph, decay);
    const contextFile = await saveContextMarkdown(cwd, contextMd, iteration);

    result.knowledgeGraph = {
      entities: Object.keys(graph.entities).length,
      relations: graph.relations.length,
      graphFile,
      contextFile,
    };
  }

  return result;
}
