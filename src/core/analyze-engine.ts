/**
 * analyze-engine — 统一分析引擎
 * 
 * 支持三种输入模式 + 三种输出范围:
 * 
 * 输入:
 *   - 纯需求: --req docs/a.md docs/b.md
 *   - 纯代码: --src backend/src 20-frontend/src
 *   - 需求+代码: 两者都指定
 * 
 * 输出范围 (scope):
 *   - global    → .speccore/GLOBAL/  全局架构/代码健康
 *   - iteration → Iteration-XX/020-specs/         迭代级基线（默认）
 *   - task      → Iteration-XX/030-tasks/Task-NN/00-specs/  任务级独立
 */
import { readFile, writeFile, pathExists, readdir, stat, ensureDir } from 'fs-extra';
import { join, relative, basename } from 'path';
import { logger } from '../utils/logger';
import { isTimestampBackup } from '../utils/task-utils';
import { buildCodeIndex, findRelevantCode, readRelevantSource, isIndexStale, loadFullIndex } from './code-scanner';
import { generateAIContext, AIContextInput, AIContextResult } from './ai-context-generator';
import { cleanStaleCache } from './git-integration';
import { refreshRagIndex, checkRagIndexFreshness, indexDirectoryDocuments } from './rag-engine';
import { refreshKnowledgeGraph } from './knowledge-graph';
import { generateQualityAudit } from './quality-audit';

// ================================================================
// 类型定义
// ================================================================

export interface AnalyzeInput {
  /** 源码目录列表 */
  sources: string[];
  /** 需求文档路径列表 */
  requirements: string[];
  /** 输出范围 */
  scope: 'global' | 'iteration' | 'task';
  /** 迭代名称 (scope=iteration|task 必填) */
  iteration?: string;
  /** 任务 ID (scope=task 必填) */
  taskId?: string;
  /** 分析深度 */
  depth: 'quick' | 'normal' | 'deep';
  /** 输出文件名 */
  output?: string;
  /** 是否读取源码内容（默认 true） */
  readSource?: boolean;
  /** 指定源码扫描范围（逗号分隔目录） */
  sourceScope?: string;
}

export interface AnalysisResult {
  /** 输出文件路径 */
  outputPath: string;
  /** 报告内容 */
  report: string;
  /** 摘要统计 */
  summary: {
    issues: number;
    blockers: number;
    filesAnalyzed: number;
    apisFound: number;
    risks: number;
  };
}

// ================================================================
// 主入口
// ================================================================

export async function runAnalysis(input: AnalyzeInput): Promise<AnalysisResult> {
  // 清理过期缓存
  cleanStaleCache();
  
  // 深拷贝输入，避免静默修改调用者的对象
  let requirements = [...input.requirements];
  let sources = [...input.sources];

  // 校验: task scope 必须同时提供 iteration 和 taskId
  if (input.scope === 'task' && (!input.taskId || !input.iteration)) {
    throw new Error('--scope task 必须同时指定 --task <id> 和 -I <iteration>');
  }

  // 自动检测: 都没指定 → 从 01-产品需求/ 递归读取产品原始需求
  if (requirements.length === 0 && sources.length === 0) {
    if (input.scope === 'iteration' && input.iteration) {
      const productReqDir = join(`Iteration-${input.iteration}`, '010-requirements');
      if (await pathExists(productReqDir)) {
        // 递归扫描子目录 (backend/ 20-frontend/Web/ 等)
        const scanDir = async (dir: string) => {
          const entries = await readdir(dir, { withFileTypes: true });
          for (const e of entries) {
            const full = join(dir, e.name);
            if (e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.')) {
              await scanDir(full);
            } else if (e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('README') && !isTimestampBackup(e.name)) {
              requirements.push(full);
            }
          }
        };
        await scanDir(productReqDir);
      }
      // 兼容旧路径: 如果没有 01-产品需求/, 回退到 010-requirements/REQUIREMENT.md
      if (requirements.length === 0) {
        const legacyReq = join(`Iteration-${input.iteration}`, '010-requirements', 'REQUIREMENT.md');
        if (await pathExists(legacyReq)) {
          requirements = [legacyReq];
        }
      }
    }
  }

  // 构建实际使用的输入（不修改原对象）
  const effectiveInput: AnalyzeInput = {
    ...input,
    sources,
    requirements,
  };

  // 判别分析类型（使用自动检测后的值）
  const hasReqs = effectiveInput.requirements.length > 0;
  const hasSrc = effectiveInput.sources.length > 0;
  const type = hasReqs && hasSrc ? 'combined' : hasReqs ? 'req' : 'code';

  let result: AnalysisResult;
  switch (type) {
    case 'req':  result = await analyzeRequirements(effectiveInput); break;
    case 'code': result = await analyzeCodebase(effectiveInput); break;
    case 'combined': result = await analyzeCombined(effectiveInput); break;
    default: throw new Error(`Unknown analysis type: ${type}`);
  }

  // ── code 模式生成 AI 上下文（req/combined 已在各自分析函数内处理） ──
  if (type === 'code') {
    try {
      await generateAIContext({
        requirements: effectiveInput.requirements,
        sources: effectiveInput.sources,
        scope: effectiveInput.scope,
        iteration: effectiveInput.iteration,
        taskId: effectiveInput.taskId,
        depth: effectiveInput.depth,
      });
    } catch {} // 非关键，静默失败
  }

  // ── 为当前 scope 构建/刷新 RAG 索引（按 scope 分文件，避免互相覆盖）──
  try {
    const cwd = process.cwd();
    if (effectiveInput.scope === 'task' && effectiveInput.taskId && effectiveInput.iteration) {
      // task 模式：索引任务目录（默认文件名 rag-index.json）
      const taskDir = join(`Iteration-${effectiveInput.iteration}`, '030-tasks', effectiveInput.taskId);
      if (await pathExists(taskDir)) {
        const { staleFiles, newFiles } = await checkRagIndexFreshness(cwd);
        await refreshRagIndex(cwd, taskDir, effectiveInput.iteration);
        const totalChanges = staleFiles.length + newFiles.length;
        if (totalChanges > 0) {
          logger.info(`   🔄 RAG 索引已增量刷新 (${totalChanges} 个文件更新): ${taskDir}`);
        } else {
          logger.info(`   🔍 RAG 索引已生成: ${taskDir}`);
        }
      }
    } else if (effectiveInput.scope === 'iteration' && effectiveInput.iteration) {
      // iteration 模式：索引 020-specs/ 目录（独立文件名）
      const specsDir = join(`Iteration-${effectiveInput.iteration}`, '020-specs');
      if (await pathExists(specsDir)) {
        const scope = `${effectiveInput.iteration}_020-specs_iteration_all`;
        const fileName = `rag-index-${effectiveInput.iteration}.json`;
        await indexDirectoryDocuments(cwd, specsDir, scope, fileName);
        logger.info(`   🔍 迭代 RAG 索引已生成: ${specsDir} → ${fileName}`);
      }
    } else if (effectiveInput.scope === 'global') {
      // global 模式：索引全局 specs 目录（独立文件名）
      const globalSpecsDir = join(cwd, '.speccore', 'GLOBAL', '020-specs');
      const fallbackDir = join(cwd, '.speccore');
      const targetDir = await pathExists(globalSpecsDir) ? globalSpecsDir : fallbackDir;
      const scope = 'GLOBAL_020-specs_global_all';
      await indexDirectoryDocuments(cwd, targetDir, scope, 'rag-index-global.json');
      logger.info(`   🔍 全局 RAG 索引已生成: ${targetDir} → rag-index-global.json`);
    }
  } catch (e) {
    logger.debug('RAG 索引生成失败（非关键）:', e);
  }

  // ── 统一刷新代码索引 + 知识图谱（所有 scope）──
  try {
    logger.info('   🔄 刷新代码索引...');
    await buildCodeIndex(undefined, true);
    logger.info('   ✅ 代码索引已刷新');
  } catch (e) {
    logger.debug('代码索引刷新失败（非关键）:', e);
  }

  try {
    logger.info('   🔄 刷新知识图谱...');
    await refreshKnowledgeGraph(process.cwd(), effectiveInput.iteration);
    logger.info('   ✅ 知识图谱已刷新');
  } catch (e) {
    logger.debug('知识图谱刷新失败（非关键）:', e);
  }

  return result;
}

// ================================================================
// 1. 纯需求分析
// ================================================================

async function analyzeRequirements(input: AnalyzeInput): Promise<AnalysisResult> {
  const allContent: string[] = [];
  for (const reqPath of input.requirements) {
    if (await pathExists(reqPath)) {
      const content = await readFile(reqPath, 'utf-8');
      allContent.push(`## 来源: ${basename(reqPath)}\n\n${content}`);
    }
  }

  if (allContent.length === 0) {
    throw new Error('未找到有效的需求文档');
  }

  const fullContent = allContent.join('\n\n---\n\n');
  const issues = scanCompleteness(fullContent);
  const archImpact = await analyzeArchitectureImpact(fullContent);

  // ── 需求分析时默认读取关联代码（避免分析不接地气 + 减少重复 token 消耗） ──
  let sourceContents: Record<string, string> = {};
  const shouldReadSource = input.readSource !== false;
  if (shouldReadSource && (input.iteration || input.taskId)) {
    const limit = input.depth === 'deep' ? 15 : (input.depth === 'quick' ? 3 : 8);
    const maxBytes = input.depth === 'deep' ? 80000 : (input.depth === 'quick' ? 20000 : 40000);
    const rawMatches = await findRelevantCode(fullContent, limit, input.sourceScope, input.iteration, input.taskId);
    sourceContents = await readRelevantSource(rawMatches, maxBytes);
    if (Object.keys(sourceContents).length > 0) {
      const scopeHint = input.sourceScope ? ` (范围: ${input.sourceScope})` : '';
      logger.info(`   📖 需求分析已关联 ${Object.keys(sourceContents).length} 个源码文件${scopeHint}`);
    }
  }

  let outputPath: string;
  let report: string;

  if (input.scope === 'global') {
    outputPath = join('.speccore', 'GLOBAL', input.output || 'REQ_CONSISTENCY.md');
    report = buildReqConsistencyReport(input, issues, archImpact);
  } else if (input.scope === 'task') {
    // task scope — 已在入口校验
    outputPath = join(`Iteration-${input.iteration}`, '030-tasks', input.taskId!, '00-specs', input.output || 'ANALYSIS.md');
    report = buildTaskReqReport(input, issues, archImpact, sourceContents);
  } else {
    // iteration (default)
    const iterDir = `Iteration-${input.iteration || 'current'}`;
    outputPath = join(iterDir, '020-specs', input.output || 'ANALYSIS.md');
    report = buildIterationReqReport(input, issues, archImpact, sourceContents);

    // 按端分目录输出
    await writePerPlatform(iterDir, report, input.output || 'ANALYSIS.md');
    // 按功能模块输出到 020-specs/features/
    await writePerFeature(iterDir, report, input.output || 'ANALYSIS.md');
    // 按类型输出扁平文件到 020-specs/{bugs,refactors,research}/
    await writePerTypedDoc(iterDir, report, input.output || 'ANALYSIS.md');

    // ── 质量核验：检查 AI 生成文档的端专业性 ──
    try {
      const platforms = await detectPlatformsFromConstitution();
      const specDir = join(iterDir, '020-specs');
      await generateQualityAudit(specDir, platforms);
    } catch {} // 非关键，静默失败
  }

  // ── 生成 AI 上下文（传入已读取的需求内容，避免重复 readFile） ──
  try {
    await generateAIContext({
      requirements: input.requirements,
      reqContents: allContent,
      sources: input.sources,
      scope: input.scope,
      iteration: input.iteration,
      taskId: input.taskId,
      depth: input.depth,
    });
  } catch {} // 非关键，静默失败

  return {
    outputPath,
    report,
    summary: {
      issues: issues.length,
      blockers: issues.filter(i => i.severity === 'blocker').length,
      filesAnalyzed: input.requirements.length + Object.keys(sourceContents).length,
      apisFound: archImpact.apis?.length || 0,
      risks: archImpact.risks?.length || 0,
    },
  };
}

// ================================================================
// 2. 纯代码分析
// ================================================================

async function analyzeCodebase(input: AnalyzeInput): Promise<AnalysisResult> {
  // 扫描源码目录
  const fileStats = await scanSourceDirs(input.sources, input.depth);
  const apiInventory = await buildApiInventory(input.sources);
  const hotspots = await detectHotspots(input.sources);
  const deps = input.depth !== 'quick' ? await analyzeDependencies(input.sources) : null;

  let outputPath: string;
  let report: string;

  if (input.scope === 'global') {
    outputPath = join('.speccore', 'GLOBAL', input.output || 'CODE_HEALTH.md');
    report = buildCodeHealthReport(input, fileStats, apiInventory, hotspots, deps);
  } else if (input.scope === 'task') {
    // task scope — 已在入口校验
    outputPath = join(`Iteration-${input.iteration}`, '030-tasks', input.taskId!, '00-specs', input.output || 'CODE_REVIEW.md');
    report = buildTaskCodeReport(input, fileStats, apiInventory, hotspots);
  } else {
    // iteration (default)
    const iterDir = `Iteration-${input.iteration || 'current'}`;
    outputPath = join(iterDir, '020-specs', input.output || 'CODE_ANALYSIS.md');
    report = buildIterationCodeReport(input, fileStats, apiInventory, hotspots, deps);
    await writePerPlatform(iterDir, report, input.output || 'CODE_ANALYSIS.md');
    await writePerFeature(iterDir, report, input.output || 'CODE_ANALYSIS.md');
  }

  return {
    outputPath,
    report,
    summary: {
      issues: hotspots.length,
      blockers: hotspots.filter(h => h.severity === 'high').length,
      filesAnalyzed: fileStats.totalFiles,
      apisFound: apiInventory.length,
      risks: deps?.cycles?.length || 0,
    },
  };}

// ================================================================
// 3. 需求+代码联合分析
// ================================================================

async function analyzeCombined(input: AnalyzeInput): Promise<AnalysisResult> {
  // 按文档来源结构化合并：每个源文档一级标题，原章节下推一级避免同名冲突
  const allContent: string[] = [];
  for (const reqPath of input.requirements) {
    if (await pathExists(reqPath)) {
      const raw = await readFile(reqPath, 'utf-8');
      const fname = reqPath.split('/').pop() || reqPath;
      // 将原文档 ##/### 标题下推一级 (##→###, ###→####)，源文件名作为 ## 标题
      const normalized = raw.replace(/^(#{2,3})\s/gm, '#$1 ');
      const sourced = `## 📄 ${fname}\n\n${normalized}`;
      allContent.push(sourced);
    }
  }
  const fullReqContent = allContent.join('\n\n---\n\n');
  const issues = scanCompleteness(fullReqContent);
  const archImpact = await analyzeArchitectureImpact(fullReqContent);

  // 代码结构分析
  const fileStats = await scanSourceDirs(input.sources, input.depth);
  const apiInventory = await buildApiInventory(input.sources);

  // 确保代码索引是最新的（解耦设计：总是全量索引，分析时按 scope 筛选）
  if (await isIndexStale()) {
    logger.info('   🔍 索引已过期，自动重建全量代码索引...');
    await buildCodeIndex();  // 总是全量建，不是按 scope
    logger.info('   ✅ 代码索引已更新（包含多端识别 + 模块分组 + git 联动分析）');
    logger.info('   💡 提示：可手动运行 `speccore code-index --show` 查看索引摘要');
  } else {
    logger.info('   📚 使用缓存的代码索引（1 小时内已构建）');
  }

  // ── AI 上下文生成: 替代关键词匹配（传入已读取的需求内容，避免重复 readFile） ──
  const aiContext = await generateAIContext({
    requirements: input.requirements,
    reqContents: allContent,
    sources: input.sources,
    scope: input.scope,
    iteration: input.iteration,
    taskId: input.taskId,
    depth: input.depth,
  });

  logger.info(`   🤖 AI 上下文已生成 → ${aiContext.promptPath}`);
  logger.info(`   📁 源码文件: ${aiContext.totalFiles} 个`);
  logger.info(`   🔗 API: ${aiContext.totalApis} 个`);

  // 默认读取相关源码内容注入分析（除非明确关闭）
  // 解耦设计：从完整索引中按 sourceScope 筛选，不是按 scope 建索引
  let sourceContents: Record<string, string> = {};
  const shouldReadSource = input.readSource !== false;
  if (shouldReadSource) {
    const limit = input.depth === 'deep' ? 20 : (input.depth === 'quick' ? 5 : 10);
    const maxBytes = input.depth === 'deep' ? 120000 : (input.depth === 'quick' ? 30000 : 60000);
    const rawMatches = await findRelevantCode(fullReqContent, limit, input.sourceScope, input.iteration, input.taskId);
    sourceContents = await readRelevantSource(rawMatches, maxBytes);
    if (Object.keys(sourceContents).length > 0) {
      const scopeHint = input.sourceScope ? ` (范围: ${input.sourceScope})` : '';
      logger.info(`   📖 已读取 ${Object.keys(sourceContents).length} 个源码文件${scopeHint} (${Object.values(sourceContents).reduce((a, c) => a + c.length, 0)} 字符)`);
    }
  }

  let outputPath: string;
  let report: string;

  if (input.scope === 'global') {
    outputPath = join('.speccore', 'GLOBAL', input.output || 'ARCH_IMPACT.md');
    report = await buildAIEnhancedReport(input, 'global', { issues, archImpact, fileStats, apiInventory, aiContext, sourceContents });
  } else if (input.scope === 'task') {
    outputPath = join(`Iteration-${input.iteration}`, '030-tasks', input.taskId!, '00-specs', input.output || 'ANALYSIS.md');
    report = await buildAIEnhancedReport(input, 'task', { issues, archImpact, fileStats, apiInventory, aiContext, sourceContents });
  } else {
    const iterDir = `Iteration-${input.iteration || 'current'}`;
    outputPath = join(iterDir, '020-specs', input.output || 'ANALYSIS.md');
    report = await buildAIEnhancedReport(input, 'iteration', { issues, archImpact, fileStats, apiInventory, aiContext, sourceContents });
    await writePerPlatform(iterDir, report, input.output || 'ANALYSIS.md');
    await writePerFeature(iterDir, report, input.output || 'ANALYSIS.md');
  }

  return {
    outputPath,
    report,
    summary: {
      issues: issues.length,
      blockers: issues.filter(i => i.severity === 'blocker').length,
      filesAnalyzed: fileStats.totalFiles,
      apisFound: apiInventory.length,
      risks: archImpact.risks?.length || 0,
    },
  };
}

// ================================================================
// 源码扫描
// ================================================================

/** 文件扩展名 → 语言名映射 (模块级常量, 避免重复创建) */
const LANG_MAP: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX',
  py: 'Python', java: 'Java', go: 'Go', rs: 'Rust',
  vue: 'Vue', sql: 'SQL', yaml: 'YAML', yml: 'YAML',
  json: 'JSON', xml: 'XML', css: 'CSS', scss: 'SCSS',
  html: 'HTML', sh: 'Shell', md: 'Markdown',
};

interface SourceStats {
  totalFiles: number;
  totalLines: number;
  byLanguage: Record<string, number>;
  byDir: Record<string, number>;
  largestFiles: { path: string; lines: number }[];
}

async function scanSourceDirs(sources: string[], depth: string): Promise<SourceStats> {
  const stats: SourceStats = {
    totalFiles: 0,
    totalLines: 0,
    byLanguage: {},
    byDir: {},
    largestFiles: [],
  };

  const allFiles: { path: string; lines: number; lang: string; dir: string }[] = [];

  for (const srcDir of sources) {
    if (!(await pathExists(srcDir))) continue;
    await walkDir(srcDir, srcDir, async (filePath) => {
      const relPath = relative(process.cwd(), filePath);
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      const lang = LANG_MAP[ext];
      if (!lang) return;

      try {
        const content = await readFile(filePath, 'utf-8');
        const lines = content.split('\n').length;
        const dir = srcDir.split('/').pop() || srcDir;

        stats.totalFiles++;
        stats.totalLines += lines;
        stats.byLanguage[lang] = (stats.byLanguage[lang] || 0) + 1;
        stats.byDir[dir] = (stats.byDir[dir] || 0) + 1;

        allFiles.push({ path: relPath, lines, lang, dir });
      } catch {
        // 跳过二进制
      }
    }, depth === 'quick' ? 2 : depth === 'deep' ? 8 : 5);
  }

  // 最大文件
  stats.largestFiles = allFiles
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 10)
    .map(f => ({ path: f.path, lines: f.lines }));

  return stats;
}

async function walkDir(
  root: string,
  dir: string,
  callback: (filePath: string) => Promise<void>,
  maxDepth: number = 5,
  visited: Set<string> = new Set()
): Promise<void> {
  // 符号链接循环保护
  const realPath = join(dir);
  if (visited.has(realPath)) return;
  visited.add(realPath);

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.name.startsWith('.') || ['node_modules', 'dist', 'build', 'target', '__pycache__', '.git'].includes(entry.name)) continue;
      if (entry.isDirectory()) {
        // 使用 path.relative 计算深度，避免尾部斜杠不一致问题
        const relPath = relative(root, fullPath);
        const curDepth = relPath.split('/').filter(Boolean).length;
        if (curDepth < maxDepth) await walkDir(root, fullPath, callback, maxDepth, visited);
      } else {
        await callback(fullPath);
      }
    }
  } catch (err: any) {
    // 区分权限错误和严重错误
    const code = err?.code || '';
    if (code === 'EACCES' || code === 'EPERM') {
      // 权限不足: 静默跳过
    } else if (code === 'ENOENT' || code === 'ELOOP') {
      // 文件已删除 / 符号链接循环: 静默跳过
    } else {
      // 其他严重错误: 记录但不中断
      logger.debug(`⚠️ walkDir 错误 (${dir}): ${err.message}`);
    }
  }
}

// ================================================================
// API 清单
// ================================================================

interface ApiEntry {
  method: string;
  path: string;
  file: string;
}

async function buildApiInventory(sources: string[]): Promise<ApiEntry[]> {
  const apis: ApiEntry[] = [];
  const seen = new Set<string>();

  for (const srcDir of sources) {
    if (!(await pathExists(srcDir))) continue;
    await walkDir(srcDir, srcDir, async (filePath) => {
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      if (!['ts', 'tsx', 'js', 'jsx', 'java', 'py', 'go'].includes(ext)) return;

      try {
        const content = await readFile(filePath, 'utf-8');
        const relPath = relative(process.cwd(), filePath);

        // Java: @XXXMapping("/api/...")
        const javaApis = content.match(/@\w*Mapping\s*\(\s*"(\/[^"]+)"/g) || [];
        for (const m of javaApis) {
          const method = (m.match(/@(Get|Post|Put|Delete|Patch)/)?.[1] || 'Request').toUpperCase();
          const path = m.match(/"(\/[^"]+)"/)?.[1] || '';
          const key = `${method} ${path}`;
          if (!seen.has(key) && path) {
            seen.add(key);
            apis.push({ method, path, file: relPath });
          }
        }

        // TS/JS: router.method('/api/...')
        const tsApis = content.match(/(?:router|app|this)\.(get|post|put|delete|patch)\s*\(\s*['"](\/[^'"]+)['"]/gi) || [];
        for (const m of tsApis) {
          const method = (m.match(/\.(get|post|put|delete|patch)/i)?.[1] || 'get').toUpperCase();
          const path = m.match(/['"](\/[^'"]+)['"]/)?.[1] || '';
          const key = `${method} ${path}`;
          if (!seen.has(key) && path) {
            seen.add(key);
            apis.push({ method, path, file: relPath });
          }
        }

        // Python: @app.route('/api/...', methods=[...])
        const pyApis = content.match(/@\w+\.route\s*\(\s*['"](\/[^'"]+)['"]/g) || [];
        for (const m of pyApis) {
          const path = m.match(/['"](\/[^'"]+)['"]/)?.[1] || '';
          const key = `ANY ${path}`;
          if (!seen.has(key) && path) {
            seen.add(key);
            apis.push({ method: 'ANY', path, file: relPath });
          }
        }
      } catch { /* skip */ }
    }, 6);
  }

  return apis;
}

// ================================================================
// 复杂度热点
// ================================================================

interface Hotspot {
  file: string;
  severity: 'high' | 'medium' | 'low';
  reason: string;
  lines: number;
}

async function detectHotspots(sources: string[]): Promise<Hotspot[]> {
  const hotspots: Hotspot[] = [];

  for (const srcDir of sources) {
    if (!(await pathExists(srcDir))) continue;
    await walkDir(srcDir, srcDir, async (filePath) => {
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      const codeExts = ['ts', 'tsx', 'js', 'jsx', 'java', 'py', 'go', 'vue'];
      if (!codeExts.includes(ext)) return;

      try {
        const content = await readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        const relPath = relative(process.cwd(), filePath);

        if (lines.length > 800) {
          hotspots.push({ file: relPath, severity: 'high', reason: `超大文件 (${lines.length} 行)`, lines: lines.length });
        } else if (lines.length > 400) {
          hotspots.push({ file: relPath, severity: 'medium', reason: `大文件 (${lines.length} 行)`, lines: lines.length });
        }

        // 检查 TODO/FIXME
        const todos = lines.filter(l => /TODO|FIXME|HACK|XXX/.test(l)).length;
        if (todos > 10) {
          hotspots.push({ file: relPath, severity: 'medium', reason: `${todos} 个 TODO/FIXME`, lines: lines.length });
        }

        // 检查深层嵌套 (deep 模式)
        if (lines.length > 100) {
          let maxIndent = 0;
          for (const line of lines) {
            const indent = line.search(/\S/);
            if (indent > maxIndent) maxIndent = indent;
          }
          if (maxIndent > 60) {
            hotspots.push({ file: relPath, severity: 'low', reason: `深层嵌套 (最大缩进 ${maxIndent})`, lines: lines.length });
          }
        }
      } catch { /* skip */ }
    }, 6);
  }

  return hotspots.sort((a, b) => {
    const sevOrder = { high: 0, medium: 1, low: 2 };
    return sevOrder[a.severity] - sevOrder[b.severity];
  }).slice(0, 30);
}

// ================================================================
// 依赖分析
// ================================================================

interface DepAnalysis {
  imports: { from: string; imports: string[] }[];
  cycles: string[][];
  entryPoints: string[];
}

async function analyzeDependencies(sources: string[]): Promise<DepAnalysis> {
  const imports: { from: string; imports: string[] }[] = [];
  const graph = new Map<string, Set<string>>();
  const allFiles: string[] = [];

  for (const srcDir of sources) {
    if (!(await pathExists(srcDir))) continue;
    await walkDir(srcDir, srcDir, async (filePath) => {
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      const codeExts = ['ts', 'tsx', 'js', 'jsx', 'java', 'py', 'go'];
      if (!codeExts.includes(ext)) return;

      try {
        const content = await readFile(filePath, 'utf-8');
        const relPath = relative(process.cwd(), filePath);
        allFiles.push(relPath);

        // TS/JS imports — 只匹配项目内部引用 (相对路径)
        const importMatches = content.match(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g) || [];
        const depSet = new Set<string>();
        for (const m of importMatches) {
          const from = m.match(/from\s+['"]([^'"]+)['"]/)?.[1] || '';
          // 正向匹配: 只保留以 ./ 或 ../ 开头的本地引用
          if (from && (from.startsWith('./') || from.startsWith('../'))) {
            depSet.add(from);
          }
        }
        if (depSet.size > 0) {
          imports.push({ from: relPath, imports: [...depSet] });
          if (!graph.has(relPath)) graph.set(relPath, new Set());
          for (const d of depSet) graph.get(relPath)!.add(d);
        }
      } catch { /* skip */ }
    }, 6);
  }

  // 简单循环依赖检测 (深度优先 2 层)
  const cycles: string[][] = [];
  for (const [file, deps] of graph) {
    for (const dep of deps) {
      const depDeps = graph.get(dep);
      if (depDeps?.has(file)) {
        cycles.push([file, dep]);
      }
    }
  }

  // 入口点(被 import 最多的文件)
  const importCount = new Map<string, number>();
  for (const { imports: imps } of imports) {
    for (const imp of imps) {
      importCount.set(imp, (importCount.get(imp) || 0) + 1);
    }
  }
  const entryPoints = [...importCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${k} (被 ${v} 个文件引用)`);

  return { imports, cycles, entryPoints };
}

// ================================================================
// 需求分析函数(从原 analyze.ts 迁移)
// ================================================================

interface Issue {
  severity: 'blocker' | 'warning' | 'info';
  category: string;
  message: string;
  location?: string;
}

function scanCompleteness(content: string): Issue[] {
  const issues: Issue[] = [];
  const lines = content.split('\n');

  let inTable = false;
  let tableRowCount = 0;
  const incompleteRows: string[] = [];

  for (const line of lines) {
    if (line.match(/^\|.*\|.*\|.*\|$/)) {
      if (line.includes(':---')) { inTable = true; continue; }
      if (inTable) {
        tableRowCount++;
        const cells = line.split('|').map(c => c.trim()).filter(Boolean);
        if (cells.length < 3 || cells.some(c => !c)) {
          incompleteRows.push(`  - ${line.trim()}`);
        }
      }
    } else { inTable = false; }
  }

  if (tableRowCount === 0) {
    issues.push({
      severity: 'warning',
      category: '接口定义',
      message: '需求中未检测到接口表格。建议补充「方法 | 路径 | 说明」格式的接口定义。',
    });
  }
  if (incompleteRows.length > 0) {
    issues.push({
      severity: 'blocker',
      category: '接口定义',
      message: `以下接口行缺少必填字段（方法/路径/说明）:\n${incompleteRows.join('\n')}`,
    });
  }

  // 按文档来源 📄 分块检测，每块独立分析避免跨文档同名标题冲突
  const docBlocks = content.split(/^##\s📄\s/m).filter((d: string) => d.trim());
  for (const doc of docBlocks) {
    const sections = doc.match(/^(#{2,3})\s+(.+)$/gm) || [];
    let prevIdx = 0;
    for (let i = 0; i < sections.length; i++) {
      const idx = doc.indexOf(sections[i], prevIdx);
      if (idx === -1) continue;
      const nextIdx = i + 1 < sections.length
        ? doc.indexOf(sections[i + 1], idx + 1)
        : doc.length;
      const sectionContent = doc.substring(idx + sections[i].length, nextIdx).trim();
      if (!sectionContent || sectionContent.length < 20) {
        issues.push({
          severity: 'warning',
          category: '内容完整性',
          message: `章节「${sections[i].replace(/^#+\s*/, '')}」内容过少（${sectionContent.length} 字符），可能需要补充`,
          location: sections[i],
        });
      }
      prevIdx = idx;
    }
  }

  const hasInterfaces = content.includes('接口') || content.includes('API');
  const hasDataModel = content.includes('数据模型') || content.includes('数据表') || content.includes('数据库');
  if (!hasInterfaces) {
    issues.push({ severity: 'warning', category: '内容完整性', message: '未找到接口定义章节。建议添加「接口定义」部分。' });
  }
  if (!hasDataModel) {
    issues.push({ severity: 'info', category: '内容完整性', message: '未找到数据模型/数据表描述。如需数据库变更，建议补充。' });
  }

  // 去重：同一 message 只保留第一次出现（避免多文档内容重复扫描导致重复告警）
  const seen = new Set<string>();
  return issues.filter(issue => {
    const key = issue.message;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface ArchImpact {
  modules: string[];
  newDependencies: string[];
  risks: string[];
  apis: string[];
}

async function analyzeArchitectureImpact(content: string): Promise<ArchImpact> {
  const impact: ArchImpact = { modules: [], newDependencies: [], risks: [], apis: [] };

  const archPath = join(process.cwd(), '.speccore', 'GLOBAL', 'ARCHITECTURE.md');
  if (await pathExists(archPath)) {
    const archContent = await readFile(archPath, 'utf-8');
    if (archContent.match(/## 模块|## 系统边界|## 服务列表/)) {
      impact.modules.push('需要对照 ARCHITECTURE.md 确认影响范围');
    }
  }

  const apiCalls = content.match(/\/api\/[a-zA-Z0-9/-]+/g) || [];
  impact.apis = [...new Set(apiCalls)];

  // 新增依赖检测
  if (/消息队列|MQ|Kafka/.test(content)) impact.newDependencies.push('消息队列');
  if (/缓存|Redis|Cache/.test(content)) impact.newDependencies.push('缓存服务 (Redis)');
  if (/OSS|对象存储|文件上传/.test(content)) impact.newDependencies.push('对象存储 (OSS/S3)');
  if (/WebSocket|实时|推送/.test(content)) impact.newDependencies.push('WebSocket 实时通信');
  if (/定时|调度|Cron/.test(content)) impact.newDependencies.push('定时任务调度');
  if (/ES|全文检?索|Elasticsearch/.test(content)) impact.newDependencies.push('搜索引擎 (Elasticsearch)');

  // 风险检测
  if (/批量删除|批量操作/.test(content)) impact.risks.push('存在批量操作，需考虑事务一致性和性能');
  if (/导出|报表/.test(content)) impact.risks.push('存在导出/报表功能，需考虑大数据量时的内存和超时');
  if (/权限|角色|RBAC/.test(content)) impact.risks.push('涉及权限变更，需确认 RBAC 模型兼容性');

  return impact;
}

// ================================================================
// 代码对标
// ================================================================

interface CodeMapEntry {
  sourceFile: string;
  apis: string[];
  exports: string[];
  relevanceScore: number;
}

// ================================================================
// 报告生成: 纯需求
// ================================================================

function buildReqConsistencyReport(
  input: AnalyzeInput,
  issues: Issue[],
  archImpact: ArchImpact
): string {
  const now = new Date().toISOString().split('T')[0];
  let r = `# 全局需求一致性分析\n\n`;
  r += `> 分析时间: ${now} | 需求文档: ${input.requirements.length} 个 | 模式: 全局\n\n`;
  r += `---\n\n`;
  r += `## 1. 需求覆盖\n\n`;
  r += `| # | 文档 |\n| :--- | :--- |\n`;
  for (let i = 0; i < input.requirements.length; i++) {
    r += `| ${i + 1} | ${input.requirements[i]} |\n`;
  }
  r += `\n## 2. 完整性问题\n\n`;
  r += issues.length === 0
    ? `> ✅ 未发现完整性问题\n`
    : `| 严重度 | 分类 | 问题 |\n| :--- | :--- | :--- |\n${issues.map(i => `| ${icon(i.severity)} ${i.severity} | ${i.category} | ${i.message.replace(/\n/g, '<br>')} |`).join('\n')}\n`;

  r += `\n## 3. 跨需求一致性\n\n`;
  r += `| 维度 | 状态 | 说明 |\n| :--- | :--- | :--- |\n`;
  r += `| API 路径规范 | ⚠️ 待检查 | 请确认不同需求间 API 路径无冲突 |\n`;
  r += `| 数据模型 | ⚠️ 待检查 | 请确认数据表/实体定义无冲突 |\n`;
  r += `| 权限模型 | ⚠️ 待检查 | 请确认权限定义无冲突 |\n`;
  r += `\n---\n\n## 4. 架构风险\n\n`;
  for (const risk of archImpact.risks) r += `- ⚠️ ${risk}\n`;
  return r;
}

function buildIterationReqReport(
  input: AnalyzeInput,
  issues: Issue[],
  archImpact: ArchImpact,
  sourceContents?: Record<string, string>,
): string {
  const now = new Date().toISOString().split('T')[0];
  const iter = input.iteration || 'current';
  const blockerCount = issues.filter(i => i.severity === 'blocker').length;

  let r = `# 需求分析报告\n\n`;
  r += `> 迭代: ${iter} | 分析时间: ${now} | 状态: ${blockerCount > 0 ? '🔴 有阻断' : '🟢 可拆分'}\n\n`;
  r += `---\n\n`;

  r += `## 1. 需求完整性检查\n\n`;
  r += `| 严重度 | 分类 | 问题 |\n| :--- | :--- | :--- |\n`;
  for (const issue of issues) {
    r += `| ${icon(issue.severity)} ${issue.severity} | ${issue.category} | ${issue.message.replace(/\n/g, '<br>')} |\n`;
  }
  if (issues.length === 0) r += `| ✅ | - | 未发现明显问题 |\n`;
  r += `\n`;

  r += `## 2. 架构影响\n\n`;
  if (archImpact.apis.length > 0) {
    r += `### 涉及接口\n`;
    for (const a of archImpact.apis) r += `- \`${a}\`\n`;
    r += `\n`;
  }
  if (archImpact.newDependencies.length > 0) {
    r += `### 新增依赖\n`;
    for (const d of archImpact.newDependencies) r += `- [ ] ${d}\n`;
    r += `\n`;
  }
  if (archImpact.risks.length > 0) {
    r += `### ⚠️ 风险提示\n`;
    for (const rk of archImpact.risks) r += `- ${rk}\n`;
    r += `\n`;
  }

  r += `## 3. 待确认清单\n\n`;
  for (const issue of issues.filter(i => i.severity !== 'info')) {
    r += `- [ ] ${issue.message.replace(/\n/g, ' ').slice(0, 100)}\n`;
  }
  for (const rk of archImpact.risks) r += `- [ ] ${rk}\n`;
  if (archImpact.newDependencies.length > 0) r += `- [ ] 确认新增依赖的引入方案和排期\n`;

  // ── 代码关联分析（v6.8.0 新增：需求分析默认关联代码） ──
  if (sourceContents && Object.keys(sourceContents).length > 0) {
    r += `\n---\n\n## 3.5 关联代码现状\n\n`;
    r += `> 以下源码文件与当前需求相关，供技术方案参考\n\n`;
    for (const [path, content] of Object.entries(sourceContents)) {
      const preview = content.slice(0, 600).replace(/\n/g, '\n  ');
      r += `### \`${path}\`\n\n\`\`\`${path.split('.').pop() || 'ts'}\n${preview}${content.length > 600 ? '\n  // ... 截断 ...' : ''}\n\`\`\`\n\n`;
    }
  }

  r += `\n---\n\n## 4. 技术方案（待填写）\n\n`;
  r += `| 模块 | 技术方案 | 负责人 | 预计工时 |\n| :--- | :--- | :--- | :--- |\n| | | | |\n\n`;
  r += `### 数据库变更\n| 表名 | 变更类型 | 说明 |\n| :--- | :--- | :--- |\n| | | |\n\n`;
  r += `### 接口依赖\n| 调用方 | 被调用方 | 接口 | 说明 |\n| :--- | :--- | :--- | :--- |\n| | | | |\n\n`;
  r += `### 确认签字\n`;
  r += `- [ ] 需求确认无遗漏\n- [ ] 技术方案评审通过\n- [ ] 工时评估合理\n- [ ] 可以开始拆分任务\n`;
  return r;
}

function buildTaskReqReport(
  input: AnalyzeInput,
  issues: Issue[],
  archImpact: ArchImpact,
  sourceContents?: Record<string, string>,
): string {
  const now = new Date().toISOString().split('T')[0];
  let r = `# 任务需求分析\n\n`;
  r += `> 迭代: ${input.iteration} | 任务: ${input.taskId} | 分析: ${now}\n\n---\n\n`;
  r += `## 问题清单\n`;
  if (issues.length === 0) r += `> ✅ 无问题\n`;
  else for (const i of issues) r += `- [ ] ${i.message.replace(/\n/g, ' ')}\n`;
  if (archImpact.risks.length > 0) {
    r += `\n## 风险\n`;
    for (const rk of archImpact.risks) r += `- ⚠️ ${rk}\n`;
  }

  // ── 代码关联分析（v6.8.0 新增） ──
  if (sourceContents && Object.keys(sourceContents).length > 0) {
    r += `\n## 关联代码\n\n`;
    r += `> 以下源码与当前任务相关\n\n`;
    for (const [path, content] of Object.entries(sourceContents)) {
      const preview = content.slice(0, 400).replace(/\n/g, '\n  ');
      r += `- **\`${path}\`**\n\n  \`\`\`${path.split('.').pop() || 'ts'}\n  ${preview}${content.length > 400 ? '\n  // ... 截断 ...' : ''}\n  \`\`\`\n\n`;
    }
  }

  return r;
}

// ================================================================
// 报告生成: 纯代码
// ================================================================

function buildCodeHealthReport(
  input: AnalyzeInput,
  stats: SourceStats,
  apis: ApiEntry[],
  hotspots: Hotspot[],
  deps: DepAnalysis | null
): string {
  const now = new Date().toISOString().split('T')[0];
  let r = `# 代码健康报告\n\n`;
  r += `> 分析时间: ${now} | 目录: ${input.sources.join(', ')} | 深度: ${input.depth}\n\n`;
  r += `---\n\n`;

  // 概览
  r += `## 1. 概览\n\n`;
  r += `| 指标 | 数值 |\n| :--- | :--- |\n`;
  r += `| 总文件数 | ${stats.totalFiles} |\n`;
  r += `| 总行数 | ${stats.totalLines.toLocaleString()} |\n`;
  r += `| API 接口数 | ${apis.length} |\n`;
  r += `| 复杂度热点 | ${hotspots.length} 个 |\n`;
  if (deps?.cycles?.length) r += `| 循环依赖 | ${deps.cycles.length} 处 |\n`;
  r += `\n`;

  // 语言分布
  r += `## 2. 语言分布\n\n`;
  r += `| 语言 | 文件数 | 占比 |\n| :--- | :--- | :--- |\n`;
  for (const [lang, count] of Object.entries(stats.byLanguage).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / stats.totalFiles) * 100).toFixed(1);
    r += `| ${lang} | ${count} | ${pct}% |\n`;
  }
  r += `\n`;

  // 目录分布
  r += `## 3. 目录分布\n\n`;
  r += `| 目录 | 文件数 |\n| :--- | :--- |\n`;
  for (const [dir, count] of Object.entries(stats.byDir).sort((a, b) => b[1] - a[1])) {
    r += `| ${dir}/ | ${count} |\n`;
  }
  r += `\n`;

  // 复杂度热点
  r += `## 4. 复杂度热点\n\n`;
  if (hotspots.length === 0) {
    r += `> ✅ 未发现明显的复杂度问题\n`;
  } else {
    r += `| 文件 | 严重度 | 行数 | 原因 |\n| :--- | :--- | :--- | :--- |\n`;
    for (const h of hotspots.slice(0, 15)) {
      const icon = h.severity === 'high' ? '🔴' : h.severity === 'medium' ? '🟡' : '⚪';
      r += `| ${h.file} | ${icon} ${h.severity} | ${h.lines} | ${h.reason} |\n`;
    }
  }
  r += `\n`;

  // API 清单
  r += `## 5. API 清单 (${apis.length})\n\n`;
  if (apis.length > 0) {
    r += `| 方法 | 路径 | 文件 |\n| :--- | :--- | :--- |\n`;
    for (const a of apis.slice(0, 40)) {
      r += `| ${a.method} | \`${a.path}\` | ${a.file} |\n`;
    }
    if (apis.length > 40) r += `| ... | 还有 ${apis.length - 40} 个接口 | |\n`;
  }
  r += `\n`;

  // 最大文件
  r += `## 6. 最大文件 TOP 10\n\n`;
  r += `| # | 文件 | 行数 |\n| :--- | :--- | :--- |\n`;
  for (let i = 0; i < stats.largestFiles.length; i++) {
    r += `| ${i + 1} | ${stats.largestFiles[i].path} | ${stats.largestFiles[i].lines.toLocaleString()} |\n`;
  }
  r += `\n`;

  // 依赖分析
  if (deps) {
    r += `## 7. 依赖分析\n\n`;
    if (deps.cycles.length > 0) {
      r += `### ⚠️ 循环依赖 (${deps.cycles.length} 处)\n`;
      for (const c of deps.cycles) r += `- ${c[0]} ↔ ${c[1]}\n`;
      r += `\n`;
    }
    if (deps.entryPoints.length > 0) {
      r += `### 核心模块 (被引用最多)\n`;
      for (const e of deps.entryPoints) r += `- ${e}\n`;
      r += `\n`;
    }
  }

  r += `---\n\n`;
  r += `## 改进建议\n\n`;
  if (hotspots.filter(h => h.severity === 'high').length > 0) {
    r += `- 🔴 存在 ${hotspots.filter(h => h.severity === 'high').length} 个高严重度热点，建议拆分大文件\n`;
  }
  if (deps?.cycles?.length) {
    r += `- ⚠️ 检测到 ${deps.cycles.length} 处循环依赖，建议重构解除耦合\n`;
  }
  r += `- 💡 定期运行此命令追踪代码健康趋势\n`;

  return r;
}

function buildIterationCodeReport(
  input: AnalyzeInput,
  stats: SourceStats,
  apis: ApiEntry[],
  hotspots: Hotspot[],
  deps: DepAnalysis | null
): string {
  const now = new Date().toISOString().split('T')[0];
  let r = `# 代码分析报告\n\n`;
  r += `> 迭代: ${input.iteration || 'current'} | 分析: ${now} | 目录: ${input.sources.join(', ')}\n\n`;
  r += `---\n\n`;
  r += `## 统计\n\n`;
  r += `| 指标 | 值 |\n| :--- | :--- |\n`;
  r += `| 文件数 | ${stats.totalFiles} |\n| 行数 | ${stats.totalLines.toLocaleString()} |\n| API | ${apis.length} |\n| 热点 | ${hotspots.length} |\n\n`;

  if (hotspots.length > 0) {
    r += `## 代码热点\n\n`;
    r += `| 文件 | 行数 | 原因 |\n| :--- | :--- | :--- |\n`;
    for (const h of hotspots.slice(0, 10)) r += `| ${h.file} | ${h.lines} | ${h.severity} — ${h.reason} |\n`;
    r += `\n`;
  }

  if (apis.length > 0) {
    r += `## API 变更影响\n\n`;
    r += `| 方法 | 路径 |\n| :--- | :--- |\n`;
    for (const a of apis.slice(0, 20)) r += `| ${a.method} | \`${a.path}\` |\n`;
    r += `\n`;
  }

  return r;
}

function buildTaskCodeReport(
  input: AnalyzeInput,
  stats: SourceStats,
  apis: ApiEntry[],
  hotspots: Hotspot[]
): string {
  const now = new Date().toISOString().split('T')[0];
  let r = `# 任务代码审查\n\n`;
  r += `> 迭代: ${input.iteration} | 任务: ${input.taskId} | ${now}\n\n---\n\n`;
  r += `## 变更文件 (${stats.totalFiles})\n\n`;
  r += `| 文件 | 行数 |\n| :--- | :--- |\n`;
  for (const f of stats.largestFiles.slice(0, 15)) r += `| ${f.path} | ${f.lines} |\n`;
  r += `\n`;

  if (hotspots.length > 0) {
    r += `## 关注点\n\n`;
    for (const h of hotspots) r += `- ${h.severity === 'high' ? '🔴' : '🟡'} ${h.file}: ${h.reason}\n`;
    r += `\n`;
  }

  r += `## 检查清单\n\n`;
  r += `- [ ] 代码风格一致\n- [ ] 无硬编码密钥\n- [ ] 错误处理完善\n- [ ] 日志覆盖关键路径\n`;
  if (apis.length > 0) r += `- [ ] API 文档已更新 (${apis.length} 个接口)\n`;
  return r;
}

// ================================================================
// 报告生成: AI 增强 (替代旧的关键词匹配方案)
// ================================================================

interface AIEnhancedReportParams {
  issues: Issue[];
  archImpact: ArchImpact;
  fileStats: SourceStats;
  apiInventory: ApiEntry[];
  aiContext: AIContextResult;
  sourceContents: Record<string, string>;
}

async function buildAIEnhancedReport(
  input: AnalyzeInput,
  scope: 'global' | 'iteration' | 'task',
  params: AIEnhancedReportParams
): Promise<string> {
  const { issues, archImpact, fileStats, apiInventory, aiContext, sourceContents } = params;
  const now = new Date().toISOString().split('T')[0];
  const iter = input.iteration || 'current';
  const blockerCount = issues.filter(i => i.severity === 'blocker').length;

  let r = `# ${scope === 'global' ? '全局架构影响分析' : scope === 'task' ? '任务综合分析' : '需求分析报告'}\n\n`;
  r += `> 迭代: ${iter} | 时间: ${now} | 状态: ${blockerCount > 0 ? '🔴 有阻断' : '🟢 可拆分'}\n`;
  r += `> 需求: ${input.requirements.length} 个 | 源码文件: ${fileStats.totalFiles} 个 | API: ${apiInventory.length} 个\n`;
  r += `> **AI 上下文**: [${aiContext.promptPath}](${aiContext.promptPath})\n\n`;
  r += `---\n\n`;

  // 1. 分析概览
  r += `## 📊 分析概览\n\n`;
  r += `| 指标 | 值 |\n| :--- | :--- |\n`;
  r += `| 需求文档 | ${input.requirements.length} |\n`;
  r += `| 扫描文件 | ${fileStats.totalFiles} |\n`;
  r += `| 发现问题 | ${issues.length} |\n`;
  r += `| 阻断问题 | ${blockerCount} |\n`;
  r += `| API 接口 | ${apiInventory.length} |\n`;
  r += `| 架构风险 | ${archImpact.risks.length} |\n`;
  r += `\n`;

  // 2. 问题清单 (基础规则检查)
  r += `## 🔍 自动检查结果\n\n`;
  if (issues.length > 0) {
    r += `| 严重度 | 分类 | 问题 |\n| :--- | :--- | :--- |\n`;
    for (const issue of issues) {
      r += `| ${icon(issue.severity)} ${issue.severity} | ${issue.category} | ${issue.message.replace(/\n/g, '<br>')} |\n`;
    }
  } else {
    r += `> ✅ 基础规则检查未发现明显问题。\n`;
  }
  r += `\n`;

  // 3. 架构影响
  r += `## 🏗 架构影响\n\n`;
  if (archImpact.apis.length > 0) {
    r += `### 涉及接口\n${archImpact.apis.slice(0, 20).map(a => `- \`${a}\``).join('\n')}\n\n`;
  }
  if (archImpact.risks.length > 0) {
    r += `### ⚠️ 风险\n${archImpact.risks.map(rk => `- ${rk}`).join('\n')}\n\n`;
  }

  // 4. 改动范围分析 (引擎可自动检测的部分)
  r += `## 📂 改动范围\n\n`;
  r += `| 维度 | 详情 |\n| :--- | :--- |\n`;
  r += `| 源码目录 | ${input.sources.join(', ') || '未指定'} |\n`;
  r += `| 扫描文件 | ${fileStats.totalFiles} 个 |\n`;
  r += `| API 接口 | ${apiInventory.length} 个 |\n`;
  if (archImpact.newDependencies && archImpact.newDependencies.length > 0) {
    r += `| 新增依赖 | ${archImpact.newDependencies.join(', ')} |\n`;
  }
  r += `\n`;

  // 5. 风险评估 (引擎可自动检测的部分)
  r += `## ⚠️ 风险评估\n\n`;
  if (archImpact.risks.length > 0) {
    r += `### 架构风险\n${archImpact.risks.map((rk, i) => `${i + 1}. ${rk}`).join('\n')}\n\n`;
  }
  if (issues.filter(i => i.severity === 'blocker').length > 0) {
    r += `### 🚫 阻断问题\n${issues.filter(i => i.severity === 'blocker').map(i => `- ${i.message.replace(/\\n/g, ' ')}`).join('\n')}\n\n`;
  }
  r += `> ⚠️ 以下风险项请 AI 深度分析后补充\n\n`;
  r += `| 风险类型 | 风险描述 | 可能性 | 影响 | 缓解措施 |\n| :--- | :--- | :--- | :--- | :--- |\n`;
  r += `| 技术风险 | _AI 分析_ | — | — | — |\n`;
  r += `| 业务风险 | _AI 分析_ | — | — | — |\n`;
  r += `| 依赖风险 | _AI 分析_ | — | — | — |\n`;
  r += `| 安全风险 | _AI 分析_ | — | — | — |\n`;
  r += `| 性能风险 | _AI 分析_ | — | — | — |\n`;
  r += `\n`;

  // 6. 文件级变更预测
  r += `## 📄 预计变更文件\n\n`;
  r += `| 文件 | 变更类型 | 影响评估 | 风险等级 |\n| :--- | :--- | :--- | :--- |\n`;
  if (Object.keys(sourceContents).length > 0) {
    for (const [file] of Object.entries(sourceContents).slice(0, 8)) {
      r += `| \`${file}\` | _AI 分析_ | _AI 分析_ | — |\n`;
    }
  }
  r += `| _其他_ | _待 AI 分析_ | — | — |\n\n`;
  r += `> 📌 请 AI 读取上下文文件完成文件级对标\n\n`;

  // 6.5 源码分析清单（已读 + 未覆盖，方便用户发现遗漏并补充）
  {
    const readFiles = Object.keys(sourceContents);
    const fullIndex = await loadFullIndex();
    const allIndexedFiles = fullIndex?.files?.map(f => f.path) || [];
    const uncoveredFiles = allIndexedFiles.filter(f => !readFiles.includes(f));

    if (readFiles.length > 0 || uncoveredFiles.length > 0) {
      r += `## 📚 源码分析清单\n\n`;

      // 已分析文件
      if (readFiles.length > 0) {
        r += `### ✅ 已分析（${readFiles.length} 个文件）\n\n`;
        for (const [file, content] of Object.entries(sourceContents)) {
          const lines = content.split('\n').length;
          const size = (content.length / 1024).toFixed(1);
          r += `- \`${file}\` (${lines} 行, ${size}KB)\n`;
        }
        r += `\n`;
      }

      // 未覆盖文件（按目录分组）
      if (uncoveredFiles.length > 0) {
        r += `### 📂 索引中未覆盖（${uncoveredFiles.length} 个文件）\n\n`;
        r += `> 以下文件已在索引中，但本次分析未读取。如发现与需求相关，可补充分析。\n\n`;

        // 按第一层目录分组
        const grouped: Record<string, string[]> = {};
        for (const f of uncoveredFiles) {
          const parts = f.split('/');
          const dir = parts.length >= 2 ? parts.slice(0, 2).join('/') : parts[0];
          if (!grouped[dir]) grouped[dir] = [];
          grouped[dir].push(f);
        }

        for (const [dir, files] of Object.entries(grouped).sort((a, b) => b[1].length - a[1].length)) {
          r += `**${dir}** (${files.length} 个)\n`;
          for (const f of files.slice(0, 5)) {
            r += `  - \`${f}\`\n`;
          }
          if (files.length > 5) {
            r += `  - _... 还有 ${files.length - 5} 个_\n`;
          }
          r += `\n`;
        }
      }

      // 补充分析指引
      r += `### 💡 如何补充分析\n\n`;
      r += `| 场景 | 命令 |\n`;
      r += `| :--- | :--- |\n`;
      r += `| **追加源码（不重新生成）** | \`speccore analyze --supplement\` |\n`;
      r += `| 指定目录追加 | \`speccore analyze --supplement --source-scope src/core\` |\n`;
      r += `| 扩大读取量（重新分析） | \`speccore analyze --auto --depth deep\` |\n`;
      r += `| 指定目录重新分析 | \`speccore analyze --auto --source-scope src/core,src/commands\` |\n`;
      r += `| 查看完整代码索引 | \`speccore code-index --show\` |\n`;
      r += `| 重建索引（代码有变动） | \`speccore code-index --full\` |\n\n`;
    }
  }

  // 7. AI 深度分析指引
  r += `## 🤖 AI 深度分析清单\n\n`;
  r += `> **上下文文件**: \`${aiContext.promptPath}\`  \n`;
  r += `> 请 AI 助手（WorkBuddy）读取上下文并完成以下分析：\n\n`;
  r += `### 必须完成\n`;
  r += `- [ ] **需求完整性分析**: 功能点覆盖、边界条件、异常处理、非功能需求\n`;
  r += `- [ ] **需求-代码对标**: 将每个功能点映射到具体源码文件和方法\n`;
  r += `- [ ] **前后端契约对标**: 每个 API 的请求/响应字段与前端页面字段一一映射，确保无遗漏\n`;
  r += `- [ ] **变更影响范围**: 评估每个变更的波及面和级联影响\n`;
  r += `- [ ] **风险矩阵填充**: 补充技术/业务/依赖/安全/性能风险详情\n`;
  r += `- [ ] **文件级变更清单**: 列出所有需要修改的文件及修改类型\n`;
  r += `### 可选\n`;
  r += `- [ ] **UI 规格补充**: 根据 UI_SPEC.md 校验页面/组件/字段映射完整性\n`;
  r += `- [ ] **任务拆分建议**: 推荐任务粒度和依赖关系\n`;
  r += `- [ ] **技术方案推荐**: 架构方案、DB 设计、API 设计建议\n`;
  r += `- [ ] **工时评估**: 基于改动范围的工时估算\n`;

  if (Object.keys(sourceContents).length > 0) {
    r += `\n### 相关源码摘要 (${Object.keys(sourceContents).length} 个文件)\n\n`;
    for (const [file, content] of Object.entries(sourceContents).slice(0, 5)) {
      const lines = content.split('\n').slice(0, 12).join('\n');
      r += `<details><summary><code>${file}</code></summary>\n\n\`\`\`\n${lines}\n\`\`\`\n\n</details>\n\n`;
    }
  }

  // 8. 确认清单
  r += `\n---\n\n## ✅ 确认清单\n\n`;
  r += `- [ ] AI 分析完成\n- [ ] 需求确认无遗漏\n- [ ] 前后端契约对齐（API 字段↔ UI 字段）\n- [ ] UI 规格审查通过\n- [ ] 改动范围达成共识\n- [ ] 风险评估无遗漏\n- [ ] 技术方案评审通过\n- [ ] 可以开始拆分任务\n`;

  return r;
}

// ================================================================
// 工具函数
// ================================================================

function icon(severity: string): string {
  switch (severity) {
    case 'blocker': return '🔴';
    case 'warning': return '🟡';
    case 'info': return 'ℹ️';
    default: return '⚪';
  }
}

/** 按需求功能 × 端 分目录写入分析报告（按端提取差异化内容） */
async function writePerPlatform(iterDir: string, report: string, filename: string): Promise<void> {
  const reqDir = join(iterDir, '010-requirements');
  const specsBase = join(iterDir, '020-specs');
  try {
    const entries = await readdir(reqDir, { withFileTypes: true });
    // 检测需求功能目录（非 assets/sources/_开头的子目录）
    const features = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.') 
        && e.name !== 'sources' && e.name !== 'assets' && e.name !== 'prototypes')
      .map(e => e.name);

    if (features.length === 0) return;

    // 平台列表从 CONSTITUTION 获取，默认四端
    const platforms = await detectPlatformsFromConstitution();
    
    for (const platform of platforms) {
      const platformDir = join(specsBase, platform);
      await ensureDir(platformDir);

      // 按端提取差异化内容（而非写入同一份报告）
      const platformReport = extractPlatformContent(report, platform);
      
      await writeFile(join(platformDir, filename), platformReport);
      for (const feature of features) {
        // 每个 feature 文件也按端提取
        const featureContent = extractFeatureForPlatform(report, feature, platform);
        await writeFile(join(platformDir, `${feature}.md`), featureContent);
      }
    }
  } catch {
    // 目录不存在，静默跳过
  }
}

/** 端关键词映射表（用于从合并报告中提取特定端的内容） */
const PLATFORM_KEYWORDS: Record<string, string[]> = {
  admin:    ['后台管理', '管理端', 'admin', 'Admin', 'Web管理', '后台', '管理后台', '数据看板', '用户管理', '数据报表', '权限管理'],
  h5:       ['H5', 'h5', '移动端', 'mobile', 'Mobile', 'H5移动', '快速预订', '扫码签到', '我的预订', '手机'],
  miniapp:  ['小程序', 'miniapp', 'MiniApp', '微信'],
  app:      ['客户端', 'app', 'App', '原生'],
  'booking-service': ['预订', '订单', 'booking', '预订域', '预订生命周期'],
  'room-service': ['会议室', 'room', '会议室域', '会议室管理'],
  backend:  ['后端服务', 'backend', '服务端', '接口', '数据模型', '业务域'],
  web:      ['Web', 'web', '桌面端', 'PC'],
  android:  ['Android', 'android', '安卓'],
  ios:      ['iOS', 'ios', '苹果'],
};

/** 从合并报告中提取特定端的内容 */
function extractPlatformContent(report: string, platform: string): string {
  const keywords = PLATFORM_KEYWORDS[platform] || [platform];
  const lines = report.split('\n');
  
  // 按 Markdown 二级标题拆分
  const sections: { heading: string; content: string[] }[] = [];
  let current: { heading: string; content: string[] } = { heading: '', content: [] };
  for (const line of lines) {
    const hm = line.match(/^(#{1,3})\s+(.+)/);
    if (hm) {
      if (current.heading || current.content.length > 0) {
        sections.push({ heading: current.heading, content: current.content });
      }
      current = { heading: line, content: [] };
    } else {
      current.content.push(line);
    }
  }
  if (current.heading || current.content.length > 0) {
    sections.push({ heading: current.heading, content: current.content });
  }

  // 提取与该端相关的段落
  const matched = sections.filter(s => {
    const text = s.heading + ' ' + s.content.join(' ');
    return keywords.some(kw => text.includes(kw));
  });

  if (matched.length > 0) {
    const platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1);
    const header = `<!-- 以下为 ${platformLabel} 端相关内容（从合并报告中自动提取） -->\n\n`;
    return header + matched.map(s => s.heading + '\n' + s.content.join('\n')).join('\n\n');
  }

  // 无匹配段落时，返回完整报告 + 标注
  return `<!-- ⚠️ 未找到 ${platform} 端专属内容，以下为完整报告，建议补充该端专属章节 -->\n\n${report}`;
}

/** 从报告中提取特定功能 × 特定端的内容 */
function extractFeatureForPlatform(report: string, feature: string, platform: string): string {
  // 先提取该功能的段落
  const featureKeywords = [feature, feature.replace(/-/g, ' ')];
  const lines = report.split('\n');
  const sections: { heading: string; content: string[] }[] = [];
  let current: { heading: string; content: string[] } = { heading: '', content: [] };
  for (const line of lines) {
    const hm = line.match(/^(#{1,4})\s+(.+)/);
    if (hm) {
      if (current.heading || current.content.length > 0) {
        sections.push({ heading: current.heading, content: current.content });
      }
      current = { heading: line, content: [] };
    } else {
      current.content.push(line);
    }
  }
  if (current.heading || current.content.length > 0) {
    sections.push({ heading: current.heading, content: current.content });
  }

  // 先按功能名匹配，再按端关键词过滤
  const featureSections = sections.filter(s => {
    const text = (s.heading + ' ' + s.content.join(' ')).toLowerCase();
    return featureKeywords.some(kw => text.includes(kw.toLowerCase()));
  });

  if (featureSections.length > 0) {
    const platformKws = PLATFORM_KEYWORDS[platform] || [platform];
    const platformMatched = featureSections.filter(s => {
      const text = s.heading + ' ' + s.content.join(' ');
      return platformKws.some(kw => text.includes(kw));
    });
    const result = platformMatched.length > 0 ? platformMatched : featureSections;
    return result.map(s => s.heading + '\n' + s.content.join('\n')).join('\n\n');
  }

  return `# ${feature} (${platform})\n\n_该功能在 ${platform} 端暂无独立分析内容，请参考完整报告。_\n`;
}

/**
 * 局部分析：只分析单个功能模块，写入 020-specs/features/{feature}.md
 * 用于 --feature 模式，避免全量重跑
 */
export async function analyzeSingleFeature(
  iterDir: string,
  featureName: string,
): Promise<{ outputPath: string; report: string } | null> {
  const reqDir = join(iterDir, '010-requirements');
  const featureReqPath = join(reqDir, 'features', featureName, 'README.md');

  if (!(await pathExists(featureReqPath))) {
    return null;
  }

  const content = await readFile(featureReqPath, 'utf-8');
  const issues = scanCompleteness(content);
  const archImpact = await analyzeArchitectureImpact(content);
  const now = new Date().toISOString().split('T')[0];
  const blockerCount = issues.filter(i => i.severity === 'blocker').length;

  // 构建单模块分析报告
  let r = `# ${featureName} — 需求分析报告\n\n`;
  r += `> 模块: ${featureName} | 分析时间: ${now} | 模式: 局部刷新 | 状态: ${blockerCount > 0 ? '🔴 有阻断' : '🟢 可拆分'}\n\n`;
  r += `---\n\n`;

  r += `## 1. 需求完整性检查\n\n`;
  r += `| 严重度 | 分类 | 问题 |\n| :--- | :--- | :--- |\n`;
  for (const issue of issues) {
    r += `| ${icon(issue.severity)} ${issue.severity} | ${issue.category} | ${issue.message.replace(/\n/g, '<br>')} |\n`;
  }
  if (issues.length === 0) r += `| ✅ | - | 未发现明显问题 |\n`;
  r += `\n`;

  r += `## 2. 架构影响\n\n`;
  if (archImpact.modules.length > 0) r += `**影响模块**: ${archImpact.modules.join(', ')}\n\n`;
  if (archImpact.risks.length > 0) {
    r += `**风险**:\n`;
    for (const risk of archImpact.risks) r += `- ⚠️ ${risk}\n`;
    r += `\n`;
  }
  if (archImpact.apis.length > 0) {
    r += `**涉及接口**:\n`;
    for (const api of archImpact.apis) r += `- \`${api}\`\n`;
    r += `\n`;
  }
  if (archImpact.modules.length === 0 && archImpact.risks.length === 0) {
    r += `_未检测到明显架构影响_\n\n`;
  }

  r += `## 3. 需求原文\n\n${content}\n`;

  // 写入 020-specs/features/
  const featuresDir = join(iterDir, '020-specs', 'features');
  await ensureDir(featuresDir);
  const outputPath = join(featuresDir, `${featureName}.md`);
  await writeFile(outputPath, r);

  return { outputPath, report: r };
}

/**
 * 局部分析：单个类型文档（bugs/refactors/research）
 *
 * @param iterDir   迭代目录
 * @param docPath   类型路径，如 "bugs/login-timeout" 或 "refactors/db-pool"
 *                  对应 010-requirements/{typeDir}/{slug}.md
 */
export async function analyzeSingleTypedDoc(
  iterDir: string,
  docPath: string,
): Promise<{ outputPath: string; report: string } | null> {
  const reqDir = join(iterDir, '010-requirements');
  const parts = docPath.split('/');
  if (parts.length !== 2) return null;

  const [typeDir, slug] = parts;
  if (!['bugs', 'refactors', 'research'].includes(typeDir)) return null;

  const docFilePath = join(reqDir, typeDir, `${slug}.md`);
  if (!(await pathExists(docFilePath))) return null;

  const content = await readFile(docFilePath, 'utf-8');
  const issues = scanCompleteness(content);
  const archImpact = await analyzeArchitectureImpact(content);
  const now = new Date().toISOString().split('T')[0];
  const blockerCount = issues.filter(i => i.severity === 'blocker').length;

  const typeLabel = typeDir === 'bugs' ? 'Bug 分析' : typeDir === 'refactors' ? '重构分析' : '研究分析';

  let r = `# ${slug} — ${typeLabel}\n\n`;
  r += `> 类型: ${typeDir} | 分析时间: ${now} | 状态: ${blockerCount > 0 ? '🔴 有阻断' : '🟢 可拆分'}\n\n`;
  r += `---\n\n`;

  // 完整性检查
  r += `## 完整性检查\n\n`;
  if (issues.length === 0) {
    r += `✅ 无阻断项\n\n`;
  } else {
    for (const issue of issues) {
      const icon = issue.severity === 'blocker' ? '🔴' : issue.severity === 'warning' ? '🟡' : 'ℹ️';
      r += `${icon} **${issue.category}**: ${issue.message}\n`;
    }
    r += '\n';
  }

  // 架构影响
  r += `## 架构影响分析\n\n`;
  r += archImpact + '\n\n';

  // 写入 020-specs/{typeDir}/
  const destDir = join(iterDir, '020-specs', typeDir);
  await ensureDir(destDir);
  const outputPath = join(destDir, `${slug}.md`);
  await writeFile(outputPath, r);

  return { outputPath, report: r };
}

/** 按功能模块写入 020-specs/features/ */
async function writePerFeature(iterDir: string, report: string, filename: string): Promise<void> {
  const reqDir = join(iterDir, '010-requirements');
  const featuresDir = join(iterDir, '020-specs', 'features');
  // 非 feature 型目录的排除名单
  const EXCLUDED_DIRS = new Set(['sources', 'assets', 'converted', 'staging', 'bugs', 'refactors', 'research', 'prototypes']);
  try {
    const entries = await readdir(reqDir, { withFileTypes: true });
    const features = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.')
        && !EXCLUDED_DIRS.has(e.name))
      .map(e => e.name);
    if (features.length === 0) return;

    await ensureDir(featuresDir);
    for (const feature of features) {
      // 读取该 feature 的 README.md 作为头部，拼接完整报告
      const featureReqPath = join(reqDir, feature, 'README.md');
      let featureHeader = '';
      if (await pathExists(featureReqPath)) {
        featureHeader = `# ${feature} — 需求分析\n\n> 来源: 010-requirements/features/${feature}/README.md\n\n---\n\n`;
      }
      const featureContent = featureHeader + report;
      await writeFile(join(featuresDir, `${feature}.md`), featureContent);
    }
  } catch {}
}

/**
 * 按类型写入 020-specs/{bugs,refactors,research}/
 *
 * 与 writePerFeature 的区别：
 * - feature 用子目录（features/{module}/README.md）
 * - bugfix/refactor/research 用扁平文件（bugs/{slug}.md）
 *
 * 对每个类型目录下的 .md 文件，生成对应的分析报告到 020-specs/ 下
 */
async function writePerTypedDoc(iterDir: string, report: string, filename: string): Promise<void> {
  const reqDir = join(iterDir, '010-requirements');
  const typeDirs = ['bugs', 'refactors', 'research'];

  for (const typeDir of typeDirs) {
    const srcDir = join(reqDir, typeDir);
    const destDir = join(iterDir, '020-specs', typeDir);

    try {
      if (!(await pathExists(srcDir))) continue;
      const entries = await readdir(srcDir, { withFileTypes: true });
      const mdFiles = entries.filter(
        e => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('README') && !isTimestampBackup(e.name)
      );
      if (mdFiles.length === 0) continue;

      await ensureDir(destDir);
      for (const entry of mdFiles) {
        const content = await readFile(join(srcDir, entry.name), 'utf-8');
        const slug = entry.name.replace(/\.md$/, '');
        const header = `# ${slug} — 需求分析\n\n> 来源: 010-requirements/${typeDir}/${entry.name}\n\n---\n\n`;
        await writeFile(join(destDir, entry.name), header + report);
      }
    } catch {}
  }

  // ── 处理 staging/ 目录（doc2spec --classify 产物，带 type frontmatter）──
  const stagingDir = join(reqDir, 'staging');
  try {
    if (!(await pathExists(stagingDir))) return;
    const stagingFiles = (await readdir(stagingDir, { withFileTypes: true }))
      .filter(e => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('README') && !isTimestampBackup(e.name));
    if (stagingFiles.length === 0) return;

    // type frontmatter → 020-specs 目标目录
    const typeToSpecDir: Record<string, string> = {
      feature: 'features',
      bugfix: 'bugs',
      refactor: 'refactors',
      research: 'research',
    };

    for (const entry of stagingFiles) {
      const content = await readFile(join(stagingDir, entry.name), 'utf-8');
      // 解析 frontmatter 中的 type 和 nature 字段
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      let specType = 'features'; // 默认
      let nature = '';
      if (fmMatch) {
        const typeLine = fmMatch[1].split('\n').find(l => l.startsWith('type:'));
        if (typeLine) {
          const typeVal = typeLine.replace('type:', '').trim();
          specType = typeToSpecDir[typeVal] || 'features';
        }
        const natureLine = fmMatch[1].split('\n').find(l => l.startsWith('nature:'));
        if (natureLine) {
          nature = natureLine.replace('nature:', '').trim();
        }
      }
      const destDir = join(iterDir, '020-specs', specType);
      await ensureDir(destDir);
      const slug = entry.name.replace(/\.md$/, '');
      const header = `# ${slug} — 需求分析\n\n> 来源: 010-requirements/staging/${entry.name}\n> 意图: ${nature || '未标注'}\n\n---\n\n`;
      await writeFile(join(destDir, entry.name), header + report);
    }
  } catch {}
}

// ================================================================
// 补充分析模式（读取现有报告，追加未覆盖的源码文件）
// ================================================================

export interface SupplementResult {
  outputPath: string;
  addedFiles: string[];
  totalRead: number;
  remainingUncovered: number;
}

/**
 * 补充分析：读取已有报告，找到未覆盖的源码文件，追加到报告中
 * 不重新生成全部文档，只追加源码内容
 */
export async function supplementAnalysis(input: {
  reportPath: string;
  scope?: string;
  maxFiles?: number;
}): Promise<SupplementResult | null> {
  const { reportPath, scope, maxFiles = 10 } = input;

  // 1. 读取现有报告（不存在则自动创建初始报告，保证流程不断）
  let existingReport: string;
  if (!await pathExists(reportPath)) {
    logger.info('   📝 报告不存在，自动创建初始分析报告...');
    // 确保索引存在
    if (await isIndexStale()) {
      await buildCodeIndex();
    }
    const fullIndex = await loadFullIndex();
    const totalFiles = fullIndex?.files?.length || 0;
    const endpoints = fullIndex?.endpoints || [];
    const modules = fullIndex?.modules || [];

    // 创建初始报告骨架
    let initialReport = `# 需求分析报告\n\n`;
    initialReport += `> 由补充分析自动创建（首次分析未生成报告）\n\n`;
    initialReport += `## 📊 项目概览\n\n`;
    initialReport += `- 索引文件总数: ${totalFiles}\n`;
    initialReport += `- 识别端: ${endpoints.map((e: any) => e.name).join(', ') || '未识别'}\n`;
    initialReport += `- 模块数: ${modules.length}\n\n`;
    initialReport += `## 📚 源码分析清单\n\n`;
    initialReport += `### ✅ 已分析（0 个文件）\n\n`;
    initialReport += `> 初始报告未读取源码文件，等待补充分析填充。\n\n`;
    initialReport += `## 🤖 AI 深度分析清单\n\n`;
    initialReport += `> 待 AI 分析\n`;

    // 确保目录存在并写入
    const dir = join(process.cwd(), reportPath, '..');
    await ensureDir(dir);
    await writeFile(reportPath, initialReport);
    logger.success(`   ✅ 初始报告已创建: ${reportPath}`);
    existingReport = initialReport;
  } else {
    existingReport = await readFile(reportPath, 'utf-8');
  }

  // 2. 解析已分析文件（从 "✅ 已分析" 和 "📚 源码分析清单" 部分提取）
  const readFiles = new Set<string>();
  const filePattern = /`((?:src|lib|app|packages|components)\/[^`]+)`/g;
  // 匹配整个源码分析清单区域（## 标题行到下一个 ## 标题行，不截断在 ### 子标题）
  // 使用 tempered greedy token 避免 multiline $ 导致的提前截断
  const sourceSection = existingReport.match(/## 📚 源码分析清单[^\n]*\n((?:(?!^## [^\n]*$)[\s\S])*)/m)?.[0] || '';
  let match;
  while ((match = filePattern.exec(sourceSection)) !== null) {
    readFiles.add(match[1]);
  }
  // 也匹配补充分析区域（可能有多个，使用 tempered greedy token）
  const supplementSections = existingReport.match(/### 🔄 补充分析[^\n]*\n((?:(?!^### 🔄 )[\s\S])*)/gm) || [];
  for (const section of supplementSections) {
    const tablePattern = /`((?:src|lib|app|packages|components)\/[^`]+)`/g;
    while ((match = tablePattern.exec(section)) !== null) {
      readFiles.add(match[1]);
    }
  }
  logger.info(`   📋 已分析文件: ${readFiles.size} 个`);

  // 3. 从索引获取所有文件，找出未覆盖的
  const fullIndex = await loadFullIndex();
  if (!fullIndex) {
    logger.error('代码索引不存在，请先运行: speccore code-index --full');
    return null;
  }

  const scopeDirs = scope ? scope.split(',').map(s => s.trim()).filter(Boolean) : [];
  const uncoveredFiles = fullIndex.files
    .map(f => f.path)
    .filter(f => !readFiles.has(f))
    .filter(f => scopeDirs.length === 0 || scopeDirs.some(dir => f.startsWith(dir)));

  if (uncoveredFiles.length === 0) {
    logger.success('✅ 所有索引文件都已分析过，无需补充');
    return { outputPath: reportPath, addedFiles: [], totalRead: readFiles.size, remainingUncovered: 0 };
  }

  // 4. 读取下一批未覆盖文件
  const filesToRead = uncoveredFiles.slice(0, maxFiles);
  logger.info(`   📖 补充读取 ${filesToRead.length} 个文件 (剩余 ${uncoveredFiles.length - filesToRead.length} 个未覆盖)`);

  const newContents: Record<string, string> = {};
  let totalBytes = 0;
  const maxBytes = 60000;
  for (const file of filesToRead) {
    if (totalBytes >= maxBytes) break;
    try {
      const content = await readFile(join(process.cwd(), file), 'utf-8');
      const bytes = Buffer.byteLength(content);
      if (totalBytes + bytes > maxBytes) {
        const remaining = maxBytes - totalBytes;
        const buf = Buffer.from(content, 'utf-8');
        newContents[file] = buf.slice(0, remaining).toString('utf-8') + '\n// ... truncated';
        break;
      }
      newContents[file] = content;
      totalBytes += bytes;
    } catch {}
  }

  const addedFiles = Object.keys(newContents);
  if (addedFiles.length === 0) {
    logger.warn('未能读取任何补充文件（文件可能不存在）');
    return null;
  }

  // 5. 构建补充分析章节
  const supplementCount = (existingReport.match(/### 🔄 补充分析/g) || []).length + 1;
  let supplement = `\n\n---\n\n`;
  supplement += `### 🔄 补充分析 #${supplementCount}（${new Date().toISOString().split('T')[0]}）\n\n`;
  supplement += `> 补充读取了以下 **${addedFiles.length}** 个源码文件（累计已分析 ${readFiles.size + addedFiles.length} / ${fullIndex.files.length} 个）\n\n`;

  // 文件清单表格
  supplement += `| 文件 | 行数 | 大小 |\n`;
  supplement += `| :--- | :--- | :--- |\n`;
  for (const [file, content] of Object.entries(newContents)) {
    const lines = content.split('\n').length;
    const size = (content.length / 1024).toFixed(1);
    supplement += `| \`${file}\` | ${lines} | ${size}KB |\n`;
  }
  supplement += `\n`;

  // 源码内容
  for (const [file, content] of Object.entries(newContents)) {
    const lang = file.split('.').pop() || '';
    supplement += `<details>\n<summary>📄 ${file}</summary>\n\n`;
    supplement += '```' + lang + '\n' + content.slice(0, 8000) + '\n```\n\n';
    supplement += `</details>\n\n`;
  }

  // 剩余未覆盖提示
  const remaining = uncoveredFiles.length - addedFiles.length;
  if (remaining > 0) {
    supplement += `> 📌 还有 **${remaining}** 个文件未覆盖\n`;
    supplement += `> - 再次运行 \`speccore analyze --supplement\` 继续补充\n`;
    supplement += `> - 或指定目录: \`speccore analyze --supplement --source-scope <目录>\`\n`;
  } else {
    supplement += `> ✅ 所有索引文件已全部覆盖！\n`;
  }

  // 6. 追加到报告并写入
  const updatedReport = existingReport.replace(/\n*$/, '') + supplement;
  await writeFile(reportPath, updatedReport);

  return {
    outputPath: reportPath,
    addedFiles,
    totalRead: readFiles.size + addedFiles.length,
    remainingUncovered: remaining,
  };
}

/** 已检测到的后端平台列表（从 CONSTITUTION.md 解析） */
let _detectedBackendPlatforms: string[] = [];

/** 从 CONSTITUTION.md 提取平台列表（支持中文端名 + 工程名映射） */
async function detectPlatformsFromConstitution(): Promise<string[]> {
  try {
    const constitutionPath = join(process.cwd(), '.speccore', 'CONSTITUTION.md');
    if (require('fs').existsSync(constitutionPath)) {
      const content = require('fs').readFileSync(constitutionPath, 'utf-8');
      const lines = content.split('\n');
      
      // 1. 先尝试从表头定位「对应需求端」和「工程名」列的索引
      let headerRowIndex = -1;
      let headerCells: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const cells = lines[i].split('|').map((c: string) => c.trim()).filter(Boolean);
        const platformColIdx = cells.findIndex((c: string) => c.includes('对应需求端'));
        if (platformColIdx >= 0) {
          headerRowIndex = i;
          headerCells = cells;
          break;
        }
      }
      
      if (headerRowIndex >= 0) {
        const platforms: string[] = [];
        const backendPlatforms: string[] = [];
        const seen = new Set<string>();
        
        // 解析数据行（跳过头部和分隔线）
        for (let i = headerRowIndex + 2; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line.startsWith('|') || line.match(/^\|[\s:-]+/)) continue;
          
          const cells = line.split('|').map((c: string) => c.trim()).filter(Boolean);
          const projectName = cells[0] || '';
          const platformChinese = cells[5] || cells[cells.length - 1] || '';
          
          if (!platformChinese || !projectName) continue;
          
          // 归一化：中文端名 → 标准端名
          const normalized = normalizeToStandardPlatform(platformChinese);
          if (normalized && !seen.has(normalized)) {
            seen.add(normalized);
            platforms.push(normalized);
            
            // 判断前后端：从工程名或中文端名推断
            const isBackend = /service|server|api|backend|后台|服务|后端/i.test(projectName) ||
                             /后台|服务|后端/.test(platformChinese);
            if (isBackend) {
              backendPlatforms.push(normalized);
            }
          }
        }
        
        if (platforms.length > 0) {
          _detectedBackendPlatforms = backendPlatforms;
          return platforms;
        }
      }
      
      // 2. 回退：简单正则匹配（兼容旧格式）
      const match = content.match(/对应需求端[|｜]\s*([a-z,\s]+)/i);
      if (match) {
        return match[1].split(/[,，]/).map((s: string) => s.trim()).filter(Boolean);
      }
    }
  } catch {}
  return ['app', 'h5', 'miniapp', 'admin']; // 默认四端
}

/**
 * 将中文端名/工程名归一化为标准端名
 * 使用 PLATFORM_ALIAS_MAP 进行语义匹配
 */
function normalizeToStandardPlatform(name: string): string | null {
  const nameLower = name.toLowerCase().trim();
  
  for (const [standardName, aliases] of Object.entries(PLATFORM_ALIAS_MAP)) {
    for (const alias of aliases) {
      if (nameLower === alias || nameLower.includes(alias) || alias.includes(nameLower)) {
        return standardName;
      }
    }
  }
  
  // 无法映射时，返回清理后的原始值
  return nameLower.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || null;
}

// ================================================================
// 从需求内容自动生成全套 Spec 文件（替代空模板）
// ================================================================

export interface SpecGenerationResult {
  files: { filename: string; content: string }[];
  summary: { total: number; withContent: number; skipped: number };
}

/**
 * 从需求文档内容中提取结构化信息，生成有实质内容的 Spec 文件。
 * 用于 analyze --auto 模式，替代 init 创建的空模板。
 */
export async function generateSpecsFromRequirements(
  reqPaths: string[],
  iteration: string,
  specDir: string,
): Promise<SpecGenerationResult> {
  // 1. 【增强】读取所有需求内容，并按端分类
  const platforms = await detectPlatformsFromConstitution(); // 【提前定义】
  const allContent: string[] = [];
  const platformFileMap: Record<string, string[]> = {}; // platform -> [file paths]
  const unclassifiedFiles: { path: string; content: string }[] = []; // 无法分类的文件
  
  for (const p of reqPaths) {
    if (await pathExists(p)) {
      const content = await readFile(p, 'utf-8');
      
      // 【新增】尝试从文件路径或内容中推断所属的端
      const inferredPlatform = inferPlatformFromPathOrContent(p, content, platforms);
      if (inferredPlatform) {
        // ✅ 端专属文档：不加入全局内容，只记录到平台映射
        if (!platformFileMap[inferredPlatform]) {
          platformFileMap[inferredPlatform] = [];
        }
        platformFileMap[inferredPlatform].push(p);
        logger.info(`   📄 检测到 ${p} 属于 ${inferredPlatform} 端（端专属文档）`);
      } else {
        // ❓ 无法推断，检查是否为跨端通用文档
        const fileName = p.split(/[/\\]/).pop() || '';
        const isGlobalDoc = fileName.toUpperCase().includes('REQUIREMENT') || 
                           fileName.toUpperCase().includes('INDEX') ||
                           fileName.toUpperCase().includes('PRD');
        
        if (isGlobalDoc) {
          // ✅ 跨端通用文档：加入全局内容
          allContent.push(content);
          logger.info(`   📄 ${fileName} 识别为跨端通用文档`);
        } else {
          // ⚠️ 无法分类的非通用文档
          unclassifiedFiles.push({ path: p, content });
          logger.warn(`   ⚠️ 无法自动识别 ${p} 所属的端`);
        }
      }
    }
  }
  
  // 【新增】如果有无法分类的文件，给出处理建议
  if (unclassifiedFiles.length > 0) {
    logger.info('');
    logger.info(`   ❓ 发现 ${unclassifiedFiles.length} 个文档无法自动识别所属端`);
    logger.info(`   💡 可用端列表: ${platforms.join(', ')}`);
    logger.info('');
    
    for (const file of unclassifiedFiles) {
      const fileName = file.path.split(/[/\\]/).pop() || file.path;
      logger.info(`   📄 ${fileName}`);
      
      // 检查是否有全局的 REQUIREMENT.md 或 INDEX.md，这些通常是跨端的
      if (fileName.toUpperCase().includes('REQUIREMENT') || 
          fileName.toUpperCase().includes('INDEX') ||
          fileName.toUpperCase().includes('PRD')) {
        logger.info(`      → 假设为跨端通用文档，内容将合并到全局分析中`);
      } else {
        logger.info(`      → 未指定端，将在生成端专属文档时使用占位符`);
        logger.info(`      → 后续可运行: speccore ask "将 ${fileName} 标注为 [端名] 端"`);
      }
    }
    logger.info('');
  }
  
  const fullContent = allContent.join('\n\n---\n\n');
  if (fullContent.trim().length < 20) {
    logger.warn('   ⚠️ 需求文档内容过少，无法生成有效 Spec 文件');
    return { files: [], summary: { total: 0, withContent: 0, skipped: 0 } };
  }

  // 2. 提取结构化信息
  const apis = extractApis(fullContent);
  const features = extractFeatures(fullContent);
  const dataModels = extractDataModels(fullContent);
  const businessRules = extractBusinessRules(fullContent);
  const uiPatterns = extractUIPatterns(fullContent);
  const archImpact = await analyzeArchitectureImpact(fullContent);
  // const platforms 已在前面定义
  const now = new Date().toISOString().split('T')[0];

  // 3. 【新增】按端分割需求内容，为每个端单独提取专属信息
  // 【修复】不仅要分割全局内容，还要合并端专属文件的内容
  const platformContents = splitContentByPlatform(fullContent, platforms);
  
  // 合并端专属文件的内容
  for (const [platform, filePaths] of Object.entries(platformFileMap)) {
    let platformContent = platformContents[platform] || '';
    for (const filePath of filePaths) {
      const content = await readFile(filePath, 'utf-8');
      if (platformContent) {
        platformContent += '\n\n---\n\n' + content;
      } else {
        platformContent = content;
      }
    }
    platformContents[platform] = platformContent;
  }
  
  logger.info(`   🔍 已按端分割需求内容: ${Object.keys(platformContents).length} 个端有专属内容`);

  // 3. 生成各 Spec 文件
  const files: { filename: string; content: string }[] = [];

  // ── 全局文档（跨端通用）──
  // REQUIREMENT.md — 结构化需求规格（业务功能 + API + 数据模型 + 业务规则）
  files.push({
    filename: 'REQUIREMENT.md',
    content: buildRequirementSpec(iteration, now, features, apis, dataModels, businessRules),
  });

  // ANALYSIS.md — 需求分析报告（完整性检查 + 架构影响 + 待确认清单）
  const issues = scanCompleteness(fullContent);
  const archImpactForAnalysis = await analyzeArchitectureImpact(fullContent);
  files.push({
    filename: 'ANALYSIS.md',
    content: buildIterationReqReport({} as any, issues, archImpactForAnalysis, {}),
  });

  // DEPS.md — 依赖清单（全局公共依赖）
  files.push({
    filename: 'DEPS.md',
    content: buildDepsSpec(iteration, now, archImpact),
  });

  // RISK.md — 风险评估（全局风险）
  files.push({
    filename: 'RISK.md',
    content: buildRiskSpec(iteration, now, archImpact),
  });

  // MONITOR.md — 监控指标（全局指标）
  files.push({
    filename: 'MONITOR.md',
    content: buildMonitorSpec(iteration, now, apis, features),
  });

  // REVIEW.md — 评审清单（全局评审要点）
  files.push({
    filename: 'REVIEW.md',
    content: buildReviewSpec(iteration, now, apis, archImpact),
  });

  // ── 各端专属文档 ──
  for (const platform of platforms) {
    const platformDir = join(specDir, platform);
    await ensureDir(platformDir);

    // TECH.md — 该端技术方案
    const techContent = buildTechSpecForPlatform(iteration, now, apis, dataModels, archImpact, platform, features, uiPatterns, platformContents);
    await writeFile(join(platformDir, 'TECH.md'), techContent);

    // TEST.md — 该端测试计划
    const testContent = buildTestSpecForPlatform(iteration, now, features, apis, platform, platformContents);
    await writeFile(join(platformDir, 'TEST.md'), testContent);

    // UI_SPEC.md — 该端 UI 规格（仅前端）
    if (!isBackendPlatform(platform)) {
      const uiContent = buildUISpecForPlatform(iteration, now, uiPatterns, platform, platformContents);
      await writeFile(join(platformDir, 'UI_SPEC.md'), uiContent);
    }
  }

  // 4. 写入全局文件（覆盖空模板，不覆盖已有实质内容的文件）
  let withContent = 0;
  let skipped = 0;
  await ensureDir(specDir);
  for (const f of files) {
    const filePath = join(specDir, f.filename);
    // 如果文件已存在且有实质内容（>50 非模板字符），跳过
    if (await pathExists(filePath)) {
      const existing = await readFile(filePath, 'utf-8');
      const meaningful = stripTemplateNoise(existing);
      if (meaningful.length > 50) {
        skipped++;
        continue;
      }
    }
    await writeFile(filePath, f.content);
    withContent++;
  }

  return {
    files,
    summary: { total: files.length + platforms.length * 3, withContent, skipped },
  };
}

// ── 信息提取工具函数 ──

function extractApis(content: string): { method: string; path: string; desc: string }[] {
  const apis: { method: string; path: string; desc: string }[] = [];
  // 从表格中提取: | GET | /api/xxx | 说明 |
  const tableRegex = /\|\s*(GET|POST|PUT|DELETE|PATCH|get|post|put|delete|patch)\s*\|\s*(\/[^\s|]+)\s*\|\s*([^|\n]*)\|/g;
  let m: RegExpExecArray | null;
  while ((m = tableRegex.exec(content)) !== null) {
    apis.push({ method: m[1].toUpperCase(), path: m[2].trim(), desc: m[3].trim() });
  }
  // 从行内提取: POST /api/xxx
  const inlineRegex = /(GET|POST|PUT|DELETE|PATCH)\s+(\/api\/[^\s,，。]+)/gi;
  while ((m = inlineRegex.exec(content)) !== null) {
    const path = m[2].trim();
    if (!apis.some(a => a.path === path)) {
      apis.push({ method: m[1].toUpperCase(), path, desc: '' });
    }
  }
  // 去重
  const seen = new Set<string>();
  return apis.filter(a => {
    const key = `${a.method}:${a.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractFeatures(content: string): { name: string; desc: string }[] {
  const features: { name: string; desc: string }[] = [];
  // 从 ## / ### 标题提取功能模块
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^#{2,3}\s+(.+)$/);
    if (headingMatch) {
      const name = headingMatch[1].trim();
      // 跳过通用标题
      if (/^(需求|功能|接口|附录|目录|概述|背景|目标|范围|非功能)/.test(name)) continue;
      if (/^(测试|评审|风险|依赖|监控|技术)/.test(name)) continue;
      // 取后续 1-2 行作为描述
      let desc = '';
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        if (lines[j].match(/^#/)) break;
        if (lines[j].trim()) desc += lines[j].trim() + ' ';
      }
      if (name.length > 1 && name.length < 30) {
        features.push({ name, desc: desc.slice(0, 100).trim() });
      }
    }
  }
  // 去重（按名称）
  const seen = new Set<string>();
  return features.filter(f => {
    if (seen.has(f.name)) return false;
    seen.add(f.name);
    return true;
  }).slice(0, 20); // 最多 20 个功能模块
}

function extractDataModels(content: string): { table: string; fields: string; desc: string }[] {
  const models: { table: string; fields: string; desc: string }[] = [];
  // 检测数据表关键词
  const tablePatterns = [
    /(?:表名|数据表|实体|模型)[：:]\s*(\w+)/gi,
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)/gi,
    /(?:user|order|product|item|payment|auth|log|config|setting)s?\b/gi,
  ];
  const tables = new Set<string>();
  for (const pattern of tablePatterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      tables.add(m[1] || m[0]);
    }
  }
  for (const t of tables) {
    models.push({ table: t, fields: '—', desc: '从需求推导' });
  }
  return models.slice(0, 15);
}

function extractBusinessRules(content: string): string[] {
  const rules: string[] = [];
  // 匹配 R-XX 格式的业务规则编号
  const ruleRegex = /R-\d{2,4}[-.]?\d{0,2}[：:]*\s*(.+)/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRegex.exec(content)) !== null) {
    rules.push(m[1].trim());
  }
  // 匹配「必须」「不允许」「应当」等规则描述
  const mustRegex = /(?:必须|不允许|应当|不能|需要|确保)\s*(.{5,60})/g;
  while ((m = mustRegex.exec(content)) !== null) {
    const rule = m[1].trim().replace(/[。，,.]+$/, '');
    if (rule.length > 5 && !rules.some(r => r.includes(rule))) {
      rules.push(rule);
    }
  }
  return rules.slice(0, 15);
}

// ── 辅助函数：判断是否为后端平台 ──
function isBackendPlatform(platform: string): boolean {
  if (_detectedBackendPlatforms.includes(platform)) return true;
  return platform === 'backend' || platform.startsWith('后台') || platform.includes('服务');
}

function stripTemplateNoise(content: string): string {
  // 移除模板占位符后计算有效内容长度
  return content
    .replace(/_待填充_|_待补充_|_待 AI 分析_|_待定_|_待导入_/g, '')
    .replace(/\|\s*:---[\s|:-]*\|/g, '')  // 表格分隔行
    .replace(/\|\s*\|\s*\|/g, '')          // 空表格行
    .replace(/^#+\s.*$/gm, '')             // 标题行
    .replace(/^>.*$/gm, '')                // 引用行
    .replace(/\s/g, '')
    .trim();
}

// ── Spec 文件内容构建器 ──

function buildRequirementSpec(
  iter: string, now: string,
  features: { name: string; desc: string }[],
  apis: { method: string; path: string; desc: string }[],
  models: { table: string; fields: string; desc: string }[],
  rules: string[],
): string {
  let md = `# 需求规格说明书\n\n> 迭代: ${iter} | 生成: ${now} | 由 analyze --auto 自动提取\n\n`;
  md += `## 1. 功能模块清单\n\n`;
  if (features.length > 0) {
    md += `| # | 功能模块 | 描述 | 涉及端 |\n| :--- | :--- | :--- | :--- |\n`;
    features.forEach((f, i) => { md += `| ${i + 1} | ${f.name} | ${f.desc || '—'} | _待 AI 标注_ |\n`; });
    md += `\n> 💡 **涉及端说明**：请 AI 或人工为每个功能模块标注涉及的端（如 admin、h5、backend），split 命令将据此生成对应端的子任务。\n`;
  } else {
    md += `_需求文档中未检测到明确的功能模块标题，建议补充功能章节。_\n`;
  }
  md += `\n## 2. 接口清单\n\n`;
  if (apis.length > 0) {
    md += `| 方法 | 路径 | 说明 |\n| :--- | :--- | :--- |\n`;
    apis.forEach(a => { md += `| ${a.method} | \`${a.path}\` | ${a.desc || '—'} |\n`; });
  } else {
    md += `_需求文档中未检测到接口定义，建议补充 API 规格。_\n`;
  }
  md += `\n## 3. 数据模型\n\n`;
  if (models.length > 0) {
    md += `| 实体/表 | 关键字段 | 说明 |\n| :--- | :--- | :--- |\n`;
    models.forEach(m => { md += `| ${m.table} | ${m.fields} | ${m.desc} |\n`; });
  } else {
    md += `_需求文档中未检测到数据模型描述。_\n`;
  }
  md += `\n## 4. 业务规则\n\n`;
  if (rules.length > 0) {
    rules.forEach((r, i) => { md += `${i + 1}. ${r}\n`; });
  } else {
    md += `_需求文档中未检测到明确业务规则。_\n`;
  }
  return md;
}

function buildTechSpec(
  iter: string, now: string,
  apis: { method: string; path: string; desc: string }[],
  models: { table: string; fields: string; desc: string }[],
  archImpact: ArchImpact,
  platforms: string[],
  features: { name: string; desc: string }[],
  uiPatterns: ReturnType<typeof extractUIPatterns>,
): string {
  let md = `# 技术方案\n\n> 迭代: ${iter} | 生成: ${now} | 由 analyze --auto 自动提取\n\n`;
  // 架构
  md += `## 1. 整体架构\n\n`;
  md += `基于需求分析，系统涉及以下端: ${platforms.join('、') || '未配置'}\n\n`;
  if (archImpact.modules.length > 0) {
    md += `**架构影响**: ${archImpact.modules.join('; ')}\n\n`;
  }
  // API 设计
  md += `## 2. API 设计\n\n`;
  if (apis.length > 0) {
    md += `| 方法 | 路径 | 说明 | 所属模块 |\n| :--- | :--- | :--- | :--- |\n`;
    apis.forEach(a => {
      const mod = guessModule(a.path, features);
      md += `| ${a.method} | \`${a.path}\` | ${a.desc || '—'} | ${mod} |\n`;
    });
  } else {
    md += `_未检测到 API 定义，需根据需求补充。_\n`;
  }
  // 数据库
  md += `\n## 3. 数据库设计\n\n`;
  if (models.length > 0) {
    md += `| 表名 | 说明 |\n| :--- | :--- |\n`;
    models.forEach(m => { md += `| \`${m.table}\` | ${m.desc} |\n`; });
    md += `\n> 💡 详细字段设计需在开发阶段补充 DDL。\n`;
  } else {
    md += `_需求中未检测到数据模型，需根据功能需求推导。_\n`;
  }
  // 中间件
  if (archImpact.newDependencies.length > 0) {
    md += `\n## 4. 中间件与外部依赖\n\n`;
    md += `| 依赖 | 用途 |\n| :--- | :--- |\n`;
    archImpact.newDependencies.forEach(d => { md += `| ${d} | 需求文档提及 |\n`; });
  }
  // 前端 UI 规格
  if (uiPatterns.pages.length > 0 || uiPatterns.components.length > 0) {
    md += `\n## 5. 前端 UI 规格\n\n`;
    md += `### 5.1 页面结构\n\n`;
    if (uiPatterns.pages.length > 0) {
      md += `| 页面 | 路由 | 描述 |\n| :--- | :--- | :--- |\n`;
      uiPatterns.pages.forEach(p => { md += `| ${p.name} | \`${p.route}\` | ${p.desc} |\n`; });
    } else {
      md += `_待补充_\n`;
    }
    md += `\n### 5.2 组件清单\n\n`;
    if (uiPatterns.components.length > 0) {
      md += `| 组件 | 类型 | 所属页面 |\n| :--- | :--- | :--- |\n`;
      uiPatterns.components.forEach(c => { md += `| ${c.name} | ${c.type} | ${c.page} |\n`; });
    } else {
      md += `_待补充_\n`;
    }
    md += `\n### 5.3 字段→UI 映射\n\n`;
    if (uiPatterns.formFields.length > 0) {
      md += `| 页面/表单 | 字段 |\n| :--- | :--- |\n`;
      uiPatterns.formFields.forEach(f => { md += `| ${f.page} | ${f.fields.join(', ')} |\n`; });
    } else {
      md += `_待补充_\n`;
    }
    md += `\n### 5.4 状态枚举\n\n`;
    if (uiPatterns.statusEnums.length > 0) {
      md += `| 字段 | 值 | 含义 |\n| :--- | :--- | :--- |\n`;
      uiPatterns.statusEnums.forEach(s => {
        md += `| ${s.field} | ${s.values.join(' / ')} | ${s.labels.join(' / ')} |\n`;
      });
    } else {
      md += `_待补充_\n`;
    }
  }
  return md;
}

// ── 按端专属文档构建器 ──

/**
 * 生成指定端的技术方案（该端专属内容）
 */
function buildTechSpecForPlatform(
  iter: string, now: string,
  apis: { method: string; path: string; desc: string }[],
  models: { table: string; fields: string; desc: string }[],
  archImpact: ArchImpact,
  platform: string,
  features: { name: string; desc: string }[],
  uiPatterns: ReturnType<typeof extractUIPatterns>,
  platformContents: Record<string, string>, // 【新增】按端分割的需求内容
): string {
  let md = `# ${platform} 端技术方案\n\n> 迭代: ${iter} | 端: ${platform} | 生成: ${now}\n\n`;

  if (isBackendPlatform(platform)) {
    // 后端专属内容
    md += `## 1. 接口设计\n\n`;
    const backendApis = apis.filter(a => !a.path.startsWith('/h5') && !a.path.startsWith('/admin'));
    if (backendApis.length > 0) {
      md += `| 方法 | 路径 | 说明 |\n| :--- | :--- | :--- |\n`;
      backendApis.forEach(a => { md += `| ${a.method} | \`${a.path}\` | ${a.desc || '—'} |\n`; });
    } else {
      md += `_未检测到后端 API，需根据需求补充。_\n`;
    }

    md += `\n## 2. 数据模型\n\n`;
    if (models.length > 0) {
      md += `| 表名 | 字段 | 说明 |\n| :--- | :--- | :--- |\n`;
      models.forEach(m => { md += `| \`${m.table}\` | ${m.fields || '待补充'} | ${m.desc} |\n`; });
    } else {
      md += `_需求中未检测到数据模型，需根据功能需求推导。_\n`;
    }

    md += `\n## 3. 业务逻辑\n\n`;
    md += `_待 AI 分析各功能的实现细节、事务约束、异常处理。_\n`;

  } else {
    // 前端专属内容
    md += `## 1. 页面结构\n\n`;
    const platformPages = uiPatterns.pages.filter(p => p.route.includes(`/${platform}`) || p.name.includes(platform));
    
    // 【v6.40.1 修复】优先从 platformContents 中提取页面
    const platformContent = platformContents[platform] || '';
    const inferredPages = extractPagesFromPlatformContent(platformContent, platform);
    
    if (platformPages.length > 0) {
      md += `| 页面 | 路由 | 描述 |\n| :--- | :--- | :--- |\n`;
      platformPages.forEach(p => { md += `| ${p.name} | \`${p.route}\` | ${p.desc} |\n`; });
    } else if (inferredPages.length > 0) {
      // 【新增】从端专属内容中提取的页面
      md += `> 💡 **AI 智能提取**（基于需求文档中的「${platform} 端需求」章节）\n\n`;
      md += `| 页面 | 路由 | 描述 |\n| :--- | :--- | :--- |\n`;
      inferredPages.forEach(p => { md += `| ${p.name} | \`${p.route}\` | ${p.desc} |\n`; });
    } else {
      // 【增强】添加智能填充提示
      md += `_待补充：从需求中提取 ${platform} 端的页面清单。_\n`;
      md += `\n> 💡 **如何填充**：\n`;
      md += `> 1. 运行 \`speccore ask "为 ${platform} 端补充页面结构和组件设计"\`\n`;
      md += `> 2. AI 会读取 010-requirements/ 中「${platform} 端需求」章节，自动提取页面清单\n`;
      md += `> 3. 或手动编辑此文件，参考需求文档中的功能描述\n`;
    }

    md += `\n## 2. 组件设计\n\n`;
    const platformComponents = uiPatterns.components.filter(c => c.page.includes(platform) || c.type.includes(platform));
    if (platformComponents.length > 0) {
      md += `| 组件 | 类型 | 所属页面 |\n| :--- | :--- | :--- |\n`;
      platformComponents.forEach(c => { md += `| ${c.name} | ${c.type} | ${c.page} |\n`; });
    } else {
      md += `_待补充：从需求中提取 ${platform} 端的组件清单。_\n`;
    }

    md += `\n## 3. 状态管理\n\n`;
    md += `_待 AI 分析 ${platform} 端的状态管理方案（Pinia/Redux/Context 等）。_\n`;

    md += `\n## 4. 交互设计\n\n`;
    if (platform === 'h5' || platform === 'miniapp') {
      md += `- 触摸交互优化\n- 弱网环境适配\n- 响应式布局\n`;
    } else if (platform === 'admin') {
      md += `- 表格/表单交互规范\n- 权限控制\n- 批量操作\n`;
    } else {
      md += `_待补充 ${platform} 端特有的交互要求。_\n`;
    }
  }

  return md;
}

/**
 * 生成指定端的测试计划（该端专属内容）
 */
function buildTestSpecForPlatform(
  iter: string, now: string,
  features: { name: string; desc: string }[],
  apis: { method: string; path: string; desc: string }[],
  platform: string,
  platformContents: Record<string, string> = {},
): string {
  let md = `# ${platform} 端测试计划\n\n> 迭代: ${iter} | 端: ${platform} | 生成: ${now}\n\n`;
  const platformContent = platformContents[platform] || '';

  if (isBackendPlatform(platform)) {
    md += `## 1. 接口测试\n\n`;
    const backendApis = apis.filter(a => !a.path.startsWith('/h5') && !a.path.startsWith('/admin'));
    if (backendApis.length > 0) {
      backendApis.forEach(a => {
        md += `- [ ] ${a.method} ${a.path}: ${a.desc || '验证接口功能'}\n`;
      });
    } else {
      md += `_待补充：根据需求编写接口测试用例。_\n`;
    }

    md += `\n## 2. 性能测试\n\n`;
    md += `- QPS 目标：待补充\n- 响应时间 P99：待补充\n- 并发用户数：待补充\n`;

  } else {
    // 【v6.40.1】从端专属内容中提取测试场景
    const platformFeatures = extractFeaturesFromPlatformContent(platformContent, platform);
    
    md += `## 1. 页面流转测试\n\n`;
    if (platformFeatures.length > 0) {
      md += `> 💡 **AI 智能提取**（基于需求文档中的端专属章节）\n\n`;
      for (const pf of platformFeatures) {
        md += `- [ ] **${pf.name}**：${pf.desc}\n`;
      }
    } else {
      md += `_待 AI 分析 ${platform} 端的页面跳转流程、入口校验、权限拦截。_\n`;
    }

    md += `\n## 2. 交互测试\n\n`;
    if (platform === 'h5' || platform === 'miniapp') {
      md += `- 触摸手势识别\n- 下拉刷新/上拉加载\n- 键盘弹出适配\n`;
    } else if (platform === 'admin') {
      md += `- 表格排序/筛选/分页\n- 表单校验提示\n- 批量操作确认\n`;
    }

    md += `\n## 3. 四态测试\n\n`;
    md += `- 空状态（无数据时展示）\n- 加载中状态\n- 错误状态（网络异常/超时）\n- 成功状态\n`;
  }

  return md;
}

/**
 * 生成指定端的 UI 规格（仅前端）
 */
function buildUISpecForPlatform(
  iter: string, now: string,
  uiPatterns: ReturnType<typeof extractUIPatterns>,
  platform: string,
  platformContents: Record<string, string> = {},
): string {
  let md = `# ${platform} 端 UI 规格\n\n> 迭代: ${iter} | 端: ${platform} | 生成: ${now}\n\n`;
  const platformContent = platformContents[platform] || '';

  // 【v6.40.1】从端专属内容中提取页面和组件
  const inferredPages = extractPagesFromPlatformContent(platformContent, platform);
  
  md += `## 1. 路由表\n\n`;
  const platformPages = uiPatterns.pages.filter(p => p.route.includes(`/${platform}`) || p.name.includes(platform));
  if (platformPages.length > 0) {
    md += `| 页面 | 路由 | 入口 | 权限 |\n| :--- | :--- | :--- | :--- |\n`;
    platformPages.forEach(p => { md += `| ${p.name} | \`${p.route}\` | 待补充 | 待补充 |\n`; });
  } else if (inferredPages.length > 0) {
    md += `> 💡 **AI 智能提取**（基于需求文档中的端专属章节）\n\n`;
    md += `| 页面 | 路由 | 描述 |\n| :--- | :--- | :--- |\n`;
    inferredPages.forEach(p => { md += `| ${p.name} | \`${p.route}\` | ${p.desc} |\n`; });
  } else {
    md += `_待补充：从需求中提取 ${platform} 端的路由配置。_\n`;
  }

  md += `\n## 2. 组件清单\n\n`;
  const platformComponents = uiPatterns.components.filter(c => c.page.includes(platform) || c.type.includes(platform));
  if (platformComponents.length > 0) {
    md += `| 组件 | 类型 | 复用性 |\n| :--- | :--- | :--- |\n`;
    platformComponents.forEach(c => { md += `| ${c.name} | ${c.type} | 高/中/低 |\n`; });
  } else {
    // 【v6.40.1】从端内容中提取页面要素作为组件
    const componentList = extractComponentsFromPlatformContent(platformContent);
    if (componentList.length > 0) {
      md += `> 💡 **AI 智能提取**\n\n`;
      md += `| 组件 | 类型 | 所属页面 |\n| :--- | :--- | :--- |\n`;
      componentList.forEach((c: { name: string; type: string; page: string }) => { md += `| ${c.name} | ${c.type} | ${c.page} |\n`; });
    } else {
      md += `_待补充：从需求中提取 ${platform} 端的组件清单。_\n`;
    }
  }

  md += `\n## 3. 字段→UI 映射\n\n`;
  const platformFields = uiPatterns.formFields.filter(f => f.page.includes(platform));
  if (platformFields.length > 0) {
    md += `| 页面/表单 | 字段 | UI 组件 |\n| :--- | :--- | :--- |\n`;
    platformFields.forEach(f => { md += `| ${f.page} | ${f.fields.join(', ')} | Input/Select/DatePicker |\n`; });
  } else {
    md += `_待补充：从需求中提取 ${platform} 端的字段与 UI 映射关系。_\n`;
  }

  md += `\n## 4. 状态枚举\n\n`;
  if (uiPatterns.statusEnums.length > 0) {
    md += `| 字段 | 值 | 含义 |\n| :--- | :--- | :--- |\n`;
    uiPatterns.statusEnums.forEach(s => {
      md += `| ${s.field} | ${s.values.join(' / ')} | ${s.labels.join(' / ')} |\n`;
    });
  } else {
    // 【v6.40.1】从端内容中提取状态枚举
    const statusEnums = extractStatusEnumsFromContent(platformContent);
    if (statusEnums.length > 0) {
      md += `> 💡 **AI 智能提取**\n\n`;
      md += `| 字段 | 值 | 含义 |\n| :--- | :--- | :--- |\n`;
      statusEnums.forEach((s: { field: string; values: string[]; labels: string[] }) => { md += `| ${s.field} | ${s.values.join(' / ')} | ${s.labels.join(' / ')} |\n`; });
    } else {
      md += `_待补充：前后端共享的状态值定义。_\n`;
    }
  }

  return md;
}

// ─ UI 规格提取与构建 ──

function extractUIPatterns(content: string): {
  pages: { name: string; route: string; desc: string }[];
  components: { name: string; type: string; page: string }[];
  formFields: { page: string; fields: string[] }[];
  statusEnums: { field: string; values: string[]; labels: string[] }[];
} {
  const pages: { name: string; route: string; desc: string }[] = [];
  const components: { name: string; type: string; page: string }[] = [];
  const formFields: { page: string; fields: string[] }[] = [];
  const statusEnums: { field: string; values: string[]; labels: string[] }[] = [];

  // 1. 提取页面：匹配「XX页面」「XX界面」
  const pageRegex = /(?:^|\n)#{1,4}\s+(.+?(?:页面|界面|首页|列表|详情|设置|登录|注册))/g;
  let m: RegExpExecArray | null;
  const pageNames = new Set<string>();
  while ((m = pageRegex.exec(content)) !== null) {
    const name = m[1].trim().replace(/^#+\s*/, '');
    if (!pageNames.has(name) && name.length >= 2 && name.length < 30) {
      pageNames.add(name);
      const routeGuess = '/' + name.replace(/页面|界面/g, '').toLowerCase().replace(/\s+/g, '-');
      // 取后续 2 行作为描述
      const after = content.slice(m.index + m[0].length, m.index + m[0].length + 200);
      const descLines = after.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 2);
      pages.push({ name, route: routeGuess, desc: descLines.join(' ').slice(0, 80) || '—' });
    }
  }
  // 从路由定义补充页面
  const routeRegex = /(?:路由|路径|route)[：:]\s*(\/\S+)/gi;
  while ((m = routeRegex.exec(content)) !== null) {
    const route = m[1].trim();
    const before = content.slice(Math.max(0, m.index - 100), m.index);
    const nameMatch = before.match(/[#*\-]\s*(.+?)(?:\n|$)/);
    if (nameMatch) {
      const name = nameMatch[1].trim().replace(/[`*]/g, '');
      if (!pages.some(p => p.route === route) && name.length >= 2 && name.length < 30) {
        pages.push({ name, route, desc: '从路由定义提取' });
      }
    }
  }

  // 2. 提取组件：从 UI 关键词推断
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 列表/表格组件
    if (/列表|清单|记录/.test(line) && !/待补充|待填充/.test(line)) {
      const heading = findNearestHeading(lines, i);
      if (heading && !components.some(c => c.name === heading + '列表')) {
        components.push({ name: heading + '列表', type: 'Table/List', page: heading });
      }
    }
    // 表单组件
    if (/表单|表单页|填写|录入|新建|创建.*页|编辑.*页/.test(line) && !/待补充|待填充/.test(line)) {
      const heading = findNearestHeading(lines, i);
      if (heading && !components.some(c => c.name.includes('表单'))) {
        components.push({ name: heading + '表单', type: 'Form', page: heading });
      }
    }
    // 详情组件
    if (/详情页|详情展示|查看.*详情/.test(line) && !/待补充|待填充/.test(line)) {
      const heading = findNearestHeading(lines, i);
      if (heading && !components.some(c => c.name.includes('详情'))) {
        components.push({ name: heading + '详情', type: 'Detail', page: heading });
      }
    }
    // Dashboard/仪表盘
    if (/仪表盘|Dashboard|看板|数据大屏|统计概览/.test(line)) {
      if (!components.some(c => c.type === 'Dashboard')) {
        components.push({ name: '仪表盘', type: 'Dashboard', page: '首页' });
      }
    }
  }

  // 3. 提取表单字段：匹配「字段：」「字段:」模式
  const formLabels = /(?:字段|参数|输入项|表项|属性)[：:]\s*(.+)/g;
  while ((m = formLabels.exec(content)) !== null) {
    const fieldsStr = m[1];
    const fields = fieldsStr.split(/[,，、;；\s]+/).filter(f => f.length >= 1 && f.length < 20);
    if (fields.length > 0) {
      const heading = findNearestHeading(lines, content.slice(0, m.index).split('\n').length - 1);
      formFields.push({ page: heading || '通用', fields: fields.slice(0, 10) });
    }
  }

  // 4. 提取状态枚举：匹配「status = 0:xxx, 1:yyy」或「状态：0=xxx 1=yyy」
  const statusRegex = /(?:status|状态|type|类型)\s*[：:]\s*(.+)/gi;
  while ((m = statusRegex.exec(content)) !== null) {
    const defs = m[1];
    const valueMatches = defs.matchAll(/(\d+)\s*[=:：]\s*([^,，;；\d]+)/g);
    const values: string[] = [];
    const labels: string[] = [];
    for (const vm of valueMatches) {
      values.push(vm[1]);
      labels.push(vm[2].trim());
    }
    if (values.length >= 2) {
      statusEnums.push({ field: m[0].split(/[：:]/)[0].trim(), values, labels });
    }
  }

  return {
    pages: pages.slice(0, 15),
    components: components.slice(0, 20),
    formFields: formFields.slice(0, 10),
    statusEnums: statusEnums.slice(0, 10),
  };
}

function findNearestHeading(lines: string[], lineIndex: number): string | null {
  for (let i = lineIndex; i >= Math.max(0, lineIndex - 8); i--) {
    const headingMatch = lines[i].match(/^#{1,4}\s+(.+)$/);
    if (headingMatch) {
      const name = headingMatch[1].trim();
      if (name.length >= 2 && name.length < 30) return name;
    }
  }
  return null;
}

function buildUISpec(
  iter: string, now: string,
  uiPatterns: {
    pages: { name: string; route: string; desc: string }[];
    components: { name: string; type: string; page: string }[];
    formFields: { page: string; fields: string[] }[];
    statusEnums: { field: string; values: string[]; labels: string[] }[];
  },
): string {
  let md = `# 前端 UI 规格\n\n> 迭代: ${iter} | 生成: ${now} | 由 analyze --auto 自动提取\n\n`;

  // 1. 页面结构
  md += `## 1. 页面结构\n\n`;
  if (uiPatterns.pages.length > 0) {
    md += `| # | 页面 | 路由 | 描述 |\n| :--- | :--- | :--- | :--- |\n`;
    uiPatterns.pages.forEach((p, i) => {
      md += `| ${i + 1} | ${p.name} | \`${p.route}\` | ${p.desc} |\n`;
    });
  } else {
    md += `_需求文档中未检测到页面定义，建议补充页面清单。_\n`;
  }

  // 2. 组件清单
  md += `\n## 2. 组件清单\n\n`;
  if (uiPatterns.components.length > 0) {
    md += `| 组件 | 类型 | 所属页面 |\n| :--- | :--- | :--- |\n`;
    uiPatterns.components.forEach(c => {
      md += `| ${c.name} | ${c.type} | ${c.page} |\n`;
    });
  } else {
    md += `_需求文档中未检测到 UI 组件，建议根据页面功能补充。_\n`;
  }

  // 3. 字段→UI 映射
  md += `\n## 3. 字段→UI 映射\n\n`;
  if (uiPatterns.formFields.length > 0) {
    md += `| 页面/表单 | 字段列表 |\n| :--- | :--- |\n`;
    uiPatterns.formFields.forEach(f => {
      md += `| ${f.page} | ${f.fields.join(', ')} |\n`;
    });
  } else {
    md += `_需求文档中未检测到表单字段定义，建议补充各页面字段映射。_\n`;
  }

  // 4. 状态枚举
  md += `\n## 4. 状态枚举\n\n`;
  if (uiPatterns.statusEnums.length > 0) {
    md += `| 字段 | 值→含义 |\n| :--- | :--- |\n`;
    uiPatterns.statusEnums.forEach(s => {
      const mapping = s.values.map((v, i) => `${v}=${s.labels[i]}`).join('; ');
      md += `| ${s.field} | ${mapping} |\n`;
    });
  } else {
    md += `_需求文档中未检测到状态枚举定义，建议补充前后端共享的状态值。_\n`;
  }

  return md;
}

function buildTestSpec(
  iter: string, now: string,
  features: { name: string; desc: string }[],
  apis: { method: string; path: string; desc: string }[],
): string {
  let md = `# 测试计划\n\n> 迭代: ${iter} | 生成: ${now} | 由 analyze --auto 自动提取\n\n`;
  // 单元测试
  md += `## 1. 单元测试\n\n`;
  if (features.length > 0) {
    features.forEach(f => {
      md += `- [ ] ${f.name}: 核心逻辑覆盖\n`;
    });
  } else {
    md += `- [ ] 核心模块覆盖\n`;
  }
  // 接口测试
  md += `\n## 2. 接口测试\n\n`;
  if (apis.length > 0) {
    md += `| 接口 | 测试场景 | 预期结果 |\n| :--- | :--- | :--- |\n`;
    apis.forEach(a => {
      md += `| \`${a.method} ${a.path}\` | 正常请求 | 200 响应 |\n`;
      md += `| \`${a.method} ${a.path}\` | 缺少必填参数 | 400 错误 |\n`;
    });
  } else {
    md += `_未检测到接口定义，需补充接口测试用例。_\n`;
  }
  // E2E
  md += `\n## 3. E2E 端到端测试\n\n`;
  if (features.length >= 2) {
    md += `- [ ] 核心业务流程: ${features.slice(0, 3).map(f => f.name).join(' → ')}\n`;
  }
  md += `- [ ] 异常流程: 网络超时、并发冲突、权限不足\n`;
  // 性能
  md += `\n## 4. 性能测试\n\n`;
  md += `- [ ] 接口响应时间 < 500ms (P99)\n`;
  md += `- [ ] 并发用户数 ≥ 100\n`;
  return md;
}

function buildReviewSpec(
  iter: string, now: string,
  apis: { method: string; path: string; desc: string }[],
  archImpact: ArchImpact,
): string {
  let md = `# 评审检查清单\n\n> 迭代: ${iter} | 生成: ${now} | 由 analyze --auto 自动提取\n\n`;
  md += `## 安全\n\n`;
  apis.forEach(a => {
    const authCheck = a.method === 'POST' || a.method === 'PUT' || a.method === 'DELETE' ? '鉴权 + 参数校验' : '鉴权检查';
    md += `- [ ] \`${a.path}\` — ${authCheck}\n`;
  });
  if (apis.length === 0) md += `- [ ] 接口鉴权完整性\n`;
  md += `\n## 质量\n\n`;
  md += `- [ ] 幂等性处理（POST/PUT 接口）\n`;
  md += `- [ ] 事务一致性（涉及多表操作）\n`;
  md += `- [ ] 错误处理与友好提示\n`;
  md += `- [ ] 日志规范（关键操作记录）\n`;
  if (archImpact.risks.length > 0) {
    md += `\n## 风险相关\n\n`;
    archImpact.risks.forEach(r => { md += `- [ ] ${r}\n`; });
  }
  return md;
}

function buildRiskSpec(iter: string, now: string, archImpact: ArchImpact): string {
  let md = `# 风险评估\n\n> 迭代: ${iter} | 生成: ${now} | 由 analyze --auto 自动提取\n\n`;
  md += `## 风险矩阵\n\n`;
  if (archImpact.risks.length > 0) {
    md += `| 风险 | 可能性 | 影响 | 缓解措施 |\n| :--- | :--- | :--- | :--- |\n`;
    archImpact.risks.forEach(r => {
      md += `| ${r} | 中 | 中 | 需评审确认 |\n`;
    });
  } else {
    md += `_从需求中未检测到明显风险项，建议在评审中确认。_\n`;
  }
  md += `\n## 回滚方案\n\n`;
  md += `1. 触发条件: 核心接口错误率 > 5% 或数据不一致\n`;
  md += `2. 回滚步骤: 回退至上一稳定版本镜像 + 数据库回滚脚本\n`;
  md += `3. 验证方式: 冒烟测试通过 + 监控指标恢复正常\n`;
  return md;
}

function buildDepsSpec(iter: string, now: string, archImpact: ArchImpact): string {
  let md = `# 依赖清单\n\n> 迭代: ${iter} | 生成: ${now} | 由 analyze --auto 自动提取\n\n`;
  md += `## 上游依赖\n\n`;
  if (archImpact.newDependencies.length > 0) {
    md += `| 服务 | 用途 | 备注 |\n| :--- | :--- | :--- |\n`;
    archImpact.newDependencies.forEach(d => { md += `| ${d} | 需求文档提及 | 需确认版本和 SLA |\n`; });
  } else {
    md += `_从需求中未检测到外部依赖，需评审确认。_\n`;
  }
  md += `\n## 下游影响\n\n`;
  md += `_需根据 API 变更评估下游消费方影响。_\n`;
  return md;
}

function buildMonitorSpec(
  iter: string, now: string,
  apis: { method: string; path: string; desc: string }[],
  features: { name: string; desc: string }[],
): string {
  let md = `# 监控指标\n\n> 迭代: ${iter} | 生成: ${now} | 由 analyze --auto 自动提取\n\n`;
  md += `## 业务指标\n\n`;
  md += `| 指标 | 阈值 | 级别 |\n| :--- | :--- | :--- |\n`;
  md += `| 接口成功率 | < 99.9% | P1 |\n`;
  md += `| P99 延迟 | > 1000ms | P2 |\n`;
  if (features.length > 0) {
    md += `| 核心功能可用率 | < 99.5% | P1 |\n`;
  }
  md += `\n## 告警规则\n\n`;
  md += `| 规则 | 条件 | 通知 |\n| :--- | :--- | :--- |\n`;
  md += `| 接口错误率突增 | 5 分钟内错误率 > 1% | 企微/钉钉 |\n`;
  md += `| 响应时间劣化 | P99 > 2s 持续 3 分钟 | 企微/钉钉 |\n`;
  if (apis.length > 0) {
    md += `| 关键接口异常 | \`${apis[0].path}\` 连续失败 3 次 | 电话告警 |\n`;
  }
  return md;
}

function guessModule(apiPath: string, features: { name: string; desc: string }[]): string {
  // 简单启发式：API 路径关键词匹配功能模块
  const segments = apiPath.split('/').filter(Boolean);
  for (const f of features) {
    const nameLower = f.name.toLowerCase();
    for (const seg of segments) {
      if (nameLower.includes(seg.toLowerCase()) || seg.toLowerCase().includes(nameLower.slice(0, 4))) {
        return f.name;
      }
    }
  }
  return segments[1] || '—';
}

// ============================================================
// 【新增】按端分割需求内容
// ============================================================

/**
 * 将需求文档按端分割，提取每个端的专属内容
 * @param fullContent 完整的需求文档内容
 * @param platforms CONSTITUTION.md 定义的端列表
 * @returns Record<platform, content> 每个端的专属内容
 */
function splitContentByPlatform(
  fullContent: string,
  platforms: string[]
): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = fullContent.split('\n');
  
  // 1. 识别端标题的正则模式（支持多种写法 + 语义映射别名）
  const platformPatterns = platforms.map(p => {
    // 收集该端的所有别名（从 PLATFORM_ALIAS_MAP）
    const aliases = PLATFORM_ALIAS_MAP[p] || [p];
    const allNames = [p, p.toUpperCase(), p.charAt(0).toUpperCase() + p.slice(1), ...aliases];
    // 去重并转义正则特殊字符
    const uniqueNames = [...new Set(allNames)].map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const namesPattern = uniqueNames.join('|');
    return {
      platform: p,
      regex: new RegExp(`^#{1,4}\\s*.*?(?:${namesPattern}).*?(?:端|需求|$|管理|后台)`, 'i')
    };
  });
  
  // 2. 扫描文档，找到每个端的起始位置
  const platformStartLines: Record<string, number> = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { platform, regex } of platformPatterns) {
      if (regex.test(line) && !(platform in platformStartLines)) {
        platformStartLines[platform] = i;
      }
    }
  }
  
  // 3. 提取每个端的内容（从该端标题到下一个端标题之前）
  for (const platform of platforms) {
    if (!(platform in platformStartLines)) continue;
    
    const startLine = platformStartLines[platform];
    let endLine = lines.length; // 默认到文档末尾
    
    // 查找下一个端的起始位置
    for (const [otherPlatform, otherStart] of Object.entries(platformStartLines)) {
      if (otherPlatform !== platform && otherStart > startLine) {
        endLine = Math.min(endLine, otherStart);
      }
    }
    
    // 提取内容并去除 Markdown 标题标记
    const content = lines.slice(startLine, endLine).join('\n');
    result[platform] = content;
  }
  
  return result;
}

// ============================================================
// 【新增】从文件路径或内容推断所属的端
// ============================================================

/**
 * 端名语义映射表：将各种写法映射到标准端名
 * 支持：中文端名、英文缩写、混合写法等
 */
const PLATFORM_ALIAS_MAP: Record<string, string[]> = {
  // H5 移动端
  'h5': ['h5', 'h5移动端', 'h5移动', 'mobile', '移动端', '手机浏览器', 'web mobile'],
  // Admin 后台管理
  'admin': ['admin', '后台管理端', '后台', '管理端', 'web', 'pc', '桌面端', '管理后台', 'dashboard'],
  // App 客户端
  'app': ['app', '客户端', 'ios', 'android', 'native', '原生', '移动端app', '手机app'],
  // 小程序
  'miniapp': ['miniapp', '小程序', '微信小程序', '支付宝小程序', 'miniprogram'],
  // 后端服务
  'backend': ['backend', '后端', '服务', 'api', 'server', '服务端', '微服务']
};

/**
 * 根据文件路径或内容推断该文档属于哪个端
 * @param filePath 文件路径
 * @param content 文件内容
 * @param platforms CONSTITUTION.md 定义的端列表
 * @returns 推断出的端名，或 null（无法推断）
 */
function inferPlatformFromPathOrContent(
  filePath: string,
  content: string,
  platforms: string[]
): string | null {
  // 0. 【v6.40.1 修复】跨端通用文档不应归到单一端
  const baseName = filePath.split(/[/\\]/).pop()?.toUpperCase() || '';
  const globalDocNames = ['REQUIREMENT', 'REQUIREMENTS', 'INDEX', 'PRD', 'README', 'OVERVIEW'];
  if (globalDocNames.some(name => baseName.includes(name))) {
    return null; // 跨端通用文档，由 splitContentByPlatform 按端分割
  }
  
  // 1. 从文件路径推断（优先级最高）
  const pathLower = filePath.toLowerCase();
  
  // 检查路径中是否包含端名目录，如: 010-requirements/app/REQUIREMENT.md
  for (const platform of platforms) {
    const platformPatterns = [
      new RegExp(`[/\\\\]${platform}[/\\\\]`, 'i'),  // /app/ 或 \app\
      new RegExp(`[/\\\\]${platform}-`, 'i'),         // /app-xxx.md
      new RegExp(`[/\\\\]${platform}_`, 'i'),         // /app_xxx.md
    ];
    
    for (const pattern of platformPatterns) {
      if (pattern.test(pathLower)) {
        return platform;
      }
    }
  }
  
  // 检查文件名本身，如: app-requirement.md
  const fileName = filePath.split(/[/\\]/).pop()?.toLowerCase() || '';
  for (const platform of platforms) {
    if (fileName.startsWith(platform + '-') || 
        fileName.startsWith(platform + '_') ||
        fileName.includes('-' + platform + '.') ||
        fileName.includes('_' + platform + '.')) {
      return platform;
    }
  }
  
  // 【新增】2. 语义映射匹配：尝试将内容中的中文端名映射到标准端名
  const firstLines = content.split('\n').slice(0, 50).join('\n');
  for (const [standardPlatform, aliases] of Object.entries(PLATFORM_ALIAS_MAP)) {
    // 只检查这个标准端名是否在 platforms 列表中
    if (!platforms.includes(standardPlatform)) continue;
    
    // 检查是否有别名出现在内容中
    for (const alias of aliases) {
      const aliasPattern = new RegExp(alias, 'i');
      if (aliasPattern.test(firstLines)) {
        logger.info(`   🔄 语义映射: "${alias}" → "${standardPlatform}"`);
        return standardPlatform;
      }
    }
  }
  
  // 3. 从文件内容推断（精确匹配标准端名）
  for (const platform of platforms) {
    const patterns = [
      new RegExp(`^#{1,4}\\s*.*?(?:${platform}|${platform.toUpperCase()}|${platform.charAt(0).toUpperCase() + platform.slice(1)}).*?(?:端|需求)`, 'im'),
      new RegExp(`(?:^|\n)>?.*?(?:${platform}|${platform.toUpperCase()}).*?(?:端|平台|前端|后端)`, 'im'),
    ];
    
    for (const pattern of patterns) {
      if (pattern.test(firstLines)) {
        return platform;
      }
    }
  }
  
  return null; // 无法推断
}

// ============================================================
// 【新增】从端专属内容中提取页面信息
// ============================================================

/**
 * 从端专属需求内容中提取页面清单
 * @param platformContent 该端的专属需求内容
 * @param platform 端名
 * @returns 页面列表 { name, route, desc }
 */
function extractPagesFromPlatformContent(
  platformContent: string,
  platform: string
): { name: string; route: string; desc: string }[] {
  const pages: { name: string; route: string; desc: string }[] = [];
  
  if (!platformContent) return pages;
  
  // 1. 按 Markdown 标题分割内容（### 或 ####）
  const sections = platformContent.split(/^#{3,4}\s+/m);
  
  // 2. 识别功能模块标题（支持 F-01、P1、### 标题等多种格式）
  const featurePattern = /^(?:F-\d+|P\d+)\s*[|｜\s]\s*(.+)$/m;
  
  for (const section of sections) {
    const match = section.match(featurePattern);
    if (match) {
      const featureName = match[1].trim();
      // 提取该功能模块的第一段描述
      const descMatch = section.match(new RegExp("\\*\\*用户场景\\*\\*[:：]?\\s*([\\s\\S]+?)(?:\\n\\*\\*|\\n\\n|\\n#)"));
      const desc = descMatch ? descMatch[1].trim().substring(0, 100) : featureName;
      
      // 生成页面信息
      pages.push({
        name: featureName,
        route: `/${platform}/${slugify(featureName)}`,
        desc: desc
      });
    }
  }
  
  // 3. 如果按标题分割没找到，尝试从表格中提取页面清单
  if (pages.length === 0) {
    // 匹配表格行: | P1 | 数据看板 | ... | ... | 功能概要 |
    const tableRowPattern = /^\|\s*(?:P\d+|F-\d+)\s*\|\s*([^|]+)\|/gm;
    let tableMatch: RegExpExecArray | null;
    while ((tableMatch = tableRowPattern.exec(platformContent)) !== null) {
      const pageName = tableMatch[1].trim();
      if (pageName.length > 1 && pageName.length < 30 && !/^(序号|页面|编号|名称)/.test(pageName)) {
        // 尝试从同行中提取功能概要
        const fullRow = tableMatch[0];
        const cells = fullRow.split('|').map((c: string) => c.trim()).filter(Boolean);
        const desc = cells[cells.length - 1] || pageName;
        pages.push({
          name: pageName,
          route: `/${platform}/${slugify(pageName)}`,
          desc: desc.substring(0, 100)
        });
      }
    }
  }
  
  return pages;
}

/**
 * 将文本转换为 URL 友好的 slug
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
}

// ============================================================
// 【v6.40.1】从端专属内容中提取功能测试场景
// ============================================================

function extractFeaturesFromPlatformContent(
  platformContent: string,
  _platform: string
): { name: string; desc: string }[] {
  const features: { name: string; desc: string }[] = [];
  if (!platformContent) return features;
  
  const sections = platformContent.split(/^#{3,4}\s+/m);
  const featurePattern = /^(?:F-\d+|P\d+)\s*[|｜\s]\s*(.+)$/m;
  
  for (const section of sections) {
    const match = section.match(featurePattern);
    if (match) {
      const name = match[1].trim();
      // 提取业务规则或用户场景作为描述
      const ruleMatch = section.match(new RegExp('\\*\\*业务规则\\*\\*[:：]?\\s*([\\s\\S]+?)(?:\\n\\*\\*|\\n\\n|\\n#)'));
      const sceneMatch = section.match(new RegExp('\\*\\*用户场景\\*\\*[:：]?\\s*([\\s\\S]+?)(?:\\n\\*\\*|\\n\\n|\\n#)'));
      const desc = ruleMatch
        ? ruleMatch[1].trim().split('\n')[0].substring(0, 120)
        : sceneMatch
        ? sceneMatch[1].trim().substring(0, 120)
        : name;
      features.push({ name, desc });
    }
  }
  return features.slice(0, 15);
}

// ============================================================
// 【v6.40.1】从端专属内容中提取组件清单
// ============================================================

function extractComponentsFromPlatformContent(
  platformContent: string
): { name: string; type: string; page: string }[] {
  const components: { name: string; type: string; page: string }[] = [];
  if (!platformContent) return components;
  
  const sections = platformContent.split(/^#{3,4}\s+/m);
  const featurePattern = /^(?:F-\d+|P\d+)\s*[|｜\s]\s*(.+)$/m;
  
  for (const section of sections) {
    const match = section.match(featurePattern);
    if (!match) continue;
    const pageName = match[1].trim();
    
    // 从「页面要素」中提取组件
    const elementsMatch = section.match(new RegExp('\\*\\*页面要素\\*\\*[:：]?\\s*([\\s\\S]+?)(?:\\n\\*\\*|\\n\\n|\\n#)'));
    if (elementsMatch) {
      const lines = elementsMatch[1].trim().split('\n');
      for (const line of lines) {
        const item = line.replace(/^[-*]\s*/, '').trim();
        if (!item || item.length < 2) continue;
        // 推断组件类型
        let type = 'UI 组件';
        if (/\u5361\u7247|\u5361\u7247\u5217\u8868/.test(item)) type = 'Card';
        else if (/\u8868\u683c|\u5217\u8868/.test(item)) type = 'Table';
        else if (/\u8868\u5355|\u8f93\u5165|\u591a\u9009|\u4e0b\u62c9/.test(item)) type = 'Form';
        else if (/\u56fe\u8868|\u6298\u7ebf|\u67f1\u72b6|\u70ed\u529b/.test(item)) type = 'Chart';
        else if (/\u5f39\u7a97|\u786e\u8ba4|\u5f39\u51fa/.test(item)) type = 'Modal';
        else if (/\u6807\u7b7e|\u72b6\u6001/.test(item)) type = 'Tag';
        else if (/\u641c\u7d22|\u7b5b\u9009|\u5207\u6362/.test(item)) type = 'Filter';
        else if (/\u6309\u94ae|\u63d0\u4ea4/.test(item)) type = 'Button';
        components.push({ name: item.substring(0, 30), type, page: pageName });
      }
    }
  }
  return components.slice(0, 20);
}

// ============================================================
// 【v6.40.1】从端专属内容中提取状态枚举
// ============================================================

function extractStatusEnumsFromContent(
  platformContent: string
): { field: string; values: string[]; labels: string[] }[] {
  const enums: { field: string; values: string[]; labels: string[] }[] = [];
  if (!platformContent) return enums;
  
  // 查找状态标签相关的描述
  const statusPatterns = [
    /\u72b6\u6001\u6807\u7b7e[:\uff1a]\s*([^\n]+)/,
    /\u72b6\u6001[:\uff1a]\s*([^\n]+)/,
    /(?:\u5f85\u5f00\u59cb|\u8fdb\u884c\u4e2d|\u5df2\u7ed3\u675f|\u5df2\u53d6\u6d88|\u672a\u7b7e\u5230)/,
  ];
  
  for (const pattern of statusPatterns) {
    const match = platformContent.match(pattern);
    if (match) {
      const text = match[1] || match[0];
      // 从文本中提取状态值
      const statuses = text.split(/[,，/\u3001]/).map((s: string) => s.trim()).filter(Boolean);
      if (statuses.length >= 2) {
        enums.push({
          field: '\u4e1a\u52a1\u72b6\u6001',
          values: statuses,
          labels: statuses,
        });
        break;
      }
    }
  }
  
  // 尝试从表格中提取状态枚举
  const tableMatch = platformContent.match(/\|\s*\u72b6\u6001[^|]*\|([^|]*)\|/g);
  if (tableMatch) {
    const allStatuses = new Set<string>();
    for (const row of tableMatch) {
      const cells = row.split('|').map((c: string) => c.trim()).filter(Boolean);
      for (const cell of cells) {
        if (cell.length < 10 && !/\u72b6\u6001|\u64cd\u4f5c|\u6743\u9650/.test(cell)) {
          allStatuses.add(cell);
        }
      }
    }
    if (allStatuses.size >= 2 && enums.length === 0) {
      const values = Array.from(allStatuses);
      enums.push({ field: '\u72b6\u6001', values, labels: values });
    }
  }
  
  return enums;
}
