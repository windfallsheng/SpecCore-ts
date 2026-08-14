/**
 * knowledge-graph — 知识图谱构建引擎
 *
 * 从文件系统扫描需求/规格/任务/子任务，提取实体和关联关系
 * 输出 knowledge-graph.json（机器读）+ CONTEXT.md（AI 读）
 */

import { readFile, writeFile, pathExists, readdir, ensureDir, stat } from 'fs-extra';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import { getIterationDir, getDefaultIteration } from './context';
import { findTaskDir, TASK_TYPES } from './task-paths';
import { isTimestampBackup } from '../utils/task-utils';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════
// 进程级缓存（避免每次 ask 都重新加载知识图谱）
// ═══════════════════════════════════════════════

interface KGCacheEntry {
  graph: KnowledgeGraph;
  mtime: number;
}

const kgCache = new Map<string, KGCacheEntry>();

// ═══════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════

export interface KnowledgeGraph {
  version: string;
  generated: string;
  iteration: string;
  entities: Record<string, GraphEntity>;
  relations: GraphRelation[];
  stats: GraphStats;
}

export interface GraphEntity {
  id: string;
  type: 'requirement' | 'spec' | 'task' | 'subtask' | 'user-file';
  title: string;
  file: string;           // 相对路径
  hash: string;           // 内容 hash（用于衰减检测）
  mtime: string;          // 最后修改时间
  status?: string;        // 任务状态
  platform?: string;      // 子任务所属端
  parentTaskId?: string;  // 子任务的父任务 ID
  tags?: string[];        // 标签
}

export interface GraphRelation {
  from: string;
  to: string;
  type: 'implements' | 'specifies' | 'subtask_of' | 'depends_on' | 'references';
}

export interface GraphStats {
  requirements: number;
  specs: number;
  tasks: number;
  subtasks: number;
  userFiles: number;
  relations: number;
}

// ═══════════════════════════════════════════════
// 文件扫描辅助
// ═══════════════════════════════════════════════

async function fileHash(filePath: string): Promise<{ hash: string; mtime: string }> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const { stat } = await import('fs-extra');
    const st = await stat(filePath);
    return {
      hash: createHash('md5').update(content).digest('hex').slice(0, 8),
      mtime: st.mtime.toISOString(),
    };
  } catch {
    return { hash: '', mtime: '' };
  }
}

/** 从 Markdown 文件提取第一个 # 标题 */
async function extractTitle(filePath: string): Promise<string> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const match = content.match(/^#\s+(.+)/m);
    return match ? match[1].trim().slice(0, 80) : '';
  } catch {
    return '';
  }
}

/** 从 Markdown 内容提取需求 ID（如 REQ-001） */
function extractReqId(content: string, fallback: string): string {
  const match = content.match(/(REQ-\d+)/);
  return match ? match[1] : fallback;
}

// ═══════════════════════════════════════════════
// 需求扫描
// ═══════════════════════════════════════════════

async function scanRequirements(iterDir: string, iterName: string): Promise<{
  entities: GraphEntity[];
  relations: GraphRelation[];
}> {
  const entities: GraphEntity[] = [];
  const relations: GraphRelation[] = [];
  const reqDir = join(iterDir, '010-requirements');

  if (!(await pathExists(reqDir))) return { entities, relations };

  // 递归扫描所有 .md 文件
  const scanDir = async (dir: string, prefix: string) => {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.name.startsWith('.') || isTimestampBackup(item.name)) continue;
      const fullPath = join(dir, item.name);
      const relPath = `${prefix}${item.name}`;

      if (item.isDirectory()) {
        // sources/ 由 scanUserFiles() 单独处理，避免双重注册
        if (item.name === 'sources') continue;
        await scanDir(fullPath, `${relPath}/`);
      } else if (item.name.endsWith('.md') && item.name !== 'INDEX.md' && !isTimestampBackup(item.name)) {
        const { hash, mtime } = await fileHash(fullPath);
        const title = await extractTitle(fullPath);
        const content = await readFile(fullPath, 'utf-8').catch(() => '');
        // 用路径前缀确保 ID 唯一性，避免不同文件引用同一 REQ-xxx 时覆盖
        const pathPrefix = relPath.replace(/\.md$/, '').replace(/\//g, '-');
        const reqId = extractReqId(content, pathPrefix);

        entities.push({
          id: reqId,
          type: 'requirement',
          title: title || item.name.replace('.md', ''),
          file: `010-requirements/${relPath}`,
          hash,
          mtime,
          tags: [
            prefix.includes('features/') ? 'feature'
            : prefix.includes('bugs/') ? 'bug'
            : prefix.includes('refactors/') ? 'refactor'
            : prefix.includes('research/') ? 'research'
            : 'requirement'
          ],
        });
      }
    }
  };

  await scanDir(reqDir, '');
  return { entities, relations };
}

// ═══════════════════════════════════════════════
// 规格扫描
// ═══════════════════════════════════════════════

async function scanSpecs(iterDir: string): Promise<{
  entities: GraphEntity[];
  relations: GraphRelation[];
}> {
  const entities: GraphEntity[] = [];
  const relations: GraphRelation[] = [];
  const specsDir = join(iterDir, '020-specs');

  if (!(await pathExists(specsDir))) return { entities, relations };

  const items = await readdir(specsDir, { withFileTypes: true });
  for (const item of items) {
    if (item.name.startsWith('.') || isTimestampBackup(item.name)) continue;
    if (!item.name.endsWith('.md') || item.name === 'INDEX.md') continue;

    const fullPath = join(specsDir, item.name);
    const { hash, mtime } = await fileHash(fullPath);
    const title = await extractTitle(fullPath);

    entities.push({
      id: `SPEC:${item.name.replace('.md', '')}`,
      type: 'spec',
      title: title || item.name.replace('.md', ''),
      file: `020-specs/${item.name}`,
      hash,
      mtime,
    });
  }

  // 扫描 platforms/ 子目录
  const platformsDir = join(specsDir, 'platforms');
  if (await pathExists(platformsDir)) {
    const platformEntries = await readdir(platformsDir, { withFileTypes: true });
    for (const pe of platformEntries) {
      if (!pe.isDirectory()) continue;
      const pFiles = await readdir(join(platformsDir, pe.name));
      for (const f of pFiles) {
        if (!f.endsWith('.md') || isTimestampBackup(f)) continue;
        const fullPath = join(platformsDir, pe.name, f);
        const { hash, mtime } = await fileHash(fullPath);
        const title = await extractTitle(fullPath);

        entities.push({
          id: `SPEC:${pe.name}/${f.replace('.md', '')}`,
          type: 'spec',
          title: title || f.replace('.md', ''),
          file: `020-specs/platforms/${pe.name}/${f}`,
          hash,
          mtime,
          platform: pe.name,
        });
      }
    }
  }

  // 扫描 features/ 子目录（按功能模块的分析产出）
  const featuresDir = join(specsDir, 'features');
  if (await pathExists(featuresDir)) {
    const featureEntries = await readdir(featuresDir, { withFileTypes: true });
    for (const fe of featureEntries) {
      if (fe.name.startsWith('.') || isTimestampBackup(fe.name)) continue;
      if (!fe.name.endsWith('.md')) continue;
      const fullPath = join(featuresDir, fe.name);
      const { hash, mtime } = await fileHash(fullPath);
      const title = await extractTitle(fullPath);
      const featureName = fe.name.replace('.md', '');

      entities.push({
        id: `SPEC:features/${featureName}`,
        type: 'spec',
        title: title || featureName,
        file: `020-specs/features/${fe.name}`,
        hash,
        mtime,
        tags: ['feature-spec'],
      });

      // 关联到对应的需求 feature（同名匹配）
      const reqFeaturePath = join('010-requirements', 'features', featureName);
      const matchedReq = entities.find(e => e.file?.startsWith(reqFeaturePath));
      if (matchedReq) {
        relations.push({
          from: `SPEC:features/${featureName}`,
          to: matchedReq.id,
          type: 'references',
        });
      }
    }
  }

  // 扫描类型目录（bugs/refactors/research — 扁平文件）
  for (const typeDir of ['bugs', 'refactors', 'research']) {
    const typeDirPath = join(specsDir, typeDir);
    if (!(await pathExists(typeDirPath))) continue;
    const typeEntries = await readdir(typeDirPath, { withFileTypes: true });
    for (const te of typeEntries) {
      if (!te.isFile() || !te.name.endsWith('.md') || isTimestampBackup(te.name)) continue;
      const fullPath = join(typeDirPath, te.name);
      const { hash, mtime } = await fileHash(fullPath);
      const title = await extractTitle(fullPath);
      const slug = te.name.replace('.md', '');

      entities.push({
        id: `SPEC:${typeDir}/${slug}`,
        type: 'spec',
        title: title || slug,
        file: `020-specs/${typeDir}/${te.name}`,
        hash,
        mtime,
        tags: [`${typeDir}-spec`],
      });

      // 关联到对应的需求文件（同名匹配）
      const reqPath = join('010-requirements', typeDir, te.name);
      const matchedReq = entities.find(e => e.file === reqPath);
      if (matchedReq) {
        relations.push({
          from: `SPEC:${typeDir}/${slug}`,
          to: matchedReq.id,
          type: 'references',
        });
      }
    }
  }

  return { entities, relations };
}

// ═══════════════════════════════════════════════
// 任务扫描（含子任务）
// ═══════════════════════════════════════════════

async function scanTasks(iterDir: string): Promise<{
  entities: GraphEntity[];
  relations: GraphRelation[];
}> {
  const entities: GraphEntity[] = [];
  const relations: GraphRelation[] = [];
  const tasksDir = join(iterDir, '030-tasks');

  if (!(await pathExists(tasksDir))) return { entities, relations };

  // 扫描类型子目录 + 旧布局
  const taskDirs: { taskId: string; taskPath: string; type: string }[] = [];

  for (const type of TASK_TYPES) {
    const typeDir = join(tasksDir, type);
    if (!(await pathExists(typeDir))) continue;
    const entries = await readdir(typeDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && e.name.startsWith('Task-')) {
        taskDirs.push({ taskId: e.name, taskPath: join(typeDir, e.name), type });
      }
    }
  }

  // 旧布局: 030-tasks/Task-XXX/
  const rootEntries = await readdir(tasksDir, { withFileTypes: true });
  for (const e of rootEntries) {
    if (e.isDirectory() && e.name.startsWith('Task-')) {
      taskDirs.push({ taskId: e.name, taskPath: join(tasksDir, e.name), type: 'feature' });
    }
  }

  for (const { taskId, taskPath, type } of taskDirs) {
    // 读取父任务信息
    const sharedTaskMd = join(taskPath, '_shared', 'TASK.md');
    const oldTaskMd = join(taskPath, '00-specs', 'TASK.md');
    const taskMdPath = (await pathExists(sharedTaskMd)) ? sharedTaskMd :
                       (await pathExists(oldTaskMd)) ? oldTaskMd : null;

    let title = taskId;
    let status = 'pending';
    if (taskMdPath) {
      const content = await readFile(taskMdPath, 'utf-8');
      const titleMatch = content.match(/^#\s+(.+)/m);
      if (titleMatch) title = titleMatch[1].trim().slice(0, 80);
      const statusMatch = content.match(/\*\*状态\*\*[:\s]*(.+)/);
      if (statusMatch) {
        const raw = statusMatch[1].trim();
        if (raw.includes('已完成') || raw.includes('completed')) status = 'completed';
        else if (raw.includes('进行中') || raw.includes('in_progress')) status = 'in_progress';
      }
    }
    // 回退：从 _shared/REQ.md 提取标题和状态
    if (title === taskId) {
      const reqMdPath = join(taskPath, '_shared', 'REQ.md');
      if (await pathExists(reqMdPath)) {
        const reqContent = await readFile(reqMdPath, 'utf-8');
        const reqTitleMatch = reqContent.match(/^#\s+(.+)/m);
        if (reqTitleMatch) title = reqTitleMatch[1].trim().slice(0, 80);
      }
    }

    // hash/mtime 回退链：TASK.md → REQ.md → .meta/status
    let hash = '', mtime = '';
    if (taskMdPath) {
      const h = await fileHash(taskMdPath);
      hash = h.hash; mtime = h.mtime;
    } else {
      const fallbackPaths = [join(taskPath, '_shared', 'REQ.md'), join(taskPath, '.meta', 'status')];
      for (const fp of fallbackPaths) {
        if (await pathExists(fp)) {
          const h = await fileHash(fp);
          hash = h.hash; mtime = h.mtime;
          break;
        }
      }
    }

    entities.push({
      id: taskId,
      type: 'task',
      title,
      file: `030-tasks/${type === 'feature' ? '' : type + '/'}${taskId}`,
      hash,
      mtime,
      status,
      tags: [type],
    });

    // 扫描各端子任务
    const dirEntries = await readdir(taskPath, { withFileTypes: true }).catch(() => []);
    for (const de of dirEntries) {
      if (!de.isDirectory()) continue;
      if (de.name.startsWith('.') || de.name.startsWith('0') || de.name === '_shared' || de.name === '99-artifacts') continue;
      if (isTimestampBackup(de.name)) continue;

      const platformTaskMd = join(taskPath, de.name, 'TASK.md');
      let subTitle = `${title} — ${de.name}`;
      let subStatus = 'pending';
      let subTaskId = `${taskId}-${de.name}`;

      if (await pathExists(platformTaskMd)) {
        const subContent = await readFile(platformTaskMd, 'utf-8');
        const titleMatch = subContent.match(/^#\s+(.+)/m);
        if (titleMatch) subTitle = titleMatch[1].trim().slice(0, 80);
        const statusMatch = subContent.match(/\*\*状态\*\*[:\s]*(.+)/);
        if (statusMatch) {
          const raw = statusMatch[1].trim();
          if (raw.includes('已完成') || raw.includes('completed')) subStatus = 'completed';
          else if (raw.includes('进行中') || raw.includes('in_progress')) subStatus = 'in_progress';
        }
        const subIdMatch = subContent.match(/子任务 ID\*\*[:\s]*`(Task-[^`]+)`/);
        if (subIdMatch) subTaskId = subIdMatch[1];
      }

      // hash 回退：TASK.md → src/ 目录文件 → 空
      let subHash: { hash: string; mtime: string } = { hash: '', mtime: '' };
      if (await pathExists(platformTaskMd)) {
        subHash = await fileHash(platformTaskMd);
      } else {
        const srcDir = join(taskPath, de.name, 'src');
        if (await pathExists(srcDir)) {
          try {
            const srcFiles = await readdir(srcDir);
            if (srcFiles.length > 0) {
              subHash = await fileHash(join(srcDir, srcFiles[0]));
            }
          } catch { /* 忽略 */ }
        }
      }

      entities.push({
        id: subTaskId,
        type: 'subtask',
        title: subTitle,
        file: `030-tasks/${type === 'feature' ? '' : type + '/'}${taskId}/${de.name}`,
        hash: subHash.hash,
        mtime: subHash.mtime,
        status: subStatus,
        platform: de.name,
        parentTaskId: taskId,
      });

      relations.push({
        from: subTaskId,
        to: taskId,
        type: 'subtask_of',
      });
    }
  }

  return { entities, relations };
}

// ═══════════════════════════════════════════════
// 用户自定义文件扫描
// ═══════════════════════════════════════════════

async function scanUserFiles(iterDir: string): Promise<GraphEntity[]> {
  const entities: GraphEntity[] = [];
  const sourcesDir = join(iterDir, '010-requirements', 'sources');

  if (!(await pathExists(sourcesDir))) return entities;

  const scanDir = async (dir: string, prefix: string) => {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.name.startsWith('.') || isTimestampBackup(item.name)) continue;
      const fullPath = join(dir, item.name);
      const relPath = `${prefix}${item.name}`;

      if (item.isDirectory()) {
        await scanDir(fullPath, `${relPath}/`);
      } else if (item.name.endsWith('.md')) {
        const { hash, mtime } = await fileHash(fullPath);
        const title = await extractTitle(fullPath);
        entities.push({
          id: `USER:${relPath.replace(/\.md$/, '').replace(/\//g, '-')}`,
          type: 'user-file',
          title: title || item.name.replace('.md', ''),
          file: `010-requirements/sources/${relPath}`,
          hash,
          mtime,
          tags: ['user-file'],
        });
      }
    }
  };

  await scanDir(sourcesDir, '');
  return entities;
}

// ═══════════════════════════════════════════════
// 关联推断
// ═══════════════════════════════════════════════

async function inferRelations(entities: GraphEntity[], iterDir: string): Promise<GraphRelation[]> {
  const relations: GraphRelation[] = [];
  const reqs = entities.filter(e => e.type === 'requirement');
  const tasks = entities.filter(e => e.type === 'task');
  const specs = entities.filter(e => e.type === 'spec');
  const entityMap = new Map(entities.map(e => [e.id, e]));

  // 需求 → 任务：按编号匹配（REQ-001 → Task-001）
  for (const req of reqs) {
    const reqNum = req.id.match(/\d+/)?.[0];
    if (!reqNum) continue;
    for (const task of tasks) {
      const taskNum = task.id.match(/\d+/)?.[0];
      if (taskNum === reqNum) {
        relations.push({ from: task.id, to: req.id, type: 'implements' });
      }
    }
  }

  // 需求 → 任务：内容关键词匹配（当编号匹配失败时回退）
  // 从需求标题中提取 ≥3 字符的特征关键词，匹配任务标题
  const matchedPairs = new Set(relations.map(r => `${r.from}:${r.to}`));
  for (const req of reqs) {
    const reqKeywords = req.title
      .split(/[-_\s]+/)
      .filter(w => w.length >= 3);
    if (reqKeywords.length === 0) continue;

    for (const task of tasks) {
      const pairKey = `${task.id}:${req.id}`;
      if (matchedPairs.has(pairKey)) continue;

      const hasMatch = reqKeywords.some(kw => task.title.includes(kw));
      if (hasMatch) {
        relations.push({ from: task.id, to: req.id, type: 'implements' });
        matchedPairs.add(pairKey);
      }
    }
  }

  // 规格 → 需求：读取 spec 文件内容，提取 REQ-xxx 引用
  for (const spec of specs) {
    const specPath = join(iterDir, spec.file);
    try {
      const content = await readFile(specPath, 'utf-8');
      const reqRefs = content.match(/REQ-\d+/g);
      if (reqRefs) {
        for (const ref of [...new Set(reqRefs)]) {
          if (entityMap.has(ref)) {
            relations.push({ from: spec.id, to: ref, type: 'specifies' });
          }
        }
      }
    } catch { /* 文件不存在或无法读取，跳过 */ }
  }

  // 任务 → 需求 / 任务 → 规格：读取任务目录下的 REQ.md 和 TECH.md
  for (const task of tasks) {
    const taskAbsDir = join(iterDir, task.file);
    const reqPaths = [
      join(taskAbsDir, '_shared', 'REQ.md'),
      join(taskAbsDir, '00-specs', 'REQ.md'),
      join(taskAbsDir, 'REQ.md'),
    ];
    for (const reqPath of reqPaths) {
      if (!(await pathExists(reqPath))) continue;
      try {
        const content = await readFile(reqPath, 'utf-8');
        // 提取 REQ-xxx 引用 → task implements req
        const reqRefs = content.match(/REQ-\d+/g);
        if (reqRefs) {
          for (const ref of [...new Set(reqRefs)]) {
            if (entityMap.has(ref) && !relations.some(r => r.from === task.id && r.to === ref && r.type === 'implements')) {
              relations.push({ from: task.id, to: ref, type: 'implements' });
            }
          }
        }
        // 提取 SPEC:xxx 引用 → task references spec
        const specRefs = content.match(/SPEC:[\w\/\-]+/g);
        if (specRefs) {
          for (const ref of [...new Set(specRefs)]) {
            if (entityMap.has(ref) && !relations.some(r => r.from === task.id && r.to === ref && r.type === 'references')) {
              relations.push({ from: task.id, to: ref, type: 'references' });
            }
          }
        }
      } catch { /* 跳过 */ }
      break; // 只读第一个存在的
    }

    // 读取 API_CONTRACT.yaml 解析依赖
    const contractPath = join(taskAbsDir, '_shared', 'API_CONTRACT.yaml');
    if (await pathExists(contractPath)) {
      try {
        const content = await readFile(contractPath, 'utf-8');
        // 提取依赖的任务引用: dependsOn: Task-xxx 或 # Depends on Task-xxx
        const depRefs = content.match(/(?:dependsOn|depends on|依赖)\s*[:：]\s*(Task-\S+)/gi);
        if (depRefs) {
          for (const raw of depRefs) {
            const m = raw.match(/(Task-\S+)/i);
            if (m && entityMap.has(m[1]) && !relations.some(r => r.from === task.id && r.to === m![1] && r.type === 'depends_on')) {
              relations.push({ from: task.id, to: m[1], type: 'depends_on' });
            }
          }
        }
      } catch { /* 跳过 */ }
    }
  }

  return relations;
}

// ═══════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════

export async function buildKnowledgeGraph(
  cwd: string,
  iteration?: string
): Promise<KnowledgeGraph> {
  const iterName = iteration || await getDefaultIteration();
  const iterDir = await getIterationDir(iterName);

  const graph: KnowledgeGraph = {
    version: '1.0',
    generated: new Date().toISOString(),
    iteration: iterName,
    entities: {},
    relations: [],
    stats: { requirements: 0, specs: 0, tasks: 0, subtasks: 0, userFiles: 0, relations: 0 },
  };

  if (!iterDir || !(await pathExists(iterDir))) return graph;

  // 扫描各层
  const reqResult = await scanRequirements(iterDir, iterName);
  const specResult = await scanSpecs(iterDir);
  const taskResult = await scanTasks(iterDir);
  const userFiles = await scanUserFiles(iterDir);

  // 合并实体（处理 ID 冲突：同名实体用路径前缀去重）
  const allEntities = [
    ...reqResult.entities,
    ...specResult.entities,
    ...taskResult.entities,
    ...userFiles,
  ];

  const idRemap = new Map<string, string>();
  for (const e of allEntities) {
    let finalId = e.id;
    if (graph.entities[e.id]) {
      finalId = `${e.id}@${e.file.replace(/\//g, '-')}`;
      idRemap.set(e.id, finalId);
    }
    e.id = finalId;
    graph.entities[e.id] = e;
  }

  // 同步更新已有关系中的旧 ID
  const remapId = (id: string) => idRemap.get(id) || id;
  for (const r of [...reqResult.relations, ...specResult.relations, ...taskResult.relations]) {
    r.from = remapId(r.from);
    r.to = remapId(r.to);
  }

  // 合并关系
  graph.relations = [
    ...reqResult.relations,
    ...specResult.relations,
    ...taskResult.relations,
    ...(await inferRelations(allEntities, iterDir)),
  ];

  // 统计
  graph.stats = {
    requirements: reqResult.entities.length,
    specs: specResult.entities.length,
    tasks: taskResult.entities.filter(e => e.type === 'task').length,
    subtasks: taskResult.entities.filter(e => e.type === 'subtask').length,
    userFiles: userFiles.length,
    relations: graph.relations.length,
  };

  return graph;
}

/** 保存知识图谱到 cache 目录 */
export async function saveKnowledgeGraph(cwd: string, graph: KnowledgeGraph): Promise<string> {
  const cacheDir = join(cwd, '.speccore', 'cache');
  await ensureDir(cacheDir);
  const filePath = join(cacheDir, 'knowledge-graph.json');
  await writeFile(filePath, JSON.stringify(graph, null, 2), 'utf-8');
  return filePath;
}

/** 加载已存在的知识图谱 */
/**
 * 加载知识图谱（带进程缓存）
 * 文件 mtime 未变时直接返回缓存，避免重复 JSON 解析
 */
export async function loadKnowledgeGraph(cwd: string): Promise<KnowledgeGraph | null> {
  const filePath = join(cwd, '.speccore', 'cache', 'knowledge-graph.json');
  if (!(await pathExists(filePath))) return null;

  try {
    const st = await stat(filePath);
    const cached = kgCache.get(filePath);
    if (cached && cached.mtime >= st.mtimeMs) {
      return cached.graph;
    }

    const content = await readFile(filePath, 'utf-8');
    const graph = JSON.parse(content) as KnowledgeGraph;
    kgCache.set(filePath, { graph, mtime: st.mtimeMs });
    return graph;
  } catch {
    return null;
  }
}

/** 获取指定任务的关联链（上游需求 + 关联子任务） */
export function getTaskContext(graph: KnowledgeGraph, taskId: string): {
  requirement: GraphEntity | null;
  siblingSubtasks: GraphEntity[];
  parentTask: GraphEntity | null;
  relatedSpecs: GraphEntity[];
  dependsOn: GraphEntity[];
} {
  const entity = graph.entities[taskId];
  if (!entity) {
    return { requirement: null, siblingSubtasks: [], parentTask: null, relatedSpecs: [], dependsOn: [] };
  }

  let requirement: GraphEntity | null = null;
  let parentTask: GraphEntity | null = null;
  const relatedSpecs: GraphEntity[] = [];
  const dependsOn: GraphEntity[] = [];

  // 预建索引：避免多次遍历全量关系
  const parentIndex = new Map<string, GraphEntity[]>();
  for (const e of Object.values(graph.entities)) {
    if (e.type === 'subtask' && e.parentTaskId) {
      const list = parentIndex.get(e.parentTaskId) || [];
      list.push(e);
      parentIndex.set(e.parentTaskId, list);
    }
  }

  // 找上游需求、关联规格、依赖任务
  for (const rel of graph.relations) {
    if (rel.from === taskId) {
      if (rel.type === 'implements') requirement = graph.entities[rel.to] || null;
      if (rel.type === 'references') {
        const spec = graph.entities[rel.to];
        if (spec) relatedSpecs.push(spec);
      }
      if (rel.type === 'depends_on') {
        const dep = graph.entities[rel.to];
        if (dep) dependsOn.push(dep);
      }
      if (rel.type === 'subtask_of') parentTask = graph.entities[rel.to] || null;
    }
  }

  // 子任务没有直接 implements 关系 → 通过父任务找上游需求
  if (!requirement && parentTask) {
    for (const rel of graph.relations) {
      if (rel.from === parentTask.id && rel.type === 'implements') {
        requirement = graph.entities[rel.to] || null;
        break;
      }
    }
  }

  // 如果是子任务，找兄弟子任务（用索引，O(1)）
  const siblingSubtasks: GraphEntity[] = [];
  const parentId = entity.parentTaskId || parentTask?.id;
  if (parentId) {
    const siblings = parentIndex.get(parentId);
    if (siblings) siblingSubtasks.push(...siblings);
  }

  return { requirement, siblingSubtasks, parentTask, relatedSpecs, dependsOn };
}

// ═══════════════════════════════════════════════
// 自动更新机制
// ═══════════════════════════════════════════════

/**
 * 递归获取目录下所有文件的最新 mtime
 * 限制：每个目录最多检查 MAX_FILES_PER_DIR 个文件，避免大型项目阻塞
 */
const MAX_FILES_PER_DIR = 100;

async function getLatestMtime(dir: string, fileCount: { value: number } = { value: 0 }): Promise<number> {
  if (!(await pathExists(dir))) return 0;
  let latest = 0;
  const items = await readdir(dir, { withFileTypes: true });
  for (const item of items) {
    if (item.name.startsWith('.') || isTimestampBackup(item.name)) continue;
    if (fileCount.value >= MAX_FILES_PER_DIR) break;
    const fullPath = join(dir, item.name);
    const st = await stat(fullPath);
    if (item.isDirectory()) {
      if (item.name === 'node_modules' || item.name === 'cache') continue;
      const subLatest = await getLatestMtime(fullPath, fileCount);
      if (subLatest > latest) latest = subLatest;
    } else {
      fileCount.value++;
      if (st.mtimeMs > latest) latest = st.mtimeMs;
    }
  }
  return latest;
}

/** 检查知识图谱是否已过期（带 500ms 超时保护） */
export async function isGraphStale(cwd: string, iteration?: string): Promise<boolean> {
  const graph = await loadKnowledgeGraph(cwd);
  if (!graph) return true; // 不存在视为过期

  const iterName = iteration || await getDefaultIteration();
  const iterDir = await getIterationDir(iterName);
  if (!iterDir) return false;

  const graphTime = new Date(graph.generated).getTime();

  // 递归检查目录下所有文件的最新 mtime（目录 mtime 只在增删文件时变）
  const dirsToCheck = [
    join(iterDir, '010-requirements'),
    join(iterDir, '020-specs'),
    join(iterDir, '030-tasks'),
  ];

  for (const dir of dirsToCheck) {
    // 超时保护：单目录扫描超过 200ms 就放弃
    const start = Date.now();
    const latestMtime = await getLatestMtime(dir);
    if (Date.now() - start > 200) {
      logger.debug(`isGraphStale: ${dir} 扫描超时，假设未过期`);
      continue;
    }
    if (latestMtime > graphTime) return true;
  }

  return false;
}

/** 刷新知识图谱（重建 + 保存）—— 供命令完成后调用 */
export async function refreshKnowledgeGraph(
  cwd: string,
  iteration?: string
): Promise<KnowledgeGraph | null> {
  try {
    const iterName = iteration || await getDefaultIteration();
    const graph = await buildKnowledgeGraph(cwd, iterName);
    await saveKnowledgeGraph(cwd, graph);
    return graph;
  } catch {
    return null; // 静默失败，不影响主流程
  }
}
