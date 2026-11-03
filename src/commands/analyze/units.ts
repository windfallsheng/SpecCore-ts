/**
 * analyze 模式：功能单元聚焦分析（--extract-units / --unit / --consolidate / --resume-units / --auto-units）
 * 含单元清单 CRUD、单元分析 Prompt、调度循环与质量报告——单元域全家桶。
 * v8.3.359+: 从 analyze.ts 拆分（渐进重构批次 D，逻辑不搬家、行为不变）
 */
import { join, dirname, basename, relative } from 'path';
import { writeFile, pathExists, ensureDir, readFile, readdir } from 'fs-extra';
import { logger } from '../../utils/logger';
import { getDefaultIteration, getIterationDir } from '../../core/context';
import { resolveUnitSourcePath } from '../../core/feature-source';
import { assembleUnitContext } from '../../core/unit-context-assembler';
import { parseProjectInfo, parsePlatformList, parseFeatureList } from '../../core/spec-paths';
import { resolveFeaturePlatformMap } from '../../core/spec-skeleton';
import { runDispatchLoopRound, type LoopRoundResult, type LoopStep } from '../../core/dispatch-loop';
import { dispatchSubagent, isSdkDispatchSupported, type AgentContext as AdapterAgentContext } from '../../core/agent-adapter';
import { findProjectRoot } from '../../utils/task-utils';
import { recordAiTrace } from '../../utils/ai-trace';
import { emitAiPrompt, parseDocMarkers } from './shared';
import type { AnalyzeOptions } from './shared';

export interface IterationUnit {
  id: string;
  name: string;
  source: string;
  sourceRange: { startLine: number; endLine: number };
  content: string;
  platforms?: string[];
}

export interface UnitAnalysis {
  id: string;
  name: string;
  req: string;
  tech: string;
  test: string;
  ui?: string;
  risk?: string;
  timestamp: string;
}

export const UNITS_CACHE_DIR = '.speccore/cache/unit-analysis';

/** 从需求文档提取功能单元清单 */
export async function extractIterationUnits(iterDir: string): Promise<IterationUnit[]> {
  const reqDir = join(iterDir, '010-requirements');
  const units: IterationUnit[] = [];
  let idCounter = 1;

  if (!await pathExists(reqDir)) return units;

  // v8.3.201+: 优先读 010-requirements/features/ 的一级子目录名作为功能单元（与 doc2spec 切分目录对齐）。
  // 旧逻辑「递归扫描所有 .md 的 ## 标题」会误读 _matrix.md / GLOBAL_CONTEXT-*.md / CHANGELOG.md，
  // 反而读不到真正的功能单元目录名。
  const featuresDir = join(reqDir, 'features');
  if (await pathExists(featuresDir)) {
    const entries = await readdir(featuresDir, { withFileTypes: true });
    // v8.3.267: 过滤 overview- 前缀的全局章节目录（unitize 误切产物，
    // 如「核心业务规则跨端通用」），防止假单元混入调度循环
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_') && !e.name.startsWith('overview-'));
    for (const dir of dirs) {
      const readmePath = await resolveUnitSourcePath(join(featuresDir, dir.name));
      let content = '';
      if (await pathExists(readmePath)) {
        // v8.3.267: 图片引用可能落在 500 字符截断之外，显式保留引用行，
        // 保证单元上下文的图片清单完整（AI 可据此 Read 原型图）
        const full = await readFile(readmePath, 'utf-8');
        content = full.slice(0, 500);
        const imgRefs = new Set<string>();
        const imgRe = /!\[[^\]]*\]\(([^)\s]+)\)/g;
        let m: RegExpExecArray | null;
        while ((m = imgRe.exec(full)) !== null) imgRefs.add(m[1]);
        const outside = [...imgRefs].filter(r => !content.includes(r));
        if (outside.length > 0) {
          content += `\n\n<!-- 原文图片引用（截断外保留）-->\n${outside.map(r => `![图片](${r})`).join('\n')}`;
        }
      }
      units.push({
        id: `M-${String(idCounter++).padStart(2, '0')}`,
        name: dir.name,
        source: relative(reqDir, readmePath).replace(/\\/g, '/'),
        sourceRange: { startLine: 1, endLine: 1 },
        content,
      });
      if (idCounter > 30) break;
    }
    if (units.length > 0) return units;
  }

  const reqFiles: string[] = [];
  // v8.3.210+: 系统报告/验证文档（非功能单元），兜底扫描时跳过
  const systemDocs = new Set(['VALIDATION', 'VALIDATION_REPORT', 'VERIFICATION', 'QUALITY_REPORT', 'CLARIFY_REPORT', 'INDEX', 'README', 'CHANGELOG', 'FUNCTION_MAP', 'GLOSSARY']);
  const resourceDirs = new Set(['assets', 'images', 'prototypes', 'screenshots', 'sources', 'designs', 'extracted']);
  async function scanDir(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (resourceDirs.has(entry.name)) continue; // 不递归资源目录
        await scanDir(fullPath);
      } else if (entry.name.endsWith('.md')) {
        const base = entry.name.slice(0, -3);
        if (systemDocs.has(base) || base.startsWith('unit-') || base.startsWith('_')) continue;
        reqFiles.push(fullPath);
      }
    }
  }
  await scanDir(reqDir);

  for (const file of reqFiles) {
    const content = await readFile(file, 'utf-8');
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^#{2,3}\s+(.+)$/);
      if (!headingMatch) continue;
      const name = headingMatch[1].trim();
      // 跳过通用标题
      const skipKeywords = ['需求概述', '术语表', '附录', '测试策略', '参考资料', '目录', '引言', '背景'];
      if (skipKeywords.some(k => name.includes(k))) continue;

      // 收集后续 1-15 行作为内容摘要
      let descLines: string[] = [];
      for (let j = i + 1; j < Math.min(i + 16, lines.length); j++) {
        const l = lines[j];
        if (l.match(/^#{1,3}\s+/)) break;
        if (l.trim()) descLines.push(l.trim());
      }

      units.push({
        id: `M-${String(idCounter++).padStart(2, '0')}`,
        name,
        source: relative(reqDir, file),
        sourceRange: { startLine: i + 1, endLine: i + 1 + descLines.length },
        content: descLines.join('\n').slice(0, 500),
      });
      if (idCounter > 30) break; // 最多识别 30 个功能单元
    }
    if (idCounter > 30) break;
  }

  return units;
}

/** 保存单元分析结果到缓存 */
export async function saveUnitAnalysis(iteration: string, analysis: UnitAnalysis): Promise<void> {
  const cacheDir = join((findProjectRoot() || process.cwd()), UNITS_CACHE_DIR, iteration);
  await ensureDir(cacheDir);
  const fp = join(cacheDir, `${analysis.id}.json`);
  await writeFile(fp, JSON.stringify(analysis, null, 2));
}

/** 读取已完成的单元分析 */
export async function loadUnitAnalyses(iteration: string): Promise<UnitAnalysis[]> {
  const cacheDir = join((findProjectRoot() || process.cwd()), UNITS_CACHE_DIR, iteration);
  if (!await pathExists(cacheDir)) return [];
  // v8.3.225+ 修复：排除 units.json 清单缓存（extractIterationUnits 产物，非单元分析结果），
  // 否则数组被 push 进 results 后 sort 时 a.id 为 undefined 崩溃
  const files = (await readdir(cacheDir)).filter(f => f.endsWith('.json') && f !== 'units.json');
  const results: UnitAnalysis[] = [];
  for (const f of files) {
    try {
      const content = await readFile(join(cacheDir, f), 'utf-8');
      const parsed = JSON.parse(content);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.id) continue;
      results.push(parsed);
    } catch { /* skip */ }
  }
  return results.sort((a, b) => a.id.localeCompare(b.id));
}

/** 检测未完成的单元分析 */
export async function detectPendingUnits(iteration: string, allUnits: IterationUnit[]): Promise<IterationUnit[]> {
  const completed = await loadUnitAnalyses(iteration);
  const completedIds = new Set(completed.map(a => a.id));
  // v8.3.266+: 用绝对路径迭代目录替代相对路径拼接——cwd 不在迭代父目录时旧写法会指向错误路径，
  // 导致 unitHasSkeletonOutput 兜底检查全部误判为骨架（路径不存在）
  const iterDir = await getIterationDir(iteration);
  const pending: IterationUnit[] = [];
  for (const u of allUnits) {
    if (!completedIds.has(u.id)) {
      pending.push(u);
      continue;
    }
    // v8.3.233+: 完成记录存在但落盘内容仍为骨架 → 仍视为待分析（兜底：
    // 用户可对有问题的单元再次分析，直到无空骨架）
    if (await unitHasSkeletonOutput(iterDir, u)) pending.push(u);
  }
  return pending;
}

/** v8.3.233+: 检查单元落盘规格是否仍为骨架/空内容（用于 pending 判定兜底，不写缓存） */
async function unitHasSkeletonOutput(iterDir: string, unit: IterationUnit): Promise<boolean> {
  const specDir = getUnitSpecDir(iterDir, unit);
  for (const f of ['REQUIREMENT.md', 'ANALYSIS.md', 'TECH.md']) {
    const fp = join(specDir, f);
    if (!(await pathExists(fp))) continue;
    const content = (await readFile(fp, 'utf-8')).trim();
    if (content && !content.includes('SPEC-SKELETON') && content.length >= 200) return false;
  }
  return true; // 三个候选全无效 → 视为骨架状态
}

/** 汇总所有单元分析为统一报告（带 [DOC:xxx] 标记） */
export async function consolidateUnitAnalyses(
  iteration: string,
  units: IterationUnit[],
  analyses: UnitAnalysis[],
): Promise<string> {
  const lines: string[] = [];
  lines.push(`# ${iteration} 迭代 Spec 统一报告`);
  lines.push(`> 生成时间: ${new Date().toISOString()}`);
  lines.push(`> 共 ${analyses.length}/${units.length} 个功能单元已完成分析`);
  lines.push('');

  // 汇总 REQUIREMENT.md
  lines.push('[DOC:REQUIREMENT.md]');
  lines.push(`# ${iteration} 需求规格`);
  lines.push('');
  lines.push('## 功能模块清单');
  lines.push('| 单元ID | 模块名称 | 需求来源 |');
  lines.push('|:---|:---|:---|');
  for (const u of units) {
    lines.push(`| ${u.id} | ${u.name} | ${u.source}#L${u.sourceRange.startLine} |`);
  }
  lines.push('');
  for (const a of analyses) {
    lines.push(`### ${a.id} ${a.name}`);
    lines.push(a.req.split(/\r?\n/).slice(0, 5).join('\n'));
    lines.push('');
  }
  lines.push('');

  // 汇总 ANALYSIS.md
  lines.push('[DOC:ANALYSIS.md]');
  lines.push(`# ${iteration} 架构分析`);
  lines.push('');
  for (const a of analyses) {
    lines.push(`## ${a.id} ${a.name}`);
    lines.push(a.tech);
    lines.push('');
  }
  lines.push('');

  // 汇总 FUNCTION_MAP.md
  lines.push('[DOC:FUNCTION_MAP.md]');
  lines.push(`# ${iteration} 功能映射`);
  lines.push('');
  lines.push('| 单元ID | 功能模块 | 涉及端 | 优先级 |');
  lines.push('|:---|:---|:---|:---|');
  for (const a of analyses) {
    lines.push(`| ${a.id} | ${a.name} | ${(a.tech.match(/端[:：]\s*(.+)/)?.[1] || '待定')} | P1 |`);
  }
  lines.push('');

  // 汇总 TECH.md
  lines.push('[DOC:TECH.md]');
  lines.push(`# ${iteration} 技术方案`);
  lines.push('');
  for (const a of analyses) {
    lines.push(`## ${a.id} ${a.name}`);
    lines.push(a.tech);
    lines.push('');
  }
  lines.push('');

  // 汇总 TEST.md
  lines.push('[DOC:TEST.md]');
  lines.push(`# ${iteration} 测试方案`);
  lines.push('');
  for (const a of analyses) {
    lines.push(`## ${a.id} ${a.name}`);
    lines.push(a.test);
    lines.push('');
  }
  lines.push('');

  // 汇总 RISK.md
  lines.push('[DOC:RISK.md]');
  lines.push(`# ${iteration} 风险评估`);
  lines.push('');
  for (const a of analyses) {
    if (a.risk) {
      lines.push(`## ${a.id} ${a.name}`);
      lines.push(a.risk);
      lines.push('');
    }
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * v8.3.249+: 构建「各端工程路径」段——从 CONSTITUTION.md 工程表解析各端源码路径。
 * 单元级/全量分析 prompt 共用，避免 AI 自行翻表定位源码。解析失败时返回空串不阻断。
 */
async function buildProjectPathsSection(): Promise<string> {
  try {
    const projectInfoMap = await parseProjectInfo();
    if (projectInfoMap.size === 0) return '';
    const lines: string[] = [];
    for (const [identifier, info] of projectInfoMap) {
      lines.push(`- \`${identifier}\`（${info.projectType || '-'}）→ \`${info.srcPath}\``);
    }
    return lines.join('\n') + '\n';
  } catch { /* 路径解析失败不阻断分析 */ return ''; }
}

/** 构建单个功能单元的深度分析 Prompt */
export async function buildUnitAnalysisPrompt(
  iterDir: string,
  iteration: string,
  unit: IterationUnit,
  allUnits: IterationUnit[],
): Promise<string> {
  const unitRef = { id: unit.id, name: unit.name, content: unit.content };
  const allUnitRefs = allUnits.map(u => ({ id: u.id, name: u.name, content: u.content }));
  const ctxResult = await assembleUnitContext(iterDir, iteration, unitRef, allUnitRefs, {
    maxTokens: 6000,
    maxRelatedUnits: 3,
    maxCodeFiles: 5,
    useKnowledgeGraph: true,
  });

  const prompt = `
# 功能单元深度分析: ${unit.id} ${unit.name}

## 迭代信息
- 迭代: ${iteration}
- 单元ID: ${unit.id}
- 来源: ${unit.source}#L${unit.sourceRange.startLine}
- 全迭代共 ${allUnits.length} 个功能单元
- 上下文预算: ${ctxResult.stats.estimatedTokens} tokens (核心${ctxResult.stats.coreChars}字符 + 关联${ctxResult.stats.relatedUnitChars + ctxResult.stats.codeChars}字符 + 全局${ctxResult.stats.globalChars}字符)

## 各端工程路径（结合源码分析时按此定位）
${await buildProjectPathsSection()}

## 需求上下文
${ctxResult.context}

## 分析要求

请对「${unit.name}」进行深度分析，输出以下文档（使用 [DOC:xxx] 标记分隔）：

### [DOC:REQ.md] 需求规格
- 功能描述（用户故事格式）
- 输入/输出定义
- 业务规则（R-XX 编号）
- 异常场景

### [DOC:TECH.md] 技术方案
- 数据模型/接口设计
- 核心算法/逻辑
- 端分工（backend/web/admin 等）
- 依赖服务

### [DOC:TEST.md] 测试方案
- 验收标准（Given-When-Then）
- 边界值
- 异常路径

### [DOC:RISK.md] 风险评估（如适用）
- 技术风险
- 业务风险
- 缓解方案

## 输出格式
\`\`\`
[DOC:REQ.md]
（内容...）

[DOC:TECH.md]
（内容...）

[DOC:TEST.md]
（内容...）

[DOC:RISK.md]
（内容...）
\`\`\`

## 重要提示
- 只分析当前功能单元「${unit.name}」，不要涉及其他模块
- 每个文档必须有实质内容，不能是空模板
- 使用具体的技术术语，避免泛泛而谈
`;

  return prompt.trim();
}

/** 单元名 → 目录名安全化（兜底模式下单元名可能是标题文本） */
function sanitizeUnitDirName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'unit';
}

/** 单元规格产物目录（对齐切分目录名，与 req-doc 澄清路径一致） */
function getUnitSpecDir(iterDir: string, unit: IterationUnit): string {
  return join(iterDir, '020-specs', sanitizeUnitDirName(unit.name), 'overview');
}

/**
 * 校验单元分析产物：020-specs/{单元名}/overview/ 下至少一份有效规格文档。
 * 通过时顺带同步旧版单元分析缓存（consolidate 依赖），保持幂等。
 */
async function validateUnitSpec(iterDir: string, iter: string, unit: IterationUnit): Promise<string | null> {
  const specDir = getUnitSpecDir(iterDir, unit);
  const candidates = ['REQUIREMENT.md', 'ANALYSIS.md', 'TECH.md'];
  const found: Record<string, string> = {};
  for (const f of candidates) {
    const fp = join(specDir, f);
    if (!(await pathExists(fp))) continue;
    const content = (await readFile(fp, 'utf-8')).trim();
    if (!content || content.includes('SPEC-SKELETON') || content.length < 200) continue;
    found[f] = content;
  }
  if (Object.keys(found).length === 0) {
    return `020-specs/${sanitizeUnitDirName(unit.name)}/overview/ 下缺少有效的规格文档（REQUIREMENT.md / ANALYSIS.md / TECH.md 至少一份，内容 ≥200 字符且非骨架模板）`;
  }

  // 同步旧版缓存，保证 --consolidate 可读
  try {
    await saveUnitAnalysis(iter, {
      id: unit.id,
      name: unit.name,
      req: found['REQUIREMENT.md'] || '',
      tech: found['TECH.md'] || found['ANALYSIS.md'] || '',
      test: '',
      timestamp: new Date().toISOString(),
    });
  } catch { /* 缓存同步失败不阻断主流程 */ }
  return null;
}

/** 构建单元分析循环 prompt：复用现有 prompt + 落盘约束 + 重试反馈 */
async function buildUnitLoopPrompt(
  iterDir: string,
  iter: string,
  unit: IterationUnit,
  allUnits: IterationUnit[],
  attempt: number,
  lastError?: string,
): Promise<string> {
  const base = await buildUnitAnalysisPrompt(iterDir, iter, unit, allUnits);
  const unitDirName = sanitizeUnitDirName(unit.name);
  const outputDir = `020-specs/${unitDirName}/overview/`;

  let extra = `

## 落盘方式（重要 — 请直接写文件）

请使用 Write 工具将以下文档直接写入迭代目录（不要只在回复中输出内容）：

- \`${outputDir}REQUIREMENT.md\` — 需求规格（功能描述/输入输出/业务规则/异常场景）
- \`${outputDir}ANALYSIS.md\` — 需求分析（现状/差距/方案要点）
- \`${outputDir}TECH.md\` — 技术方案（数据模型/接口设计/端分工/依赖）

约束：
- 每个文件内容不少于 200 字符，禁止输出空模板或骨架占位
- 写入前先创建目录；写完后回复一行：\`DONE ${unit.name}\`
- 若上下文中含「需求图片/原型」或 \`![...](...)\` 图片引用，请先用 Read 工具打开图片文件查看，再结合图片信息撰写规格；不要忽略图片提示
`;

  if (attempt > 1 && lastError) {
    extra += `
## ⚠️ 上次尝试未通过校验（第 ${attempt - 1} 次尝试）

失败原因：${lastError}

请检查文件是否写入了正确路径（\`${outputDir}\`），并确保内容完整、非骨架模板。
`;
  }

  return base + extra;
}

/**
 * v8.3.266: 调度循环 SDK 派单——Qoder 环境非 TTY 下由 CLI 直接调起子 Agent
 * （独立上下文、acceptEdits 直接写文件），返回 true 表示派单成功（含自动落盘）。
 */
async function trySdkDispatchUnit(prompt: string, iter: string, unitName: string): Promise<boolean> {
  try {
    const agentCtx: AdapterAgentContext = {
      subagent: 'requirement-analyzer',
      iteration: iter,
      contextBudget: 6000,
      contextType: 'incremental',
      cwd: findProjectRoot() || process.cwd(),
    };
    const dispatchResult = await dispatchSubagent(agentCtx, prompt);
    if (!dispatchResult || !dispatchResult.success) {
      logger.debug('[analyze] SDK 派单未成功，回退标记模式');
      return false;
    }
    // v8.3.266: 防御空转——success 但既没写文件也没返回可落盘内容，视为无效派单，
    // 立即回退标记模式（否则循环会白白耗尽该单元 3 次尝试并误标 failed）
    if (!dispatchResult.content && (!dispatchResult.filesChanged || dispatchResult.filesChanged.length === 0)) {
      logger.warn('[analyze] SDK 派单无产出（未写文件且无回传内容），回退标记模式');
      return false;
    }
    logger.info(`[analyze] 调度循环子 Agent SDK 派单成功: ${unitName}`);
    // v8.3.196+ 自动落盘：子 Agent 未直接写文件时，解析其返回的 JSON/[DOC:] 内容
    // 并路由到该单元的 overview/ 目录（applyDocContent 无单元路由，此处专用落盘）
    if (dispatchResult.content) {
      const autoApplied = await applyUnitLoopDocs(dispatchResult.content, iter, unitName);
      if (autoApplied > 0) {
        process.stdout.write(`✅ 已自动写入 ${autoApplied} 个文档到 020-specs/${sanitizeUnitDirName(unitName)}/overview/\n`);
      }
    }
    if (dispatchResult.filesChanged && dispatchResult.filesChanged.length > 0) {
      process.stdout.write(`📄 文件变更: ${dispatchResult.filesChanged.join(', ')}\n`);
    }
    return true;
  } catch (e: any) {
    logger.debug(`[analyze] SDK 派单异常: ${e.message}，回退标记模式`);
    return false;
  }
}

/**
 * v8.3.266: 把子 Agent 回传的 JSON/[DOC:] 内容写入指定单元的 overview/ 目录。
 * 文档名归一化：analyze prompt 用 [DOC:REQ.md]，落盘用 REQUIREMENT.md（validateUnitSpec 校验名单）。
 */
async function applyUnitLoopDocs(content: string, iter: string, unitName: string): Promise<number> {
  const trimmed = content.trim();
  if (!trimmed) return 0;
  const iterDir = await getIterationDir(iter);
  const unitDir = join(iterDir, '020-specs', sanitizeUnitDirName(unitName), 'overview');
  let docs: Record<string, string> = {};
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) docs = parsed as Record<string, string>;
    } catch { /* 回退 [DOC:] 标记 */ }
  }
  if (Object.keys(docs).length === 0) {
    for (const [name, c] of parseDocMarkers(trimmed)) docs[name] = c;
  }
  if (Object.keys(docs).length === 0) return 0;

  const NAME_MAP: Record<string, string> = { 'REQ.md': 'REQUIREMENT.md' };
  let applied = 0;
  for (const [filename, docContent] of Object.entries(docs)) {
    if (typeof docContent !== 'string' || !docContent.trim()) continue;
    const baseName = (filename.split('/').pop() || filename).trim();
    const normalized = NAME_MAP[baseName] || baseName;
    if (!normalized.endsWith('.md') || normalized.startsWith('.')) continue;
    await ensureDir(unitDir);
    await writeFile(join(unitDir, normalized), docContent);
    applied++;
  }
  return applied;
}

/** 单元分析调度循环：构建步骤清单并推进一轮 */
async function runUnitDispatchLoop(
  iter: string,
  iterDir: string,
  units: IterationUnit[],
): Promise<LoopRoundResult> {
  const steps: LoopStep[] = units.map((u) => ({
    id: `unit:${sanitizeUnitDirName(u.name)}`,
    name: u.name,
    validate: () => validateUnitSpec(iterDir, iter, u),
    buildPrompt: ({ attempt, lastError }) => buildUnitLoopPrompt(iterDir, iter, u, units, attempt, lastError),
  }));

  return runDispatchLoopRound(steps, {
    projectRoot: findProjectRoot() || process.cwd(),
    scope: `analyze-units:${iter}`,
    // v8.3.233+: 一轮内最多 3 次尝试（初始 + 2 重试）；循环外 resume 还可无限续跑
    maxRetries: 2,
  });
}

/** 输出调度循环完成汇总 */
async function printUnitLoopSummary(iter: string, iterDir: string, units: IterationUnit[], result: LoopRoundResult): Promise<void> {
  const s = result.summary!;
  if (s.failed.length > 0) {
    logger.warn(`⚠️ 功能单元分析循环完成: ${s.done.length} 完成 / ${s.failed.length} 失败`);
    for (const id of s.failed) {
      logger.warn(`   ❌ ${id}: ${s.failedErrors[id] || '未知原因'}`);
    }
    logger.info(`   重跑失败单元: speccore analyze --unit "<单元名>" --prompt -I ${iter}`);
  } else {
    logger.success(`🎉 所有 ${s.done.length} 个功能单元分析完成！`);
  }
  logger.info(`   下一步: 汇总统一报告 speccore analyze --prompt -I ${iter} --consolidate`);
  // v8.3.266+: 循环只保证 overview/ 3 份，端级文档（{feature}/{端}/）由 Phase 2 负责——
  // 此前完成提示不提 Phase 2，用户以为分析已闭环，taskify 时端级内容仍是骨架
  const platformSk = await countPlatformSkeletons(iterDir);
  if (platformSk.total > 0 && platformSk.skeleton > 0) {
    logger.warn(`⚠️ 端级文档仍有 ${platformSk.skeleton}/${platformSk.total} 份为骨架（overview/ 之外）`);
    logger.info(`   Phase 2 生成各端专属文档: speccore analyze --prompt -I ${iter} --phase 2`);
  }
  // v8.3.234+: 执行完成质量报告（成功/失败清单 + 产出物评分）落盘 QUALITY_AUDIT.md
  await buildAndSaveQualityReport(iterDir, iter, units);
}

/**
 * v8.3.266+: 统计 020-specs/{feature}/{端}/ 下仍为骨架的 .md 文件数。
 * 用于调度循环完成后引导 Phase 2（调度循环只保证 overview/ 3 份落盘）。
 */
async function countPlatformSkeletons(iterDir: string): Promise<{ skeleton: number; total: number }> {
  let skeleton = 0;
  let total = 0;
  try {
    const specDir = join(iterDir, '020-specs');
    if (!(await pathExists(specDir))) return { skeleton, total };
    const features = await parseFeatureList(iterDir);
    const platforms = await parsePlatformList();
    // v8.3.278+: 统计口径与骨架生成一致——只统计声明端（未声明单元全端兜底），
    // 避免把不涉及端的旧残留目录计入骨架提示
    const featurePlatforms = await resolveFeaturePlatformMap(
      join(iterDir, '010-requirements', 'features'), features, platforms);
    for (const feature of features) {
      const declared = featurePlatforms.get(feature);
      const unitPlatforms = declared && declared.length > 0 ? declared : platforms;
      for (const platform of unitPlatforms) {
        const pDir = join(specDir, feature, platform);
        if (!(await pathExists(pDir))) continue;
        const entries = await readdir(pDir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (!entry.name.endsWith('.md') || !entry.isFile()) continue;
          total++;
          const content = (await readFile(join(pDir, entry.name), 'utf-8').catch(() => '')).trim();
          if (!content || content.includes('SPEC-SKELETON') || content.length < 200) skeleton++;
        }
      }
    }
  } catch { /* 统计失败不阻断主流程 */ }
  return { skeleton, total };
}

/**
 * v8.3.234+: 生成并落盘「功能单元分析质量报告」——成功/失败清单 + 每单元产出物评分。
 * 落盘到 020-specs/QUALITY_AUDIT.md；无可评单元时返回 null。
 */
export async function buildAndSaveQualityReport(iterDir: string, iter: string, units: IterationUnit[]): Promise<string | null> {
  if (units.length === 0) return null;
  const { validateContentQuality } = await import('../../core/spec-skeleton');
  interface UnitReportEntry { unit: string; ok: boolean; rows: { doc: string; score: number; issues: string[] }[]; }
  const report: UnitReportEntry[] = [];
  for (const u of units) {
    const specDir = getUnitSpecDir(iterDir, u);
    const rows: UnitReportEntry['rows'] = [];
    for (const f of ['REQUIREMENT.md', 'ANALYSIS.md', 'TECH.md']) {
      const fp = join(specDir, f);
      if (!(await pathExists(fp))) continue;
      const content = (await readFile(fp, 'utf-8')).trim();
      if (!content || content.includes('SPEC-SKELETON') || content.length < 200) continue;
      const q = await validateContentQuality(f, content, '');
      rows.push({ doc: f, score: q.score, issues: q.issues });
    }
    report.push({ unit: u.name, ok: rows.length > 0, rows });
  }
  const okCount = report.filter(r => r.ok).length;
  const failCount = report.length - okCount;
  const totalDocs = report.reduce((a, r) => a + r.rows.length, 0);
  const avgScore = totalDocs > 0 ? Math.round(report.reduce((a, r) => a + r.rows.reduce((b, row) => b + row.score, 0), 0) / totalDocs) : 0;

  const lines: string[] = [];
  lines.push('# 功能单元分析质量报告');
  lines.push('');
  lines.push(`> 生成时间: ${new Date().toISOString()}`);
  lines.push(`> 迭代: ${iter}`);
  lines.push(`> 结果: ${okCount} 成功 / ${failCount} 失败（共 ${units.length} 单元，评 ${totalDocs} 份文档，平均 ${avgScore} 分）`);
  lines.push('');
  lines.push('## 评分明细');
  lines.push('');
  lines.push('| 单元 | 状态 | 文档 | 评分 | 主要扣分项 |');
  lines.push('|:---|:---|:---|:---|:---|');
  for (const r of report) {
    if (r.ok) {
      for (const row of r.rows) {
        lines.push(`| ${r.unit} | ✅ | ${row.doc} | ${row.score} | ${row.issues.slice(0, 3).join('；') || '—'} |`);
      }
    } else {
      lines.push(`| ${r.unit} | ❌ 失败 | — | — | 缺少有效规格文档（REQUIREMENT/ANALYSIS/TECH 至少一份，内容 ≥200 字符且非骨架） |`);
    }
  }
  lines.push('');
  lines.push('## 失败单元修复');
  lines.push('');
  if (failCount === 0) {
    lines.push('无失败单元。');
  } else {
    lines.push('```bash');
    lines.push(`speccore analyze --resume-units -I ${iter}`);
    lines.push('```');
    lines.push('仍为骨架/空内容的单元会被重新纳入分析，循环直到干净。');
  }
  lines.push('');

  const specRoot = join(iterDir, '020-specs');
  await ensureDir(specRoot);
  const reportPath = join(specRoot, 'QUALITY_AUDIT.md');
  await writeFile(reportPath, lines.join('\n'));
  logger.info(`   📊 质量报告已落盘: 020-specs/QUALITY_AUDIT.md（${okCount} 成功 / ${failCount} 失败，平均 ${avgScore} 分）`);
  return reportPath;
}

/**
 * 功能单元聚焦分析主入口
 * v8.3.341+: 从 analyzeCommand 抽出的模式早退块
 */
export async function analyzeUnitModes(options: AnalyzeOptions, projectRoot: string): Promise<void> {
  const iter = options.iteration || await getDefaultIteration();
  if (!iter) { logger.error('请指定迭代: -I <iteration>'); return; }
  const iterDir = await getIterationDir(iter);

  // Step 1: 提取功能单元清单
  let units: IterationUnit[] = [];
  const unitsCachePath = join(projectRoot, UNITS_CACHE_DIR, iter, 'units.json');
  if (await pathExists(unitsCachePath)) {
    try {
      units = JSON.parse(await readFile(unitsCachePath, 'utf-8'));
      logger.info(`📋 已加载功能单元清单: ${units.length} 个`);
    } catch { /* fall through to re-extract */ }
  }
  if (units.length === 0 || options.extractUnits) {
    units = await extractIterationUnits(iterDir);
    await ensureDir(dirname(unitsCachePath));
    await writeFile(unitsCachePath, JSON.stringify(units, null, 2));
    logger.info(`📋 功能单元清单已提取: ${units.length} 个`);
    for (const u of units) {
      logger.info(`   ${u.id}: ${u.name} (${u.source}#L${u.sourceRange.startLine})`);
    }
    if (options.extractUnits) {
      logger.info('');
      logger.info('📋 下一步: 逐个分析功能单元');
      logger.info(`   speccore analyze --prompt -I ${iter} --unit M-01`);
      return;
    }
  } else if (options.autoUnits || options.resumeUnits) {
    // v8.3.266+: 缓存与磁盘 features/ 权威源对照——旧缓存可能含 unitize 重切前的假单元
    // （实测会议项目 23 个缓存单元中 6 个在 features/ 不存在），调度循环会给假单元生成
    // Prompt 写到 features 锚点之外的目录，白写且 taskify/Phase 2 均不读。
    const diskUnits = await extractIterationUnits(iterDir);
    const cacheNames = new Set(units.map((u: IterationUnit) => u.name));
    const diskNames = new Set(diskUnits.map((u: IterationUnit) => u.name));
    const mismatched = diskUnits.length > 0
      && (diskUnits.length !== units.length || [...diskNames].some((n: string) => !cacheNames.has(n)));
    if (mismatched) {
      units = diskUnits;
      await ensureDir(dirname(unitsCachePath));
      await writeFile(unitsCachePath, JSON.stringify(units, null, 2));
      logger.warn(`⚠️ 单元清单与磁盘 features/ 目录不一致，已刷新: ${units.length} 个`);
      for (const u of units) {
        logger.info(`   ${u.id}: ${u.name} (${u.source}#L${u.sourceRange.startLine})`);
      }
    }
  }

  // Step 2: 汇总模式（--consolidate）
  if (options.consolidate) {
    const analyses = await loadUnitAnalyses(iter);
    if (analyses.length === 0) {
      logger.warn('⚠️ 尚未完成任何单元分析，请先运行 --unit 模式');
      logger.info(`   speccore analyze --prompt -I ${iter} --unit M-01`);
      return;
    }
    const report = await consolidateUnitAnalyses(iter, units, analyses);
    if (options.prompt) {
      await emitAiPrompt(iter, `${report}\n\n## 操作选项\n\n**选项 A：确认通过，写入所有文档**\n\`\`\`bash\nspeccore analyze --apply '[DOC:...]' -I ${iter}\n\`\`\`\n`, { mode: 'consolidate-report' });
      process.exitCode = 10;
      return;
    }
    if (options.apply) {
      // 直接通过 --apply 的 [DOC:xxx] 处理逻辑写入
      logger.info(`📋 汇总报告已生成，共 ${analyses.length}/${units.length} 个单元`);
      return;
    }
    logger.info(`📋 汇总报告（${analyses.length}/${units.length} 个单元）`);
    logger.info('   使用 --prompt 查看完整报告，或 --apply 直接写入');
    return;
  }

  // Step 3: 确定目标功能单元集合（--auto-units / --resume-units / --unit 可逗号分隔）
  let targetUnitIds: string[] = [];

  // 3a. --auto-units: 自动遍历所有待分析单元
  if (options.autoUnits) {
    const pending = await detectPendingUnits(iter, units);
    if (pending.length === 0) {
      logger.success('🎉 所有功能单元分析已完成！');
      logger.info('   运行 --consolidate 汇总为统一报告');
      logger.info(`   speccore analyze --prompt -I ${iter} --consolidate`);
      // v8.3.234+: 执行完成质量报告（成功/失败清单 + 产出物评分）
      await buildAndSaveQualityReport(iterDir, iter, units);
      return;
    }
    targetUnitIds = pending.map(u => u.id);
    logger.info(`🚀 自动遍历 ${targetUnitIds.length} 个待分析单元: ${targetUnitIds.join(', ')}`);
  }

  // 3b. --resume-units: 断点续跑（取第一个待分析单元）
  if (options.resumeUnits) {
    const pending = await detectPendingUnits(iter, units);
    if (pending.length === 0) {
      logger.success('🎉 所有功能单元分析已完成！');
      logger.info('   运行 --consolidate 汇总为统一报告');
      logger.info(`   speccore analyze --prompt -I ${iter} --consolidate`);
      // v8.3.234+: 执行完成质量报告（成功/失败清单 + 产出物评分）
      await buildAndSaveQualityReport(iterDir, iter, units);
      return;
    }
    targetUnitIds = [pending[0].id];
    logger.info(`🔄 断点续跑: ${pending[0].id} ${pending[0].name}（剩余 ${pending.length} 个）`);
  }

  // 3d. v8.3.225+: --auto-units / --resume-units 调度循环模式（方式 Y 宿主会话内闭环）
  //   CLI 每轮推进状态机：校验产出 → 已就绪自动标记并推进，未就绪输出该单元 prompt（exitCode 10）
  //   → 宿主 AI 落盘 → 再次调用本命令 → CLI 校验通过自动推进下一个单元，直到全部完成
  if (options.autoUnits || options.resumeUnits) {
    // v8.3.266: Qoder 环境非 TTY 下优先 SDK 派单——CLI 进程内直接调起子 Agent
    // （独立上下文、acceptEdits 直接写文件），校验通过后自动推进下一单元，宿主全程
    // 不参与；SDK 不可用/失败时回退标记模式（exitCode 10 宿主接力）。
    // 收敛性：每轮单元状态必然前进（done/failed）或 SDK 失败退出，不会死循环。
    const sdkSupported = !process.stdout.isTTY && isSdkDispatchSupported();
    const maxDispatchRounds = units.length * 3 + 5; // 防御性上限（每单元最多 3 次尝试 + 余量）
    let dispatchCount = 0;
    while (true) {
      const loopResult = await runUnitDispatchLoop(iter, iterDir, units);
      if (loopResult.finished) {
        await printUnitLoopSummary(iter, iterDir, units, loopResult);
        return;
      }
      const fallbackPrompt = `${loopResult.prompt}\n\n## 完成后继续\n\n落盘后运行以下命令，CLI 将校验产出并自动推进到下一个单元：\n\n\`\`\`bash\nspeccore analyze --resume-units -I ${iter}\n\`\`\`\n`;
      if (!sdkSupported || !(await trySdkDispatchUnit(loopResult.prompt!, iter, loopResult.step!.name))) {
        // 回退标记模式（非 Qoder 宿主 / TTY / SDK 失败均走此路径）
        await emitAiPrompt(iter, fallbackPrompt, { mode: 'resume-units-loop' });
        process.exitCode = 10;
        return;
      }
      if (++dispatchCount >= maxDispatchRounds) {
        logger.warn(`⚠️ SDK 派单轮次超限（${maxDispatchRounds}），退出调度循环`);
        process.exitCode = 10;
        return;
      }
    }
    // 理论不可达：while(true) 内所有路径均 return
  }

  // 3c. --unit: 指定单元（支持逗号分隔多个，如 M-01,M-03）
  if (options.unit) {
    targetUnitIds = options.unit.split(',').map(s => s.trim()).filter(Boolean);
    // v8.3.249+: 支持目录名直接指定——unitize 切分的目录名（如 v3-service-01-门禁授权同步）
    // 与缓存 M-ID 体系无映射，仅按 u.id 匹配会让用户面对目录名无法指定单元
    const matchUnit = (q: string, list: IterationUnit[]) =>
      list.some(u => u.id === q || u.name === q);
    let invalid = targetUnitIds.filter(id => !matchUnit(id, units));
    // v8.3.249+: unitize/doc2spec 切分不写 units.json 缓存，新切分的单元不在缓存清单中——
    // 回退磁盘提取（features/ 目录）合并后再匹配，避免「刚切完就找不到」的断层
    if (invalid.length > 0) {
      const diskUnits = await extractIterationUnits(iterDir);
      if (diskUnits.length > units.length) {
        units = diskUnits;
        await ensureDir(dirname(unitsCachePath));
        await writeFile(unitsCachePath, JSON.stringify(units, null, 2));
        logger.info(`📋 检测到新切分单元，清单已刷新: ${units.length} 个`);
        invalid = targetUnitIds.filter(id => !matchUnit(id, units));
      }
    }
    if (invalid.length > 0) {
      logger.error(`未找到功能单元: ${invalid.join(', ')}`);
      logger.info(`   可用单元: ${units.map(u => u.id).join(', ')}`);
      return;
    }
  }

  const targetUnits = targetUnitIds
    .map(id => units.find(u => u.id === id || u.name === id))
    .filter((u): u is IterationUnit => !!u);

  // 单单元：保持原有行为
  if (targetUnits.length === 1) {
    const targetUnit = targetUnits[0];
    if (options.prompt) {
      const prompt = await buildUnitAnalysisPrompt(iterDir, iter, targetUnit, units);
      await emitAiPrompt(iter, prompt, { mode: 'unit', unit: targetUnit.id });
      process.exitCode = 10;
      return;
    }
    if (options.apply) {
      // v8.3.249+: 此前为“空实现”——只打印「已接收」但 [DOC:xxx] 内容从不落盘，
      // AI 认真提交后产物丢失，taskify 拿不到分析结果。现在真正解析写入。
      await recordAiTrace(iter, 'apply-in', {
        unit: targetUnit.id,
        rawLength: options.apply.length,
        hasDocMarkers: /\[DOC:[^\]]+\]/.test(options.apply),
        rawPreview: options.apply.trim().slice(0, 500),
      });
      const docBlocks = parseDocMarkers(options.apply);
      if (docBlocks.size === 0) {
        await recordAiTrace(iter, 'apply-fail', { unit: targetUnit.id, reason: 'no-doc-markers', rawInput: options.apply });
        logger.warn('⚠️ 未检测到 [DOC:xxx] 标记，请按 prompt 格式输出');
        return;
      }
      const specDir = getUnitSpecDir(iterDir, targetUnit);
      await ensureDir(specDir);
      let written = 0;
      const writtenFiles: string[] = [];
      for (const [docName, content] of docBlocks) {
        const safeName = basename(docName);
        if (!/^[A-Za-z_][A-Za-z0-9_-]*\.(md|yaml)$/.test(safeName)) continue;
        if (content.trim().length < 50) { logger.warn(`   ⏭️  跳过 ${safeName}（内容过短）`); continue; }
        await writeFile(join(specDir, safeName), content.trim());
        written++;
        writtenFiles.push(safeName);
      }
      await recordAiTrace(iter, 'apply-done', { unit: targetUnit.id, applied: written, files: writtenFiles });
      logger.success(`✅ 功能单元 ${targetUnit.id} 分析结果已写入 ${written} 个文档`);
      logger.info(`   📂 020-specs/${sanitizeUnitDirName(targetUnit.name)}/overview/`);
      return;
    }
    logger.info(`📋 功能单元: ${targetUnit.id} ${targetUnit.name}`);
    logger.info(`   来源: ${targetUnit.source}#L${targetUnit.sourceRange.startLine}`);
    logger.info('   使用 --prompt 生成分析 Prompt，或 --apply 写入分析结果');
    return;
  }

  // 多单元：逐个输出独立 Prompt（保持每个单元独立上下文，步骤隔离）
  if (targetUnits.length > 1) {
    if (options.prompt) {
      const parts: string[] = [];
      parts.push(`# 功能单元批量分析指令（${targetUnits.length} 个单元）`);
      parts.push('');
      parts.push('> ⚠️ **步骤隔离要求**：每个功能单元独立分析、独立提交，不要跨单元混合内容。');
      parts.push('> 请**逐个单元**处理：每完成一个单元，立即用对应命令提交该单元结果，再处理下一个。');
      parts.push('');
      for (const u of targetUnits) {
        const p = await buildUnitAnalysisPrompt(iterDir, iter, u, units);
        parts.push(`\n\n===== 功能单元 ${u.id}: ${u.name} =====\n`);
        parts.push(p);
        parts.push(`\n> 提交本单元: speccore analyze --unit ${u.id} --apply '[DOC:...]' -I ${iter}\n`);
      }
      process.stdout.write(parts.join('\n'));
      process.exitCode = 10;
      return;
    }
    if (options.apply) {
      logger.warn('⚠️ 多单元模式下 --apply 请逐个单元执行（指定单个 --unit）');
      logger.info(`   待分析单元: ${targetUnits.map(u => u.id).join(', ')}`);
      return;
    }
    logger.info(`📋 已选择 ${targetUnits.length} 个功能单元: ${targetUnits.map(u => u.id).join(', ')}`);
    logger.info('   使用 --prompt 逐个生成分析 Prompt，或 --auto-units 自动遍历全部待分析单元');
  }
}
