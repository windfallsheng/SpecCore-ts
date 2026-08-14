/**
 * global-knowledge — 全局知识沉淀引擎
 *
 * 设计哲学：不追求完美文档，追求"能检索到"
 *
 * 工作流程：
 *   1. sync-global 完成后，扫描迭代所有 specs 文档
 *   2. 为全局层构建 RAG 索引（聚合所有迭代的技术内容）
 *   3. 生成轻量级 GLOBAL/SUMMARY.md（AI 概览，可手动修改）
 *   4. 刷新知识图谱
 *
 * 输出：
 *   .speccore/GLOBAL/SUMMARY.md          ← 全局概览（轻量，可手动改）
 *   .speccore/cache/rag-index.json       ← 全局 RAG 索引（聚合所有迭代）
 */

import { readFile, pathExists, readdir, writeFile, ensureDir, stat } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';
import { indexDirectoryDocuments, loadRagIndex } from './rag-engine';
import { refreshKnowledgeGraph } from './knowledge-graph';

export interface GlobalKnowledgeOptions {
  iteration?: string;
  cwd?: string;
}

/**
 * 全局知识沉淀主入口
 * sync-global 完成后调用
 */
export async function syncGlobalKnowledge(options: GlobalKnowledgeOptions = {}): Promise<void> {
  const cwd = options.cwd || process.cwd();
  const iteration = options.iteration;

  logger.info('');
  logger.info('🌐 全局知识沉淀...');

  // ── 1. 收集所有迭代的 specs 文档 ──
  const specsDirs: string[] = [];

  // 1.1 如果指定了迭代，优先扫描该迭代
  if (iteration) {
    const iterSpecsDir = join(cwd, `Iteration-${iteration}`, '020-specs');
    if (await pathExists(iterSpecsDir)) {
      specsDirs.push(iterSpecsDir);
    }
    // 扫描该迭代的所有任务目录
    const tasksDir = join(cwd, `Iteration-${iteration}`, '030-tasks');
    if (await pathExists(tasksDir)) {
      const tasks = await readdir(tasksDir, { withFileTypes: true });
      for (const t of tasks) {
        if (t.isDirectory() && t.name.startsWith('Task-')) {
          const taskSpecsDir = join(tasksDir, t.name, '00-specs');
          const taskSharedDir = join(tasksDir, t.name, '_shared');
          if (await pathExists(taskSpecsDir)) specsDirs.push(taskSpecsDir);
          if (await pathExists(taskSharedDir)) specsDirs.push(taskSharedDir);
        }
      }
    }
  }

  // 1.2 同时扫描全局层的现有 specs
  const globalSpecsDir = join(cwd, '.speccore', 'GLOBAL', '020-specs');
  if (await pathExists(globalSpecsDir)) {
    specsDirs.push(globalSpecsDir);
  }

  if (specsDirs.length === 0) {
    logger.info('   ⚠️ 未找到 specs 文档，跳过全局知识沉淀');
    return;
  }

  // ── 2. 为每个 specs 目录构建/更新 RAG 索引 ──
  // 全局 RAG 索引：聚合所有迭代的 specs
  const globalScope = iteration
    ? `GLOBAL_all_${iteration}_aggregated`
    : 'GLOBAL_all_all_aggregated';

  // 收集所有要索引的文件
  const allFiles: { filePath: string; content: string; mtime: number }[] = [];

  for (const dir of specsDirs) {
    await collectMdFiles(dir, allFiles);
  }

  if (allFiles.length === 0) {
    logger.info('   ⚠️ 未收集到有效文档，跳过');
    return;
  }

  // 用通用函数建全局 RAG 索引
  const { buildRagIndex, saveRagIndex } = await import('./rag-engine');
  const index = await buildRagIndex(allFiles, globalScope);
  await saveRagIndex(cwd, index);

  logger.info(`   ✅ 全局 RAG 索引已更新: ${allFiles.length} 个文件, ${index.chunks.length} 个块`);

  // ── 3. 生成/更新 GLOBAL/SUMMARY.md ──
  await generateGlobalSummary(cwd, allFiles, iteration);

  // ── 4. 刷新知识图谱 ──
  try {
    await refreshKnowledgeGraph(cwd, iteration || undefined);
    logger.info('   ✅ 知识图谱已刷新');
  } catch {
    logger.debug('知识图谱刷新失败（非关键）');
  }

  logger.info('   🌐 全局知识沉淀完成');
}

/**
 * 递归收集目录下的 .md 文件
 */
async function collectMdFiles(
  dir: string,
  result: { filePath: string; content: string; mtime: number }[],
): Promise<void> {
  if (!(await pathExists(dir))) return;
  const items = await readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = join(dir, item.name);
    if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
      await collectMdFiles(fullPath, result);
    } else if (item.isFile() && item.name.endsWith('.md') && !item.name.startsWith('README')) {
      const [content, st] = await Promise.all([
        readFile(fullPath, 'utf-8'),
        stat(fullPath),
      ]);
      if (content.trim().length > 50) {
        result.push({ filePath: fullPath, content, mtime: st.mtimeMs });
      }
    }
  }
}

/**
 * 生成轻量级 GLOBAL/SUMMARY.md
 *
 * 不追求完美，只是聚合信息 + 提供导航。
 * 内容：已交付功能清单、技术方案概览、API 清单、已知问题。
 */
async function generateGlobalSummary(
  cwd: string,
  files: { filePath: string; content: string }[],
  iteration?: string,
): Promise<void> {
  const summaryPath = join(cwd, '.speccore', 'GLOBAL', 'SUMMARY.md');
  await ensureDir(join(cwd, '.speccore', 'GLOBAL'));

  // 从文件内容中提取结构化信息
  const features: string[] = [];
  const techDecisions: string[] = [];
  const apis: string[] = [];
  const issues: string[] = [];

  for (const { filePath, content } of files) {
    const fileName = filePath.split('/').pop() || '';

    // 提取功能点（REQ.md / REQUIREMENT.md 中的 ### 标题）
    if (fileName.includes('REQ') || fileName.includes('REQUIREMENT')) {
      const matches = content.matchAll(/^#{2,3}\s+(.+)$/gm);
      for (const m of matches) {
        const title = m[1].trim();
        if (title && !title.match(/^(需求|概述|目录|前言|背景)/)) {
          features.push(title);
        }
      }
    }

    // 提取技术方案（TECH.md 中的 ### 标题）
    if (fileName.includes('TECH')) {
      const matches = content.matchAll(/^#{2,3}\s+(.+)$/gm);
      for (const m of matches) {
        const title = m[1].trim();
        if (title && !title.match(/^(技术|概述|目录)/)) {
          techDecisions.push(title);
        }
      }
    }

    // 提取 API（表格中的 GET/POST/PUT/DELETE）
    const apiMatches = content.matchAll(/\|\s*(GET|POST|PUT|DELETE|PATCH)\s*\|\s*(\/[^\s|]+)/gi);
    for (const m of apiMatches) {
      apis.push(`${m[1].toUpperCase()} ${m[2]}`);
    }

    // 提取已知问题（.issues.md 或 RISK.md）
    if (fileName.includes('issue') || fileName.includes('RISK')) {
      const issueMatches = content.matchAll(/^[-*]\s+(.+)$/gm);
      for (const m of issueMatches) {
        issues.push(m[1].trim());
      }
    }
  }

  // 去重
  const uniqueFeatures = [...new Set(features)].slice(0, 30);
  const uniqueTech = [...new Set(techDecisions)].slice(0, 20);
  const uniqueApis = [...new Set(apis)].slice(0, 30);
  const uniqueIssues = [...new Set(issues)].slice(0, 10);

  const now = new Date().toLocaleString('zh-CN');
  const iterInfo = iteration ? `（基于 Iteration-${iteration}）` : '';

  const summary = `# 全局技术概览 ${iterInfo}

> 📌 本文件由 \_speccore sync-global\_ 自动生成，**可手动编辑**。不完美没关系，大方向对就行。
> 
> 🔄 最后更新: ${now}

---

## 已交付功能

${uniqueFeatures.length > 0
    ? uniqueFeatures.map(f => `- ${f}`).join('\n')
    : '_暂无功能记录_'}

## 技术方案要点

${uniqueTech.length > 0
    ? uniqueTech.map(t => `- ${t}`).join('\n')
    : '_暂无技术方案_'}

## API 清单

${uniqueApis.length > 0
    ? '| 方法 | 路径 |\n| :--- | :--- |\n' + uniqueApis.map(a => {
        const parts = a.split(' ');
        return `| ${parts[0]} | ${parts[1] || ''} |`;
      }).join('\n')
    : '_暂无 API 记录_'}

## 已知问题 / 风险

${uniqueIssues.length > 0
    ? uniqueIssues.map(i => `- ${i}`).join('\n')
    : '_暂无记录_'}

---

## 文档索引

${files.length > 0
    ? files.map(f => {
        const relPath = f.filePath.replace(cwd + '/', '');
        return `- [${relPath.split('/').pop()}](${relPath})`;
      }).join('\n')
    : '_暂无文档_'}

---

*💡 提示: 运行 \`speccore refresh\` 刷新检索层，运行 \`speccore rag-index\` 查看索引状态。*
`;

  await writeFile(summaryPath, summary);
  logger.info(`   ✅ 全局概览已生成: .speccore/GLOBAL/SUMMARY.md`);
}
