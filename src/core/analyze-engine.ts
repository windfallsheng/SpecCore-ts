/**
 * analyze-engine — 统一分析引擎
 * 
 * 支持三种输入模式 + 三种输出范围:
 * 
 * 输入:
 *   - 纯需求: --req docs/a.md docs/b.md
 *   - 纯代码: --src backend/src frontend/src
 *   - 需求+代码: 两者都指定
 * 
 * 输出范围 (scope):
 *   - global    → .speccore/GLOBAL/  全局架构/代码健康
 *   - iteration → 期次-XX/00-需求文档/  (默认)
 *   - task      → 期次-XX/Task-NN/  单任务深化
 */
import { readFile, writeFile, pathExists, readdir, stat } from 'fs-extra';
import { join, relative, basename } from 'path';
import { logger } from '../utils/logger';
import { buildCodeIndex, findRelevantCode, readRelevantSource, isIndexStale } from './code-scanner';
import { generateAIContext, AIContextInput, AIContextResult } from './ai-context-generator';

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
  /** 期次名称 (scope=iteration|task 必填) */
  iteration?: string;
  /** 任务 ID (scope=task 必填) */
  taskId?: string;
  /** 分析深度 */
  depth: 'quick' | 'normal' | 'deep';
  /** 输出文件名 */
  output?: string;
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
  // 深拷贝输入，避免静默修改调用者的对象
  let requirements = [...input.requirements];
  let sources = [...input.sources];

  // 校验: task scope 必须同时提供 iteration 和 taskId
  if (input.scope === 'task' && (!input.taskId || !input.iteration)) {
    throw new Error('--scope task 必须同时指定 --task <id> 和 -I <iteration>');
  }

  // 自动检测: 都没指定 → 只检测需求文档, 不自动扫描源码
  if (requirements.length === 0 && sources.length === 0) {
    if (input.scope === 'iteration' && input.iteration) {
      const defaultReq = join(`期次-${input.iteration}`, '00-需求文档', 'REQUIREMENT.md');
      if (await pathExists(defaultReq)) {
        requirements = [defaultReq];
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

  switch (type) {
    case 'req':  return analyzeRequirements(effectiveInput);
    case 'code': return analyzeCodebase(effectiveInput);
    case 'combined': return analyzeCombined(effectiveInput);
    default: throw new Error(`Unknown analysis type: ${type}`);
  }
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

  let outputPath: string;
  let report: string;

  if (input.scope === 'global') {
    outputPath = join('.speccore', 'GLOBAL', input.output || 'REQ_CONSISTENCY.md');
    report = buildReqConsistencyReport(input, issues, archImpact);
  } else if (input.scope === 'task') {
    // task scope — 已在入口校验
    outputPath = join(`期次-${input.iteration}`, input.taskId!, 'backend', input.output || 'ANALYSIS.md');
    report = buildTaskReqReport(input, issues, archImpact);
  } else {
    // iteration (default)
    const iterDir = `期次-${input.iteration || 'current'}`;
    outputPath = join(iterDir, '00-需求文档', input.output || 'ANALYSIS.md');
    report = buildIterationReqReport(input, issues, archImpact);
  }

  return {
    outputPath,
    report,
    summary: {
      issues: issues.length,
      blockers: issues.filter(i => i.severity === 'blocker').length,
      filesAnalyzed: input.requirements.length,
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
    outputPath = join(`期次-${input.iteration}`, input.taskId!, 'backend', input.output || 'CODE_REVIEW.md');
    report = buildTaskCodeReport(input, fileStats, apiInventory, hotspots);
  } else {
    // iteration (default)
    const iterDir = `期次-${input.iteration || 'current'}`;
    outputPath = join(iterDir, '00-需求文档', input.output || 'CODE_ANALYSIS.md');
    report = buildIterationCodeReport(input, fileStats, apiInventory, hotspots, deps);
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
  // 先做需求分析
  const allContent: string[] = [];
  for (const reqPath of input.requirements) {
    if (await pathExists(reqPath)) {
      allContent.push(await readFile(reqPath, 'utf-8'));
    }
  }
  const fullReqContent = allContent.join('\n\n---\n\n');
  const issues = scanCompleteness(fullReqContent);
  const archImpact = await analyzeArchitectureImpact(fullReqContent);

  // 代码结构分析
  const fileStats = await scanSourceDirs(input.sources, input.depth);
  const apiInventory = await buildApiInventory(input.sources);

  // 确保代码索引是最新的
  if (await isIndexStale()) {
    await buildCodeIndex();
  }

  // ── AI 上下文生成: 替代关键词匹配 ──
  const aiContext = await generateAIContext({
    requirements: input.requirements,
    sources: input.sources,
    scope: input.scope,
    iteration: input.iteration,
    taskId: input.taskId,
    depth: input.depth,
  });

  logger.info(`   🤖 AI 上下文已生成 → ${aiContext.promptPath}`);
  logger.info(`   📁 源码文件: ${aiContext.totalFiles} 个`);
  logger.info(`   🔗 API: ${aiContext.totalApis} 个`);

  // deep 模式: 仍然读取相关源码内容注入分析
  let sourceContents: Record<string, string> = {};
  if (input.depth === 'deep') {
    const rawMatches = await findRelevantCode(fullReqContent, 15);
    sourceContents = await readRelevantSource(rawMatches, 80000);
  }

  let outputPath: string;
  let report: string;

  if (input.scope === 'global') {
    outputPath = join('.speccore', 'GLOBAL', input.output || 'ARCH_IMPACT.md');
    report = buildAIEnhancedReport(input, 'global', { issues, archImpact, fileStats, apiInventory, aiContext, sourceContents });
  } else if (input.scope === 'task') {
    outputPath = join(`期次-${input.iteration}`, input.taskId!, 'backend', input.output || 'ANALYSIS.md');
    report = buildAIEnhancedReport(input, 'task', { issues, archImpact, fileStats, apiInventory, aiContext, sourceContents });
  } else {
    const iterDir = `期次-${input.iteration || 'current'}`;
    outputPath = join(iterDir, '00-需求文档', input.output || 'ANALYSIS.md');
    report = buildAIEnhancedReport(input, 'iteration', { issues, archImpact, fileStats, apiInventory, aiContext, sourceContents });
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

  const sections = content.match(/^(#{2,3})\s+(.+)$/gm) || [];
  let prevIdx = 0;
  for (let i = 0; i < sections.length; i++) {
    const idx = content.indexOf(sections[i], prevIdx);
    const nextIdx = i + 1 < sections.length
      ? content.indexOf(sections[i + 1], idx + 1)
      : content.length;
    const sectionContent = content.substring(idx + sections[i].length, nextIdx).trim();
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

  const hasInterfaces = content.includes('接口') || content.includes('API');
  const hasDataModel = content.includes('数据模型') || content.includes('数据表') || content.includes('数据库');
  if (!hasInterfaces) {
    issues.push({ severity: 'warning', category: '内容完整性', message: '未找到接口定义章节。建议添加「接口定义」部分。' });
  }
  if (!hasDataModel) {
    issues.push({ severity: 'info', category: '内容完整性', message: '未找到数据模型/数据表描述。如需数据库变更，建议补充。' });
  }

  return issues;
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
  archImpact: ArchImpact
): string {
  const now = new Date().toISOString().split('T')[0];
  const iter = input.iteration || 'current';
  const blockerCount = issues.filter(i => i.severity === 'blocker').length;

  let r = `# 需求分析报告\n\n`;
  r += `> 期次: ${iter} | 分析时间: ${now} | 状态: ${blockerCount > 0 ? '🔴 有阻断' : '🟢 可拆分'}\n\n`;
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
  archImpact: ArchImpact
): string {
  const now = new Date().toISOString().split('T')[0];
  let r = `# 任务需求分析\n\n`;
  r += `> 期次: ${input.iteration} | 任务: ${input.taskId} | 分析: ${now}\n\n---\n\n`;
  r += `## 问题清单\n`;
  if (issues.length === 0) r += `> ✅ 无问题\n`;
  else for (const i of issues) r += `- [ ] ${i.message.replace(/\n/g, ' ')}\n`;
  if (archImpact.risks.length > 0) {
    r += `\n## 风险\n`;
    for (const rk of archImpact.risks) r += `- ⚠️ ${rk}\n`;
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
  r += `> 期次: ${input.iteration || 'current'} | 分析: ${now} | 目录: ${input.sources.join(', ')}\n\n`;
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
  r += `> 期次: ${input.iteration} | 任务: ${input.taskId} | ${now}\n\n---\n\n`;
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

function buildAIEnhancedReport(
  input: AnalyzeInput,
  scope: 'global' | 'iteration' | 'task',
  params: AIEnhancedReportParams
): string {
  const { issues, archImpact, fileStats, apiInventory, aiContext, sourceContents } = params;
  const now = new Date().toISOString().split('T')[0];
  const iter = input.iteration || 'current';
  const blockerCount = issues.filter(i => i.severity === 'blocker').length;

  let r = `# ${scope === 'global' ? '全局架构影响分析' : scope === 'task' ? '任务综合分析' : '需求分析报告'}\n\n`;
  r += `> 期次: ${iter} | 时间: ${now} | 状态: ${blockerCount > 0 ? '🔴 有阻断' : '🟢 可拆分'}\n`;
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

  // 4. AI 深度分析指引
  r += `## 🤖 AI 深度分析\n\n`;
  r += `> 以下分析项请由 AI 助手（WorkBuddy 等）读取 AI 上下文文件完成：\n\n`;
  r += `**AI 上下文文件**: \`${aiContext.promptPath}\`\n\n`;
  r += `请 AI 执行以下分析任务：\n\n`;
  r += `- [ ] **需求完整性分析**: 检查需求覆盖的功能点、边界条件、异常处理\n`;
  r += `- [ ] **需求-代码对标**: 将需求功能点映射到具体源码文件\n`;
  r += `- [ ] **架构影响评估**: 评估变更对现有架构的影响范围\n`;
  r += `- [ ] **风险识别**: 技术风险、业务风险、依赖风险\n`;
  r += `- [ ] **任务拆分建议**: 推荐的任务粒度和依赖关系\n`;

  if (Object.keys(sourceContents).length > 0) {
    r += `\n### 相关源码摘要\n\n`;
    for (const [file, content] of Object.entries(sourceContents).slice(0, 3)) {
      const lines = content.split('\n').slice(0, 15).join('\n');
      r += `**${file}**:\n\`\`\`\n${lines}\n\`\`\`\n\n`;
    }
  }

  // 5. 技术方案模板
  r += `\n---\n\n## 📝 技术方案（待填写）\n\n`;
  r += `| 模块 | 技术方案 | 负责人 | 预计工时 |\n| :--- | :--- | :--- | :--- |\n| | | | |\n\n`;
  r += `### 待确认\n`;
  r += `- [ ] AI 分析完成\n- [ ] 需求确认无遗漏\n- [ ] 技术方案评审通过\n- [ ] 可以开始拆分任务\n`;

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
