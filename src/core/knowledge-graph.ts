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
  type: 'requirement' | 'spec' | 'task' | 'subtask' | 'user-file' | 'source-file' | 'global-doc' | 'task-spec' | 'business_module';
  title: string;
  file: string;           // 相对路径
  hash: string;           // 内容 hash（用于衰减检测）
  mtime: string;          // 最后修改时间
  status?: string;        // 任务状态
  platform?: string;      // 子任务所属端
  parentTaskId?: string;  // 子任务的父任务 ID
  tags?: string[];        // 标签
  // source-file 专属
  endpoint?: string;      // 所属端: frontend/backend/mobile/cli/shared
  module?: string;        // 所属模块
  language?: string;      // 编程语言
  exports?: string[];     // 导出的类/函数名
  imports?: string[];     // 导入的模块
  apis?: string[];        // API 路径
  // business_module 专属
  codeEntities?: string[];  // 关联的代码实体（文件/表/API/组件等）
  businessModule?: string;  // 所属业务模块名
}

export interface GraphRelation {
  from: string;
  to: string;
  type: 'implements' | 'specifies' | 'subtask_of' | 'depends_on' | 'references' | 'imports' | 'module_depends' | 'co_changes' | 'governs' | 'elaborates' | 'maps_to' | 'uses_table' | 'calls_api' | 'affects' | string;
  metadata?: Record<string, string>;  // 扩展元数据（如关系来源、置信度等）
}

export interface GraphStats {
  requirements: number;
  specs: number;
  tasks: number;
  subtasks: number;
  userFiles: number;
  sourceFiles: number;
  globalDocs: number;
  taskSpecs: number;
  businessModules: number;
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

  // 扫描各端子目录（新路径 020-specs/{端}/，兼容旧路径 020-specs/platforms/{端}/）
  const knownNonPlatformDirs = new Set(['sources', 'assets', 'prototypes', 'converted', 'features', 'bugs', 'refactors', 'research', 'staging', 'platforms', 'snapshots']);
  const platformDirs: string[] = [];
  const specsEntries = await readdir(specsDir, { withFileTypes: true });
  for (const e of specsEntries) {
    if (e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.') && !knownNonPlatformDirs.has(e.name)) {
      platformDirs.push(e.name);
    }
  }
  // 旧路径回退
  const platformsDir = join(specsDir, 'platforms');
  if (await pathExists(platformsDir)) {
    const platformEntries = await readdir(platformsDir, { withFileTypes: true });
    for (const pe of platformEntries) {
      if (pe.isDirectory() && !pe.name.startsWith('.') && !platformDirs.includes(pe.name)) {
        platformDirs.push(pe.name);
      }
    }
  }
  for (const pName of platformDirs) {
    const pDir = join(specsDir, pName);
    if (!(await pathExists(pDir))) continue;
    const pFiles = await readdir(pDir);
    for (const f of pFiles) {
      if (!f.endsWith('.md') || isTimestampBackup(f)) continue;
      const fullPath = join(pDir, f);
      const { hash, mtime } = await fileHash(fullPath);
      const title = await extractTitle(fullPath);

      entities.push({
        id: `SPEC:${pName}/${f.replace('.md', '')}`,
        type: 'spec',
        title: title || f.replace('.md', ''),
        file: `020-specs/${pName}/${f}`,
        hash,
        mtime,
        platform: pName,
      });
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

// ═══════════════════════════════════════════════════
// 业务-代码映射扫描（从 TECH.md 提取业务模块→代码实体映射）
// ═══════════════════════════════════════════════════

/**
 * 扫描各端 TECH.md 中的「业务-代码映射」章节
 * 提取业务模块实体及其关联的代码实体（文件/表/API/组件等）
 *
 * 期望的 TECH.md 格式：
 * ````
 * ## 业务-代码映射
 *
 * | 业务模块 | 代码实体 | 关系类型 | 说明 |
 * |:--|:--|:--|:--|
 * | 会议室档案 | backend/RoomController.java | api_controller | REST 控制器 |
 * | 会议室档案 | table-meeting_room | uses_table | 主数据表 |
 * | 会议室档案 | admin-web/src/pages/RoomList.vue | page | 列表页 |
 * ```
 */
async function scanBusinessCodeMappings(iterDir: string): Promise<{
  entities: GraphEntity[];
  relations: GraphRelation[];
}> {
  const entities: GraphEntity[] = [];
  const relations: GraphRelation[] = [];
  const specsDir = join(iterDir, '020-specs');

  if (!(await pathExists(specsDir))) return { entities, relations };

  // 扫描各端子目录
  const knownNonPlatformDirs = new Set(['sources', 'assets', 'prototypes', 'converted', 'features', 'bugs', 'refactors', 'research', 'staging', 'platforms', 'snapshots', 'global']);
  const specsEntries = await readdir(specsDir, { withFileTypes: true });

  for (const e of specsEntries) {
    if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.') || knownNonPlatformDirs.has(e.name)) continue;
    const platformName = e.name;
    const techMdPath = join(specsDir, platformName, 'TECH.md');

    if (!(await pathExists(techMdPath))) continue;

    const content = await readFile(techMdPath, 'utf-8').catch(() => '');
    if (!content) continue;

    // 查找「业务-代码映射」章节（不用 m 标志，$ 仅匹配字符串末尾）
    const mappingSectionMatch = content.match(/##\s+业务-代码映射[\s\S]*?(?=\n##\s|$)/i);
    if (!mappingSectionMatch) continue;

    const sectionContent = mappingSectionMatch[0];

    // 解析表格
    const lines = sectionContent.split('\n');
    let inTable = false;
    let headerParsed = false;
    let colIndices = { module: -1, entity: -1, relation: -1, desc: -1 };

    // 用于去重的业务模块集合
    const seenModules = new Set<string>();

    for (const line of lines) {
      const cells = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length < 2) continue;

      // 表头行
      if (!headerParsed && cells.some(c => c.includes('业务模块') || c.includes('代码实体'))) {
        colIndices = {
          module: cells.findIndex(c => c.includes('业务模块')),
          entity: cells.findIndex(c => c.includes('代码实体')),
          relation: cells.findIndex(c => c.includes('关系类型')),
          desc: cells.findIndex(c => c.includes('说明')),
        };
        if (colIndices.module < 0) colIndices.module = 0;
        if (colIndices.entity < 0) colIndices.entity = 1;
        headerParsed = true;
        inTable = true;
        continue;
      }

      // 分隔行跳过
      if (cells.every(c => /^[-:]+$/.test(c))) continue;

      if (!inTable || !headerParsed) continue;

      // 数据行
      const moduleName = cells[colIndices.module];
      const codeEntity = cells[colIndices.entity];
      const relationType = colIndices.relation >= 0 && colIndices.relation < cells.length ? cells[colIndices.relation] : 'maps_to';
      const desc = colIndices.desc >= 0 && colIndices.desc < cells.length ? cells[colIndices.desc] : '';

      if (!moduleName || !codeEntity) continue;
      if (moduleName === '业务模块' || moduleName === '#') continue;

      // 创建业务模块实体（去重）
      const bizModuleId = `biz:${platformName}:${moduleName}`;
      if (!seenModules.has(bizModuleId)) {
        seenModules.add(bizModuleId);
        entities.push({
          id: bizModuleId,
          type: 'business_module',
          title: moduleName,
          file: `020-specs/${platformName}/TECH.md`,
          hash: '',
          mtime: '',
          platform: platformName,
          businessModule: moduleName,
          tags: ['business-mapping'],
        });

        // 关联到对应的 spec 实体
        const specId = `SPEC:${platformName}/TECH`;
        relations.push({
          from: bizModuleId,
          to: specId,
          type: 'elaborates',
          metadata: { source: 'tech-md-mapping' },
        });
      }

      // 创建代码实体（作为 business_module 的关联目标）
      const codeEntityId = `code:${platformName}:${codeEntity.replace(/[/\\]/g, '-')}`;
      if (!entities.find(e => e.id === codeEntityId)) {
        entities.push({
          id: codeEntityId,
          type: 'source-file',
          title: codeEntity,
          file: codeEntity,
          hash: '',
          mtime: '',
          platform: platformName,
          tags: ['code-entity', relationType],
        });
      }

      // 创建关系
      relations.push({
        from: bizModuleId,
        to: codeEntityId,
        type: relationType || 'maps_to',
        metadata: { description: desc, source: 'tech-md-mapping' },
      });
    }
  }

  return { entities, relations };
}

// ═══════════════════════════════════════════════════
// 任务扫描（含子任务）
// ═══════════════════════════════════════════════════

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
    // 读取父任务信息（00-specs/ 优先，_shared/ 回退）
    const specsTaskMd = join(taskPath, '00-specs', 'TASK.md');
    const sharedTaskMd = join(taskPath, '_shared', 'TASK.md');
    const taskMdPath = (await pathExists(specsTaskMd)) ? specsTaskMd :
                       (await pathExists(sharedTaskMd)) ? sharedTaskMd : null;

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
    // 回退：从 00-specs/REQ.md 或 _shared/REQ.md 提取标题
    if (title === taskId) {
      const specsReqMd = join(taskPath, '00-specs', 'REQ.md');
      const sharedReqMd = join(taskPath, '_shared', 'REQ.md');
      const reqMdPath = (await pathExists(specsReqMd)) ? specsReqMd :
                        (await pathExists(sharedReqMd)) ? sharedReqMd : null;
      if (reqMdPath) {
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
      const fallbackPaths = [join(taskPath, '00-specs', 'REQ.md'), join(taskPath, '_shared', 'REQ.md'), join(taskPath, '.meta', 'status')];
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

    // 扫描各端子任务（新结构: 10-backend/{service}/{subtask}/ + 20-frontend/{platform}/{subtask}/）
    const dirEntries = await readdir(taskPath, { withFileTypes: true }).catch(() => []);
    const hasNewStructure = dirEntries.some(de => de.isDirectory() && (de.name === '10-backend' || de.name === '20-frontend'));

    if (hasNewStructure) {
      // 新结构：三级嵌套
      for (const catDir of ['10-backend', '20-frontend']) {
        const catPath = join(taskPath, catDir);
        if (!(await pathExists(catPath))) continue;
        const serviceEntries = await readdir(catPath, { withFileTypes: true }).catch(() => []);
        for (const svc of serviceEntries) {
          if (!svc.isDirectory()) continue;
          const subEntries = await readdir(join(catPath, svc.name), { withFileTypes: true }).catch(() => []);
          for (const sub of subEntries) {
            if (!sub.isDirectory() || sub.name.startsWith('.')) continue;
            const subtaskPath = join(catPath, svc.name, sub.name);
            const platformLabel = `${svc.name}/${sub.name}`;

            const subtaskTaskMd = join(subtaskPath, 'TASK.md');
            let subTitle = `${title} — ${platformLabel}`;
            let subStatus = 'pending';
            let subTaskId = `${taskId}-${svc.name}-${sub.name}`;

            if (await pathExists(subtaskTaskMd)) {
              const subContent = await readFile(subtaskTaskMd, 'utf-8');
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

            // hash 回退：TASK.md → .meta/status → src/ → 空
            let subHash: { hash: string; mtime: string } = { hash: '', mtime: '' };
            if (await pathExists(subtaskTaskMd)) {
              subHash = await fileHash(subtaskTaskMd);
            } else {
              const metaStatus = join(subtaskPath, '.meta', 'status');
              if (await pathExists(metaStatus)) {
                subHash = await fileHash(metaStatus);
              } else {
                const srcDir = join(subtaskPath, 'src');
                if (await pathExists(srcDir)) {
                  try {
                    const srcFiles = await readdir(srcDir);
                    if (srcFiles.length > 0) subHash = await fileHash(join(srcDir, srcFiles[0]));
                  } catch { /* 忽略 */ }
                }
              }
            }

            entities.push({
              id: subTaskId,
              type: 'subtask',
              title: subTitle,
              file: `030-tasks/${type === 'feature' ? '' : type + '/'}${taskId}/${catDir}/${svc.name}/${sub.name}`,
              hash: subHash.hash,
              mtime: subHash.mtime,
              status: subStatus,
              platform: platformLabel,
              parentTaskId: taskId,
            });

            relations.push({ from: subTaskId, to: taskId, type: 'subtask_of' });
          }
        }
      }
    } else {
      // 旧结构：扁平平台目录
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

        let subHash: { hash: string; mtime: string } = { hash: '', mtime: '' };
        if (await pathExists(platformTaskMd)) {
          subHash = await fileHash(platformTaskMd);
        } else {
          const srcDir = join(taskPath, de.name, 'src');
          if (await pathExists(srcDir)) {
            try {
              const srcFiles = await readdir(srcDir);
              if (srcFiles.length > 0) subHash = await fileHash(join(srcDir, srcFiles[0]));
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

        relations.push({ from: subTaskId, to: taskId, type: 'subtask_of' });
      }
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
// 源码文件扫描（从 code-index 缓存读取）
// ═══════════════════════════════════════════════

async function scanSourceFiles(cwd: string): Promise<{ entities: GraphEntity[]; relations: GraphRelation[] }> {
  const entities: GraphEntity[] = [];
  const relations: GraphRelation[] = [];

  // 从 code-index 缓存读取
  const indexPath = join(cwd, '.speccore', 'cache', 'code-structure.json');
  if (!(await pathExists(indexPath))) return { entities, relations };

  try {
    const index = JSON.parse(await readFile(indexPath, 'utf-8'));
    const files: any[] = index.files || [];

    // 只取核心文件（每个模块 top 3）
    const moduleGroups = new Map<string, any[]>();
    for (const f of files) {
      const key = `${f.endpoint || 'common'}:${f.module || 'root'}`;
      if (!moduleGroups.has(key)) moduleGroups.set(key, []);
      moduleGroups.get(key)!.push(f);
    }

    const coreFiles: any[] = [];
    for (const group of moduleGroups.values()) {
      group.sort((a: any, b: any) => (b.exports?.length || 0) - (a.exports?.length || 0));
      coreFiles.push(...group.slice(0, 3));
    }

    // 限制总数，避免图谱过大
    const maxFiles = Math.min(coreFiles.length, 50);
    const selectedFiles = coreFiles.slice(0, maxFiles);

    for (const f of selectedFiles) {
      const id = `SRC:${f.path.replace(/\//g, '-').replace(/\.[^.]+$/, '')}`;
      entities.push({
        id,
        type: 'source-file',
        title: f.path.split('/').pop() || f.path,
        file: f.path,
        hash: '',
        mtime: new Date(f.lastModified || 0).toISOString(),
        endpoint: f.endpoint || 'common',
        module: f.module || 'root',
        language: f.language || 'unknown',
        exports: (f.exports || []).slice(0, 10),
        imports: (f.imports || []).slice(0, 15),
        apis: f.apis || [],
        tags: ['source', f.endpoint || 'common', f.module || 'root'],
      });
    }

    // 构建 import 关系
    const entityMap = new Map(entities.map(e => [e.id, e]));
    for (const f of selectedFiles) {
      const fromId = `SRC:${f.path.replace(/\//g, '-').replace(/\.[^.]+$/, '')}`;
      for (const imp of (f.imports || [])) {
        // 查找被 import 的文件
        const impBasename = imp.replace(/\.[^.]+$/, '').replace(/.*[\/\\]/, '');
        for (const other of selectedFiles) {
          if (other.path === f.path) continue;
          const otherBasename = other.path.replace(/\.[^.]+$/, '').replace(/.*[\/\\]/, '');
          if (imp.includes(otherBasename) || imp.includes(other.path)) {
            const toId = `SRC:${other.path.replace(/\//g, '-').replace(/\.[^.]+$/, '')}`;
            if (entityMap.has(toId) && !relations.some(r => r.from === fromId && r.to === toId && r.type === 'imports')) {
              relations.push({ from: fromId, to: toId, type: 'imports' });
            }
          }
        }
      }
    }

    // 构建模块依赖关系
    const moduleDeps = new Map<string, Set<string>>();
    for (const f of selectedFiles) {
      const fromMod = `${f.endpoint || 'common'}:${f.module || 'root'}`;
      for (const imp of (f.imports || [])) {
        for (const other of selectedFiles) {
          if (other.path === f.path) continue;
          const otherBasename = other.path.replace(/\.[^.]+$/, '').replace(/.*[\/\\]/, '');
          if (imp.includes(otherBasename)) {
            const toMod = `${other.endpoint || 'common'}:${other.module || 'root'}`;
            if (toMod !== fromMod) {
              if (!moduleDeps.has(fromMod)) moduleDeps.set(fromMod, new Set());
              moduleDeps.get(fromMod)!.add(toMod);
            }
          }
        }
      }
    }

    // 添加模块依赖关系（用模块名作为虚拟节点）
    for (const [fromMod, toMods] of moduleDeps) {
      for (const toMod of toMods) {
        if (!relations.some(r => r.from === fromMod && r.to === toMod && r.type === 'module_depends')) {
          relations.push({ from: fromMod, to: toMod, type: 'module_depends' });
        }
      }
    }

    // 构建 Git 共变关系
    const correlations: any[] = index.correlations || [];
    for (const corr of correlations) {
      const filesInCorr = corr.files || [];
      for (let i = 0; i < filesInCorr.length; i++) {
        for (let j = i + 1; j < filesInCorr.length; j++) {
          const fromId = `SRC:${filesInCorr[i].replace(/\//g, '-').replace(/\.[^.]+$/, '')}`;
          const toId = `SRC:${filesInCorr[j].replace(/\//g, '-').replace(/\.[^.]+$/, '')}`;
          if (entityMap.has(fromId) && entityMap.has(toId)) {
            if (!relations.some(r => r.from === fromId && r.to === toId && r.type === 'co_changes')) {
              relations.push({ from: fromId, to: toId, type: 'co_changes' });
            }
          }
        }
      }
    }
  } catch {
    // 索引不存在或解析失败，跳过
  }

  return { entities, relations };
}

// ═══════════════════════════════════════════════
// 全局层扫描（.speccore/GLOBAL/）
// ═══════════════════════════════════════════════

async function scanGlobalDocs(cwd: string): Promise<{ entities: GraphEntity[]; relations: GraphRelation[] }> {
  const entities: GraphEntity[] = [];
  const relations: GraphRelation[] = [];
  const globalDir = join(cwd, '.speccore', 'GLOBAL');

  if (!(await pathExists(globalDir))) return { entities, relations };

  const scanDir = async (dir: string, prefix: string) => {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.name.startsWith('.') || isTimestampBackup(item.name)) continue;
      const fullPath = join(dir, item.name);
      const relPath = `${prefix}${item.name}`;

      if (item.isDirectory()) {
        if (item.name === '_template' || item.name === 'RULES') continue;
        await scanDir(fullPath, `${relPath}/`);
      } else if (item.name.endsWith('.md') && item.name !== 'INDEX.md') {
        const { hash, mtime } = await fileHash(fullPath);
        const title = await extractTitle(fullPath);
        const tags: string[] = ['global'];
        if (prefix.includes('synthesis/')) tags.push('synthesis');
        else if (prefix.includes('platforms/')) { tags.push('platform'); tags.push(prefix.split('platforms/')[1]?.split('/')[0] || ''); }
        else if (prefix.includes('baselines/')) tags.push('baseline');
        else if (prefix.includes('projects/')) tags.push('project');

        entities.push({
          id: `GLOBAL:${relPath.replace(/\.md$/, '').replace(/\//g, '-')}`,
          type: 'global-doc',
          title: title || item.name.replace('.md', ''),
          file: `.speccore/GLOBAL/${relPath}`,
          hash,
          mtime,
          tags,
        });
      }
    }
  };

  await scanDir(globalDir, '');
  return { entities, relations };
}

// ═══════════════════════════════════════════════
// 任务层详细规格扫描（Task-xxx/{platform}/REQ.md, TECH.md 等）
// ═══════════════════════════════════════════════

const TASK_SPEC_FILES = ['REQ.md', 'TECH.md', 'SCHEMA.md', 'CHANGELOG.md', 'TEST.md', 'TASK.md'];

async function scanTaskSpecs(iterDir: string): Promise<{ entities: GraphEntity[]; relations: GraphRelation[] }> {
  const entities: GraphEntity[] = [];
  const relations: GraphRelation[] = [];
  const tasksDir = join(iterDir, '030-tasks');

  if (!(await pathExists(tasksDir))) return { entities, relations };

  const findTaskDirs = async (dir: string): Promise<string[]> => {
    const results: string[] = [];
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name.startsWith('Task-')) results.push(p);
          else if (!e.name.startsWith('.') && e.name !== 'node_modules') {
            results.push(...await findTaskDirs(p));
          }
        }
      }
    } catch { /* 跳过 */ }
    return results;
  };

  const taskDirs = await findTaskDirs(tasksDir);

  for (const taskDir of taskDirs) {
    const taskId = taskDir.split('/').pop() || '';
    const subDirs: string[] = ['_shared', '00-specs'];
    // 新结构: 10-backend/{service}/{subtask}/ + 20-frontend/{platform}/{subtask}/
    const nestedSubDirs: string[] = [];
    try {
      const entries = await readdir(taskDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.') || isTimestampBackup(e.name)) continue;
        if (e.name === '10-backend' || e.name === '20-frontend') {
          // 新结构：深入两层（service/platform → subtask）
          const catPath = join(taskDir, e.name);
          try {
            const svcEntries = await readdir(catPath, { withFileTypes: true });
            for (const svc of svcEntries) {
              if (!svc.isDirectory()) continue;
              const subEntries = await readdir(join(catPath, svc.name), { withFileTypes: true });
              for (const sub of subEntries) {
                if (!sub.isDirectory() || sub.name.startsWith('.')) continue;
                nestedSubDirs.push(`${e.name}/${svc.name}/${sub.name}`);
              }
            }
          } catch { /* 跳过 */ }
        } else if (!e.name.startsWith('0') && e.name !== '_shared' && e.name !== '99-artifacts') {
          // 旧结构：扁平平台目录
          subDirs.push(e.name);
        }
      }
    } catch { /* 跳过 */ }

    // 扫描任务根下的子目录（_shared/、00-specs/、旧平台目录）
    for (const subDir of subDirs) {
      const specDir = join(taskDir, subDir);
      if (!(await pathExists(specDir))) continue;

      for (const specFile of TASK_SPEC_FILES) {
        const specPath = join(specDir, specFile);
        if (!(await pathExists(specPath))) continue;

        const { hash, mtime } = await fileHash(specPath);
        const title = await extractTitle(specPath);
        const specType = specFile.replace('.md', '').toLowerCase();

        entities.push({
          id: `TSPEC:${taskId}-${subDir}-${specType}`,
          type: 'task-spec',
          title: title || `${taskId}/${subDir}/${specFile}`,
          file: `030-tasks/**/${taskId}/${subDir}/${specFile}`,
          hash,
          mtime,
          tags: ['task-spec', specType, subDir === '_shared' ? 'shared' : subDir],
        });

        relations.push({ from: `TSPEC:${taskId}-${subDir}-${specType}`, to: taskId, type: 'elaborates' });
      }
    }

    // 扫描新结构的子任务目录（10-backend/svc/sub/、20-frontend/plat/sub/）
    for (const nestedDir of nestedSubDirs) {
      const specDir = join(taskDir, nestedDir);
      if (!(await pathExists(specDir))) continue;

      for (const specFile of TASK_SPEC_FILES) {
        const specPath = join(specDir, specFile);
        if (!(await pathExists(specPath))) continue;

        const { hash, mtime } = await fileHash(specPath);
        const title = await extractTitle(specPath);
        const specType = specFile.replace('.md', '').toLowerCase();
        const label = nestedDir.replace(/\//g, '-');

        entities.push({
          id: `TSPEC:${taskId}-${label}-${specType}`,
          type: 'task-spec',
          title: title || `${taskId}/${nestedDir}/${specFile}`,
          file: `030-tasks/**/${taskId}/${nestedDir}/${specFile}`,
          hash,
          mtime,
          tags: ['task-spec', specType, label],
        });

        relations.push({ from: `TSPEC:${taskId}-${label}-${specType}`, to: taskId, type: 'elaborates' });
      }
    }
  }

  return { entities, relations };
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

  // ═══════════════════════════════════════════════
  // v6.69.0+: 从 IMPACT.md 补充 depends_on 关系（知识图谱链路补全）
  // ═══════════════════════════════════════════════
  const impactPath = join(iterDir, 'IMPACT.md');
  if (await pathExists(impactPath)) {
    try {
      const content = await readFile(impactPath, 'utf-8');
      // 解析 Dependencies 表格：| Consumer | → | Producer | 类型 |
      // 格式：| Task-002: 订单导出 | → | Task-001: 用户管理 | API: `/api/users` |
      const lines = content.split('\n');
      let inDepsSection = false;
      for (const line of lines) {
        if (line.includes('## Dependencies')) { inDepsSection = true; continue; }
        if (inDepsSection && line.startsWith('## ')) break;
        if (!inDepsSection || !line.includes('|') || !line.includes('→')) continue;
        // 跳过表头分隔行
        if (line.match(/^\|[-:\s|]+\|$/)) continue;

        const cells = line.split('|').map(c => c.trim()).filter(Boolean);
        if (cells.length >= 3) {
          const consumer = cells[0].split(':')[0].trim();
          const producer = cells[2].split(':')[0].trim();
          if (consumer.startsWith('Task-') && producer.startsWith('Task-')) {
            if (entityMap.has(consumer) && entityMap.has(producer) &&
                !relations.some(r => r.from === consumer && r.to === producer && r.type === 'depends_on')) {
              relations.push({
                from: consumer,
                to: producer,
                type: 'depends_on',
                metadata: { source: 'IMPACT.md', reason: cells[3] || '' }
              });
            }
          }
        }
      }
    } catch { /* 跳过 */ }
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
    stats: { requirements: 0, specs: 0, tasks: 0, subtasks: 0, userFiles: 0, sourceFiles: 0, globalDocs: 0, taskSpecs: 0, businessModules: 0, relations: 0 },
  };

  if (!iterDir || !(await pathExists(iterDir))) return graph;

  // 扫描各层
  const reqResult = await scanRequirements(iterDir, iterName);
  const specResult = await scanSpecs(iterDir);
  const taskResult = await scanTasks(iterDir);
  const userFiles = await scanUserFiles(iterDir);
  const sourceResult = await scanSourceFiles(cwd);
  const globalResult = await scanGlobalDocs(cwd);
  const taskSpecResult = await scanTaskSpecs(iterDir);
  const bizMappingResult = await scanBusinessCodeMappings(iterDir);

  // 合并实体（处理 ID 冲突：同名实体用路径前缀去重）
  const allEntities = [
    ...reqResult.entities,
    ...specResult.entities,
    ...taskResult.entities,
    ...userFiles,
    ...sourceResult.entities,
    ...globalResult.entities,
    ...taskSpecResult.entities,
    ...bizMappingResult.entities,
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
  for (const r of [...reqResult.relations, ...specResult.relations, ...taskResult.relations, ...taskSpecResult.relations]) {
    r.from = remapId(r.from);
    r.to = remapId(r.to);
  }

  // 合并关系
  graph.relations = [
    ...reqResult.relations,
    ...specResult.relations,
    ...taskResult.relations,
    ...sourceResult.relations,
    ...taskSpecResult.relations,
    ...bizMappingResult.relations,
    ...(await inferRelations(allEntities, iterDir)),
  ];

  // 统计
  graph.stats = {
    requirements: reqResult.entities.length,
    specs: specResult.entities.length,
    tasks: taskResult.entities.filter(e => e.type === 'task').length,
    subtasks: taskResult.entities.filter(e => e.type === 'subtask').length,
    userFiles: userFiles.length,
    sourceFiles: sourceResult.entities.length,
    globalDocs: globalResult.entities.length,
    taskSpecs: taskSpecResult.entities.length,
    businessModules: bizMappingResult.entities.filter(e => e.type === 'business_module').length,
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

// ═══════════════════════════════════════════════
// v6.69.0+: 依赖链路追踪（知识图谱链路补全）
// ═══════════════════════════════════════════════

export interface DependencyChain {
  taskId: string;
  taskName: string;
  depth: number;
  path: string[];              // 完整路径 [taskId, depId, depDepId, ...]
  relations: GraphRelation[];  // 路径上的所有关系
  entities: GraphEntity[];     // 路径上的所有实体
}

/**
 * 追踪任务的完整依赖链路（向上追溯）
 * 递归追踪 implements → references → depends_on 关系
 */
export function traceDependencyChain(
  graph: KnowledgeGraph,
  taskId: string,
  maxDepth: number = 5,
  visited: Set<string> = new Set()
): DependencyChain[] {
  const chains: DependencyChain[] = [];
  if (maxDepth <= 0 || visited.has(taskId)) return chains;

  const entity = graph.entities[taskId];
  if (!entity) return chains;

  visited.add(taskId);

  // 收集所有上游关系（implements, references, depends_on）
  const upstreamRels = graph.relations.filter(r =>
    r.from === taskId &&
    (r.type === 'implements' || r.type === 'references' || r.type === 'depends_on')
  );

  for (const rel of upstreamRels) {
    const depEntity = graph.entities[rel.to];
    if (!depEntity) continue;

    chains.push({
      taskId,
      taskName: entity.title,
      depth: 1,
      path: [taskId, rel.to],
      relations: [rel],
      entities: [entity, depEntity],
    });

    // 递归追踪更深层的依赖
    const subChains = traceDependencyChain(graph, rel.to, maxDepth - 1, new Set(visited));
    for (const sub of subChains) {
      chains.push({
        taskId,
        taskName: entity.title,
        depth: sub.depth + 1,
        path: [taskId, ...sub.path],
        relations: [rel, ...sub.relations],
        entities: [entity, ...sub.entities],
      });
    }
  }

  return chains;
}

/**
 * 获取任务的完整上下文（扩展版，包含依赖链路）
 * 在 getTaskContext 基础上增加 dependencyChain 字段
 */
export function getFullTaskContext(graph: KnowledgeGraph, taskId: string): {
  requirement: GraphEntity | null;
  siblingSubtasks: GraphEntity[];
  parentTask: GraphEntity | null;
  relatedSpecs: GraphEntity[];
  dependsOn: GraphEntity[];
  dependencyChain: DependencyChain[];
  downstreamTasks: GraphEntity[];  // 依赖于本任务的任务
} {
  const base = getTaskContext(graph, taskId);

  // 追踪完整依赖链路
  const dependencyChain = traceDependencyChain(graph, taskId);

  // 找下游任务（哪些任务依赖于本任务）
  const downstreamTasks: GraphEntity[] = [];
  const seen = new Set<string>();
  for (const rel of graph.relations) {
    if (rel.to === taskId && rel.type === 'depends_on') {
      const downstream = graph.entities[rel.from];
      if (downstream && !seen.has(downstream.id)) {
        downstreamTasks.push(downstream);
        seen.add(downstream.id);
      }
    }
  }

  return {
    ...base,
    dependencyChain,
    downstreamTasks,
  };
}
