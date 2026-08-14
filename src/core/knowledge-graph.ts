/**
 * knowledge-graph — 知识图谱构建引擎
 *
 * 从文件系统扫描需求/规格/任务/子任务，提取实体和关联关系
 * 输出 knowledge-graph.json（机器读）+ CONTEXT.md（AI 读）
 */

import { readFile, writeFile, pathExists, readdir, ensureDir } from 'fs-extra';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import { getIterationDir, getDefaultIteration } from './context';
import { findTaskDir, TASK_TYPES } from './task-paths';
import { isTimestampBackup } from '../utils/task-utils';

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
        await scanDir(fullPath, `${relPath}/`);
      } else if (item.name.endsWith('.md') && item.name !== 'INDEX.md') {
        const { hash, mtime } = await fileHash(fullPath);
        const title = await extractTitle(fullPath);
        const content = await readFile(fullPath, 'utf-8').catch(() => '');
        const reqId = extractReqId(content, item.name.replace('.md', ''));

        entities.push({
          id: reqId,
          type: 'requirement',
          title: title || item.name.replace('.md', ''),
          file: `010-requirements/${relPath}`,
          hash,
          mtime,
          tags: [prefix.includes('features/') ? 'feature' : 'requirement'],
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

    const { hash, mtime } = taskMdPath ? await fileHash(taskMdPath) : { hash: '', mtime: '' };

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

      const platformTaskMd = join(taskPath, de.name, 'TASK.md');
      if (!(await pathExists(platformTaskMd))) continue;

      const subContent = await readFile(platformTaskMd, 'utf-8');
      let subTitle = `${title} - ${de.name}`;
      let subStatus = 'pending';
      let subTaskId = `${taskId}-${de.name}`;

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

      const subHash = await fileHash(platformTaskMd);

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

function inferRelations(entities: GraphEntity[]): GraphRelation[] {
  const relations: GraphRelation[] = [];
  const reqs = entities.filter(e => e.type === 'requirement');
  const tasks = entities.filter(e => e.type === 'task');
  const specs = entities.filter(e => e.type === 'spec');

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

  // 规格 → 需求：spec 文件内容中引用了 REQ-xxx
  // （这里只做结构推断，实际内容分析在 CONTEXT.md 生成时做）

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

  // 合并实体
  const allEntities = [
    ...reqResult.entities,
    ...specResult.entities,
    ...taskResult.entities,
    ...userFiles,
  ];

  for (const e of allEntities) {
    graph.entities[e.id] = e;
  }

  // 合并关系
  graph.relations = [
    ...reqResult.relations,
    ...specResult.relations,
    ...taskResult.relations,
    ...inferRelations(allEntities),
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
export async function loadKnowledgeGraph(cwd: string): Promise<KnowledgeGraph | null> {
  const filePath = join(cwd, '.speccore', 'cache', 'knowledge-graph.json');
  if (!(await pathExists(filePath))) return null;
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as KnowledgeGraph;
  } catch {
    return null;
  }
}

/** 获取指定任务的关联链（上游需求 + 关联子任务） */
export function getTaskContext(graph: KnowledgeGraph, taskId: string): {
  requirement: GraphEntity | null;
  siblingSubtasks: GraphEntity[];
  parentTask: GraphEntity | null;
} {
  const entity = graph.entities[taskId];
  if (!entity) {
    return { requirement: null, siblingSubtasks: [], parentTask: null };
  }

  let requirement: GraphEntity | null = null;
  let parentTask: GraphEntity | null = null;
  const siblingSubtasks: GraphEntity[] = [];

  // 找上游需求
  for (const rel of graph.relations) {
    if (rel.from === taskId && rel.type === 'implements') {
      requirement = graph.entities[rel.to] || null;
    }
    if (rel.from === taskId && rel.type === 'subtask_of') {
      parentTask = graph.entities[rel.to] || null;
    }
  }

  // 如果是子任务，找兄弟子任务
  const parentId = entity.parentTaskId || parentTask?.id;
  if (parentId) {
    for (const e of Object.values(graph.entities)) {
      if (e.type === 'subtask' && e.parentTaskId === parentId) {
        siblingSubtasks.push(e);
      }
    }
  }

  return { requirement, siblingSubtasks, parentTask };
}
