/**
 * index-guard — 统一命令前索引新鲜度门禁
 *
 * 在 analyze / split / execute / change 等命令执行前，
 * 检查所有索引层（RAG / 代码 / 知识图谱）是否过期，
 * 返回标准化的变更摘要供 AI 展示给用户确认。
 *
 * 设计目标：
 *   - 一个入口函数 ensureIndexFresh() 覆盖所有命令
 *   - 输出标准化格式，AI 可直接展示
 *   - 非阻塞：只 warn 不阻止执行，但明确提示需要刷新
 */

import { logger } from '../utils/logger';
import { checkRagIndexFreshness, loadRagIndex } from './rag-engine';
import { checkCodeIndexFreshness, loadCodeIndex } from './code-scanner';
import { isGraphStale, loadKnowledgeGraph } from './knowledge-graph';
import { getDefaultIteration } from './context';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface IndexFreshnessResult {
  /** 是否全部新鲜 */
  allFresh: boolean;
  /** 各层状态 */
  layers: {
    rag: LayerStatus;
    code: LayerStatus;
    graph: LayerStatus;
  };
  /** 标准化变更摘要（可直接展示给用户） */
  summary: string;
  /** 建议的刷新命令 */
  suggestedCommand: string;
}

export interface LayerStatus {
  /** 层名称 */
  name: string;
  /** 是否新鲜 */
  fresh: boolean;
  /** 变更文件数 */
  changedCount: number;
  /** 变更文件列表（最多显示 5 个） */
  changedFiles: string[];
  /** 人可读的描述 */
  message: string;
}

// ═══════════════════════════════════════════════════════════
// 核心函数
// ═══════════════════════════════════════════════════════════

/**
 * 统一检查所有索引层的新鲜度
 *
 * 在 analyze / split / execute / change 命令入口调用。
 * 返回标准化结果，调用方决定如何展示。
 *
 * @param cwd         工作目录
 * @param command     当前执行的命令名（用于生成建议）
 * @param iteration   迭代名（可选，自动推断）
 */
export async function ensureIndexFresh(
  cwd: string,
  command: string,
  iteration?: string,
): Promise<IndexFreshnessResult> {
  const iterName = iteration || await getDefaultIteration(cwd);

  // ── 并行检查三层 ──
  const [ragStatus, codeStatus, graphStatus] = await Promise.all([
    checkRagLayer(cwd, iterName),
    checkCodeLayer(),
    checkGraphLayer(cwd, iterName),
  ]);

  const allFresh = ragStatus.fresh && codeStatus.fresh && graphStatus.fresh;
  const summary = formatChangeSummary(ragStatus, codeStatus, graphStatus, command);
  const suggestedCommand = `speccore refresh`;

  return {
    allFresh,
    layers: { rag: ragStatus, code: codeStatus, graph: graphStatus },
    summary,
    suggestedCommand,
  };
}

// ═══════════════════════════════════════════════════════════
// 各层检查
// ═══════════════════════════════════════════════════════════

async function checkRagLayer(cwd: string, iteration?: string): Promise<LayerStatus> {
  try {
    // 尝试加载 iteration 级索引
    const ragFileName = iteration ? `rag-index-${iteration}.json` : undefined;
    const index = await loadRagIndex(cwd, ragFileName);
    if (!index) {
      return {
        name: '文档 RAG',
        fresh: true, // 不存在不算过期，只是未建立
        changedCount: 0,
        changedFiles: [],
        message: '未建立索引',
      };
    }
    const { fresh, staleFiles, newFiles } = await checkRagIndexFreshness(cwd, ragFileName);
    const changed = [...staleFiles, ...newFiles];
    return {
      name: '文档 RAG',
      fresh,
      changedCount: changed.length,
      changedFiles: changed.slice(0, 5).map(f => f.replace(cwd + '/', '')),
      message: fresh
        ? '文档索引已同步'
        : `${staleFiles.length} 个文件已变更，${newFiles.length} 个新文件待索引`,
    };
  } catch {
    return {
      name: '文档 RAG',
      fresh: true,
      changedCount: 0,
      changedFiles: [],
      message: '检查失败（跳过）',
    };
  }
}

async function checkCodeLayer(): Promise<LayerStatus> {
  try {
    const freshness = await checkCodeIndexFreshness();
    const staleFiles = freshness.staleFiles || [];
    return {
      name: '代码索引',
      fresh: freshness.fresh,
      changedCount: staleFiles.length,
      changedFiles: staleFiles.slice(0, 5),
      message: freshness.fresh
        ? '代码索引已同步'
        : freshness.message || `${staleFiles.length} 个文件已变更`,
    };
  } catch {
    return {
      name: '代码索引',
      fresh: true,
      changedCount: 0,
      changedFiles: [],
      message: '检查失败（跳过）',
    };
  }
}

async function checkGraphLayer(cwd: string, iteration?: string): Promise<LayerStatus> {
  try {
    const stale = await isGraphStale(cwd, iteration);
    const graph = await loadKnowledgeGraph(cwd);
    const entityCount = graph ? graph.entities.length : 0;
    return {
      name: '知识图谱',
      fresh: !stale,
      changedCount: stale ? 1 : 0,
      changedFiles: stale ? ['需求/规格/任务目录有变更'] : [],
      message: stale
        ? `知识图谱已过期（${entityCount} 个实体待更新）`
        : `知识图谱已同步（${entityCount} 个实体）`,
    };
  } catch {
    return {
      name: '知识图谱',
      fresh: true,
      changedCount: 0,
      changedFiles: [],
      message: '检查失败（跳过）',
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 变更摘要格式化
// ═══════════════════════════════════════════════════════════

/**
 * 格式化标准化变更摘要
 *
 * 输出格式：
 * ```
 * 📋 索引状态检查（执行 {command} 前）
 * ├── ✅ 文档 RAG：已同步
 * ├── ⚠️  代码索引：3 个文件已变更
 * │   ├── src/commands/analyze.ts
 * │   ├── src/core/rag-engine.ts
 * │   └── src/core/prompt-builder.ts
 * └── ⚠️  知识图谱：已过期（12 个实体待更新）
 *
 * 💡 建议执行 `speccore refresh` 更新索引
 * ```
 */
function formatChangeSummary(
  rag: LayerStatus,
  code: LayerStatus,
  graph: LayerStatus,
  command: string,
): string {
  const layers = [rag, code, graph];
  const hasChanges = layers.some(l => !l.fresh);

  if (!hasChanges) {
    return `📋 索引状态检查（${command}）：全部已同步 ✅`;
  }

  const lines: string[] = [];
  lines.push(`📋 索引状态检查（${command} 前）`);

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const connector = i === layers.length - 1 ? '└──' : '├──';
    const icon = layer.fresh ? '✅' : '⚠️ ';
    lines.push(`${connector} ${icon} ${layer.name}：${layer.message}`);

    // 显示变更文件列表（最多 3 个）
    if (!layer.fresh && layer.changedFiles.length > 0) {
      const subConnector = i === layers.length - 1 ? '   ' : '│  ';
      const files = layer.changedFiles.slice(0, 3);
      for (const file of files) {
        lines.push(`${subConnector}   • ${file}`);
      }
      if (layer.changedFiles.length > 3) {
        lines.push(`${subConnector}   ... 还有 ${layer.changedFiles.length - 3} 个文件`);
      }
    }
  }

  lines.push('');
  lines.push('💡 建议执行 `speccore refresh` 更新索引');

  return lines.join('\n');
}

/**
 * 在命令入口输出新鲜度检查（非阻塞，只 warn）
 *
 * 用法：
 *   await warnIfIndexStale(cwd, 'analyze');
 */
export async function warnIfIndexStale(
  cwd: string,
  command: string,
  iteration?: string,
): Promise<IndexFreshnessResult> {
  const result = await ensureIndexFresh(cwd, command, iteration);
  if (!result.allFresh) {
    logger.warn(result.summary);
  }
  return result;
}
