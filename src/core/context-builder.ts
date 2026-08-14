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

  // ── 1. 需求→任务追踪表 ──
  const reqs = Object.values(graph.entities).filter(e => e.type === 'requirement');
  const tasks = Object.values(graph.entities).filter(e => e.type === 'task');

  if (reqs.length > 0 || tasks.length > 0) {
    lines.push('## 需求→任务追踪');
    lines.push('');
    lines.push('| 需求 | 任务 | 状态 | 子任务 |');
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
          lines.push(`| ${req.id} ${req.title} | ${task.id} | ${statusEmoji(task.status)} ${statusLabel(task.status)} | ${subtaskStr} |`);
        }
      } else {
        lines.push(`| ${req.id} ${req.title} | — | — | — |`);
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
      lines.push(`| — | ${task.id} ${task.title} | ${statusEmoji(task.status)} ${statusLabel(task.status)} | ${subtaskStr} |`);
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
    if (taskContext.requirement || taskContext.parentTask || taskContext.siblingSubtasks.length > 0) {
      lines.push('## 当前任务关联链');
      lines.push('');

      if (taskContext.requirement) {
        lines.push(`- **上游需求**: ${taskContext.requirement.id} — ${taskContext.requirement.title}`);
      }
      if (taskContext.parentTask) {
        lines.push(`- **父任务**: ${taskContext.parentTask.id} — ${taskContext.parentTask.title}`);
      }
      if (taskContext.siblingSubtasks.length > 0) {
        lines.push('- **兄弟子任务**:');
        for (const sub of taskContext.siblingSubtasks) {
          const current = sub.platform === options.currentPlatform ? ' ⬅ 当前' : '';
          lines.push(`  - ${sub.platform || '?'}: ${statusEmoji(sub.status)} ${sub.title}${current}`);
        }
      }
      lines.push('');
    }
  }

  // ── 5. 统计 ──
  lines.push('---');
  lines.push(`> ${graph.stats.requirements} 需求 · ${graph.stats.specs} 规格 · ${graph.stats.tasks} 任务 · ${graph.stats.subtasks} 子任务${userFiles.length > 0 ? ` · ${userFiles.length} 用户文件` : ''}`);

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

  return lines.length > 0 ? lines.join('\n') : '';
}
