/**
 * decay-detector — 知识衰减检测
 *
 * 对比上次完整性快照（integrity.json）与当前文件状态，
 * 检测哪些文件已变更但其关联索引/下游引用未更新
 */

import { readFile, pathExists, stat } from 'fs-extra';
import { join } from 'path';
import { createHash } from 'crypto';
import { KnowledgeGraph, GraphEntity } from './knowledge-graph';
import { loadCodeIndex } from './code-scanner';
import { scanCodeForSpecAnnotations } from './reverse-sync';

// ═══════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════

export interface DecayReport {
  generated: string;
  iteration: string;
  decayedFiles: DecayItem[];
  summary: {
    total: number;
    decayed: number;
    healthy: number;
  };
}

export interface DecayItem {
  entityId: string;
  title: string;
  file: string;
  type: 'content_changed' | 'downstream_stale' | 'orphaned' | 'code_ahead_of_spec';
  severity: 'info' | 'warning' | 'critical';
  detail: string;          // 人可读的描述
  affectedDownstream?: string[];  // 受影响的下游实体
}

interface IntegrityEntry {
  hash: string;
  size: number;
  mtime: string;
}

interface IntegritySnapshot {
  lastScan: string;
  version: string;
  files: Record<string, IntegrityEntry>;
}

// ═══════════════════════════════════════════════
// 核心检测
// ═══════════════════════════════════════════════

/** 加载上次完整性快照 */
async function loadIntegritySnapshot(cwd: string): Promise<IntegritySnapshot | null> {
  const filePath = join(cwd, '.speccore', 'cache', 'integrity.json');
  if (!(await pathExists(filePath))) return null;
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as IntegritySnapshot;
  } catch {
    return null;
  }
}

/** 计算当前文件 hash */
async function currentFileHash(filePath: string): Promise<string> {
  try {
    const { readFile: read } = await import('fs-extra');
    const content = await read(filePath, 'utf-8');
    return createHash('md5').update(content).digest('hex').slice(0, 8);
  } catch {
    return '';
  }
}

/**
 * 检测知识衰减
 *
 * 检测规则：
 * 1. content_changed: 文件 hash 与上次快照不同 → 内容已变更
 * 2. downstream_stale: 上游需求变更了，但关联的 spec/task 未同步更新
 * 3. orphaned: 图谱中有引用但文件已不存在
 */
export async function detectDecay(
  cwd: string,
  graph: KnowledgeGraph
): Promise<DecayReport> {
  const snapshot = await loadIntegritySnapshot(cwd);
  const report: DecayReport = {
    generated: new Date().toISOString(),
    iteration: graph.iteration,
    decayedFiles: [],
    summary: { total: 0, decayed: 0, healthy: 0 },
  };

  const entities = Object.values(graph.entities);
  report.summary.total = entities.length;

  // 检测 1: content_changed — 文件内容与上次快照不一致，按变更程度分级
  for (const entity of entities) {
    if (!entity.file || !entity.hash) continue;

    // 直接查找（路径格式一致时匹配）
    let snapshotEntry = snapshot?.files[entity.file];

    // 回退：basename 匹配（应对路径格式不一致的情况）
    if (!snapshotEntry && snapshot) {
      const entityBase = entity.file.split('/').pop();
      for (const [snapPath, snapEntry] of Object.entries(snapshot.files)) {
        if (snapPath.split('/').pop() === entityBase) {
          snapshotEntry = snapEntry;
          break;
        }
      }
    }

    if (snapshotEntry) {
      const oldHash = snapshotEntry.hash;
      if (oldHash !== entity.hash) {
        // 计算变更强度：基于文件大小变化比例
        const sizeChangeRatio = snapshotEntry.size > 0
          ? Math.abs((entity.hash.length ? snapshotEntry.size : 0) - snapshotEntry.size) / snapshotEntry.size
          : 1;
        const intensity = sizeChangeRatio > 0.5 ? 'major' : sizeChangeRatio > 0.1 ? 'moderate' : 'minor';
        const severity = intensity === 'major' ? 'critical' : intensity === 'moderate' ? 'warning' : 'info';

        report.decayedFiles.push({
          entityId: entity.id,
          title: entity.title,
          file: entity.file,
          type: 'content_changed',
          severity,
          detail: `内容已变更（强度: ${intensity}, hash: ${oldHash} → ${entity.hash}）`,
        });
      }
    }
  }

  // 检测 2: downstream_stale — 上游需求重大变更，下游 spec/task 未更新
  // 只关注重大变更（major/critical），忽略 minor 的 typo 修复
  const changedReqs = new Set(
    report.decayedFiles
      .filter(d => d.type === 'content_changed' && (d.severity === 'critical' || d.severity === 'warning'))
      .map(d => d.entityId)
  );

  for (const reqId of changedReqs) {
    // 找实现该需求的任务
    const implRelations = graph.relations.filter(
      r => r.to === reqId && r.type === 'implements'
    );

    for (const rel of implRelations) {
      const task = graph.entities[rel.from];
      if (!task) continue;

      // 检查任务文件是否也变更了
      const taskDecayed = report.decayedFiles.some(d => d.entityId === task.id);
      if (!taskDecayed) {
        report.decayedFiles.push({
          entityId: task.id,
          title: task.title,
          file: task.file,
          type: 'downstream_stale',
          severity: 'critical',
          detail: `上游需求 ${reqId} 已变更，但此任务未同步更新`,
          affectedDownstream: [reqId],
        });
      }
    }
  }

  // 检测 3: orphaned — 图谱中有实体但文件可能不存在（hash 为空）
  for (const entity of entities) {
    if (entity.hash === '' && entity.file && entity.type !== 'user-file') {
      report.decayedFiles.push({
        entityId: entity.id,
        title: entity.title,
        file: entity.file,
        type: 'orphaned',
        severity: 'warning',
        detail: '文件不存在或无法读取',
      });
    }
  }

  // 检测 4: code_ahead_of_spec — 代码已变更但关联 Spec/Task 未同步更新
  const codeDrift = await detectCodeSpecDrift(cwd, graph);
  for (const item of codeDrift) {
    report.decayedFiles.push(item);
  }

  report.summary.decayed = report.decayedFiles.length;
  report.summary.healthy = report.summary.total - report.summary.decayed;

  return report;
}

/**
 * 检测代码→Task→Spec 漂移：代码文件已修改，但关联的 Task/Spec 未更新
 *
 * 逻辑：
 * 1. 扫描代码中的 @spec 注释，建立 filePath → taskId 映射
 * 2. 对比 code-index 中记录的 lastModified 与当前文件 mtime
 * 3. 如果代码文件已变更，查找关联的 Task
 * 4. 通过知识图谱查找 Task 关联的 Spec/Req
 * 5. 生成 code_ahead_of_spec 类型的 DecayItem，affectedDownstream 包含完整影响链
 */
async function detectCodeSpecDrift(cwd: string, graph: KnowledgeGraph): Promise<DecayItem[]> {
  const results: DecayItem[] = [];

  // 1. 加载代码索引
  const codeIndex = await loadCodeIndex();
  if (!codeIndex || codeIndex.files.length === 0) return results;

  // 2. 扫描 @spec 注释（建立 filePath → taskId 映射）
  const specAnnotations = await scanCodeForSpecAnnotations(cwd);
  const fileToTasks = new Map<string, string[]>();
  for (const ref of specAnnotations) {
    const fullPath = join(cwd, ref.file);
    if (!fileToTasks.has(fullPath)) fileToTasks.set(fullPath, []);
    fileToTasks.get(fullPath)!.push(ref.taskId);
  }

  // 3. 检查每个有 @spec 关联的代码文件是否已变更
  const checkedTasks = new Set<string>(); // 避免同一 Task 重复报告

  for (const codeFile of codeIndex.files) {
    const fullPath = join(cwd, codeFile.path);
    const taskIds = fileToTasks.get(fullPath);
    if (!taskIds || taskIds.length === 0) continue;

    // 检查文件当前 mtime 是否大于索引记录的 lastModified
    let currentMtime = 0;
    try {
      const st = await stat(fullPath);
      currentMtime = st.mtimeMs;
    } catch { continue; }

    // 文件在索引建立后有过修改（5分钟容差）
    if (currentMtime <= codeFile.lastModified + 5 * 60 * 1000) continue;

    // 4. 对每个关联的 Task，推断影响范围
    for (const taskId of taskIds) {
      if (checkedTasks.has(taskId)) continue;
      checkedTasks.add(taskId);

      const taskEntity = graph.entities[taskId];
      if (!taskEntity) continue;

      // 检查 Task 的 spec 文件是否也更新了
      const taskFile = taskEntity.file;
      let taskMtime = 0;
      if (taskFile) {
        try {
          const st = await stat(join(cwd, taskFile));
          taskMtime = st.mtimeMs;
        } catch {}
      }

      // 如果代码比 Task spec 新，说明存在漂移
      if (taskMtime > 0 && taskMtime >= currentMtime - 60 * 1000) continue; // Task 也在最近更新，不算漂移

      // 5. 通过知识图谱查找关联的 Spec/Req
      const affectedChain: string[] = [];

      // Task 实现了哪些需求
      const implRelations = graph.relations.filter(
        r => r.from === taskId && r.type === 'implements'
      );
      for (const rel of implRelations) {
        affectedChain.push(rel.to);
      }

      // Task 参考了哪些规格
      const refRelations = graph.relations.filter(
        r => r.from === taskId && r.type === 'references'
      );
      for (const rel of refRelations) {
        affectedChain.push(rel.to);
      }

      // Task 依赖了哪些任务（上游也可能受影响）
      const depRelations = graph.relations.filter(
        r => r.from === taskId && r.type === 'depends_on'
      );
      for (const rel of depRelations) {
        affectedChain.push(rel.to);
      }

      results.push({
        entityId: taskId,
        title: taskEntity.title || taskId,
        file: codeFile.path,
        type: 'code_ahead_of_spec',
        severity: 'warning',
        detail: `代码文件 ${codeFile.path} 已修改（${new Date(currentMtime).toLocaleString()}），但关联的 ${taskId} 及 Spec 未同步更新`,
        affectedDownstream: affectedChain.length > 0 ? affectedChain : undefined,
      });
    }
  }

  return results;
}

/** 格式化衰减报告为 Markdown */
export function formatDecayReport(report: DecayReport): string {
  const lines: string[] = [];

  lines.push('## 知识衰减检测');
  lines.push('');

  if (report.decayedFiles.length === 0) {
    lines.push('> ✅ 所有知识均为最新状态，无衰减');
    return lines.join('\n');
  }

  const critical = report.decayedFiles.filter(d => d.severity === 'critical');
  const warning = report.decayedFiles.filter(d => d.severity === 'warning');
  const info = report.decayedFiles.filter(d => d.severity === 'info');
  const codeDrift = report.decayedFiles.filter(d => d.type === 'code_ahead_of_spec');

  if (critical.length > 0) {
    lines.push('### ❌ 严重（上下游不一致）');
    lines.push('');
    for (const item of critical) {
      lines.push(`| \`${item.entityId}\` | ${item.title} | ${item.detail} |`);
    }
    lines.push('');
  }

  if (codeDrift.length > 0) {
    lines.push('### 📝 代码先行（代码已改但 Spec 未同步）');
    lines.push('');
    for (const item of codeDrift) {
      lines.push(`| \`${item.entityId}\` | ${item.title} | ${item.detail} |`);
      if (item.affectedDownstream && item.affectedDownstream.length > 0) {
        lines.push(`|   | 影响链: | ${item.affectedDownstream.join(' → ')} |`);
      }
    }
    lines.push('');
  }

  if (warning.length > 0) {
    lines.push('### ⚠️ 警告（内容已变更）');
    lines.push('');
    for (const item of warning) {
      lines.push(`| \`${item.entityId}\` | ${item.title} | ${item.detail} |`);
    }
    lines.push('');
  }

  if (info.length > 0) {
    lines.push('### ℹ️ 提示（轻微变更）');
    lines.push('');
    for (const item of info) {
      lines.push(`| \`${item.entityId}\` | ${item.title} | ${item.detail} |`);
    }
    lines.push('');
  }

  lines.push(`> 共 ${report.summary.total} 个实体，${report.summary.decayed} 个需关注`);

  return lines.join('\n');
}
