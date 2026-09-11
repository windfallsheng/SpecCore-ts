/**
 * review — Spec 自审命令
 * v8.3.141+: 支持用户主动触发 AI 自审，检查分析文档质量并输出修订建议
 * v8.3.142+: 支持多端、多文档、全局+端组合评审
 *
 * 用法:
 *   speccore review -I <迭代名>                    # 评审整个迭代的 specs
 *   speccore review -I <迭代名> --platform <端1,端2> # 评审多个端的所有 specs
 *   speccore review -I <迭代名> --doc <路径1,路径2>  # 评审多个文档
 *   speccore review --global                        # 评审全局分析文档
 *   speccore review --global --platform backend     # 评审全局 + backend 端
 *
 * 输出: 构建 review prompt 到 .speccore/cache/reviews/
 *       并输出 [SPECCORE_REVIEW: <path>] 标记供宿主 AI 读取
 */

import { readFile, pathExists, readdir, stat } from 'fs-extra';
import { join, basename, dirname, relative } from 'path';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { findProjectRoot } from '../utils/task-utils';
import { findRelevantCode, readRelevantSource } from '../core/code-scanner';
import { loadFreshKnowledgeGraph } from '../core/knowledge-graph';
import { ensureDir, writeFile } from 'fs-extra';

export interface ReviewOptions {
  iteration?: string;
  platform?: string;
  doc?: string;
  global?: boolean;
  fix?: boolean;
  output?: string;
}

interface ReviewTarget {
  filePath: string;
  docContent: string;
  reqContent?: string;
  sourceContext?: string;
  platform?: string;
  feature?: string;
}

/** 入口 */
export async function reviewCommand(options: ReviewOptions): Promise<void> {
  const spinner = new Spinner('准备 Spec 自审上下文');
  spinner.start();

  try {
    const projectRoot = findProjectRoot();
    if (!projectRoot) {
      spinner.stop('未找到项目根目录');
      throw new Error('请在 SpecCore 项目目录内运行此命令（向上查找 .speccore/）');
    }

    // 确定目标文件列表
    const targets = await collectReviewTargets(projectRoot, options, spinner);
    if (targets.length === 0) {
      spinner.stop('未找到需要评审的文档');
      logger.warn('请检查迭代名、端名或文档路径是否正确');
      return;
    }

    spinner.stop(`找到 ${targets.length} 个待评审文档`);

    // 为每个目标构建 review prompt
    const reviewDir = join(projectRoot, '.speccore', 'cache', 'reviews');
    await ensureDir(reviewDir);

    const reportPaths: string[] = [];

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      logger.info(`\n[${i + 1}/${targets.length}] 评审: ${relative(projectRoot, target.filePath)}`);

      // 读取关联需求
      target.reqContent = await findRelatedRequirement(projectRoot, target);

      // 读取关联源码（如果有源码路径配置）
      target.sourceContext = await findRelatedSource(projectRoot, target, spinner);

      // 构建 review prompt
      const prompt = buildReviewPrompt(target);

      // 写入文件
      const safeName = basename(target.filePath).replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_');
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '');
      const promptPath = join(reviewDir, `review-${safeName}-${timestamp}.md`);
      await writeFile(promptPath, prompt, 'utf-8');
      reportPaths.push(promptPath);

      logger.info(`   ✅ Review Prompt 已生成: ${relative(projectRoot, promptPath)}`);
    }

    // 输出总结
    logger.info('\n' + '━'.repeat(50));
    logger.info('🔍 Spec 自审准备完成');
    logger.info('━'.repeat(50));
    for (const p of reportPaths) {
      logger.info(`   📄 ${relative(projectRoot, p)}`);
    }

    if (reportPaths.length === 1) {
      logger.info(`\n[SPECCORE_REVIEW: ${reportPaths[0]}]`);
      logger.info('> 宿主 AI 请读取上述文件，执行评审并输出 REVIEW_REPORT.md');
    } else {
      logger.info(`\n[SPECCORE_REVIEW: ${reviewDir}]`);
      logger.info('> 宿主 AI 请按顺序读取上述文件，执行评审并输出 REVIEW_REPORT.md');
    }

    // 如果 --fix，输出额外提示
    if (options.fix) {
      logger.info('\n💡 --fix 模式: 评审完成后，宿主 AI 可直接生成修订版文档');
      logger.info('   建议将 REVIEW_REPORT.md 中的修订建议应用到原文件');
    }

  } catch (error: any) {
    spinner.fail(`Review 失败: ${error.message || error}`);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════
// 收集待评审目标
// ═══════════════════════════════════════════════════════════

async function collectReviewTargets(
  projectRoot: string,
  options: ReviewOptions,
  _spinner: any,
): Promise<ReviewTarget[]> {
  const targets: ReviewTarget[] = [];

  // 全局模式（可与 --platform / --doc 组合）
  if (options.global) {
    const globalSpecsDir = join(projectRoot, '.speccore', 'GLOBAL', '020-specs');
    if (await pathExists(globalSpecsDir)) {
      const files = await collectMarkdownFiles(globalSpecsDir);
      for (const f of files) {
        targets.push({ filePath: f, docContent: await readFile(f, 'utf-8') });
      }
    }
    // 如果同时指定了 platform 或 doc，继续收集，不 return
    if (!options.platform && !options.doc) return targets;
  }

  // 迭代模式
  const iteration = options.iteration || await getDefaultIteration(undefined);
  if (!iteration) {
    throw new Error('请指定迭代名 (-I) 或在 .speccore/local/context.json 中设置 currentIteration');
  }

  const iterDir = join(projectRoot, '.speccore', 'ITERATIONS', iteration);
  if (!(await pathExists(iterDir))) {
    throw new Error(`迭代不存在: ${iteration}`);
  }

  // 多文档模式（逗号分隔）
  if (options.doc) {
    const docPaths = options.doc.split(',').map(d => d.trim()).filter(Boolean);
    for (const doc of docPaths) {
      const docPath = doc.startsWith('/')
        ? doc
        : join(iterDir, doc);
      if (await pathExists(docPath)) {
        targets.push({ filePath: docPath, docContent: await readFile(docPath, 'utf-8') });
      } else {
        logger.warn(`⚠️  文档不存在，已跳过: ${docPath}`);
      }
    }
    if (targets.length === 0) {
      throw new Error('所有指定的文档都不存在');
    }
    // 去重（避免与 global/platform 重复）
    return dedupeTargets(targets);
  }

  // 按端筛选或全量
  const specsDir = join(iterDir, '020-specs');
  if (!(await pathExists(specsDir))) {
    throw new Error(`迭代 ${iteration} 没有 020-specs/ 目录`);
  }

  // 多端模式（逗号分隔）
  const platforms = options.platform
    ? options.platform.split(',').map(p => p.trim()).filter(Boolean)
    : await detectPlatforms(specsDir);

  for (const platform of platforms) {
    const platformDir = join(specsDir, platform);
    if (!(await pathExists(platformDir))) {
      logger.warn(`⚠️  端目录不存在，已跳过: ${platform}`);
      continue;
    }

    // 也检查 overview 目录（每个平台都包含全局 overview）
    const overviewDir = join(specsDir, 'overview');
    const dirsToScan = [platformDir];
    if (await pathExists(overviewDir)) dirsToScan.push(overviewDir);

    for (const dir of dirsToScan) {
      const files = await collectMarkdownFiles(dir);
      for (const f of files) {
        const rel = relative(specsDir, f);
        const featMatch = rel.match(/^([^/]+)/);
        targets.push({
          filePath: f,
          docContent: await readFile(f, 'utf-8'),
          platform: platform === 'overview' ? undefined : platform,
          feature: featMatch ? featMatch[1] : undefined,
        });
      }
    }
  }

  return dedupeTargets(targets);
}

/** 按文件路径去重 */
function dedupeTargets(targets: ReviewTarget[]): ReviewTarget[] {
  const seen = new Set<string>();
  return targets.filter(t => {
    if (seen.has(t.filePath)) return false;
    seen.add(t.filePath);
    return true;
  });
}

/** 递归收集 Markdown 文件 */
async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await collectMarkdownFiles(fullPath);
      result.push(...sub);
    } else if (entry.name.endsWith('.md')) {
      result.push(fullPath);
    }
  }
  return result;
}

/** 检测 specs 目录下的端列表 */
async function detectPlatforms(specsDir: string): Promise<string[]> {
  const entries = await readdir(specsDir, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory())
    .map(e => e.name);
}

// ═══════════════════════════════════════════════════════════
// 关联需求文档发现
// ═══════════════════════════════════════════════════════════

async function findRelatedRequirement(
  projectRoot: string,
  target: ReviewTarget,
): Promise<string | undefined> {
  // 策略 1: 同目录下找 REQ.md / REQUIREMENT.md
  const dir = dirname(target.filePath);
  const candidates = ['REQ.md', 'REQUIREMENT.md', 'README.md'];
  for (const c of candidates) {
    const p = join(dir, c);
    if (await pathExists(p)) {
      return await readFile(p, 'utf-8');
    }
  }

  // 策略 2: 从迭代 010-requirements/ 找对应功能模块
  if (target.feature) {
    const iterDir = dirname(dirname(dirname(target.filePath))); // 020-specs/../..
    const reqDir = join(iterDir, '010-requirements', 'features', target.feature);
    if (await pathExists(reqDir)) {
      const reqFiles = await collectMarkdownFiles(reqDir);
      if (reqFiles.length > 0) {
        return await readFile(reqFiles[0], 'utf-8');
      }
    }
  }

  // 策略 3: 找迭代根目录的 REQUIREMENT.md
  const iterDir = dirname(dirname(dirname(target.filePath)));
  const rootReq = join(iterDir, 'REQUIREMENT.md');
  if (await pathExists(rootReq)) {
    return await readFile(rootReq, 'utf-8');
  }

  return undefined;
}

// ═══════════════════════════════════════════════════════════
// 关联源码发现
// ═══════════════════════════════════════════════════════════

async function findRelatedSource(
  projectRoot: string,
  target: ReviewTarget,
  _spinner: any,
): Promise<string | undefined> {
  try {
    // 从文档内容提取关键特征词
    const keywords = extractKeywords(target.docContent);
    if (keywords.length === 0) return undefined;

    // 查找关联源码（通过代码索引，不需要直接操作知识图谱）
    const matches = await findRelevantCode(
      keywords.join(' '),
      5,        // limit: 最多 5 个文件
      undefined, // scope: 不限制目录
      undefined, // iteration: 从当前上下文推断
      undefined, // taskId
    );
    if (matches.length === 0) return undefined;

    const sourceContents = await readRelevantSource(matches, 30000, 5);
    const entries = Object.entries(sourceContents);
    if (entries.length === 0) return undefined;

    return entries
      .map(([path, content]) => `// ${path}\n${content}`)
      .join('\n\n');
  } catch {
    return undefined;
  }
}

/** 从文档内容提取关键词（简单启发式） */
function extractKeywords(content: string): string[] {
  const kws = new Set<string>();
  // 提取英文驼峰命名 / 下划线命名
  for (const m of content.matchAll(/[A-Z][a-zA-Z]{2,}/g)) kws.add(m[0]);
  for (const m of content.matchAll(/[a-z][a-z0-9]*_[a-z0-9_]+/g)) kws.add(m[0]);
  // 提取中文词
  for (const m of content.matchAll(/[\u4e00-\u9fa5]{2,}/g)) kws.add(m[0]);
  return Array.from(kws).slice(0, 10);
}

// ═══════════════════════════════════════════════════════════
// 构建 Review Prompt
// ═══════════════════════════════════════════════════════════

function buildReviewPrompt(target: ReviewTarget): string {
  const lines: string[] = [];

  lines.push('# Spec 自审 Prompt');
  lines.push('');
  lines.push(`> 目标文档: ${target.filePath}`);
  if (target.platform) lines.push(`> 端: ${target.platform}`);
  if (target.feature) lines.push(`> 功能模块: ${target.feature}`);
  lines.push('');

  lines.push('## 角色设定');
  lines.push('');
  lines.push('你是一位严格的技术评审员。请扮演 "Spec Reviewer" 角色，对照原始需求文档和源码，检查技术文档的质量。');
  lines.push('');

  lines.push('## 检查维度（必须逐项检查）');
  lines.push('');
  lines.push('### 1. 功能完整性');
  lines.push('- 文档是否覆盖了需求文档中的所有功能点？');
  lines.push('- 是否有遗漏的接口、页面、流程？');
  lines.push('- [INFO_GAP: 如有遗漏，请具体说明缺什么]');
  lines.push('');

  lines.push('### 2. 边界情况与异常处理');
  lines.push('- 是否考虑了空状态、加载状态、错误状态？');
  lines.push('- 异常流程（网络失败、权限不足、数据不存在）是否描述？');
  lines.push('- [INFO_GAP: 如有遗漏，请具体说明缺什么]');
  lines.push('');

  lines.push('### 3. 与源码一致性');
  lines.push('- 文档描述的接口、参数、返回值是否与源码实际一致？');
  lines.push('- 组件/模块划分是否与代码结构匹配？');
  lines.push('- [INFO_GAP: 如有不一致，请具体说明哪里不一致]');
  lines.push('');

  lines.push('### 4. 可执行性');
  lines.push('- 按此文档开发，开发者能否独立完成？');
  lines.push('- 是否有歧义、模糊、需要进一步澄清的地方？');
  lines.push('- [INFO_GAP: 如有歧义，请具体说明]');
  lines.push('');

  lines.push('### 5. 非功能需求');
  lines.push('- 性能、安全、权限、兼容性是否提及？');
  lines.push('- [INFO_GAP: 如有遗漏，请具体说明]');
  lines.push('');

  lines.push('## 输出格式');
  lines.push('');
  lines.push('```markdown');
  lines.push('## REVIEW_REPORT');
  lines.push('');
  lines.push('### 总体评分: x/100');
  lines.push('');
  lines.push('### 通过项');
  lines.push('- [x] 功能完整性');
  lines.push('- [x] ...');
  lines.push('');
  lines.push('### 问题清单');
  lines.push('| 序号 | 维度 | 问题描述 | 严重程度 | 修订建议 |');
  lines.push('| :--- | :--- | :--- | :--- | :--- |');
  lines.push('| 1 | 功能完整性 | xxx | 🔴 高 | 补充 xxx |');
  lines.push('');
  lines.push('### 修订版（直接可用的修改后内容）');
  lines.push('> 仅输出有问题的章节，直接给出修改后的完整内容');
  lines.push('```');
  lines.push('');

  // 原始需求
  if (target.reqContent) {
    lines.push('---');
    lines.push('## 原始需求文档（供对照）');
    lines.push('');
    lines.push(target.reqContent.slice(0, 15000));
    lines.push('');
  }

  // 关联源码
  if (target.sourceContext) {
    lines.push('---');
    lines.push('## 关联源码（供对照）');
    lines.push('');
    lines.push('```');
    lines.push(target.sourceContext.slice(0, 30000));
    lines.push('```');
    lines.push('');
  }

  // 待评审文档
  lines.push('---');
  lines.push('## 待评审文档');
  lines.push('');
  lines.push(target.docContent);
  lines.push('');

  return lines.join('\n');
}
