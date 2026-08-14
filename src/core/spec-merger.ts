/**
 * spec-merger — Section 级局部更新引擎
 *
 * 统一处理三种场景的局部合并：
 * 1. analyze --task --sync → 任务分析结果局部回写 020-specs/
 * 2. change → 需求变更后局部更新受影响的 specs
 * 3. sync-global → 迭代 specs 局部合并到全局层
 *
 * 核心原则：只更新受影响的部分，其余内容不动
 */

import { readFile, writeFile, pathExists, readdir, ensureDir } from 'fs-extra';
import { join, basename } from 'path';
import { logger } from '../utils/logger';

// ═══════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════

export interface MarkdownSection {
  /** 原始标题文本（不含 # 前缀） */
  heading: string;
  /** 标题级别 (1-6) */
  level: number;
  /** 正文内容（不含标题行） */
  content: string;
  /** 包含标题行的完整原始文本 */
  raw: string;
}

export interface AffectedFeature {
  /** 功能模块名 */
  name: string;
  /** spec 文件路径（相对迭代目录） */
  specPath: string;
  /** 需求源文件路径（相对迭代目录） */
  reqPath: string;
  /** 匹配置信度 */
  confidence: number;
}

export interface MergeResult {
  /** 修改的文件数 */
  filesUpdated: number;
  /** 每个文件的变更摘要 */
  changes: { file: string; sectionsPatched: string[]; action: 'patched' | 'created' | 'skipped' }[];
}

// ═══════════════════════════════════════════════
// Markdown Section 拆分/重组
// ═══════════════════════════════════════════════

/**
 * 将 Markdown 文档按 H2 标题拆分为段落数组
 *
 * 标题前的内容（前言）作为第一个元素返回（heading 为空字符串）
 */
export function splitMarkdownSections(content: string): MarkdownSection[] {
  const lines = content.split('\n');
  const sections: MarkdownSection[] = [];
  let cur: MarkdownSection = { heading: '', level: 0, content: '', raw: '' };

  for (const line of lines) {
    const hMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (hMatch && hMatch[1].length <= 2) {
      // 只按 H1/H2 拆分（更细粒度可后续扩展）
      if (cur.heading || cur.content) {
        cur.raw = (cur.heading ? `#${' #'.repeat(cur.level - 1)} ${cur.heading}\n` : '') + cur.content;
        sections.push(cur);
      }
      cur = { heading: hMatch[2].trim(), level: hMatch[1].length, content: '', raw: '' };
    } else {
      cur.content += (cur.content ? '\n' : '') + line;
    }
  }
  // 推入最后一段
  if (cur.heading || cur.content) {
    cur.raw = (cur.heading ? `#${' #'.repeat(cur.level - 1)} ${cur.heading}\n` : '') + cur.content;
    sections.push(cur);
  }
  return sections;
}

/**
 * 替换文档中指定标题的段落，不存在则追加
 *
 * @param docContent 原始完整文档
 * @param sectionHeading 要替换的 H2 标题（精确匹配或包含匹配）
 * @param newContent 新的段落内容（不含标题行）
 * @returns 替换后的完整文档
 */
export function patchSection(
  docContent: string,
  sectionHeading: string,
  newContent: string
): string {
  const sections = splitMarkdownSections(docContent);
  let patched = false;

  for (const sec of sections) {
    if (sec.heading === sectionHeading || sec.heading.includes(sectionHeading)) {
      sec.content = newContent.endsWith('\n') ? newContent : newContent + '\n';
      patched = true;
      break;
    }
  }

  if (!patched) {
    // 追加新段落
    sections.push({
      heading: sectionHeading,
      level: 2,
      content: newContent.endsWith('\n') ? newContent : newContent + '\n',
      raw: `## ${sectionHeading}\n${newContent}`,
    });
  }

  return sections.map(s => {
    if (s.level === 0) return s.content.trimEnd();
    return `${'#'.repeat(s.level)} ${s.heading}\n${s.content.trimEnd()}`;
  }).join('\n\n');
}

/**
 * 从文档中提取指定标题的段落内容
 */
export function extractSection(docContent: string, sectionHeading: string): string | null {
  const sections = splitMarkdownSections(docContent);
  for (const sec of sections) {
    if (sec.heading === sectionHeading || sec.heading.includes(sectionHeading)) {
      return sec.content.trim();
    }
  }
  return null;
}

// ═══════════════════════════════════════════════
// 关键词提取
// ═══════════════════════════════════════════════

/** 中文分词常用停用词（过滤用） */
const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
  '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
  '没有', '看', '好', '自己', '这', '他', '她', '它', '们', '那', '些',
  '什么', '怎么', '如何', '为什么', '可以', '需要', '使用', '通过', '进行',
  '功能', '模块', '系统', '管理', '服务', '实现', '设计', '开发',
]);

/**
 * 从文本中提取特征关键词（≥3 字符，过滤停用词）
 */
export function extractKeywords(text: string): string[] {
  const chinese = text.match(/[\u4e00-\u9fa5]{3,}/g) || [];
  const english = text.match(/[a-zA-Z]{3,}/g) || [];
  const keywords = [...chinese, ...english]
    .filter(w => !STOP_WORDS.has(w))
    .map(w => w.toLowerCase());
  return [...new Set(keywords)];
}

// ═══════════════════════════════════════════════
// 功能模块级合并
// ═══════════════════════════════════════════════

/**
 * 将源文档中的相关段落合并到目标文档
 *
 * 匹配策略：
 * 1. 标题精确匹配 → 直接替换
 * 2. 标题关键词重叠 → 替换（重叠率 > 阈值）
 * 3. 无匹配 → 追加到目标文档末尾
 *
 * @param sourceContent 源文档（新分析结果）
 * @param targetContent 目标文档（现有 spec）
 * @param keywords 用于匹配的关键词集合
 * @returns 合并后的文档
 */
export function mergeSpecContent(
  sourceContent: string,
  targetContent: string,
  keywords: string[]
): { content: string; patchedSections: string[] } {
  const sourceSections = splitMarkdownSections(sourceContent);
  const targetSections = splitMarkdownSections(targetContent);
  const patchedSections: string[] = [];

  const kwLower = keywords.map(k => k.toLowerCase());

  for (const src of sourceSections) {
    if (!src.heading || src.level === 0) continue; // 跳过前言

    // 关键词匹配打分
    const srcKw = extractKeywords(src.heading + ' ' + src.content.slice(0, 200));
    let matchScore = 0;
    for (const kw of kwLower) {
      if (srcKw.some(sk => sk.includes(kw) || kw.includes(sk))) {
        matchScore++;
      }
    }

    if (matchScore === 0 && kwLower.length > 0) continue; // 不相关的段落，跳过

    // 在目标中找匹配段落
    let bestMatch = -1;
    let bestScore = 0;
    for (let i = 0; i < targetSections.length; i++) {
      const tgt = targetSections[i];
      if (!tgt.heading) continue;

      // 精确匹配
      if (tgt.heading === src.heading) {
        bestMatch = i;
        bestScore = 100;
        break;
      }

      // 包含匹配
      if (tgt.heading.includes(src.heading) || src.heading.includes(tgt.heading)) {
        bestMatch = i;
        bestScore = 80;
        break;
      }

      // 关键词重叠匹配
      const tgtKw = extractKeywords(tgt.heading);
      let overlap = 0;
      for (const sk of srcKw) {
        if (tgtKw.some(tk => tk.includes(sk) || sk.includes(tk))) {
          overlap++;
        }
      }
      if (overlap > bestScore) {
        bestScore = overlap;
        bestMatch = i;
      }
    }

    if (bestMatch >= 0 && bestScore > 0) {
      // 替换已有段落
      targetSections[bestMatch].content = src.content;
      patchedSections.push(targetSections[bestMatch].heading);
    } else if (matchScore > 0) {
      // 追加新段落
      targetSections.push(src);
      patchedSections.push(src.heading);
    }
  }

  const content = targetSections.map(s => {
    if (s.level === 0) return s.content.trimEnd();
    return `${'#'.repeat(s.level)} ${s.heading}\n${s.content.trimEnd()}`;
  }).join('\n\n');

  return { content, patchedSections };
}

// ═══════════════════════════════════════════════
// 影响范围查询
// ═══════════════════════════════════════════════

/**
 * 根据关键词查找受影响的功能模块 spec 文件
 *
 * 扫描 020-specs/features/ 目录，按文件名和内容匹配关键词
 */
export async function findAffectedFeatures(
  iterDir: string,
  keywords: string[]
): Promise<AffectedFeature[]> {
  const featuresDir = join(iterDir, '020-specs', 'features');
  if (!(await pathExists(featuresDir))) return [];

  const results: AffectedFeature[] = [];
  const entries = await readdir(featuresDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const featureName = entry.name.replace('.md', '');
    const specPath = join('020-specs', 'features', entry.name);

    // 文件名匹配
    const nameKw = extractKeywords(featureName);
    let score = 0;
    for (const kw of keywords) {
      if (featureName.includes(kw) || nameKw.some(nk => nk.includes(kw) || kw.includes(nk))) {
        score += 2;
      }
    }

    // 内容匹配（轻量：只读前 500 字符）
    const content = await readFile(join(featuresDir, entry.name), 'utf-8');
    const header = content.slice(0, 500);
    for (const kw of keywords) {
      if (header.includes(kw)) score += 1;
    }

    if (score > 0) {
      // 推导对应的需求源路径
      const reqPath = `010-requirements/features/${featureName}/README.md`;
      results.push({ name: featureName, specPath, reqPath, confidence: score });
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

/**
 * 根据关键词查找受影响的顶层 spec 文件（TECH.md / TEST.md 等）
 *
 * 返回需要 patch 的 section 名称列表
 */
export async function findAffectedSpecSections(
  iterDir: string,
  keywords: string[]
): Promise<{ file: string; sections: string[] }[]> {
  const specFiles = ['TECH.md', 'TEST.md', 'RISK.md', 'DEPS.md', 'MONITOR.md'];
  const results: { file: string; sections: string[] }[] = [];

  for (const filename of specFiles) {
    const filePath = join(iterDir, '020-specs', filename);
    if (!(await pathExists(filePath))) continue;

    const content = await readFile(filePath, 'utf-8');
    const sections = splitMarkdownSections(content);
    const matched: string[] = [];

    for (const sec of sections) {
      if (!sec.heading) continue;
      const secKw = extractKeywords(sec.heading + ' ' + sec.content.slice(0, 200));
      for (const kw of keywords) {
        if (secKw.some(sk => sk.includes(kw) || kw.includes(sk))) {
          matched.push(sec.heading);
          break;
        }
      }
    }

    if (matched.length > 0) {
      results.push({ file: filename, sections: matched });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════
// 高层 API：任务级局部回写
// ═══════════════════════════════════════════════

/**
 * 将任务分析结果局部回写到迭代级 020-specs/
 *
 * 流程：
 * 1. 从任务标题/REQ.md 提取关键词
 * 2. 查找受影响的功能模块 spec 文件
 * 3. 对每个受影响文件执行 section 级 merge
 * 4. 对顶层 spec 文件（TECH.md 等）执行 section 级 patch
 *
 * @param iterDir 迭代目录绝对路径
 * @param taskDir 任务目录绝对路径
 * @param taskName 任务名称（用于关键词提取）
 * @returns 合并结果摘要
 */
export async function syncTaskToSpecs(
  iterDir: string,
  taskDir: string,
  taskName: string
): Promise<MergeResult> {
  const result: MergeResult = { filesUpdated: 0, changes: [] };

  // 1. 提取关键词
  const keywords = extractKeywords(taskName);
  // 补充：从 _shared/REQ.md 提取更多关键词
  const reqMdPath = join(taskDir, '_shared', 'REQ.md');
  if (await pathExists(reqMdPath)) {
    const reqContent = await readFile(reqMdPath, 'utf-8');
    const reqKw = extractKeywords(reqContent.slice(0, 1000));
    keywords.push(...reqKw);
  }
  const uniqueKw = [...new Set(keywords)];

  if (uniqueKw.length === 0) {
    logger.warn('   ⚠️ 无法提取有效关键词，跳过局部回写');
    return result;
  }

  logger.info(`   🔑 关键词: ${uniqueKw.slice(0, 6).join(', ')}${uniqueKw.length > 6 ? ` ...等${uniqueKw.length}个` : ''}`);

  // 2. 查找受影响的功能模块
  const affectedFeatures = await findAffectedFeatures(iterDir, uniqueKw);

  // 3. 对每个受影响的功能模块执行 merge
  for (const feature of affectedFeatures) {
    const specFullPath = join(iterDir, feature.specPath);
    const sourceContent = await readTaskSpecContent(taskDir, feature.name, uniqueKw);

    if (!sourceContent) {
      result.changes.push({ file: feature.specPath, sectionsPatched: [], action: 'skipped' });
      continue;
    }

    let targetContent = '';
    if (await pathExists(specFullPath)) {
      targetContent = await readFile(specFullPath, 'utf-8');
    }

    const { content, patchedSections } = mergeSpecContent(sourceContent, targetContent, uniqueKw);

    if (patchedSections.length > 0) {
      await ensureDir(join(iterDir, '020-specs', 'features'));
      await writeFile(specFullPath, content, 'utf-8');
      result.filesUpdated++;
      result.changes.push({ file: feature.specPath, sectionsPatched: patchedSections, action: targetContent ? 'patched' : 'created' });
      logger.info(`   ✅ ${feature.specPath}: 更新 ${patchedSections.length} 个段落 [${patchedSections.join(', ')}]`);
    } else {
      result.changes.push({ file: feature.specPath, sectionsPatched: [], action: 'skipped' });
    }
  }

  // 4. 对顶层 spec 文件执行 section 级 patch
  const affectedSections = await findAffectedSpecSections(iterDir, uniqueKw);
  for (const { file, sections } of affectedSections) {
    const specFullPath = join(iterDir, '020-specs', file);
    const taskSpecContent = await readTaskSpecByFilename(taskDir, file);
    if (!taskSpecContent) continue;

    const existingContent = await pathExists(specFullPath)
      ? await readFile(specFullPath, 'utf-8')
      : '';

    let updated = existingContent;
    const patched: string[] = [];
    for (const sectionName of sections) {
      const newSectionContent = extractSection(taskSpecContent, sectionName);
      if (newSectionContent) {
        updated = patchSection(updated, sectionName, newSectionContent);
        patched.push(sectionName);
      }
    }

    if (patched.length > 0) {
      await writeFile(specFullPath, updated, 'utf-8');
      result.filesUpdated++;
      result.changes.push({ file: `020-specs/${file}`, sectionsPatched: patched, action: existingContent ? 'patched' : 'created' });
      logger.info(`   ✅ 020-specs/${file}: 更新 ${patched.length} 个段落 [${patched.join(', ')}]`);
    }
  }

  return result;
}

// ═══════════════════════════════════════════════
// 高层 API：迭代级同步到全局
// ═══════════════════════════════════════════════

/**
 * 将迭代级 spec 文件局部合并到全局层
 *
 * 与 syncTaskToSpecs 类似，但方向是 iteration → global
 *
 * @param iterDir 迭代目录绝对路径
 * @param globalDir 全局 .speccore 目录绝对路径
 * @param keywords 可选的过滤关键词（只同步相关模块）
 */
export async function syncIterationToGlobal(
  iterDir: string,
  globalDir: string,
  keywords?: string[]
): Promise<MergeResult> {
  const result: MergeResult = { filesUpdated: 0, changes: [] };

  // 扫描迭代 020-specs/ 下的所有 spec 文件
  const iterSpecsDir = join(iterDir, '020-specs');
  if (!(await pathExists(iterSpecsDir))) return result;

  const entries = await readdir(iterSpecsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name === 'features') {
      // 功能模块：逐个 merge 到全局
      const featureEntries = await readdir(join(iterSpecsDir, 'features'), { withFileTypes: true });
      for (const fe of featureEntries) {
        if (!fe.isFile() || !fe.name.endsWith('.md')) continue;

        // 关键词过滤
        if (keywords && keywords.length > 0) {
          const feKw = extractKeywords(fe.name);
          const hasMatch = keywords.some(kw => feKw.some(fk => fk.includes(kw) || kw.includes(fk)) || fe.name.includes(kw));
          if (!hasMatch) continue;
        }

        const iterContent = await readFile(join(iterSpecsDir, 'features', fe.name), 'utf-8');
        const globalFeatureDir = join(globalDir, 'GLOBAL', '020-specs', 'features');
        const globalPath = join(globalFeatureDir, fe.name);
        const globalContent = (await pathExists(globalPath))
          ? await readFile(globalPath, 'utf-8')
          : '';

        const mergeKw = keywords || extractKeywords(fe.name);
        const { content, patchedSections } = mergeSpecContent(iterContent, globalContent, mergeKw);

        if (patchedSections.length > 0 || !globalContent) {
          await ensureDir(globalFeatureDir);
          await writeFile(globalPath, content, 'utf-8');
          result.filesUpdated++;
          result.changes.push({
            file: `GLOBAL/020-specs/features/${fe.name}`,
            sectionsPatched: patchedSections,
            action: globalContent ? 'patched' : 'created',
          });
        }
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      // 顶层文件：section 级 merge
      if (keywords && keywords.length > 0) {
        const fileKw = extractKeywords(entry.name);
        const hasMatch = keywords.some(kw => fileKw.some(fk => fk.includes(kw) || kw.includes(fk)));
        if (!hasMatch) continue;
      }

      const iterContent = await readFile(join(iterSpecsDir, entry.name), 'utf-8');
      const globalSpecDir = join(globalDir, 'GLOBAL', '020-specs');
      const globalPath = join(globalSpecDir, entry.name);
      const globalContent = (await pathExists(globalPath))
        ? await readFile(globalPath, 'utf-8')
        : '';

      const mergeKw = keywords || extractKeywords(entry.name);
      const { content, patchedSections } = mergeSpecContent(iterContent, globalContent, mergeKw);

      if (patchedSections.length > 0 || !globalContent) {
        await ensureDir(globalSpecDir);
        await writeFile(globalPath, content, 'utf-8');
        result.filesUpdated++;
        result.changes.push({
          file: `GLOBAL/020-specs/${entry.name}`,
          sectionsPatched: patchedSections,
          action: globalContent ? 'patched' : 'created',
        });
      }
    }
  }

  return result;
}

// ═══════════════════════════════════════════════
// 内部辅助
// ═══════════════════════════════════════════════

/** 读取任务目录中与功能模块相关的 spec 内容 */
async function readTaskSpecContent(
  taskDir: string,
  featureName: string,
  keywords: string[]
): Promise<string | null> {
  // 优先从 _shared/TECH.md 提取
  const techPath = join(taskDir, '_shared', 'TECH.md');
  if (await pathExists(techPath)) {
    const content = await readFile(techPath, 'utf-8');
    // 尝试提取与 featureName 相关的段落
    const sectionContent = extractSection(content, featureName);
    if (sectionContent) return `## ${featureName}\n${sectionContent}`;

    // 回退：提取包含关键词的段落
    const sections = splitMarkdownSections(content);
    const relevant = sections.filter(s => {
      if (!s.heading) return false;
      return keywords.some(kw => s.heading.includes(kw) || s.content.slice(0, 200).includes(kw));
    });
    if (relevant.length > 0) {
      return relevant.map(s => `## ${s.heading}\n${s.content.trim()}`).join('\n\n');
    }
  }

  // 回退：读取 _shared/REQ.md
  const reqPath = join(taskDir, '_shared', 'REQ.md');
  if (await pathExists(reqPath)) {
    const content = await readFile(reqPath, 'utf-8');
    return content;
  }

  return null;
}

/** 按文件名读取任务目录中对应的 spec 文件 */
async function readTaskSpecByFilename(
  taskDir: string,
  filename: string
): Promise<string | null> {
  // 优先 _shared/，回退 99-artifacts/
  const paths = [
    join(taskDir, '_shared', filename),
    join(taskDir, '00-specs', filename),
    join(taskDir, '99-artifacts', filename),
  ];
  for (const p of paths) {
    if (await pathExists(p)) return readFile(p, 'utf-8');
  }
  return null;
}

// ═══════════════════════════════════════════════
// 高层 API：归档时新增需求合并回原文档
// ═══════════════════════════════════════════════

/**
 * 归档时将新增需求局部合并回原需求文档
 *
 * 流程：
 * 1. 扫描迭代下所有任务，找出「新增需求」任务
 *    （通过 .meta/ 标记、CHANGE_SUMMARY.md 记录、或任务名含"新增"特征）
 * 2. 读取任务的 _shared/REQ.md
 * 3. 按关键词匹配原需求文档（010-requirements/features/ 或 converted/）
 * 4. 用 mergeSpecContent() 做 section 级合并
 * 5. 未匹配到原文档的，追加到 features/{slug}/README.md
 */
export async function mergeNewRequirementsOnArchive(
  iterDir: string
): Promise<MergeResult> {
  const result: MergeResult = { filesUpdated: 0, changes: [] };
  const tasksDir = join(iterDir, '030-tasks');
  if (!(await pathExists(tasksDir))) return result;

  // 扫描所有任务目录（含类型子目录）
  const taskDirs = await scanTaskDirs(tasksDir);

  // 读取 CHANGE_SUMMARY.md 获取新增需求记录
  const changeSummaryPath = join(iterDir, '020-specs', 'CHANGE_SUMMARY.md');
  let changeSummaryContent = '';
  if (await pathExists(changeSummaryPath)) {
    changeSummaryContent = await readFile(changeSummaryPath, 'utf-8');
  }

  for (const { taskId, taskDir } of taskDirs) {
    // 检查是否是「新增需求」任务
    const isNewReq = await detectNewRequirement(taskDir, taskId, changeSummaryContent);
    if (!isNewReq) continue;

    // 读取任务的 REQ.md
    const reqMdPath = join(taskDir, '_shared', 'REQ.md');
    if (!(await pathExists(reqMdPath))) continue;
    const reqContent = await readFile(reqMdPath, 'utf-8');

    // 提取关键词
    const titleMatch = reqContent.match(/^#\s+(.+)/m);
    const taskTitle = titleMatch ? titleMatch[1].trim() : taskId;
    const keywords = extractKeywords(taskTitle + ' ' + reqContent.slice(0, 500));
    if (keywords.length === 0) continue;

    // 查找匹配的原需求文档
    const matchedOriginal = await findMatchingOriginalRequirement(iterDir, keywords);

    if (matchedOriginal) {
      // 合并到原文档
      const originalContent = await readFile(matchedOriginal.path, 'utf-8');
      const { content, patchedSections } = mergeSpecContent(reqContent, originalContent, keywords);

      if (patchedSections.length > 0) {
        await writeFile(matchedOriginal.path, content, 'utf-8');
        result.filesUpdated++;
        result.changes.push({
          file: matchedOriginal.relativePath,
          sectionsPatched: patchedSections,
          action: 'patched',
        });
        logger.info(`   ✅ ${taskId} → ${matchedOriginal.relativePath}: 合并 ${patchedSections.length} 个段落`);
      } else {
        result.changes.push({ file: matchedOriginal.relativePath, sectionsPatched: [], action: 'skipped' });
      }
    } else {
      // 未匹配到原文档 → 追加到 features/{slug}/README.md
      const slug = slugify(taskTitle);
      const featureDir = join(iterDir, '010-requirements', 'features', slug);
      const featurePath = join(featureDir, 'README.md');

      if (!(await pathExists(featurePath))) {
        await ensureDir(featureDir);
        await writeFile(featurePath, reqContent, 'utf-8');
        result.filesUpdated++;
        result.changes.push({
          file: `010-requirements/features/${slug}/README.md`,
          sectionsPatched: ['(新建)'],
          action: 'created',
        });
        logger.info(`   ✨ ${taskId} → 新建 features/${slug}/README.md`);
      } else {
        // 已存在 → section 级合并
        const existing = await readFile(featurePath, 'utf-8');
        const { content, patchedSections } = mergeSpecContent(reqContent, existing, keywords);
        if (patchedSections.length > 0) {
          await writeFile(featurePath, content, 'utf-8');
          result.filesUpdated++;
          result.changes.push({
            file: `010-requirements/features/${slug}/README.md`,
            sectionsPatched: patchedSections,
            action: 'patched',
          });
          logger.info(`   ✅ ${taskId} → features/${slug}/README.md: 合并 ${patchedSections.length} 个段落`);
        }
      }
    }
  }

  return result;
}

// ═══════════════════════════════════════════════
// 归档合并 — 内部辅助
// ═══════════════════════════════════════════════

/** 递归扫描任务目录（支持类型子目录） */
async function scanTaskDirs(tasksDir: string): Promise<{ taskId: string; taskDir: string }[]> {
  const results: { taskId: string; taskDir: string }[] = [];
  const entries = await readdir(tasksDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    const fullPath = join(tasksDir, entry.name);

    if (entry.name.startsWith('Task-')) {
      results.push({ taskId: entry.name, taskDir: fullPath });
    } else {
      // 类型子目录（feature/bugfix/refactor/...）→ 递归扫描
      try {
        const subEntries = await readdir(fullPath, { withFileTypes: true });
        for (const sub of subEntries) {
          if (sub.isDirectory() && sub.name.startsWith('Task-')) {
            results.push({ taskId: sub.name, taskDir: join(fullPath, sub.name) });
          }
        }
      } catch {}
    }
  }
  return results;
}

/** 检测任务是否为「新增需求」（通过多种信号判断） */
async function detectNewRequirement(
  taskDir: string, taskId: string, changeSummaryContent: string
): Promise<boolean> {
  // 信号 1：CHANGE_SUMMARY.md 中记录了该任务为「新增」
  if (changeSummaryContent) {
    const pattern = new RegExp(`${taskId}.*(?:新增|新增需求|added|new)`, 'i');
    if (pattern.test(changeSummaryContent)) return true;
  }

  // 信号 2：.meta/ 目录中有 change-source 标记
  const changeSourcePath = join(taskDir, '.meta', 'change-source');
  if (await pathExists(changeSourcePath)) {
    const content = await readFile(changeSourcePath, 'utf-8');
    if (content.includes('new') || content.includes('新增')) return true;
  }

  // 信号 3：任务名/REQ.md 标题含「新增」特征
  const reqMdPath = join(taskDir, '_shared', 'REQ.md');
  if (await pathExists(reqMdPath)) {
    const content = await readFile(reqMdPath, 'utf-8');
    const titleMatch = content.match(/^#\s+(.+)/m);
    if (titleMatch) {
      const title = titleMatch[1];
      if (/^新增|新增需求|^\[?new\]?/i.test(title)) return true;
    }
  }

  return false;
}

/** 在 010-requirements/ 中查找与关键词匹配的原需求文档 */
async function findMatchingOriginalRequirement(
  iterDir: string, keywords: string[]
): Promise<{ path: string; relativePath: string; score: number } | null> {
  const candidates: { path: string; relativePath: string; score: number }[] = [];
  const reqDir = join(iterDir, '010-requirements');
  if (!(await pathExists(reqDir))) return null;

  // 扫描 features/ 目录
  const featuresDir = join(reqDir, 'features');
  if (await pathExists(featuresDir)) {
    const entries = await readdir(featuresDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const readmePath = join(featuresDir, entry.name, 'README.md');
      if (!(await pathExists(readmePath))) continue;

      let score = 0;
      const nameKw = extractKeywords(entry.name);
      for (const kw of keywords) {
        if (entry.name.includes(kw) || nameKw.some(nk => nk.includes(kw) || kw.includes(nk))) {
          score += 2;
        }
      }
      // 内容匹配（轻量）
      const content = await readFile(readmePath, 'utf-8');
      const header = content.slice(0, 500);
      for (const kw of keywords) {
        if (header.includes(kw)) score += 1;
      }

      if (score > 0) {
        candidates.push({
          path: readmePath,
          relativePath: `010-requirements/features/${entry.name}/README.md`,
          score,
        });
      }
    }
  }

  // 扫描 converted/ 目录
  const convertedDir = join(reqDir, 'converted');
  if (await pathExists(convertedDir)) {
    const entries = await readdir(convertedDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const filePath = join(convertedDir, entry.name);

      let score = 0;
      const nameKw = extractKeywords(entry.name.replace('.md', ''));
      for (const kw of keywords) {
        if (entry.name.includes(kw) || nameKw.some(nk => nk.includes(kw) || kw.includes(nk))) {
          score += 2;
        }
      }

      if (score > 0) {
        candidates.push({
          path: filePath,
          relativePath: `010-requirements/converted/${entry.name}`,
          score,
        });
      }
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

/** 简单的 slugify（中文转拼音太复杂，用关键词拼接） */
function slugify(text: string): string {
  // 提取英文单词和数字
  const english = text.match(/[a-zA-Z0-9]+/g) || [];
  if (english.length > 0) return english.join('-').toLowerCase().slice(0, 40);
  // 回退：取前 20 个字符（去空格和特殊字符）
  return text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '-').slice(0, 20) || 'new-feature';
}
