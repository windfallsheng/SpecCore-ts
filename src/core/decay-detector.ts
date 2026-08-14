/**
 * decay-detector — 知识衰减检测
 *
 * 对比上次完整性快照（integrity.json）与当前文件状态，
 * 检测哪些文件已变更但其关联索引/下游引用未更新
 */

import { readFile, pathExists } from 'fs-extra';
import { join } from 'path';
import { createHash } from 'crypto';
import { KnowledgeGraph, GraphEntity } from './knowledge-graph';

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
  type: 'content_changed' | 'downstream_stale' | 'orphaned';
  severity: 'warning' | 'critical';
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

  // 检测 1: content_changed — 文件内容与上次快照不一致
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
        report.decayedFiles.push({
          entityId: entity.id,
          title: entity.title,
          file: entity.file,
          type: 'content_changed',
          severity: 'warning',
          detail: `内容自上次索引后已变更（hash: ${oldHash} → ${entity.hash}）`,
        });
      }
    }
  }

  // 检测 2: downstream_stale — 上游需求变更，下游 spec/task 未更新
  // 找出所有变更的需求
  const changedReqs = new Set(
    report.decayedFiles
      .filter(d => d.type === 'content_changed')
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

  report.summary.decayed = report.decayedFiles.length;
  report.summary.healthy = report.summary.total - report.summary.decayed;

  return report;
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

  if (critical.length > 0) {
    lines.push('### ❌ 严重（上下游不一致）');
    lines.push('');
    for (const item of critical) {
      lines.push(`| \`${item.entityId}\` | ${item.title} | ${item.detail} |`);
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

  lines.push(`> 共 ${report.summary.total} 个实体，${report.summary.decayed} 个需关注`);

  return lines.join('\n');
}
