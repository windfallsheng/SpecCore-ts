/**
 * incremental-analyzer — 增量分析引擎（v6.75.0）
 *
 * 核心能力：
 * 1. 检测上次分析后的变更（需求文档变更、源码变更、新增端）
 * 2. 对比已有分析产出，识别需要重新分析的部分
 * 3. 复用未变更的内容（在 prompt 中标注"已有内容，请复用/校验"）
 * 4. 检查遗漏：用 checklist 检查上次分析是否有遗漏
 *
 * 增量分析触发条件：
 * - 需求文档 mtime 更新
 * - 需求文档内容 hash 变化
 * - 源码文件变更（如果 --with-code）
 * - 新增端（检测端列表变化）
 */

import { join } from 'path';
import { pathExists, readFile, stat, readdir } from 'fs-extra';
import { createHash } from 'crypto';
import { logger } from '../utils/logger';
import { parsePlatformList } from './spec-paths';

// ── 类型定义 ──

/** 变更类型 */
export type ChangeType = 'added' | 'modified' | 'deleted' | 'unchanged';

/** 文档变更信息 */
export interface DocumentChange {
  filePath: string;
  changeType: ChangeType;
  lastModified: string;
  contentHash: string;
  previousHash?: string;
}

/** 增量分析结果 */
export interface IncrementalAnalysis {
  /** 是否有变更 */
  hasChanges: boolean;
  /** 变更的需求文档 */
  requirementChanges: DocumentChange[];
  /** 变更的源码文件 */
  codeChanges: DocumentChange[];
  /** 新增的端 */
  addedPlatforms: string[];
  /** 删除的端 */
  removedPlatforms: string[];
  /** 需要重新分析的已有产出 */
  staleOutputs: string[];
  /** 上次分析的遗漏检查项 */
  potentialGaps: string[];
  /** 建议的增量分析策略 */
  recommendation: string;
}

/** 上次分析的快照 */
interface AnalysisSnapshot {
  timestamp: string;
  requirementHashes: Record<string, string>;
  codeHashes: Record<string, string>;
  platforms: string[];
  outputs: string[];
}

// ── 常量 ──

const SNAPSHOT_FILE = '.speccore/cache/last-analysis-snapshot.json';

// ── 核心函数 ──

/**
 * 执行增量分析
 * @param iterDir 迭代目录
 * @param options 分析选项
 */
export async function runIncrementalAnalysis(
  iterDir: string,
  options?: { withCode?: boolean; platform?: string }
): Promise<IncrementalAnalysis> {
  const result: IncrementalAnalysis = {
    hasChanges: false,
    requirementChanges: [],
    codeChanges: [],
    addedPlatforms: [],
    removedPlatforms: [],
    staleOutputs: [],
    potentialGaps: [],
    recommendation: '',
  };

  // 1. 读取上次分析快照
  const snapshot = await loadSnapshot(iterDir);

  // 2. 检测需求文档变更
  const reqChanges = await detectRequirementChanges(iterDir, snapshot);
  result.requirementChanges = reqChanges;
  if (reqChanges.some(c => c.changeType !== 'unchanged')) {
    result.hasChanges = true;
  }

  // 3. 检测源码变更（如果 --with-code）
  if (options?.withCode) {
    const codeChanges = await detectCodeChanges(iterDir, snapshot);
    result.codeChanges = codeChanges;
    if (codeChanges.some(c => c.changeType !== 'unchanged')) {
      result.hasChanges = true;
    }
  }

  // 4. 检测端列表变更
  const currentPlatforms = await parsePlatformList();
  if (snapshot) {
    const added = currentPlatforms.filter(p => !snapshot.platforms.includes(p));
    const removed = snapshot.platforms.filter(p => !currentPlatforms.includes(p));
    result.addedPlatforms = added;
    result.removedPlatforms = removed;
    if (added.length > 0 || removed.length > 0) {
      result.hasChanges = true;
    }
  }

  // 5. 识别需要重新分析的已有产出
  result.staleOutputs = await identifyStaleOutputs(iterDir, result);

  // 6. 检查上次分析的潜在遗漏
  result.potentialGaps = await detectPotentialGaps(iterDir);

  // 7. 生成建议
  result.recommendation = buildRecommendation(result);

  // 8. 保存新快照
  await saveSnapshot(iterDir, {
    timestamp: new Date().toISOString(),
    requirementHashes: Object.fromEntries(reqChanges.map(c => [c.filePath, c.contentHash])),
    codeHashes: Object.fromEntries(result.codeChanges.map(c => [c.filePath, c.contentHash])),
    platforms: currentPlatforms,
    outputs: await listExistingOutputs(iterDir),
  });

  return result;
}

/**
 * 生成增量分析 Prompt
 */
export function buildIncrementalPrompt(
  iterDir: string,
  analysis: IncrementalAnalysis,
  iteration: string
): string {
  let prompt = `\n# 任务: 增量分析（基于上次分析结果）\n\n`;

  prompt += `## 分析背景\n\n`;
  prompt += `本次分析是**增量分析**，基于上次分析已有产出，只重新分析变更/遗漏的部分，复用未变更的内容。\n\n`;

  // 变更摘要
  prompt += `## 变更摘要\n\n`;

  const changedReqs = analysis.requirementChanges.filter(c => c.changeType !== 'unchanged');
  if (changedReqs.length > 0) {
    prompt += `### 需求文档变更（${changedReqs.length} 个）\n\n`;
    for (const c of changedReqs) {
      const typeLabel = c.changeType === 'added' ? '🆕 新增' : c.changeType === 'modified' ? '✏️ 修改' : '🗑️ 删除';
      prompt += `- ${typeLabel}: \`${c.filePath.replace(iterDir + '/', '')}\`\n`;
    }
    prompt += `\n`;
  }

  const changedCode = analysis.codeChanges.filter(c => c.changeType !== 'unchanged');
  if (changedCode.length > 0) {
    prompt += `### 源码变更（${changedCode.length} 个）\n\n`;
    for (const c of changedCode.slice(0, 10)) {
      const typeLabel = c.changeType === 'added' ? '🆕 新增' : c.changeType === 'modified' ? '✏️ 修改' : '🗑️ 删除';
      prompt += `- ${typeLabel}: \`${c.filePath}\`\n`;
    }
    if (changedCode.length > 10) {
      prompt += `- ... 等共 ${changedCode.length} 个文件\n`;
    }
    prompt += `\n`;
  }

  if (analysis.addedPlatforms.length > 0) {
    prompt += `### 新增端（${analysis.addedPlatforms.length} 个）\n\n`;
    for (const p of analysis.addedPlatforms) {
      prompt += `- 🆕 ${p}\n`;
    }
    prompt += `\n`;
  }

  if (analysis.removedPlatforms.length > 0) {
    prompt += `### 移除端（${analysis.removedPlatforms.length} 个）\n\n`;
    for (const p of analysis.removedPlatforms) {
      prompt += `- 🗑️ ${p}\n`;
    }
    prompt += `\n`;
  }

  // 需要重新分析的部分
  if (analysis.staleOutputs.length > 0) {
    prompt += `## 需要重新分析的产出\n\n`;
    prompt += `以下已有产出因输入变更而需要更新：\n\n`;
    for (const o of analysis.staleOutputs) {
      prompt += `- \`${o}\`\n`;
    }
    prompt += `\n`;
  }

  // 遗漏检查
  if (analysis.potentialGaps.length > 0) {
    prompt += `## 上次分析的潜在遗漏\n\n`;
    prompt += `以下项在上次分析中可能未覆盖，请检查并补充：\n\n`;
    for (const gap of analysis.potentialGaps) {
      prompt += `- [ ] ${gap}\n`;
    }
    prompt += `\n`;
  }

  // 复用指令
  prompt += `## 复用指令\n\n`;
  prompt += `对于**未变更**的需求和源码，请按以下方式处理：\n\n`;
  prompt += `1. **Read 已有分析产出**（不要重新从零分析）\n`;
  prompt += `2. **校验已有内容**是否仍然准确（需求未变则内容应不变）\n`;
  prompt += `3. **只更新受影响的部分**：\n`;
  prompt += `   - 如果某功能模块的需求未变更 → 复用已有分析，只做一致性校验\n`;
  prompt += `   - 如果某功能模块的需求已变更 → 重新分析该模块\n`;
  prompt += `   - 如果新增了功能模块 → 补充分析新模块\n`;
  prompt += `4. **全局文档更新**：如果功能模块有增删改，更新 FUNCTION_MAP.md 和 INTERACTION_MAP.md\n\n`;

  // 具体执行步骤
  prompt += `## 执行步骤\n\n`;
  prompt += `### Step 1: 读取上次分析产出\n`;
  prompt += `Read 以下文件了解已有分析结果：\n`;
  prompt += `- \`020-specs/global/REQUIREMENT.md\`\n`;
  prompt += `- \`020-specs/global/FUNCTION_MAP.md\`\n`;
  prompt += `- \`020-specs/global/ANALYSIS.md\`\n`;
  prompt += `- 各端的 TECH.md、TEST.md 等\n\n`;

  prompt += `### Step 2: 读取变更后的需求文档\n`;
  prompt += `只读取变更的需求文档（上面的变更摘要），未变更的不需要重读。\n\n`;

  prompt += `### Step 3: 增量更新分析\n`;
  prompt += `基于变更内容，更新受影响的分析产出：\n`;
  prompt += `- 新增功能 → 补充到 REQUIREMENT.md、FUNCTION_MAP.md、各端 TECH.md\n`;
  prompt += `- 修改功能 → 更新对应文档中的相关内容\n`;
  prompt += `- 删除功能 → 从 FUNCTION_MAP.md 中移除，标注各端对应代码为「待删除」\n\n`;

  prompt += `### Step 4: 检查遗漏\n`;
  prompt += `对照上面的「潜在遗漏」清单，确认是否已覆盖。\n\n`;

  prompt += `## 写入方式\n`;
  prompt += `\`\`\`bash\n`;
  prompt += `speccore analyze --apply '{"global/REQUIREMENT.md":"...",...}' -I ${iteration}\n`;
  prompt += `\`\`\`\n`;

  return prompt;
}

// ── 内部函数 ──

/** 加载上次分析快照 */
async function loadSnapshot(iterDir: string): Promise<AnalysisSnapshot | null> {
  const snapshotPath = join(iterDir, '..', SNAPSHOT_FILE);
  if (!(await pathExists(snapshotPath))) return null;
  try {
    const content = await readFile(snapshotPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/** 保存分析快照 */
async function saveSnapshot(iterDir: string, snapshot: AnalysisSnapshot): Promise<void> {
  const { ensureDir, writeFile } = await import('fs-extra');
  const snapshotPath = join(iterDir, '..', SNAPSHOT_FILE);
  await ensureDir(join(iterDir, '..', '.speccore', 'cache'));
  await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));
}

/** 检测需求文档变更 */
async function detectRequirementChanges(
  iterDir: string,
  snapshot: AnalysisSnapshot | null
): Promise<DocumentChange[]> {
  const changes: DocumentChange[] = [];
  const reqDir = join(iterDir, '010-requirements');

  if (!(await pathExists(reqDir))) return changes;

  // 收集所有需求文件
  const reqFiles = await findAllFiles(reqDir, ['.md', '.txt']);

  // 对比快照
  const currentHashes: Record<string, string> = {};
  for (const file of reqFiles) {
    const hash = await hashFile(file);
    currentHashes[file] = hash;

    if (!snapshot) {
      changes.push({ filePath: file, changeType: 'added', lastModified: (await stat(file)).mtime.toISOString(), contentHash: hash });
    } else if (snapshot.requirementHashes[file] !== hash) {
      changes.push({
        filePath: file,
        changeType: snapshot.requirementHashes[file] ? 'modified' : 'added',
        lastModified: (await stat(file)).mtime.toISOString(),
        contentHash: hash,
        previousHash: snapshot.requirementHashes[file],
      });
    } else {
      changes.push({ filePath: file, changeType: 'unchanged', lastModified: (await stat(file)).mtime.toISOString(), contentHash: hash });
    }
  }

  // 检测删除的文件
  if (snapshot) {
    for (const file of Object.keys(snapshot.requirementHashes)) {
      if (!currentHashes[file]) {
        changes.push({ filePath: file, changeType: 'deleted', lastModified: '', contentHash: '', previousHash: snapshot.requirementHashes[file] });
      }
    }
  }

  return changes;
}

/** 检测源码变更 */
async function detectCodeChanges(
  iterDir: string,
  snapshot: AnalysisSnapshot | null
): Promise<DocumentChange[]> {
  const changes: DocumentChange[] = [];

  const constitutionPath = join(iterDir, '..', '.speccore', 'CONSTITUTION.md');
  if (!(await pathExists(constitutionPath))) return changes;

  const constitutionContent = await readFile(constitutionPath, 'utf-8');
  const sourcePaths = extractSourcePaths(constitutionContent);

  const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.java', '.go', '.py', '.vue', '.php', '.rb'];
  const allCodeFiles: string[] = [];

  for (const sp of sourcePaths) {
    const fullPath = join(iterDir, '..', sp);
    if (await pathExists(fullPath)) {
      allCodeFiles.push(...await findAllFiles(fullPath, codeExtensions));
    }
  }

  const currentHashes: Record<string, string> = {};
  for (const file of allCodeFiles) {
    const hash = await hashFile(file);
    currentHashes[file] = hash;

    if (!snapshot) {
      changes.push({ filePath: file, changeType: 'added', lastModified: (await stat(file)).mtime.toISOString(), contentHash: hash });
    } else if (snapshot.codeHashes[file] !== hash) {
      changes.push({
        filePath: file,
        changeType: snapshot.codeHashes[file] ? 'modified' : 'added',
        lastModified: (await stat(file)).mtime.toISOString(),
        contentHash: hash,
        previousHash: snapshot.codeHashes[file],
      });
    } else {
      changes.push({ filePath: file, changeType: 'unchanged', lastModified: (await stat(file)).mtime.toISOString(), contentHash: hash });
    }
  }

  // 检测删除
  if (snapshot) {
    for (const file of Object.keys(snapshot.codeHashes)) {
      if (!currentHashes[file]) {
        changes.push({ filePath: file, changeType: 'deleted', lastModified: '', contentHash: '', previousHash: snapshot.codeHashes[file] });
      }
    }
  }

  return changes;
}

/** 识别过期的分析产出 */
async function identifyStaleOutputs(
  iterDir: string,
  analysis: IncrementalAnalysis
): Promise<string[]> {
  const stale: string[] = [];
  const specDir = join(iterDir, '020-specs');

  // 如果需求文档变更，对应的功能模块分析可能过期
  const changedReqs = analysis.requirementChanges.filter(c => c.changeType === 'modified' || c.changeType === 'added');
  for (const req of changedReqs) {
    // 从文件路径推断功能模块名
    const moduleMatch = req.filePath.match(/features\/([^/]+)/);
    if (moduleMatch) {
      const moduleName = moduleMatch[1];
      const moduleSpec = join(specDir, 'features', `${moduleName}.md`);
      if (await pathExists(moduleSpec)) {
        stale.push(`020-specs/features/${moduleName}.md`);
      }
    }
  }

  // 如果新增端，全局文档需要更新
  if (analysis.addedPlatforms.length > 0) {
    stale.push('020-specs/global/FUNCTION_MAP.md');
    stale.push('020-specs/global/INTERACTION_MAP.md');
    stale.push('.speccore/GLOBAL/ARCHITECTURE.md');
  }

  // 如果源码变更，对应的端分析可能过期
  const changedCode = analysis.codeChanges.filter(c => c.changeType === 'modified');
  if (changedCode.length > 0) {
    // 标记所有端的 TECH.md 可能需要检查
    const platforms = await parsePlatformList();
    for (const p of platforms) {
      stale.push(`020-specs/${p}/TECH.md`);
    }
  }

  return [...new Set(stale)];
}

/** 检测潜在遗漏 */
async function detectPotentialGaps(iterDir: string): Promise<string[]> {
  const gaps: string[] = [];
  const specDir = join(iterDir, '020-specs');
  const reqDir = join(iterDir, '010-requirements');

  // 1. 检查需求文档中的功能是否在分析中有对应
  const featuresDir = join(reqDir, 'features');
  if (await pathExists(featuresDir)) {
    const features = await readdir(featuresDir, { withFileTypes: true });
    for (const f of features.filter(e => e.isDirectory())) {
      const specPath = join(specDir, 'features', `${f.name}.md`);
      if (!(await pathExists(specPath))) {
        gaps.push(`功能模块 "${f.name}" 有需求文档但未生成分析文档`);
      }
    }
  }

  // 2. 检查全局文档完整性
  const globalDocs = ['REQUIREMENT.md', 'ANALYSIS.md', 'FUNCTION_MAP.md'];
  for (const doc of globalDocs) {
    if (!(await pathExists(join(specDir, 'global', doc)))) {
      gaps.push(`全局文档缺失: global/${doc}`);
    }
  }

  // 3. 检查各端文档完整性
  const platforms = await parsePlatformList();
  for (const p of platforms) {
    if (!(await pathExists(join(specDir, p, 'TECH.md')))) {
      gaps.push(`端 ${p} 缺失 TECH.md`);
    }
  }

  return gaps;
}

/** 生成增量分析建议 */
function buildRecommendation(analysis: IncrementalAnalysis): string {
  const parts: string[] = [];

  if (analysis.addedPlatforms.length > 0) {
    parts.push(`新增端 ${analysis.addedPlatforms.join(', ')} 需要完整分析，并更新全局文档`);
  }

  const changedReqs = analysis.requirementChanges.filter(c => c.changeType !== 'unchanged');
  if (changedReqs.length > 0) {
    parts.push(`${changedReqs.length} 个需求文档变更，需要更新对应分析`);
  }

  const changedCode = analysis.codeChanges.filter(c => c.changeType !== 'unchanged');
  if (changedCode.length > 0) {
    parts.push(`${changedCode.length} 个源码文件变更，需要检查对应端分析`);
  }

  if (analysis.potentialGaps.length > 0) {
    parts.push(`发现 ${analysis.potentialGaps.length} 个潜在遗漏需要补充`);
  }

  if (parts.length === 0) {
    return '无变更 detected，建议运行最终核对检查（phase6-final-audit）确认完整性';
  }

  return parts.join('；');
}

/** 列出已有分析产出 */
async function listExistingOutputs(iterDir: string): Promise<string[]> {
  const outputs: string[] = [];
  const specDir = join(iterDir, '020-specs');
  if (!(await pathExists(specDir))) return outputs;

  const files = await findAllFiles(specDir, ['.md', '.yaml', '.yml']);
  return files.map(f => f.replace(iterDir + '/', ''));
}

// ── 辅助函数 ──

/** 计算文件内容 hash */
async function hashFile(filePath: string): Promise<string> {
  try {
    const content = await readFile(filePath);
    return createHash('md5').update(content).digest('hex');
  } catch {
    return '';
  }
}

/** 递归查找文件 */
async function findAllFiles(dir: string, extensions: string[]): Promise<string[]> {
  const result: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        result.push(...await findAllFiles(fullPath, extensions));
      } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
        result.push(fullPath);
      }
    }
  } catch { /* ignore */ }
  return result;
}

/** 从 CONSTITUTION.md 提取源码路径 */
function extractSourcePaths(content: string): string[] {
  const paths: string[] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const matches = line.match(/[\w\-./]+/g);
    if (matches) {
      paths.push(...matches.filter(p => p.includes('/') && !p.startsWith('http')));
    }
  }
  return [...new Set(paths)];
}
