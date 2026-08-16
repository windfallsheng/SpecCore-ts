/**
 * context-builder — 紧凑上下文生成器
 *
 * 从知识图谱 + 衰减报告生成 CONTEXT.md（AI 直接读取的紧凑上下文）
 * 设计目标：< 800 tokens，一眼看到全貌
 */

import { readFile, writeFile, pathExists, ensureDir } from 'fs-extra';
import { join } from 'path';
import { KnowledgeGraph, GraphEntity, getTaskContext } from './knowledge-graph';
import { getIterationDir } from './context';
import { DecayReport } from './decay-detector';

// ═══════════════════════════════════════════════
// 状态 emoji
// ═══════════════════════════════════════════════

function statusEmoji(status?: string): string {
  if (!status) return '🔲';
  if (status === 'completed') return '✅';
  if (status === 'in_progress') return '🟡';
  return '🔲';
}

function statusLabel(status?: string): string {
  if (!status) return '未开始';
  if (status === 'completed') return '已完成';
  if (status === 'in_progress') return '进行中';
  return '未开始';
}

// ═══════════════════════════════════════════════
// CONTEXT.md 生成
// ═══════════════════════════════════════════════

/** 生成完整的 CONTEXT.md 内容 */
export function buildContextMarkdown(
  graph: KnowledgeGraph,
  decay?: DecayReport,
  options?: { currentTask?: string; currentPlatform?: string }
): string {
  const lines: string[] = [];
  const now = new Date().toISOString().split('T')[0];

  lines.push('# 项目上下文快照');
  lines.push(`> 自动生成于 ${now} · speccore reindex · 迭代 ${graph.iteration}`);
  lines.push('');

  // ── 1. 需求→功能模块追踪表 ──
  const reqs = Object.values(graph.entities).filter(e => e.type === 'requirement');
  const tasks = Object.values(graph.entities).filter(e => e.type === 'task');

  if (reqs.length > 0 || tasks.length > 0) {
    lines.push('## 需求→功能模块追踪');
    lines.push('');
    lines.push('| 需求 | 功能模块 | 状态 | 任务 |');
    lines.push('| :--- | :--- | :--- | :--- |');

    // 按编号配对
    const paired = new Set<string>();

    for (const req of reqs) {
      const reqNum = req.id.match(/\d+/)?.[0];
      const relatedTasks = tasks.filter(t => {
        const taskNum = t.id.match(/\d+/)?.[0];
        return taskNum === reqNum;
      });

      if (relatedTasks.length > 0) {
        for (const task of relatedTasks) {
          paired.add(task.id);
          const subtasks = Object.values(graph.entities)
            .filter(e => e.parentTaskId === task.id);
          const subtaskStr = subtasks.length > 0
            ? subtasks.map(s => `${s.platform || '?'}(${s.id.slice(-4)}) ${statusEmoji(s.status)}`).join(' · ')
            : '—';
          lines.push(`| ${req.title} | ${task.title || task.id} | ${statusEmoji(task.status)} ${statusLabel(task.status)} | ${subtaskStr} |`);
        }
      } else {
        lines.push(`| ${req.title} | — | — | — |`);
      }
    }

    // 未关联需求的任务
    const unpairedTasks = tasks.filter(t => !paired.has(t.id));
    for (const task of unpairedTasks) {
      const subtasks = Object.values(graph.entities)
        .filter(e => e.parentTaskId === task.id);
      const subtaskStr = subtasks.length > 0
        ? subtasks.map(s => `${s.platform || '?'}(${s.id.slice(-4)}) ${statusEmoji(s.status)}`).join(' · ')
        : '—';
      lines.push(`| — | ${task.title || task.id} | ${statusEmoji(task.status)} ${statusLabel(task.status)} | ${subtaskStr} |`);
    }

    lines.push('');
  }

  // ── 2. 用户自定义文件 ──
  const userFiles = Object.values(graph.entities).filter(e => e.type === 'user-file');
  if (userFiles.length > 0) {
    lines.push('## 用户自定义文件（未归类）');
    lines.push('');
    for (const f of userFiles) {
      lines.push(`- \`${f.file}\` — ${f.title}`);
    }
    lines.push('');
  }

  // ── 2.5 业务-代码映射 ──
  const bizModules = Object.values(graph.entities).filter(e => e.type === 'business_module');
  if (bizModules.length > 0) {
    lines.push('## 业务-代码映射');
    lines.push('');
    lines.push('| 业务模块 | 端 | 关联代码实体 |');
    lines.push('| :--- | :--- | :--- |');

    // 按端分组
    const byPlatform = new Map<string, GraphEntity[]>();
    for (const m of bizModules) {
      const p = m.platform || 'unknown';
      if (!byPlatform.has(p)) byPlatform.set(p, []);
      byPlatform.get(p)!.push(m);
    }

    for (const [platform, modules] of byPlatform) {
      // 获取该端的所有关系
      const codeRelations = graph.relations.filter(r =>
        modules.some(m => m.id === r.from) &&
        r.type !== 'elaborates'  // 排除到 TECH.md 的关系
      );

      for (const m of modules) {
        const relatedCodes = codeRelations
          .filter(r => r.from === m.id)
          .map(r => {
            const target = graph.entities[r.to];
            return target ? `${r.type}: ${target.title}` : r.to;
          });
        const codeStr = relatedCodes.length > 0 ? relatedCodes.join(', ') : '—';
        lines.push(`| ${m.title} | ${platform} | ${codeStr.slice(0, 100)} |`);
      }
    }
    lines.push('');
  }

  // ── 3. 衰减检测 ──
  if (decay && decay.decayedFiles.length > 0) {
    lines.push('## 知识衰减检测');
    lines.push('');

    const critical = decay.decayedFiles.filter(d => d.severity === 'critical');
    const warning = decay.decayedFiles.filter(d => d.severity === 'warning');

    if (critical.length > 0) {
      lines.push('### ❌ 上下游不一致');
      lines.push('');
      for (const item of critical.slice(0, 5)) {
        lines.push(`- \`${item.entityId}\` ${item.title} — ${item.detail}`);
      }
      lines.push('');
    }

    if (warning.length > 0) {
      lines.push('### ⚠️ 内容已变更');
      lines.push('');
      for (const item of warning.slice(0, 5)) {
        lines.push(`- \`${item.entityId}\` ${item.title} — ${item.detail}`);
      }
      lines.push('');
    }
  } else if (decay) {
    lines.push('## 知识衰减检测');
    lines.push('> ✅ 所有知识均为最新状态');
    lines.push('');
  }

  // ── 4. 当前任务上下文（如果指定了任务） ──
  if (options?.currentTask) {
    const taskContext = getTaskContext(graph, options.currentTask);
    if (taskContext.requirement || taskContext.parentTask || taskContext.siblingSubtasks.length > 0
        || taskContext.relatedSpecs.length > 0 || taskContext.dependsOn.length > 0) {
      lines.push('## 当前任务关联链');
      lines.push('');

      if (taskContext.requirement) {
        lines.push(`- **上游需求**: ${taskContext.requirement.id} — ${taskContext.requirement.title}`);
      }
      if (taskContext.parentTask) {
        lines.push(`- **父任务**: ${taskContext.parentTask.id} — ${taskContext.parentTask.title}`);
      }
      if (taskContext.siblingSubtasks.length > 0) {
        lines.push('- **兄弟任务**:');
        for (const sub of taskContext.siblingSubtasks) {
          const current = sub.platform === options.currentPlatform ? ' ⬅ 当前' : '';
          lines.push(`  - ${sub.platform || '?'}: ${statusEmoji(sub.status)} ${sub.title}${current}`);
        }
      }
      if (taskContext.relatedSpecs.length > 0) {
        lines.push('- **关联规格**:');
        for (const spec of taskContext.relatedSpecs) {
          lines.push(`  - ${spec.id}: ${spec.title}`);
        }
      }
      if (taskContext.dependsOn.length > 0) {
        lines.push('- **依赖任务**:');
        for (const dep of taskContext.dependsOn) {
          lines.push(`  - ${dep.id}: ${dep.title}`);
        }
      }
      lines.push('');
    }
  }

  // ── 5. 统计 ──
  lines.push('---');
  lines.push(`> ${graph.stats.requirements} 需求 · ${graph.stats.specs} 规格 · ${graph.stats.tasks} 功能模块 · ${graph.stats.subtasks} 任务${userFiles.length > 0 ? ` · ${userFiles.length} 用户文件` : ''}`);

  return lines.join('\n');
}

/** 生成并保存 CONTEXT.md */
export async function saveContextMarkdown(
  cwd: string,
  content: string,
  iteration?: string
): Promise<string> {
  let targetDir: string;
  if (iteration) {
    const iterDir = await getIterationDir(iteration);
    if (iterDir) {
      targetDir = join(iterDir, '000-overview');
    } else {
      targetDir = join(cwd, '.speccore', 'cache');
    }
  } else {
    // 保存到全局 cache 下
    targetDir = join(cwd, '.speccore', 'cache');
  }

  await ensureDir(targetDir);
  const filePath = join(targetDir, 'CONTEXT.md');
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

/**
 * 为 prompt 注入生成紧凑上下文字符串（< 500 tokens）
 * 直接嵌入到 AI prompt 中，不需要 AI 额外 Read
 */
export function buildCompactContext(
  graph: KnowledgeGraph,
  options: { taskId?: string; platform?: string }
): string {
  if (!options.taskId) return '';

  const taskContext = getTaskContext(graph, options.taskId);
  const lines: string[] = [];

  if (taskContext.requirement) {
    lines.push(`上游需求: ${taskContext.requirement.id}（${taskContext.requirement.title}）`);
  }

  if (taskContext.parentTask) {
    lines.push(`父任务: ${taskContext.parentTask.id}（${taskContext.parentTask.title}）`);
  }

  if (taskContext.siblingSubtasks.length > 0) {
    const parts = taskContext.siblingSubtasks.map(s => {
      const current = s.platform === options.platform ? ' ⬅当前' : '';
      return `${s.platform}:${statusEmoji(s.status)}${current}`;
    });
    lines.push(`各端进度: ${parts.join(' · ')}`);
  }

  if (taskContext.relatedSpecs.length > 0) {
    lines.push(`关联规格: ${taskContext.relatedSpecs.map(s => s.id).join(', ')}`);
  }

  if (taskContext.dependsOn.length > 0) {
    lines.push(`依赖任务: ${taskContext.dependsOn.map(d => d.id).join(', ')}`);
  }

  return lines.length > 0 ? lines.join('\n') : '';
}
