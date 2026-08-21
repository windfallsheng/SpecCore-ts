/**
 * analyze — 统一分析命令
 * 
 * 支持:
 *   - 需求分析: --req docs/a.md docs/b.md
 *   - 代码分析: --src backend/src h5-mobile/src
 *   - 联合分析: --src backend/src --req docs/req.md
 * 
 * 输出范围:
 *   - global    → .speccore/GLOBAL/              全局架构/代码健康
 *   - iteration → Iteration-XX/020-specs/         迭代级基线（默认）
 *   - task      → Iteration-XX/030-tasks/Task-NN/_shared/  任务级独立（不覆盖基线）
 */
import { writeFile, pathExists, ensureDir, rename, stat } from 'fs-extra';
import { join, dirname } from 'path';
import { backupWithTimestamp, isTimestampBackup, shouldOverwrite, findProjectRoot } from '../utils/task-utils';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, getIterationDir } from '../core/context';
import { findTaskDir } from '../core/task-paths';
import { extractQuestions, showQuestionChecklist } from '../core/question-checklist';
import { showNextSteps } from '../core/next-steps';
import { runAnalysis, AnalyzeInput, supplementAnalysis, analyzeSingleFeature, generateSpecsFromRequirements } from '../core/analyze-engine';
import { readFile, readdir, readdirSync } from 'fs-extra';
import { generateGlobalArtifacts } from '../core/global-artifacts';
import { buildPrompt, formatPrompt } from '../core/prompt-builder';
import { buildAutoModeInstruction, writeQuestions, extractQuestionsFromText, type QuestionItem } from '../core/questions';
import { resolvePlatform } from '../core/platform-registry';
import { warnIfIndexStale } from '../core/index-guard';
import { GLOBAL_SPECS_DIR, GLOBAL_SPEC_FILES, parsePlatformTypes, parsePlatformList } from '../core/spec-paths';
import { unifiedSearch, formatUnifiedContext } from '../core/unified-retrieval';
import { PipelineEngine, createAnalyzePipeline, createGlobalAnalyzePipeline } from '../core/pipeline-engine';
import { detectAffectedPlatforms, detectPlatformPriorityOrder, recordAnalysisSnapshot } from '../core/change-detection';
import {
  buildPhasePrompt,
  detectBacktrackingNeeds,
  runFinalAudit,
  getPhaseSequence,
  getPhaseDisplayName,
  type AnalyzePhase,
  type PhaseContext,
} from '../core/streaming-analyzer';
// v6.80.0+: 需求澄清模块
import {
  assessRequirementQuality,
  writeClarifyReport,
  hasValidClarifiedDocs,
  buildClarifiedHeader,
  type RequirementQualityReport,
} from '../core/requirement-clarifier';
// v6.83.0+: 专业 AI 角色定义
// v6.84.0+: 迁移到规范数据库 (.speccore/AGENTS/)，保留向后兼容
import {
  PRODUCT_ANALYST_ROLE,
  INTERACTION_DESIGNER_ROLE,
  // AGENTS 引擎 v6.84.0+
  resolveAgentsForPhase,
  buildAgentPrompt,
  type AgentContext,
} from '../core/agents';
// v6.91.0+: 代码知识图谱摘要注入
import { loadCodeGraph } from '../core/code-graph';
// v7.2.0+: 结构化代码数据提取
import { extractStructuredData, loadStructuredData } from '../core/structured-extractor';

export interface AnalyzeOptions {
  iteration?: string;
  output?: string;
  auto?: boolean;
  interactive?: boolean;
  task?: string;
  type?: string;   // 任务类型: feature|bugfix|refactor/...
  platform?: string; // 指定端: backend/web/admin/...
  // NEW options (CLI passes comma-separated strings)
  source?: string;
  requirements?: string;
  scope?: 'global' | 'iteration' | 'task';
  depth?: 'quick' | 'normal' | 'deep';
  prompt?: boolean;     // --prompt: 输出结构化分析 Prompt 到 stdout
  apply?: string;       // --apply: 接收 AI 分析结果写入 ANALYSIS.md
  withCode?: boolean;   // --with-code: 结合工程源码分析
  noSource?: boolean;   // --no-source: 不读源码
  sourceScope?: string; // --source-scope <dirs>: 指定源码目录
  supplement?: boolean; // --supplement: 补充模式（追加源码到现有报告）
  feature?: string;     // --feature: 局部分析单个功能模块
  doc?: string;         // --doc: 局部分析类型文档（如 bugs/login-timeout, refactors/db-pool）
  sync?: boolean;       // --sync: 任务分析后局部回写 020-specs/（不全覆盖）
  auditFix?: boolean;   // --audit-fix: 读取质量审计报告并生成修复指令
  // synthesize 整合选项
  full?: boolean;       // --full: 全自动三阶段合成（原 synthesize --full）
  phase?: string;       // --phase N: 单阶段合成执行
  applyPhase?: string;  // --apply-phase N: 指定写入哪个阶段的合成结果
  // Pipeline 选项 (v6.68.0+)
  pipeline?: boolean;   // --pipeline: 启用流水线模式，自动执行 Phase 1 → Phase 2
  // 流式分析选项 (v6.74.0+)
  streaming?: boolean;  // --streaming: 启用流式全局分析
  streamingPhase?: string; // --streaming-phase: 指定流式分析阶段
  // 增量分析选项 (v6.75.0+)
  incremental?: boolean;  // --incremental: 增量分析
  reanalyze?: boolean;    // --reanalyze: 重新分析
  addPlatform?: string;   // --add-platform: 新增端分析
  contextGuard?: boolean; // --context-guard: 上下文爆炸防护
  estimateOnly?: boolean; // --estimate-only: 只预估不分析
  // 功能模块级全局分析 (v6.76.0+)
  module?: string;        // --module: 功能模块级全局分析
  // 需求澄清 (v6.76.0+)
  clarify?: boolean;      // --clarify: 检测到非专业文档时提示澄清
  // v6.80.0+: 需求澄清控制
  skipClarify?: boolean;  // --skip-clarify: 跳过需求澄清阶段
  // v7.2.0+: 全局分析分层执行
  layer?: number;         // --layer N: 全局分析指定层级（1-4）
  // v7.2.0+: 单文档深度分析
  deep?: string;          // --deep <文档名>: 对指定文档进行深度分析（如 ARCHITECTURE.md）
  // v7.2.0+: 迭代式补全（大纲→逐节填充）
  iterative?: boolean;    // --iterative: 先输出大纲，再逐节深入（配合 --deep 使用）
  // v7.2.0+: 按需分析（只分析指定模块）
  filter?: string;        // --filter <关键词>: 只分析与关键词匹配的模块（如 "auth|login"）
  // v7.2.0+: 细粒度分析参数（由意图识别自动提取）
  docName?: string;       // 目标文档名（如 TECH.md）
  featureName?: string;   // 目标功能名（如 "订单模块"）
}

export async function analyzeCommand(options: AnalyzeOptions): Promise<void> {
  // v6.97.0+ 修复：全局分析时统一设置 iteration 为 'GLOBAL'，避免任何 fallback 到 getDefaultIteration()
  // 这是根治方案：后面所有 "options.iteration || await getDefaultIteration()" 都会命中 options.iteration
  if (options.scope === 'global' && !options.iteration) {
    options.iteration = 'GLOBAL';
  }

  // ── --full / --phase 模式: 委托给 synthesizeCommand（原 synthesize 命令） ──
  if (options.full || options.phase) {
    const { synthesizeCommand } = await import('./synthesize');
    return synthesizeCommand({
      iteration: options.iteration,
      withCode: options.withCode,
      prompt: options.prompt,
      apply: options.apply,
      full: options.full,
      phase: options.phase,
      applyPhase: options.applyPhase,
    });
  }

  // ── --audit-fix 模式: 读取质量审计报告并生成修复指令 ──
  if (options.auditFix) {
    const iter = options.iteration || await getDefaultIteration();
    if (!iter) { logger.error('请指定迭代: -I <iteration>'); return; }
    const iterDir = await getIterationDir(iter);
    const specDir = join(iterDir, '020-specs');
    const auditPath = join(specDir, 'QUALITY_AUDIT.md');
    if (!(await import('fs-extra')).pathExists(auditPath)) {
      logger.warn('未找到 QUALITY_AUDIT.md，请先运行 speccore analyze 生成质量审计报告');
      return;
    }
    const auditContent = await (await import('fs-extra')).readFile(auditPath, 'utf-8');
    let prompt = `\n# 任务: 质量修复（基于 QUALITY_AUDIT.md）\n\n`;
    prompt += `## 审计报告\n\n${auditContent}\n\n`;
    prompt += `## 修复要求\n`;
    prompt += `1. Read 上述审计报告中标记为 ❌ 和 ⚠️ 的维度\n`;
    prompt += `2. 逐个修复对应文档中的缺失内容：\n`;
    prompt += `   - 后端缺失: 补充 API 接口定义、数据模型、业务规则、错误码\n`;
    prompt += `   - 前端缺失: 补充页面路由表、组件清单、字段→UI 映射、状态枚举、交互设计\n`;
    prompt += `3. 修复后重新运行 \`speccore analyze -I ${iter}\` 重新审计\n`;
    prompt += `4. 最多修复 2 轮，超过 2 轮仍有问题则标记为“需人工确认”\n`;
    prompt += `5. 写入: speccore analyze --apply '{...}' -I ${iter}\n`;
    process.stdout.write(`[SPECCORE_PROMPT]\n${prompt}`);
    process.exitCode = 10;
    return;
  }

  // ── v6.75.0+: 上下文爆炸防护（--context-guard / --estimate-only）──
  if (options.contextGuard || options.estimateOnly) {
    const iter = options.iteration || await getDefaultIteration();
    if (!iter) { logger.error('请指定迭代: -I <iteration>'); return; }
    const iterDir = await getIterationDir(iter);

    const { estimateContextSize, buildSegmentationPlan, buildContextGuardPrompt } = await import('../core/analyze-context-guard');
    const estimate = await estimateContextSize(iterDir, { withCode: options.withCode });
    const plan = await buildSegmentationPlan(estimate, iterDir, { withCode: options.withCode });

    logger.info('');
    logger.info('📊 上下文大小预估报告');
    logger.info(`预估 Tokens: ~${estimate.estimatedTokens.toLocaleString()} (${estimate.level})`);
    logger.info(`推荐策略: ${estimate.recommendedStrategy}`);
    logger.info(`分段数: ${plan.segments.length}`);

    if (options.estimateOnly) {
      // 只输出预估报告到 prompt
      const prompt = buildContextGuardPrompt(estimate, plan);
      process.stdout.write(`[SPECCORE_PROMPT]\n${prompt}`);
      process.exitCode = 10;
      return;
    }

    // context-guard 模式下，将预估信息注入后续 prompt
    // 通过全局变量或 options 传递（简化处理：直接输出报告后继续）
    logger.info('');
    logger.info('💡 继续执行分析，建议按上述分段策略进行');
    logger.info('');
  }

  // ── v6.75.0+: 增量分析模式（--incremental / --reanalyze）──
  if (options.incremental || options.reanalyze) {
    const iter = options.iteration || await getDefaultIteration();
    if (!iter) { logger.error('请指定迭代: -I <iteration>'); return; }
    const iterDir = await getIterationDir(iter);

    const { runIncrementalAnalysis, buildIncrementalPrompt } = await import('../core/incremental-analyzer');
    const analysis = await runIncrementalAnalysis(iterDir, { withCode: options.withCode });

    if (!analysis.hasChanges && analysis.potentialGaps.length === 0) {
      logger.success('✅ 未检测到变更，所有分析产出均为最新');
      logger.info('   如需强制重新分析，去掉 --incremental 参数');
      return;
    }

    logger.info('');
    logger.info(`📊 增量分析结果: ${analysis.recommendation}`);
    logger.info('');

    if (options.prompt) {
      const prompt = buildIncrementalPrompt(iterDir, analysis, iter);
      process.stdout.write(`[SPECCORE_PROMPT]\n${prompt}`);
      process.exitCode = 10;
      return;
    }

    // 非 prompt 模式，输出摘要
    const changedReqs = analysis.requirementChanges.filter(c => c.changeType !== 'unchanged');
    if (changedReqs.length > 0) {
      logger.info(`✏️ 需求文档变更: ${changedReqs.length} 个`);
    }
    const changedCode = analysis.codeChanges.filter(c => c.changeType !== 'unchanged');
    if (changedCode.length > 0) {
      logger.info(`✏️ 源码文件变更: ${changedCode.length} 个`);
    }
    if (analysis.addedPlatforms.length > 0) {
      logger.info(`🆕 新增端: ${analysis.addedPlatforms.join(', ')}`);
    }
    if (analysis.potentialGaps.length > 0) {
      logger.info(`⚠️ 潜在遗漏: ${analysis.potentialGaps.length} 项`);
      for (const gap of analysis.potentialGaps) {
        logger.info(`   • ${gap}`);
      }
    }

    logger.info('');
    logger.info('📋 下一步:');
    logger.info(`   speccore analyze --prompt -I ${iter} --incremental`);
    return;
  }

  // ── v6.75.0+: 新增端分析模式（--add-platform）──
  if (options.addPlatform) {
    const iter = options.iteration || await getDefaultIteration();
    if (!iter) { logger.error('请指定迭代: -I <iteration>'); return; }
    const iterDir = await getIterationDir(iter);
    const newPlatform = options.addPlatform;

    const { analyzeNewPlatform, buildNewPlatformPrompt } = await import('../core/platform-addition');
    const analysis = await analyzeNewPlatform(iterDir, newPlatform);

    logger.info('');
    logger.info(`🆕 新增端分析: ${newPlatform} (${analysis.platformType})`);
    logger.info(`   后端端: ${analysis.isBackend ? '是' : '否'}`);
    logger.info(`   已有端: ${analysis.existingPlatforms.join(', ')}`);
    logger.info(`   跨端关系: ${analysis.crossPlatformRelations.length} 个`);
    logger.info(`   全局更新: ${analysis.globalUpdates.length} 项`);
    logger.info('');

    if (options.prompt) {
      const prompt = buildNewPlatformPrompt(iterDir, analysis, iter);
      process.stdout.write(`[SPECCORE_PROMPT]\n${prompt}`);
      process.exitCode = 10;
      return;
    }

    logger.info('📋 新端产出:');
    for (const out of analysis.newPlatformOutputs) {
      logger.info(`   • ${out}`);
    }
    logger.info('');
    logger.info('📋 全局文档更新:');
    for (const up of analysis.globalUpdates) {
      logger.info(`   • ${up.action}: ${up.file}`);
    }
    logger.info('');
    logger.info('📋 下一步:');
    logger.info(`   speccore analyze --prompt -I ${iter} --add-platform ${newPlatform}`);
    return;
  }

  // ── v6.76.0+: 功能模块级全局分析（--module）──
  if (options.module) {
    const iter = options.iteration || await getDefaultIteration();
    if (!iter) { logger.error('请指定迭代: -I <iteration>'); return; }
    const iterDir = await getIterationDir(iter);
    const moduleName = options.module;

    const { analyzeModule, buildModuleAnalysisPrompt, listAnalyzedModules, listRequirementModules } = await import('../core/module-analyzer');
    const result = await analyzeModule(iterDir, moduleName);

    logger.info('');
    if (result.exists) {
      logger.info(`🔄 功能模块重新分析: ${moduleName}`);
      logger.info(`   状态: 已存在于全局文档`);
    } else {
      logger.info(`🆕 功能模块新增分析: ${moduleName}`);
      logger.info(`   状态: 尚未在全局文档中分析`);

      // 检查需求文档中是否存在该模块
      const reqModules = await listRequirementModules(iterDir);
      if (!reqModules.includes(moduleName)) {
        logger.warn(`⚠️ 需求文档中未找到功能模块 "${moduleName}"`);
        logger.info(`   需求中已有的模块: ${reqModules.slice(0, 10).join(', ')}${reqModules.length > 10 ? '...' : ''}`);
        logger.info(`   建议: 先确认模块名称是否正确，或在 010-requirements/features/ 中创建 ${moduleName}/README.md`);
      }
    }

    logger.info(`   涉及端: ${result.involvedPlatforms.join(', ') || '待确定'}`);
    logger.info(`   全局更新: ${result.globalUpdates.length} 项`);
    logger.info(`   各端更新: ${result.platformUpdates.length} 个端`);
    logger.info('');

    if (options.prompt) {
      const prompt = buildModuleAnalysisPrompt(iterDir, result, iter);
      process.stdout.write(`[SPECCORE_PROMPT]\n${prompt}`);
      process.exitCode = 10;
      return;
    }

    logger.info('📋 全局文档更新:');
    for (const up of result.globalUpdates) {
      logger.info(`   • ${up.action}: ${up.file}`);
    }
    logger.info('');
    logger.info('📋 各端文档更新:');
    for (const pu of result.platformUpdates) {
      logger.info(`   • ${pu.platform}: ${pu.files.join(', ')}`);
    }
    logger.info('');
    logger.info('📋 下一步:');
    logger.info(`   speccore analyze --prompt -I ${iter} --module ${moduleName}`);
    return;
  }

  // ── --feature 模式: 局部刷新单个功能模块 ──
  if (options.feature) {
    const iter = options.iteration || await getDefaultIteration();
    if (!iter) { logger.error('请指定迭代: -I <iteration>'); return; }
    const iterDir = await getIterationDir(iter);
    const featureName = options.feature;

    const spinner = new Spinner(`局部分析: ${featureName}`);
    spinner.start();

    const result = await analyzeSingleFeature(iterDir, featureName);
    if (!result) {
      spinner.fail(`未找到功能模块: 010-requirements/features/${featureName}/README.md`);
      return;
    }

    spinner.stop(`✅ 局部分析完成: 020-specs/features/${featureName}.md`);
    logger.info('');

    // 自动刷新知识图谱
    try {
      const { refreshKnowledgeGraph } = await import('../core/knowledge-graph');
      await refreshKnowledgeGraph(process.cwd(), iter);
      logger.info('🧠 知识图谱已刷新');
    } catch {}

    logger.info('');
    logger.info('📋 下一步:');
    logger.info(`   speccore split -I ${iter}          # 重新拆分任务`);
    logger.info(`   speccore reindex                    # 完整重建索引`);
    return;
  }

  // ── --doc 模式: 局部刷新单个类型文档（bugs/refactors/research） ──
  if (options.doc) {
    const iter = options.iteration || await getDefaultIteration();
    if (!iter) { logger.error('请指定迭代: -I <iteration>'); return; }
    const iterDir = await getIterationDir(iter);
    const docPath = options.doc; // e.g. "bugs/login-timeout" or "refactors/db-pool"

    const spinner = new Spinner(`局部分析: ${docPath}`);
    spinner.start();

    const { analyzeSingleTypedDoc } = await import('../core/analyze-engine');
    const result = await analyzeSingleTypedDoc(iterDir, docPath);
    if (!result) {
      spinner.fail(`未找到类型文档: 010-requirements/${docPath}.md`);
      logger.info('   支持的格式: bugs/<slug>, refactors/<slug>, research/<slug>');
      return;
    }

    const typeDir = docPath.split('/')[0];
    spinner.stop(`✅ 局部分析完成: 020-specs/${docPath}.md`);
    logger.info('');

    // 自动刷新知识图谱
    try {
      const { refreshKnowledgeGraph } = await import('../core/knowledge-graph');
      await refreshKnowledgeGraph(process.cwd(), iter);
      logger.info('🧠 知识图谱已刷新');
    } catch {}

    logger.info('');
    logger.info('📋 下一步:');
    logger.info(`   speccore split -I ${iter}          # 重新拆分任务`);
    logger.info(`   speccore reindex                    # 完整重建索引`);
    return;
  }

  // 模糊匹配端名
  if (options.platform) {
    const resolved = await resolvePlatform(options.platform);
    if (resolved.error) {
      logger.error(`❌ ${resolved.error}`);
      return;
    }
    if (!resolved.exact) {
      logger.info(`📍 --platform ${options.platform} → 匹配 ${resolved.resolved}`);
    }
    options.platform = resolved.resolved!;
  }

  // 命令前索引新鲜度检查（非阻塞）
  // v6.97.0+ 修复：全局分析时不检查迭代级索引，避免误导用户
  if (options.scope !== 'global') {
    await warnIfIndexStale(process.cwd(), 'analyze', options.iteration);
  }

  // 备份追踪
  const backups: string[] = [];
  const printBackupSummary = () => {
    if (backups.length > 0) {
      logger.info('');
      logger.info(`📦 备份文件 (${backups.length} 个):`);
      for (const bp of backups) {
        logger.info(`   ${bp}`);
      }
      logger.info('   💡 如不再需要可手动删除');
    }
  };

  // ── --supplement 模式: 追加未覆盖源码到现有报告 ──
  if (options.supplement) {
    const iter = options.iteration || await getDefaultIteration();
    if (!iter) { logger.error('请指定迭代: -I <iteration>'); return; }
    const iterDir = await getIterationDir(iter);
    const reportPath = join(iterDir, '020-specs', options.output || 'ANALYSIS.md');

    logger.info(`🔄 补充分析: ${iter}`);
    const result = await supplementAnalysis({
      reportPath,
      scope: options.sourceScope,
      maxFiles: options.depth === 'deep' ? 20 : (options.depth === 'quick' ? 5 : 10),
    });
    if (result) {
      if (result.addedFiles.length > 0) {
        logger.success(`✅ 补充完成: 新增 ${result.addedFiles.length} 个文件，累计 ${result.totalRead} 个`);
        if (result.remainingUncovered > 0) {
          logger.info(`   📌 还有 ${result.remainingUncovered} 个未覆盖，可再次运行 --supplement 继续补充`);
        }
      }
    }
    return;
  }

  // ── --auto 模式: 全自动分析（收集文档 → 生成 prompt → 交给 AI，不交互） ──
  // 【v6.40.2 修复】--auto 不再跳过 AI，而是自动生成 prompt 让宿主 AI 执行专业分析
  if (options.auto) {
    const iter = options.iteration || await getDefaultIteration();
    if (!iter) { logger.error('请指定迭代: -I <iteration>'); return; }
    const iterDir = await getIterationDir(iter);
    const reqDir = join(iterDir, '010-requirements');
    const specDir = join(iterDir, '020-specs');
    await ensureDir(specDir);

    // 收集需求文档
    const requirements: string[] = [];
    const reqIndex = join(reqDir, 'INDEX.md');
    if (await pathExists(reqIndex)) requirements.push(reqIndex);
    const convDir = join(reqDir, 'converted');
    if (await pathExists(convDir)) {
      try {
        const files = await readdir(convDir);
        for (const f of files.filter((f: string) => f.endsWith('.md') && !isTimestampBackup(f))) requirements.push(join(convDir, f));
      } catch {}
    }
    const reqRoot = join(reqDir, 'REQUIREMENT.md');
    if (await pathExists(reqRoot)) requirements.push(reqRoot);

    // 收集 features/*/README.md
    const featuresDir = join(reqDir, 'features');
    if (await pathExists(featuresDir)) {
      try {
        const featureEntries = await readdir(featuresDir, { withFileTypes: true });
        for (const fe of featureEntries) {
          if (fe.isDirectory() && !fe.name.startsWith('.')) {
            const readmePath = join(featuresDir, fe.name, 'README.md');
            if (await pathExists(readmePath)) requirements.push(readmePath);
          }
        }
      } catch {}
    }

    // 收集 staging/ 下的分类文档（doc2spec --classify 产物，带 type frontmatter）
    const stagingDir = join(reqDir, 'staging');
    if (await pathExists(stagingDir)) {
      try {
        const stagingFiles = await readdir(stagingDir);
        for (const f of stagingFiles.filter((f: string) => f.endsWith('.md') && !isTimestampBackup(f))) {
          requirements.push(join(stagingDir, f));
        }
      } catch {}
    }

    // 收集类型目录下的文档（bugs/, refactors/, research/ — 扁平 .md 文件）
    for (const typeDir of ['bugs', 'refactors', 'research']) {
      const typeDirPath = join(reqDir, typeDir);
      if (!(await pathExists(typeDirPath))) continue;
      try {
        const typeFiles = await readdir(typeDirPath);
        for (const f of typeFiles.filter((f: string) => f.endsWith('.md') && !isTimestampBackup(f))) {
          requirements.push(join(typeDirPath, f));
        }
      } catch {}
    }

    if (requirements.length === 0) {
      logger.warn('未找到需求文档，请先导入: speccore doc2spec');
      return;
    }

    // v6.76.0+: --clarify 模式下检测需求文档专业度
    if (options.clarify) {
      const { detectProfessionalLevel } = await import('../core/requirement-clarifier');
      let lowQualityCount = 0;
      for (const reqPath of requirements) {
        const reqContent = await readFile(reqPath, 'utf-8');
        const level = detectProfessionalLevel(reqContent);
        if (level !== 'high') {
          lowQualityCount++;
          logger.warn(`   ⚠️  需求文档质量${level.toUpperCase()}: ${reqPath.replace(iterDir + '/', '')}`);
          logger.info(`      💡 建议: speccore clarify --from "${reqPath}" --to ${iter}`);
        }
      }
      if (lowQualityCount > 0) {
        logger.info('');
        logger.info(`📋 ${lowQualityCount}/${requirements.length} 个需求文档需要澄清整理`);
        logger.info('   选项 1: 先执行 clarify 整理需求，再重新 analyze');
        logger.info('   选项 2: 继续使用当前文档分析（加 --force 跳过检测）');
        logger.info('');
        // 不阻断，但在 prompt 中注入澄清指令
      }
    }

    // 【v6.40.2 修复】--auto 不再跳过 AI，而是自动生成 prompt 让宿主 AI 执行专业分析
    logger.info(` Auto 分析: ${iter} (${requirements.length} 个需求文档 → AI 专业分析)`);
    // 设置 prompt 模式，fall through 到下面的 prompt 生成逻辑
    options.prompt = true;
  }

  // ── v6.49.13+: 预创建 020-specs/ 目录结构（CLI 控制目录，AI 只填内容）──
  if (options.prompt) {
    if (options.scope === 'global') {
      // 全局分析：预创建 .speccore/GLOBAL/ 目录结构，不写迭代目录
      // v6.81.0+: 需求文档单独放在 requirements/ 下，技术文档放在 platforms/ 下
      // v7.2.0+: 全局技术文档统一放在 overview/ 子目录下，与迭代层 020-specs/overview/ 命名一致
      const globalDir = join(process.cwd(), '.speccore', 'GLOBAL');
      await ensureDir(globalDir);
      await ensureDir(join(globalDir, 'overview'));
      await ensureDir(join(globalDir, 'platforms'));
      await ensureDir(join(globalDir, 'requirements'));
      await ensureDir(join(globalDir, 'requirements', 'images'));
      await ensureDir(join(globalDir, 'requirements', 'prototypes'));
      // v7.0.0+: 图表可视化目录
      await ensureDir(join(globalDir, 'diagrams'));
      logger.info(`📁 已预创建 .speccore/GLOBAL/ 目录结构（overview/ + platforms/ + requirements/ + diagrams/）`);
    } else {
      const iterForDirs = options.iteration || await getDefaultIteration();
      if (iterForDirs) {
        await preCreateSpecDirectories(iterForDirs);
      }
    }
  }

  // ── 非 prompt/apply 模式 → 全部转 AI prompt，不再走代码模板分析 ──
  if (!options.prompt && !options.apply) {
    options.prompt = true;
  }

  // ── v6.68.0+: Pipeline 模式初始化 ──
  // v6.69.0+: 支持契约先行 + 逐端推进（增强策略一 & 三）
  // v6.69.0+: 全局层接入 createGlobalAnalyzePipeline（增强策略二）
  if (options.prompt && options.pipeline) {
    const iter = options.iteration || await getDefaultIteration();
    const isGlobalScope = options.scope === 'global';

    if (!isGlobalScope && !iter) {
      logger.error('Pipeline 模式需要指定迭代');
      return;
    }

    let engine: PipelineEngine;
    let steps: { id: string; name: string; next: string | null }[];
    let pipelineKey: string;
    let initStep: string;

    // v6.69.0+: 变更感知 + 关键路径优先检测
    let affectedPlatforms: string[] | undefined;
    let platformOrder: string[] | undefined;

    if (!isGlobalScope && iter) {
      // 变更感知：检测 Git 变更影响的端
      affectedPlatforms = await detectAffectedPlatforms(process.cwd());
      // 关键路径优先：按任务优先级排序端
      platformOrder = await detectPlatformPriorityOrder(iter);
    }

    if (isGlobalScope) {
      // 全局层：使用 createGlobalAnalyzePipeline（增强策略二）
      const result = await createGlobalAnalyzePipeline();
      engine = result.engine;
      steps = result.steps;
      pipelineKey = 'GLOBAL';
      initStep = 'init';
    } else {
      // 迭代层：使用 createAnalyzePipeline（支持契约先行 + 逐端推进 + 变更感知 + 关键路径优先 + 需求澄清）
      const result = await createAnalyzePipeline(iter!, process.cwd(), {
        affectedPlatforms: affectedPlatforms && affectedPlatforms.length > 0 ? affectedPlatforms : undefined,
        platformOrder: platformOrder && platformOrder.length > 0 ? platformOrder : undefined,
        skipClarify: options.skipClarify,
      });
      engine = result.engine;
      steps = result.steps;
      pipelineKey = iter!;
      // v6.80.0+: 默认从 clarify 开始，skipClarify 时从 phase1 开始
      initStep = options.skipClarify ? 'phase1-prompt' : 'clarify-prompt';
    }

    // 检查是否有活跃的 Pipeline（恢复模式）
    const hasActive = await PipelineEngine.hasActivePipeline(process.cwd(), pipelineKey);
    let currentStep: string;

    if (hasActive) {
      const existingState = await PipelineEngine.loadExistingState(process.cwd(), pipelineKey);
      currentStep = existingState?.currentStep || initStep;
      logger.info(`🔄 恢复 Pipeline: ${currentStep}`);
    } else {
      await engine.init(initStep);
      currentStep = initStep;
    }

    // 根据当前步骤生成对应的 prompt
    let prompt: string;
    const platformMatch = currentStep.match(/^platform-(.+)-prompt$/);

    if (isGlobalScope) {
      // 全局层 Pipeline 步骤映射
      if (currentStep === 'init' || currentStep === 'discovery') {
        prompt = await buildMultiDocPrompt('analyze', {
          iteration: iter || 'GLOBAL', task: options.task, type: options.type,
          scope: 'global', withCode: options.withCode, platform: options.platform,
        }, options);
      } else if (currentStep === 'global-analysis') {
        prompt = await buildMultiDocPrompt('analyze', {
          iteration: iter || 'GLOBAL', scope: 'global', withCode: options.withCode,
        }, options);
      } else if (currentStep === 'consistency-check') {
        prompt = `\n# 任务: 全局一致性检查\n\n` +
          `检查各迭代、各端之间的规格是否一致。\n` +
          `重点检查：接口定义冲突、数据模型不一致、命名规范违规。\n`;
      } else if (currentStep === 'report-generation') {
        prompt = `\n# 任务: 生成全局索引报告\n\n` +
          `汇总所有分析结果，生成 .speccore/GLOBAL/INDEX.md。\n`;
      } else {
        prompt = await buildMultiDocPrompt('analyze', {
          iteration: iter || 'GLOBAL', scope: 'global', withCode: options.withCode,
        }, options);
      }
    } else if (currentStep === 'clarify-prompt') {
      // v6.80.0+: Phase 0 需求澄清
      prompt = await buildClarifyPhasePrompt(iter!);
    } else if (currentStep === 'confirm-check') {
      // v6.80.0+: 需求确认阶段 — 输出质量报告提示
      prompt = await buildConfirmCheckPrompt(iter!);
    } else if (currentStep === 'phase1-prompt') {
      prompt = await buildMultiDocPrompt('analyze', {
        iteration: iter!, task: options.task, type: options.type,
        scope: options.scope, withCode: options.withCode, platform: options.platform,
      }, options);
    } else if (currentStep === 'contract-prompt') {
      // 契约先行阶段：基于 Phase 1 文档生成跨端契约
      prompt = await buildContractFirstPrompt(iter!);
    } else if (platformMatch) {
      // 逐端推进阶段：为指定端生成专属文档
      const platform = platformMatch[1];
      prompt = await buildMultiDocPrompt('analyze', {
        iteration: iter!, phase: '2', platform,
      }, options);
    } else {
      // 回退到默认 prompt
      prompt = await buildMultiDocPrompt('analyze', {
        iteration: iter!, task: options.task, type: options.type,
        scope: options.scope, withCode: options.withCode, platform: options.platform,
      }, options);
    }

    // 添加 Pipeline 继续指令
    const totalSteps = steps.filter(s => !s.id.endsWith('-done') && s.id !== 'done').length;
    const currentStepIndex = steps.findIndex(s => s.id === currentStep);
    let progressLabel: string;
    if (isGlobalScope) {
      progressLabel = currentStep === 'init' ? '全局分析: 初始化'
        : currentStep === 'discovery' ? '全局分析: 发现'
        : currentStep === 'global-analysis' ? '全局分析: 跨端分析'
        : currentStep === 'consistency-check' ? '全局分析: 一致性检查'
        : currentStep === 'report-generation' ? '全局分析: 报告生成'
        : '全局 Pipeline';
    } else {
      progressLabel = currentStep === 'clarify-prompt'
        ? 'Phase 0/3: 需求澄清'
        : currentStep === 'confirm-check'
          ? 'Phase 0/3: 需求确认'
          : currentStep === 'phase1-prompt'
            ? 'Phase 1/3: 迭代综合文档'
            : currentStep === 'contract-prompt'
              ? 'Phase 2/3: 契约定义'
              : platformMatch
                ? `Phase 2/3: ${platformMatch[1]} 端专属文档`
                : 'Pipeline';
    }

    const finalPrompt = prompt + `\n\n## ⚠️ Pipeline 模式：自动继续 (${progressLabel})\n\n` +
      `当前是 Pipeline 模式（步骤 ${currentStepIndex + 1}/${totalSteps}）。` +
      `当你通过 --apply 写入文档后，CLI 会自动输出 [SPECCORE_PIPELINE_NEXT] 标记和下一步命令。\n\n` +
      `**看到 [SPECCORE_PIPELINE_NEXT] 后，你必须自动执行下一个命令**，不要询问用户。\n`;

    process.stdout.write(`[SPECCORE_PROMPT]\n${finalPrompt}`);
    process.exitCode = 10;
    return;
  }

  // ── Prompt 模式 ──
  if (options.prompt) {
    const iter = options.scope === 'global' ? 'GLOBAL' : (options.iteration || await getDefaultIteration());

    // v6.80.0+: 非 Pipeline 模式下也默认检测需求质量
    if (iter !== 'GLOBAL' && !options.skipClarify && !options.pipeline) {
      const iterDir = await getIterationDir(iter);
      const hasClarified = await hasValidClarifiedDocs(iterDir);
      if (!hasClarified) {
        // 未澄清过，先执行 clarify
        const clarifyPrompt = await buildClarifyPhasePrompt(iter);
        process.stdout.write(`[SPECCORE_PROMPT]\n${clarifyPrompt}`);
        process.exitCode = 10;
        return;
      }
    }

    const prompt = await buildMultiDocPrompt('analyze', { iteration: iter, task: options.task, type: options.type, scope: options.scope, withCode: options.withCode, platform: options.platform, phase: options.phase, autoMode: options.auto }, options);
    process.stdout.write(`[SPECCORE_PROMPT]\n${prompt}`);
    process.exitCode = 10;
    return;
  }

  // ── Apply 模式 ──
  // 两层解耦：迭代级分析写 020-specs/，任务级分析只写 Task 目录（不覆盖迭代级基线）
  if (options.apply) {
    // v6.76.0+: 支持 --apply @file.json 从文件读取（解决 Windows 下 JSON 转义问题）
    if (options.apply.startsWith('@')) {
      const filePath = options.apply.slice(1).trim();
      try {
        const fileContent = await readFile(filePath, 'utf-8');
        options.apply = fileContent;
        logger.info(`   📄 已从文件读取 apply 内容: ${filePath}`);
      } catch (e) {
        logger.error(`无法读取 apply 文件: ${filePath}`);
        return;
      }
    }

    const isGlobalScope = options.scope === 'global';
    if (!isGlobalScope && !options.iteration) { logger.error('--apply 需要 --iteration'); return; }
    const iterDir = isGlobalScope ? undefined : await getIterationDir(options.iteration!);
    const isTaskLevel = !isGlobalScope && !!options.task;
    let taskDir: string | null = null;
    if (isTaskLevel) {
      const taskId = options.task!.startsWith('Task-') ? options.task! : `Task-${options.task!}`;
      taskDir = await findTaskDir(join(iterDir!, '030-tasks'), taskId);
      if (!taskDir) { logger.error(`未找到任务: ${taskId}`); return; }
    }

    // 支持 JSON 多文档写入
    if (options.apply.startsWith('{')) {
      try {
        const docs: Record<string, string> = JSON.parse(options.apply);
        let count = 0;

        if (isTaskLevel && taskDir) {
          // 任务级：写 Task/00-specs/（v6.44.0+ 统一写入 00-specs/）
          const targetSubDir = options.platform && !isTaskLevel ? options.platform : '00-specs';
          const taskSpecDir = join(taskDir, targetSubDir);
          await ensureDir(taskSpecDir);
          for (const [filename, content] of Object.entries(docs)) {
            const fp = join(taskSpecDir, filename);
            if (!(await shouldOverwrite(fp, !!options.interactive))) { logger.info(`   ⏭️  跳过: ${filename}`); continue; }
            const bk = await backupWithTimestamp(fp);
            if (bk) {
              backups.push(bk);
              logger.info(`   📦 ${filename} 旧版已备份: ${bk.split('/').pop()}`);
            }
            await writeFile(fp, content);
            count++;
          }
          const platformLabel = options.platform ? `/${options.platform}` : '';
          logger.success(`✅ ${count} 个 Spec 文档已写入 ${options.task}${platformLabel}/（任务级，迭代基线不变）`);
        } else if (isGlobalScope) {
          // 全局级：写入 .speccore/GLOBAL/（与 platforms/ 同级，非迭代目录）
          const globalBaseDir = join(process.cwd(), '.speccore', 'GLOBAL');
          await ensureDir(globalBaseDir);
          const globalSet = new Set(GLOBAL_SPEC_FILES);

          for (const [filename, content] of Object.entries(docs)) {
            // PATTERNS/ 文件特殊处理 → 写入 .speccore/PATTERNS/
            if (filename.startsWith('PATTERNS/')) {
              const patternsDir = join(process.cwd(), '.speccore', 'PATTERNS');
              await ensureDir(patternsDir);
              const patternFile = filename.slice('PATTERNS/'.length);
              const fp = join(patternsDir, patternFile);
              let existing = '';
              if (await pathExists(fp)) existing = await readFile(fp, 'utf-8');
              const merged = existing ? `${existing}\n\n---\n\n${content}` : content;
              await writeFile(fp, merged);
              logger.info(`   🧩 PATTERN 已追加: ${patternFile}`);
              count++;
              continue;
            }

            let targetDir: string;
            let targetFilename: string;

            if (filename.includes('/')) {
              const parts = filename.split('/');
              if (parts[0] === 'platforms' || parts[0] === 'requirements') {
                // v6.81.0+: platforms/ 和 requirements/ 都按原路径写入 GLOBAL/
                // platforms/admin-web/_INDEX.md → .speccore/GLOBAL/platforms/admin-web/
                // requirements/REQUIREMENT.md → .speccore/GLOBAL/requirements/
                // requirements/admin-web/REQUIREMENT.md → .speccore/GLOBAL/requirements/admin-web/
                targetDir = join(globalBaseDir, ...parts.slice(0, -1));
                targetFilename = parts[parts.length - 1];
              } else {
                // admin-web/_INDEX.md → .speccore/GLOBAL/platforms/admin-web/
                targetDir = join(globalBaseDir, 'platforms', parts[0]);
                targetFilename = parts[parts.length - 1];
              }
            } else if (filename === 'REQUIREMENT.md') {
              // v6.81.0+: REQUIREMENT.md 默认路由到 requirements/
              targetDir = join(globalBaseDir, 'requirements');
              targetFilename = filename;
            } else if (globalSet.has(filename)) {
              // v7.2.0+: 全局技术文档统一放入 overview/ 子目录，与迭代层命名一致
              targetDir = join(globalBaseDir, 'overview');
              targetFilename = filename;
            } else {
              // v7.2.0+: 未知文件也归入 overview/ 子目录
              targetDir = join(globalBaseDir, 'overview');
              targetFilename = filename;
            }

            await ensureDir(targetDir);
            const fp = join(targetDir, targetFilename);
            if (!(await shouldOverwrite(fp, !!options.interactive))) { logger.info(`   ⏭️  跳过: ${filename}`); continue; }
            const bk = await backupWithTimestamp(fp);
            if (bk) {
              backups.push(bk);
              logger.info(`   📦 ${filename} 旧版已备份: ${bk.split('/').pop()}`);
            }
            await writeFile(fp, content);
            count++;
          }

          logger.success(`✅ ${count} 个全局文档已写入 .speccore/GLOBAL/`);

          // v7.2.0+: 全局文档质量门禁
          const { runGlobalQualityGate, printQualityReport } = await import('../core/doc-quality-gate');
          const reports = await runGlobalQualityGate();
          printQualityReport(reports);

          // v7.2.0+: 自动生成文档间交叉引用
          const { generateCrossReferences } = await import('../core/doc-cross-reference');
          await generateCrossReferences();
        } else {
          // 迭代级：写 020-specs/（综合文档写入 global/ 子目录，v6.41.0+）
          // v6.69.2+: 增加端名白名单校验，防止 AI 创建非法目录
          const specDir = join(iterDir!, '020-specs');
          await ensureDir(specDir);
          const globalSet = new Set(GLOBAL_SPEC_FILES);
          const validPlatforms = new Set([GLOBAL_SPECS_DIR, ...(await parsePlatformList())]);
          let skippedCount = 0;

          for (const [filename, content] of Object.entries(docs)) {
            // v6.80.0+: 010-requirements/ 路径处理（clarify 结果写入）
            if (filename.startsWith('010-requirements/')) {
              const reqFilePath = filename.slice('010-requirements/'.length);
              const reqDir = join(iterDir!, '010-requirements');
              const fp = join(reqDir, reqFilePath);
              await ensureDir(dirname(fp));
              // 为 clarified 文件添加头部元信息
              let finalContent = content;
              if (reqFilePath.startsWith('converted/clarified-') && !content.startsWith('---')) {
                finalContent = buildClarifiedHeader(reqFilePath) + content;
              }
              await writeFile(fp, finalContent);
              logger.info(`   📝 需求文档已写入: ${reqFilePath}`);
              count++;
              continue;
            }

            // v6.72.0+: PATTERNS/ 文件特殊处理 → 写入 .speccore/PATTERNS/
            if (filename.startsWith('PATTERNS/')) {
              const patternsDir = join(process.cwd(), '.speccore', 'PATTERNS');
              await ensureDir(patternsDir);
              const patternFile = filename.slice('PATTERNS/'.length);
              const fp = join(patternsDir, patternFile);
              // PATTERNS 文件：追加模式（不覆盖，合并内容）
              let existing = '';
              if (await pathExists(fp)) {
                existing = await readFile(fp, 'utf-8');
              }
              const merged = existing ? `${existing}\n\n---\n\n${content}` : content;
              await writeFile(fp, merged);
              logger.info(`   🧩 PATTERN 已追加: ${patternFile}`);
              count++;
              continue;
            }

            // v7.4.0+: 文件名归一化——剥离 AI 可能携带的 overview/ 前缀，防止嵌套目录
            let cleanFilename = filename;
            if (cleanFilename.startsWith(`${GLOBAL_SPECS_DIR}/`)) {
              cleanFilename = cleanFilename.slice(`${GLOBAL_SPECS_DIR}/`.length);
            }
            // v7.4.0+: 如果 AI 携带了其他未知目录前缀（非端名），剥离前缀只保留文件名
            if (cleanFilename.includes('/')) {
              const prefix = cleanFilename.split('/')[0];
              if (!validPlatforms.has(prefix)) {
                logger.warn(`   ⚠️ 文件名含未知目录前缀 "${prefix}/"，已自动剥离: ${cleanFilename}`);
                cleanFilename = cleanFilename.split('/').pop()!;
              }
            }

            // 解析目录名（如 "admin-web/TECH.md" → "admin-web"）
            const platformDir = cleanFilename.includes('/') ? cleanFilename.split('/')[0] : null;

            // 白名单校验：如果包含目录前缀，必须是合法端名
            if (platformDir && !validPlatforms.has(platformDir)) {
              logger.warn(`   ⚠️ 跳过非法端目录: ${platformDir}（文件: ${cleanFilename}）`);
              logger.warn(`      合法端: ${Array.from(validPlatforms).join(', ')}`);
              skippedCount++;
              continue;
            }

            // 综合文档写入 overview/ 子目录，端专属文档写入 {端}/ 子目录
            const targetDir = globalSet.has(cleanFilename)
              ? join(specDir, GLOBAL_SPECS_DIR)
              : options.platform ? join(specDir, options.platform) : specDir;
            await ensureDir(targetDir);
            const fp = join(targetDir, cleanFilename);
            if (!(await shouldOverwrite(fp, !!options.interactive))) { logger.info(`   ⏭️  跳过: ${filename}`); continue; }
            const bk = await backupWithTimestamp(fp);
            if (bk) {
              backups.push(bk);
              logger.info(`   📦 ${filename} 旧版已备份: ${bk.split('/').pop()}`);
            }
            await writeFile(fp, content);
            count++;
          }
          if (skippedCount > 0) {
            logger.warn(`⚠️ 共跳过 ${skippedCount} 个非法目录的文档，请检查 AI 输出是否包含非端名目录`);
          }
          logger.success(`✅ ${count} 个 Spec 文档已写入 020-specs/`);

          // v6.90.0+: 事后校验——检测并清理 AI 绕过 --apply 创建的非法目录/文件
          await sanitizeSpecDirectories(iterDir!);

          // v7.4.0+: 从 AI 输出中提取疑问并持久化
          const extractedQs = extractQuestionsFromText(options.apply);
          if (extractedQs.length > 0) {
            await writeQuestions(
              { command: 'analyze', scope: options.iteration || 'unknown' },
              extractedQs,
            );
          }

          // v6.74.0+: 流式分析自动检查（回退检测 + 最终核对）
          if (options.streamingPhase) {
            const phase = options.streamingPhase as import('../core/streaming-analyzer').AnalyzePhase;
            if (phase === 'phase1-backend' || phase === 'phase3-frontend') {
              logger.info('');
              logger.info('🔍 流式分析回退检测...');
              const bt = await detectBacktrackingNeeds(iterDir!, phase);
              if (bt.needed) {
                logger.warn(`   ⚠️ 检测到 ${bt.targets.length} 个文档需要回退修正:`);
                for (let i = 0; i < bt.targets.length; i++) {
                  logger.warn(`      - ${bt.targets[i]}: ${bt.reasons[i]}`);
                }
                logger.info('   💡 请在下一 Phase 前先修正上述文档');
              } else {
                logger.info('   ✅ 无回退需求，继续下一 Phase');
              }
            }
            if (phase === 'phase6-final-audit') {
              logger.info('');
              logger.info('🔍 执行最终核对检查...');
              const auditIssues = await runFinalAudit(iterDir!);
              if (auditIssues.length > 0) {
                const errors = auditIssues.filter(i => i.severity === 'error');
                const warnings = auditIssues.filter(i => i.severity === 'warning');
                if (errors.length > 0) {
                  logger.error(`   ❌ 发现 ${errors.length} 个错误:`);
                  for (const e of errors) {
                    logger.error(`      - ${e.description}`);
                  }
                }
                if (warnings.length > 0) {
                  logger.warn(`   ⚠️ 发现 ${warnings.length} 个警告:`);
                  for (const w of warnings) {
                    logger.warn(`      - ${w.description}`);
                  }
                }
              } else {
                logger.info('   ✅ 最终核对通过，所有文档完整一致');
              }
            }
          }

          // v6.72.0+: FUNCTION_MAP.md 自检
          const fmContent = docs['FUNCTION_MAP.md'] || docs['overview/FUNCTION_MAP.md'] || docs['global/FUNCTION_MAP.md'];
          if (fmContent) {
            const platforms = Array.from(validPlatforms);
            const fmResult = validateFunctionMap(fmContent, platforms);
            if (!fmResult.valid || fmResult.warnings.length > 0) {
              logger.info('');
              logger.info('📋 FUNCTION_MAP.md 自检结果:');
              for (const err of fmResult.errors) {
                logger.error(`   ❌ ${err}`);
              }
              for (const warn of fmResult.warnings) {
                logger.warn(`   ⚠️ ${warn}`);
              }
              if (fmResult.valid && fmResult.warnings.length > 0) {
                logger.info('   💡 警告不影响写入，但建议修正后重新分析');
              }
            } else {
              logger.info('   ✅ FUNCTION_MAP.md 自检通过');
            }
          }
        }
        printBackupSummary();
        return;
      } catch {
        // fallback to single-file mode
      }
    }

    // 单文件模式
    if (isTaskLevel && taskDir) {
      // 任务级：写 Task/00-specs/（v6.44.0+）
      const targetSubDir = '00-specs';
      const taskSpecDir = join(taskDir, targetSubDir);
      await ensureDir(taskSpecDir);
      const taskAnalysisPath = join(taskSpecDir, 'ANALYSIS.md');
      if (await shouldOverwrite(taskAnalysisPath, !!options.interactive)) {
        const taskBackup = await backupWithTimestamp(taskAnalysisPath);
        if (taskBackup) {
          backups.push(taskBackup);
          logger.info(`   📦 旧版已备份: ${taskBackup.split('/').pop()}`);
        }
        await writeFile(taskAnalysisPath, options.apply);
        const platformLabel = options.platform ? `/${options.platform}` : '';
        logger.success(`✅ ANALYSIS.md 已写入 ${options.task}${platformLabel}/`);
      } else { logger.info(`   ⏭️  用户取消覆盖`); }
    } else if (isGlobalScope) {
      // 全局级：写 .speccore/GLOBAL/ANALYSIS.md
      const globalDir = join(process.cwd(), '.speccore', 'GLOBAL');
      await ensureDir(globalDir);
      const globalAnalysisPath = join(globalDir, 'ANALYSIS.md');
      if (await shouldOverwrite(globalAnalysisPath, !!options.interactive)) {
        const globalBackup = await backupWithTimestamp(globalAnalysisPath);
        if (globalBackup) {
          backups.push(globalBackup);
          logger.info(`   📦 旧版已备份: ${globalBackup.split('/').pop()}`);
        }
        await writeFile(globalAnalysisPath, options.apply);
        logger.success(`✅ ANALYSIS.md 已写入 .speccore/GLOBAL/`);
      } else { logger.info(`   ⏭️  用户取消覆盖`); }
    } else {
      // 迭代级：写 020-specs/overview/（迭代综合文档，v6.78.0+）
      const specDir = join(iterDir!, '020-specs');
      const globalDir = join(specDir, GLOBAL_SPECS_DIR);
      await ensureDir(globalDir);
      const iterAnalysisPath = join(globalDir, 'ANALYSIS.md');
      if (await shouldOverwrite(iterAnalysisPath, !!options.interactive)) {
        const iterBackup = await backupWithTimestamp(iterAnalysisPath);
        if (iterBackup) {
          backups.push(iterBackup);
          logger.info(`   📦 旧版已备份: ${iterBackup.split('/').pop()}`);
        }
        await writeFile(iterAnalysisPath, options.apply);
        logger.success(`✅ ANALYSIS.md 已写入 020-specs/overview/`);
      } else { logger.info(`   ⏭️  用户取消覆盖`); }
    }
    // ── --sync: 任务分析后局部回写 020-specs/ ──
    if (options.sync && isTaskLevel && taskDir) {
      logger.info('');
      logger.info('🔄 局部回写: 将任务分析结果同步到 020-specs/ ...');
      try {
        const { syncTaskToSpecs } = await import('../core/spec-merger');
        const iterDirPath = iterDir!;
        const taskName = options.task || '';
        const mergeResult = await syncTaskToSpecs(iterDirPath, taskDir, taskName);
        if (mergeResult.filesUpdated > 0) {
          logger.success(`✅ 局部回写完成: ${mergeResult.filesUpdated} 个 spec 文件已更新`);
        } else {
          logger.info('   ℹ️ 未找到匹配的 spec 文件，无需回写');
        }
      } catch (e) {
        logger.debug('局部回写失败（非关键）:', e);
      }
    }

    printBackupSummary();

    // 自动刷新知识图谱（v6.49.10+）
    if (options.iteration) {
      try {
        const { refreshKnowledgeGraph } = await import('../core/knowledge-graph');
        await refreshKnowledgeGraph(process.cwd(), options.iteration);
        logger.info('🧠 知识图谱已刷新');
      } catch {}
    }

    // ── v6.68.0+: Pipeline 自动推进 ──
    // v6.69.0+: 支持全局 Pipeline 推进（增强策略二）
    if (!isTaskLevel) {
      const isGlobalScope = options.scope === 'global';
      const pipelineKey = isGlobalScope ? 'GLOBAL' : options.iteration;
      if (!pipelineKey) return;

      const hasPipeline = await PipelineEngine.hasActivePipeline(process.cwd(), pipelineKey);
      if (hasPipeline) {
        const { createAnalyzePipeline, createGlobalAnalyzePipeline } = await import('../core/pipeline-engine');

        // v6.69.0+: 推进时保持与初始化时相同的过滤和排序条件
        let engine: PipelineEngine;
        if (isGlobalScope) {
          engine = (await createGlobalAnalyzePipeline()).engine;
        } else {
          const { detectAffectedPlatforms, detectPlatformPriorityOrder } = await import('../core/change-detection');
          const affectedPlatforms = await detectAffectedPlatforms(process.cwd());
          const platformOrder = await detectPlatformPriorityOrder(options.iteration!);
          engine = (await createAnalyzePipeline(options.iteration!, process.cwd(), {
            affectedPlatforms: affectedPlatforms.length > 0 ? affectedPlatforms : undefined,
            platformOrder: platformOrder.length > 0 ? platformOrder : undefined,
          })).engine;
        }
        await engine.advance();

        const state = await engine.getState();
        if (state?.currentStep === 'done') {
          logger.success('🎉 Pipeline 完成!');
          // v6.69.1: 记录分析快照，支持下次增量分析
          const snapshotScope = isGlobalScope ? 'global' : (options.iteration ? `Iteration-${options.iteration}` : 'unknown');
          await recordAnalysisSnapshot(snapshotScope);
          await engine.reset();
        } else if (state?.currentStep) {
          logger.info('');
          logger.info(`🔄 Pipeline 推进: ${state.currentStep}`);
          logger.info('');

          // 生成下一步 prompt（v6.69.0+: 适配全局/迭代层步骤）
          let nextPrompt: string;
          const nextPlatformMatch = state.currentStep.match(/^platform-(.+)-prompt$/);

          if (isGlobalScope) {
            // 全局层 Pipeline 步骤映射
            if (state.currentStep === 'global-analysis') {
              nextPrompt = await buildMultiDocPrompt('analyze', {
                iteration: options.iteration || 'GLOBAL', scope: 'global', withCode: options.withCode,
              });
            } else if (state.currentStep === 'consistency-check') {
              nextPrompt = `\n# 任务: 全局一致性检查\n\n` +
                `检查各迭代、各端之间的规格是否一致。\n` +
                `重点检查：接口定义冲突、数据模型不一致、命名规范违规。\n`;
            } else if (state.currentStep === 'report-generation') {
              nextPrompt = `\n# 任务: 生成全局索引报告\n\n` +
                `汇总所有分析结果，生成 .speccore/GLOBAL/INDEX.md。\n`;
            } else {
              nextPrompt = await buildMultiDocPrompt('analyze', {
                iteration: options.iteration || 'GLOBAL', scope: 'global', withCode: options.withCode,
              });
            }
          // v6.80.0+: clarify 阶段推进
          } else if (state.currentStep === 'clarify-prompt') {
            nextPrompt = await buildClarifyPhasePrompt(options.iteration!);
          } else if (state.currentStep === 'confirm-check') {
            nextPrompt = await buildConfirmCheckPrompt(options.iteration!);
          } else if (state.currentStep === 'contract-prompt') {
            nextPrompt = await buildContractFirstPrompt(options.iteration!);
          } else if (nextPlatformMatch) {
            const platform = nextPlatformMatch[1];
            nextPrompt = await buildMultiDocPrompt('analyze', {
              iteration: options.iteration!,
              phase: '2',
              platform,
            });
          } else if (state.currentStep === 'phase2-prompt') {
            // 兼容旧 Pipeline 步骤名
            nextPrompt = await buildMultiDocPrompt('analyze', {
              iteration: options.iteration!,
              phase: '2',
            });
          } else {
            nextPrompt = await buildMultiDocPrompt('analyze', {
              iteration: options.iteration!,
            });
          }

          process.stdout.write(`[SPECCORE_PIPELINE_NEXT]\n${nextPrompt}`);
          process.exitCode = 10;
        }

        return;
      }
    }

    // ── v6.64.0+: Phase 1 完成后自动触发 Phase 2（仅多端项目，非 Pipeline 模式）──
    if (!options.phase && !isTaskLevel && options.iteration) {
      // 检查是否有多个端
      const platforms = await parsePlatformList();
      
      // 只有多端项目(≥2 个端)才需要分两阶段:
      // - Phase 1: 生成综合文档(overview/REQUIREMENT.md、ANALYSIS.md、DEPS.md)
      // - Phase 2: 生成各端专属文档({端}/TECH.md、TEST.md、UI_SPEC.md)
      // 
      // 单端项目(=1 个端)不需要分阶段:
      // - Phase 1 生成的 overview/TECH.md 本身就是该端的专属文档
      // - 不需要再生成 {端}/TECH.md(会重复)
      if (platforms.length >= 2) {
        logger.info('');
        logger.info(`🔄 Phase 1 已完成，检测到 ${platforms.length} 个端 (${platforms.join(', ')})`);
        logger.info('⚠️  请手动执行以下命令以生成各端专属文档：');
        logger.info(`   speccore analyze --prompt -I ${options.iteration} --phase 2`);
        logger.info('');
        logger.info('💡 为什么需要手动执行？');
        logger.info('   - apply 命令和 prompt 命令是两个独立的调用');
        logger.info('   - AI 在 apply 命令完成后不会自动等待下一个 prompt');
        logger.info('   - 需要用户确认 Phase 1 结果满意后，再手动触发 Phase 2');
        logger.info('');
        logger.info('💡 提示: 使用 --pipeline 选项可自动执行 Phase 1 → Phase 2');
        logger.info(`   speccore analyze --prompt --pipeline -I ${options.iteration}`);
        logger.info('');
      } else if (platforms.length === 0) {
        // 如果没有检测到端列表，输出警告
        logger.warn('⚠️ 未检测到端列表，请检查 .speccore/CONSTITUTION.md 是否配置了「端列表」');
        logger.warn('   建议：在 CONSTITUTION.md 中添加端列表，或手动执行 speccore analyze --phase 2 -I <迭代名>');
      }
      // platforms.length === 1: 单端项目，Phase 1 已完成，无需 Phase 2
    }

    return;
  }

  // ── 非 prompt/apply 模式 → 自动转为 prompt 模式，所有分析必须经 AI 执行 ──
  if (!options.prompt && !options.apply) {
    options.prompt = true;
  }

  // ── Prompt 模式 ──
  if (options.prompt) {
    // v6.97.0+ 修复：全局分析时不应 fallback 到当前迭代
    const iter = options.scope === 'global' ? 'GLOBAL' : (options.iteration || await getDefaultIteration());

    // v7.2.0+: 保存分析上下文到临时目录
    if (iter && iter !== 'GLOBAL') {
      try {
        const { saveAnalysisContext } = await import('../core/iteration-cache');
        await saveAnalysisContext({
          iteration: iter,
          docName: options.docName,
          featureName: options.featureName,
          withCode: options.withCode,
          timestamp: new Date().toISOString(),
        });
      } catch { /* ignore */ }
    }

    const prompt = await buildMultiDocPrompt('analyze', { iteration: iter, task: options.task, type: options.type, scope: options.scope, withCode: options.withCode, platform: options.platform, phase: options.phase, autoMode: options.auto }, options);
    process.stdout.write(`[SPECCORE_PROMPT]\n${prompt}`);

    // v7.2.0+: 全局分析完成后输出下一步引导
    if (options.scope === 'global') {
      const guide = await buildGlobalAnalysisGuide(options);
      if (guide) {
        process.stdout.write(`\n[SPECCORE_GUIDE]\n${guide}`);
      }
    }

    process.exitCode = 10;
    return;
  }
}

/**
 * v6.49.13+: 预创建 020-specs/ 目录结构
 * CLI 控制目录创建（确定性操作），AI 只负责内容生成
 */
async function preCreateSpecDirectories(iteration: string): Promise<void> {
  const iterDir = await getIterationDir(iteration);
  const specDir = join(iterDir, '020-specs');
  await ensureDir(specDir);

  // 预创建 overview/ 子目录（v6.78.0+ 从 global/ 改名）
  const globalDir = join(specDir, GLOBAL_SPECS_DIR);
  await ensureDir(globalDir);

  // 读取端列表并预创建各端目录
  const platforms = await parsePlatformList();
  for (const platform of platforms) {
    await ensureDir(join(specDir, platform));
  }

  if (platforms.length > 0) {
    logger.info(`📁 已预创建 020-specs/ 目录结构: ${GLOBAL_SPECS_DIR}/ + ${platforms.length} 个端目录 (${platforms.join(', ')})`);
  } else {
    logger.info(`📁 已预创建 020-specs/ 目录结构: ${GLOBAL_SPECS_DIR}/`);
  }
}

/**
 * v6.90.0+: 事后校验——检测并清理 020-specs/ 下 AI 绕过 --apply 创建的非法目录和文件
 * 
 * 解决的问题：AI 用 Write 工具直接写文件，绕过 CLI --apply，导致：
 * - 非法子目录（如 1001/、工程标识/、错误码/）
 * - 遗留的 global/ 旧目录（应迁移到 overview/）
 * - 根目录散落的 .md 文件（应在 overview/ 内）
 */
async function sanitizeSpecDirectories(iterDir: string): Promise<void> {
  const specDir = join(iterDir, '020-specs');
  if (!await pathExists(specDir)) return;

  const platforms = await parsePlatformList();
  const validDirs = new Set([GLOBAL_SPECS_DIR, ...platforms]);
  const globalSet = new Set(GLOBAL_SPEC_FILES);

  const entries = await readdir(specDir);
  let illegalDirCount = 0;
  let orphanFileCount = 0;
  let legacyGlobalMigrated = false;

  for (const entry of entries) {
    const entryPath = join(specDir, entry);
    const entryStat = await stat(entryPath);

    if (entryStat.isDirectory()) {
      // 检测遗留的 global/ 目录（v6.78.0+ 已改名为 overview/）
      if (entry === 'global') {
        logger.warn(`⚠️ 检测到遗留 global/ 目录（v6.78.0+ 已改名为 ${GLOBAL_SPECS_DIR}/）`);
        // 将 global/ 中的文件迁移到 overview/
        const globalFiles = await readdir(entryPath);
        const overviewDir = join(specDir, GLOBAL_SPECS_DIR);
        await ensureDir(overviewDir);
        for (const f of globalFiles) {
          const src = join(entryPath, f);
          const dest = join(overviewDir, f);
          if (!await pathExists(dest)) {
            await rename(src, dest);
            logger.info(`   📦 迁移: global/${f} → ${GLOBAL_SPECS_DIR}/${f}`);
          }
        }
        // 删除空的 global/ 目录
        const remaining = await readdir(entryPath);
        if (remaining.length === 0) {
          await rename(entryPath, join(specDir, `global.migrated-${Date.now()}`));
          logger.info(`   🗑️ global/ 已迁移并归档`);
        } else {
          logger.warn(`   ⚠️ global/ 仍有 ${remaining.length} 个文件未迁移，已重命名归档`);
          await rename(entryPath, join(specDir, `global.archived-${Date.now()}`));
        }
        legacyGlobalMigrated = true;
        continue;
      }

      // 白名单校验：非 overview/ 且非端名的目录 → 非法
      if (!validDirs.has(entry)) {
        const archivedName = `${entry}.invalid-${Date.now()}`;
        await rename(entryPath, join(specDir, archivedName));
        logger.warn(`⚠️ 非法目录已归档: 020-specs/${entry}/ → ${archivedName}/`);
        illegalDirCount++;
      }
    } else if (entryStat.isFile()) {
      // 根目录散落的 .md 文件 → 检查是否应归入 overview/
      if (entry.endsWith('.md') && globalSet.has(entry)) {
        const overviewDir = join(specDir, GLOBAL_SPECS_DIR);
        await ensureDir(overviewDir);
        const dest = join(overviewDir, entry);
        if (!await pathExists(dest)) {
          await rename(entryPath, dest);
          logger.warn(`⚠️ 散落文件已归位: 020-specs/${entry} → ${GLOBAL_SPECS_DIR}/${entry}`);
          orphanFileCount++;
        } else {
          // overview/ 中已有同名文件，归档根目录版本
          const archivedName = `${entry}.orphan-${Date.now()}`;
          await rename(entryPath, join(specDir, archivedName));
          logger.warn(`⚠️ 重复散落文件已归档: 020-specs/${entry} → ${archivedName}`);
          orphanFileCount++;
        }
      }
    }
  }

  // 汇总报告
  if (illegalDirCount > 0 || orphanFileCount > 0 || legacyGlobalMigrated) {
    logger.info('');
    logger.info(`🔍 020-specs/ 目录校验报告:`);
    if (illegalDirCount > 0) logger.warn(`   ⚠️ ${illegalDirCount} 个非法目录已归档（AI 绕过 --apply 创建）`);
    if (orphanFileCount > 0) logger.warn(`   ⚠️ ${orphanFileCount} 个散落文件已归位到 ${GLOBAL_SPECS_DIR}/`);
    if (legacyGlobalMigrated) logger.info(`   📦 遗留 global/ 已迁移到 ${GLOBAL_SPECS_DIR}/`);
    logger.info(`   ✅ 当前合法目录: ${Array.from(validDirs).join(', ')}`);
  }
}

/**
 * 迭代创建全套规范文件
 */
async function generateIterationSpecDocs(iteration: string): Promise<void> {
  const iterDir = await getIterationDir(iteration);
  const specDir = join(iterDir, '020-specs');
  const globalDir = join(specDir, GLOBAL_SPECS_DIR);
  await ensureDir(globalDir);

  const now = new Date().toISOString().split('T')[0];
  // 综合文档模板 → 写入 global/ 子目录（v6.41.0+）
  const globalTemplates: [string, string][] = [
    ['REQUIREMENT.md',
      `# 本期需求文档\n\n> 迭代：${iteration}\n> 时间范围：${new Date().toISOString().split('T')[0]}\n\n`
      + `## 1. 需求概述\n\n### 1.1 背景\n\n### 1.2 目标\n\n### 1.3 范围\n\n`
      + `## 2. 功能需求\n\n### 2.1 功能模块一\n\n### 2.2 功能模块二\n\n`
      + `## 3. 非功能需求\n\n### 3.1 性能\n\n### 3.2 安全\n\n### 3.3 兼容性\n\n`
      + `## 4. 验收标准\n\n## 5. 附录\n`],
    ['RISK.md',
      `# 风险评估\n\n> 迭代: ${iteration} | 生成: ${now}\n\n`
      + `## 风险矩阵\n\n| 风险 | 可能性 | 影响 | 缓解措施 |\n| :--- | :--- | :--- | :--- |\n| | | | |\n\n`
      + `## 回滚方案\n\n1. 触发条件: _待定_\n2. 回滚步骤: _待定_\n`],
    ['DEPS.md',
      `# 依赖清单\n\n> 迭代: ${iteration}\n\n`
      + `## 上游依赖\n\n| 服务 | 版本 | 用途 | SLA |\n| :--- | :--- | :--- | :--- |\n| | | | |\n\n`
      + `## 下游影响\n\n| 消费方 | 接口 | 影响 |\n| :--- | :--- | :--- |\n| | | |\n`],
    ['REVIEW.md',
      `# Code Review 清单\n\n> 迭代: ${iteration}\n\n`
      + `## 检查项\n\n- [ ] 参数校验完整性\n- [ ] 幂等性处理\n- [ ] 索引覆盖\n- [ ] 迁移脚本可回滚\n- [ ] 鉴权配置\n- [ ] 日志规范\n`],
    ['MONITOR.md',
      `# 监控指标\n\n> 迭代: ${iteration}\n\n`
      + `## 业务指标\n\n| 指标 | 阈值 | 级别 |\n| :--- | :--- | :--- |\n| 成功率 | <99.9% | P1 |\n| P99延迟 | >1000ms | P2 |\n\n`
      + `## 告警规则\n\n| 规则 | 条件 | 通知 |\n| :--- | :--- | :--- |\n| | | |\n`],
    ['TECH.md',
      `# 技术架构（跨端全局）\n\n> 迭代: ${iteration} | 生成: ${now}\n\n`
      + `## 整体架构\n\n_待填充_\n\n`
      + `## 跨端交互\n\n| 调用方 | 被调方 | 协议 | 说明 |\n| :--- | :--- | :--- | :--- |\n| | | | |\n\n`
      + `## 中间件选型\n\n| 组件 | 用途 | 版本 |\n| :--- | :--- | :--- |\n| | | |\n\n`
      + `## 数据库设计\n\n| 表名 | 字段 | 索引 | 说明 |\n| :--- | :--- | :--- | :--- |\n| | | | |\n`],
  ];

  // 端无关模板 → 写入 020-specs/ 根目录（各端分析时覆盖）
  const rootTemplates: [string, string][] = [
    ['TEST.md',
      `# 测试计划\n\n> 迭代: ${iteration} | 生成: ${now}\n\n`
      + `## 单元测试\n\n- [ ] 核心模块覆盖\n\n`
      + `## 集成测试\n\n- [ ] API 端到端\n\n`
      + `## 边界测试\n\n- [ ] 异常参数\n- [ ] 超时重试\n- [ ] 并发冲突\n\n`
      + `## 性能测试\n\n- [ ] 压测方案\n`],
  ];

  let created = 0;
  let skipped = 0;
  // 写入综合文档到 global/
  for (const [filename, content] of globalTemplates) {
    const filePath = join(globalDir, filename);
    if (!(await pathExists(filePath))) {
      await writeFile(filePath, content);
      created++;
    } else {
      skipped++;
    }
  }
  // 写入端无关模板到根目录
  for (const [filename, content] of rootTemplates) {
    const filePath = join(specDir, filename);
    if (!(await pathExists(filePath))) {
      await writeFile(filePath, content);
      created++;
    } else {
      skipped++;
    }
  }

  logger.info(`\n📄 Spec 文档: 新建 ${created} 个, 跳过 ${skipped} 个 (已存在) → ${specDir}/ (global/ + 根目录)`);
}

/**
 * 任务级文档补全 (原 perTaskAnalyze 逻辑)
 */
async function enrichTaskDocs(iteration: string, taskId: string, reqFiles: string[]): Promise<void> {
  const { readdirSync } = require('fs');
  const iterDir = await getIterationDir(iteration);
  
  if (!(await pathExists(iterDir))) return;

  const entries = readdirSync(iterDir, { withFileTypes: true });
  const taskEntry = entries.find((e: any) => e.isDirectory() && e.name.startsWith(taskId));
  // enrichTaskDocs continues, but taskEntry logic remains...
  if (!taskEntry) return;
  
  if (!taskEntry) {
    logger.info(`   ℹ️ 未找到任务目录 ${taskId}，跳过文档补全`);
    return;
  }

  const fullTaskDir = join(iterDir, taskEntry.name);
  // 向后兼容: _shared/ → 00-specs/
  const specsDir = (await pathExists(join(fullTaskDir, '_shared')))
    ? join(fullTaskDir, '_shared')
    : join(fullTaskDir, '00-specs');
  
  if (!(await pathExists(specsDir))) return;

  let reqContent = '';
  
  // 读取任务 REQ 或传入的需求文件
  const taskReqPath = join(specsDir, 'REQ.md');
  if (await pathExists(taskReqPath)) {
    reqContent = await require('fs-extra').readFile(taskReqPath, 'utf-8');
  } else if (reqFiles.length > 0) {
    for (const f of reqFiles) {
      if (await pathExists(f)) reqContent += await require('fs-extra').readFile(f, 'utf-8') + '\n';
    }
  }

  if (!reqContent) return;

  // 补全 TECH.md
  const techPath = join(specsDir, 'TECH.md');
  let techContent = '';
  if (await pathExists(techPath)) {
    techContent = await require('fs-extra').readFile(techPath, 'utf-8');
    if (!techContent.includes('## 分析建议')) {
      const items: string[] = [];
      const apis = (reqContent.match(/\/api\/[a-zA-Z0-9\/-]+/g) || []).map((a: string) => a.trim());
      if (apis.length > 0) {
        items.push(`检测到 ${apis.length} 个 API:`);
        for (const api of [...new Set(apis)]) items.push(`  \`${api}\``);
      }
      if (reqContent.match(/数据库|表|DDL/)) items.push('涉及数据库变更，请补充 DDL');
      if (reqContent.match(/权限|RBAC|鉴权/)) items.push('涉及权限控制，注意鉴权边界');
      if (items.length > 0) {
        techContent += `\n\n---\n\n## 分析建议\n\n> 自动生成\n\n${items.map(i => `- ${i}`).join('\n')}\n`;
        await writeFile(techPath, techContent);
        logger.info(`   📄 更新 TECH.md`);
      }
    }
  }

  // 补全 TEST.md（v6.49.9+: 扫描平铺的端目录）
  const testFiles: string[] = [];
  const subtaskPaths = await getSubtaskDirs(fullTaskDir);
  for (const stDir of subtaskPaths) {
    const fp = join(stDir, 'TEST.md');
    if (await pathExists(fp)) testFiles.push(fp);
  }
  if (testFiles.length === 0) {
    const legacy = join(fullTaskDir, '99-artifacts', 'TEST.md');
    if (await pathExists(legacy)) testFiles.push(legacy);
  }
  for (const testPath of testFiles) {
    let testContent = await require('fs-extra').readFile(testPath, 'utf-8');
    if (!testContent.includes('## 补充分析')) {
      const items: string[] = [];
      if (reqContent.includes('POST') || reqContent.includes('创建')) items.push('[ ] 正常参数 + 异常参数测试');
      if (reqContent.includes('GET') || reqContent.includes('查询')) items.push('[ ] 分页 / 筛选 / 空结果测试');
      if (reqContent.includes('DELETE') || reqContent.includes('删除')) items.push('[ ] 删除确认 + 级联处理');
      if (reqContent.includes('权限') || reqContent.includes('RBAC')) items.push('[ ] 无权限访问 + 越权检测');
      if (items.length > 0) {
        testContent += `\n\n---\n\n## 补充分析\n${items.join('\n')}\n`;
        await writeFile(testPath, testContent);
        logger.info(`   📄 更新 ${testPath.replace(fullTaskDir + '/', '')}`);
      }
    }
  }

  // 补全 REVIEW.md（v6.49.9+: 扫描平铺的端目录）
  const reviewFiles: string[] = [];
  for (const stDir of subtaskPaths) {
    const fp = join(stDir, 'REVIEW.md');
    if (await pathExists(fp)) reviewFiles.push(fp);
  }
  if (reviewFiles.length === 0) {
    const legacy = join(fullTaskDir, '99-artifacts', 'REVIEW.md');
    if (await pathExists(legacy)) reviewFiles.push(legacy);
  }
  for (const reviewPath of reviewFiles) {
    let reviewContent = await require('fs-extra').readFile(reviewPath, 'utf-8');
    if (!reviewContent.includes('## 本任务专项检查')) {
      const items: string[] = [];
      if (reqContent.includes('POST') || reqContent.includes('创建')) items.push('[ ] 参数校验 + 幂等性处理');
      if (reqContent.includes('数据库') || reqContent.includes('表')) items.push('[ ] 索引覆盖 + 迁移脚本可回滚');
      if (reqContent.includes('权限') || reqContent.includes('RBAC')) items.push('[ ] 鉴权注解/中间件正确配置');
      if (items.length > 0) {
        reviewContent += `\n\n---\n\n## 本任务专项检查\n${items.join('\n')}\n`;
        await writeFile(reviewPath, reviewContent);
        logger.info(`   📄 更新 ${reviewPath.replace(fullTaskDir + '/', '')}`);
      }
    }
  }

  // 创建缺失文件（v6.49.9+: 扫描平铺的端目录）
  const subtaskDirs: string[] = subtaskPaths;
  // 旧结构回退
  if (subtaskDirs.length === 0) {
    const legacyArtifacts = join(fullTaskDir, '99-artifacts');
    if (await pathExists(legacyArtifacts)) subtaskDirs.push(legacyArtifacts);
    else subtaskDirs.push(fullTaskDir); // 最后回退到任务根
  }

  const templates: [string, string][] = [
    ['RISK.md', `# 风险评估\n\n> analyze | ${new Date().toISOString().split('T')[0]}\n\n## 风险矩阵\n| 风险 | 可能 | 影响 | 缓解 |\n| :--- | :--- | :--- | :--- |\n| 兼容性 | 中 | 高 | 版本号+测试 |\n\n## 回滚\n1. 触发: 线上错误率 > 1%\n2. 步骤: git revert → 重部署\n`],
    ['DEPS.md', `# 依赖清单\n\n## 上游依赖\n| 服务 | 版本 | 用途 |\n| :--- | :--- | :--- |\n| _待补充_ | — | — |\n`],
    ['MONITOR.md', `# 监控\n\n## 关键指标\n| 指标 | 阈值 | 级别 |\n| :--- | :--- | :--- |\n| 成功率 | <99.9% | P1 |\n| P99延迟 | >1000ms | P2 |\n`],
  ];

  for (const subtaskDir of subtaskDirs) {
    for (const [filename, content] of templates) {
      const fp = join(subtaskDir, filename);
      if (!(await pathExists(fp))) {
        await writeFile(fp, content);
        logger.info(`   📄 创建 ${fp.replace(fullTaskDir + '/', '')}`);
      }
    }
  }
}

/**
 * 从 process.argv 手动解析选项 (Commander.js 偶发不传递部分选项)
 */
function parseArgv(options: AnalyzeOptions): void {
  const argv = process.argv;
  const strFlags: [string[], (v: string) => void][] = [
    [['--iteration', '-i', '-I'], (v) => { options.iteration = v; }],
    [['--task', '-t'], (v) => { options.task = v; }],
    [['--platform'], (v) => { options.platform = v; }],
    [['--scope'], (v) => { options.scope = v as any; }],
    [['--src', '--source'], (v) => { options.source = v; }],
    [['--req', '--requirements'], (v) => { options.requirements = v; }],
    [['--output', '-o'], (v) => { options.output = v; }],
    [['--depth'], (v) => { options.depth = v as any; }],
    [['--feature'], (v) => { options.feature = v; }],
    [['--phase'], (v) => { options.phase = v; }],
  ];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    for (const [flags, setter] of strFlags) {
      for (const flag of flags) {
        // --flag value
        if (arg === flag && i + 1 < argv.length) {
          setter(argv[i + 1]);
        }
        // --flag=value
        if (arg.startsWith(flag + '=')) {
          setter(arg.slice(flag.length + 1));
        }
      }
    }
  }
}

// ── 用户自定义模板加载（v6.45.0+）──
// 目录约定：.speccore/templates/{global|iteration|task}/
// 查找优先级：type/platform/ > type/ > _shared/ > 根目录自定义 > 内置模板
async function loadUserTemplates(
  level: 'global' | 'iteration' | 'task',
  type?: string,
  platform?: string
): Promise<Map<string, string>> {
  const templateBase = join('.speccore', 'templates', level);
  const candidates: string[] = [];

  if (level === 'task') {
    const t = type || 'feature';
    if (platform) candidates.push(join(templateBase, t, platform));
    candidates.push(join(templateBase, t));
    candidates.push(join(templateBase, '_shared'));
    candidates.push(templateBase);
  } else if (level === 'iteration') {
    if (platform) candidates.push(join(templateBase, platform));
    candidates.push(templateBase);
  } else {
    candidates.push(templateBase);
  }

  const result = new Map<string, string>();
  const seen = new Set<string>();

  for (const dir of candidates) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    if (!(await pathExists(dir))) continue;
    try {
      const files = readdirSync(dir).filter((f: string) => f.endsWith('.md'));
      for (const file of files) {
        // 高优先级目录先写入，后续低优先级目录不覆盖（首次写入胜出）
        if (!result.has(file)) {
          const content = await readFile(join(dir, file), 'utf-8');
          if (content.trim().length > 0) {
            result.set(file, content);
          }
        }
      }
    } catch { /* skip */ }
  }

  return result;
}

// ── v6.72.0+: FUNCTION_MAP.md 自检 ──
interface FunctionMapValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function validateFunctionMap(content: string, validPlatforms: string[]): FunctionMapValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // 1. 查找表格
  const tableLines = lines.filter(l => l.startsWith('|'));
  if (tableLines.length < 2) {
    errors.push('FUNCTION_MAP.md 未找到有效表格');
    return { valid: false, errors, warnings };
  }

  // 2. 校验表头
  const headerLine = tableLines[0];
  const requiredColumns = ['功能单元', '涉及端', '全局对比'];
  for (const col of requiredColumns) {
    if (!headerLine.includes(col)) {
      errors.push(`表头缺少必填列: ${col}`);
    }
  }

  // 3. 解析数据行（跳过分隔行 ---|---）
  const dataRows = tableLines.slice(1).filter(l => l.replace(/[\s|:-]/g, '').length > 0);
  const platformSet = new Set(validPlatforms.map(p => p.toLowerCase()));
  const validComparisonTypes = new Set(['新增', '扩展', '重构', '复用']);

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const cells = row.split('|').map(c => c.trim()).filter(c => c.length > 0);
    if (cells.length < 3) continue; // 跳过格式异常行

    const funcUnit = cells[1] || '';
    const platforms = (cells[2] || '').split(/[,，]/).map(p => p.trim()).filter(Boolean);
    const comparison = cells[3] || '';
    const deps = cells[5] || '';

    // 功能单元非空
    if (!funcUnit || funcUnit === '功能单元') continue;
    if (!funcUnit || /^[-—]+$/.test(funcUnit)) {
      errors.push(`第 ${i + 1} 行: 功能单元名称不能为空`);
    }

    // 涉及端校验
    for (const plat of platforms) {
      const platLower = plat.toLowerCase();
      if (platLower === '无' || platLower === '-' || platLower === '—') continue;
      if (!platformSet.has(platLower)) {
        warnings.push(`第 ${i + 1} 行("${funcUnit}"): 涉及端 "${plat}" 不在已知端列表中 [${validPlatforms.join(', ')}]`);
      }
    }

    // 全局对比校验
    if (comparison && !validComparisonTypes.has(comparison) && !/^[-—]+$/.test(comparison)) {
      warnings.push(`第 ${i + 1} 行("${funcUnit}"): 全局对比 "${comparison}" 不是标准值（新增/扩展/重构/复用）`);
    }

    // 依赖任务格式校验
    if (deps && deps !== '无' && deps !== '-' && deps !== '—') {
      const depList = deps.split(/[,，]/).map(d => d.trim()).filter(Boolean);
      for (const dep of depList) {
        if (!/^Task-\d{3,}$/i.test(dep)) {
          warnings.push(`第 ${i + 1} 行("${funcUnit}"): 依赖任务格式异常 "${dep}"（应为 Task-NNN）`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// v6.91.1: 代码知识图谱摘要注入辅助函数
let _graphSummaryCache: string | undefined;
let _graphSummaryCacheTime = 0;
const GRAPH_SUMMARY_TTL = 300000; // 5 分钟缓存

async function injectGraphSummary(prompt: string): Promise<string> {
  try {
    if (_graphSummaryCache && Date.now() - _graphSummaryCacheTime < GRAPH_SUMMARY_TTL) {
      return prompt + _graphSummaryCache;
    }
    const cg = await loadCodeGraph(process.cwd());
    if (!cg) return prompt;

    const lines: string[] = [];
    lines.push('\n\n## 📊 代码知识图谱摘要（v6.91.0+ 自动注入）');
    lines.push(`> 基于本地 AST 解析（${cg.metadata.scannedFiles} 文件, ${cg.metadata.totalNodes} 节点, ${cg.metadata.totalEdges} 边）`);
    lines.push('');
    lines.push('### 子系统（自动检测）');
    for (const comm of cg.communities.slice(0, 8)) {
      const sample = comm.nodes
        .map(id => cg.nodes.find(n => n.id === id))
        .filter(Boolean)
        .slice(0, 5)
        .map(n => n!.name);
      lines.push(`- **${comm.label}** (${comm.nodes.length} 节点, 密度 ${(comm.density * 100).toFixed(0)}%): ${sample.join(', ')}`);
    }
    lines.push('');
    lines.push('### 核心枢纽（God Nodes）');
    const godNodeDetails = cg.godNodes
      .map(id => cg.nodes.find(n => n.id === id))
      .filter(Boolean)
      .slice(0, 10);
    for (const n of godNodeDetails) {
      lines.push(`- **${n!.name}** (${n!.type}) — degree: ${n!.degree}, file: \`${n!.filePath}\``);
    }
    lines.push('');
    lines.push('### 跨子系统连接');
    const crossEdges = cg.edges.filter(e => {
      const s = cg.nodes.find(n => n.id === e.source);
      const t = cg.nodes.find(n => n.id === e.target);
      return s && t && s.community !== t.community;
    }).slice(0, 8);
    for (const e of crossEdges) {
      const s = cg.nodes.find(n => n.id === e.source);
      const t = cg.nodes.find(n => n.id === e.target);
      lines.push(`- \`${s?.name}\` [${e.type}] \`${t?.name}\` (${e.confidence})`);
    }
    lines.push('');
    lines.push('> 提示：如需深入查看完整图谱，运行 `speccore code-index --graph` 后打开 `.speccore/code-graph/graph.html`');

    const summary = lines.join('\n');
    _graphSummaryCache = summary;
    _graphSummaryCacheTime = Date.now();
    return prompt + summary;
  } catch {
    return prompt;
  }
}

// ── v7.2.0+: 检测全局分析当前进度 ──
// Layer 4 拆分为子层: 4a=产品文档, 4b=全局技术核心, 4c=全局技术扩展, 4d=各端技术
async function detectGlobalLayerProgress(): Promise<{
  completedLayer: number;
  nextLayer: number;
  missing: string[];
  subLayer?: { completed: string[]; next: string };
}> {
  const globalDir = join(process.cwd(), '.speccore', 'GLOBAL');
  let completedLayer = 0;
  const missing: string[] = [];

  // Layer 1: 检查各端 _INDEX.md
  try {
    const platformsDir = join(globalDir, 'platforms');
    const entries = await readdir(platformsDir, { withFileTypes: true });
    const platformDirs = entries.filter(e => e.isDirectory() && e.name !== '_shared').map(e => e.name);
    const hasIndex = platformDirs.length > 0 && (await Promise.all(
      platformDirs.map(async d => pathExists(join(platformsDir, d, '_INDEX.md')))
    )).some(Boolean);
    if (hasIndex) completedLayer = 1;
    else missing.push('Layer 1: platforms/{端}/_INDEX.md');
  } catch { missing.push('Layer 1: platforms/{端}/_INDEX.md'); }

  // Layer 2: 检查 _ASSOCIATION.md
  if (completedLayer >= 1) {
    if (await pathExists(join(globalDir, 'platforms', '_shared', '_ASSOCIATION.md'))) {
      completedLayer = 2;
    } else {
      missing.push('Layer 2: platforms/_shared/_ASSOCIATION.md + _MODULES.md');
    }
  }

  // Layer 3: 检查 _MODULES.md
  if (completedLayer >= 2) {
    if (await pathExists(join(globalDir, 'platforms', '_shared', '_MODULES.md'))) {
      completedLayer = 3;
    } else {
      missing.push('Layer 3: platforms/_shared/_MODULES.md（功能模块候选清单）');
    }
  }

  // Layer 4 子层检测
  let subLayer: { completed: string[]; next: string } | undefined;
  if (completedLayer >= 3) {
    const overviewDir = join(globalDir, 'overview');
    const requirementsDir = join(globalDir, 'requirements');
    const completedSubLayers: string[] = [];

    // 4a: 产品文档
    const hasReq = await pathExists(join(requirementsDir, 'REQUIREMENT.md'));
    if (hasReq) completedSubLayers.push('4a');

    // 4b: 全局技术核心文档
    const hasCoreTech = await pathExists(join(overviewDir, 'ARCHITECTURE.md'))
      && await pathExists(join(overviewDir, 'FUNCTION_MAP.md'));
    if (hasCoreTech) completedSubLayers.push('4b');

    // 4c: 全局技术扩展文档
    const hasExtTech = await pathExists(join(overviewDir, 'SECURITY_AUDIT.md'))
      || await pathExists(join(overviewDir, 'DATA_FLOW.md'));
    if (hasExtTech) completedSubLayers.push('4c');

    // 4d: 各端技术文档
    try {
      const platformsDir = join(globalDir, 'platforms');
      const entries = await readdir(platformsDir, { withFileTypes: true });
      const platformDirs = entries.filter(e => e.isDirectory() && e.name !== '_shared').map(e => e.name);
      const hasPlatformDoc = platformDirs.length > 0 && (await Promise.all(
        platformDirs.map(async d => pathExists(join(platformsDir, d, 'API_INVENTORY.md'))
          || pathExists(join(platformsDir, d, 'UI_FLOW.md')))
      )).some(Boolean);
      if (hasPlatformDoc) completedSubLayers.push('4d');
    } catch { /* ignore */ }

    if (completedSubLayers.length === 4) {
      completedLayer = 4;
    } else {
      const subLayerOrder = ['4a', '4b', '4c', '4d'];
      const nextSub = subLayerOrder.find(s => !completedSubLayers.includes(s)) || '4d';
      missing.push(`Layer 4${nextSub}: 全局汇总文档子层`);
      subLayer = { completed: completedSubLayers, next: nextSub };
    }
  }

  return { completedLayer, nextLayer: Math.min(completedLayer + 1, 4), missing, subLayer };
}

// ── v7.2.0+: 全局分析下一步引导 ──
async function buildGlobalAnalysisGuide(options?: AnalyzeOptions): Promise<string | null> {
  const progress = await detectGlobalLayerProgress();
  const { completedLayer, nextLayer, subLayer } = progress;
  const deepDoc = options?.deep;

  let guide = '';

  // 进度条
  const layers = ['Layer 1 索引扫描', 'Layer 2 跨端关联', 'Layer 3 模块深入', 'Layer 4 全局汇总'];
  guide += `\n📊 全局分析进度: ${completedLayer}/4 层完成\n`;
  guide += layers.map((l, i) => {
    const status = i < completedLayer ? '✅' : i === completedLayer ? '▶️' : '⬜';
    return `   ${status} ${l}`;
  }).join('\n');
  guide += '\n';

  if (completedLayer === 4 && (!subLayer || subLayer.completed.length === 4)) {
    guide += '\n🎉 全局分析全部完成！\n';
    guide += '   所有文档已生成在 .speccore/GLOBAL/ 目录\n';
    guide += '   如需补充某份文档: speccore analyze --scope global --layer 4 --deep <文档名>\n';
    return guide;
  }

  // 下一步命令
  guide += '\n➡️  下一步:\n';

  if (deepDoc && options?.iterative) {
    const outlinePath = join(process.cwd(), '.speccore', 'cache', `deep-outline-${deepDoc.replace(/\//g, '-')}.md`);
    const hasOutline = await pathExists(outlinePath);
    if (!hasOutline) {
      guide += `   1. 将 AI 输出的大纲保存到: ${outlinePath}\n`;
      guide += `   2. 审核/修改大纲\n`;
      guide += `   3. 再次执行: speccore analyze --scope global --layer 4 --deep ${deepDoc} --iterative\n`;
    } else {
      guide += `   1. 将 AI 输出的本节内容追加到文档\n`;
      guide += `   2. 继续下一节: speccore analyze --scope global --layer 4 --deep ${deepDoc} --iterative\n`;
    }
  } else if (deepDoc) {
    guide += `   speccore analyze --scope global --layer 4 --deep ${deepDoc}\n`;
    guide += `   （如需迭代式补全: 加 --iterative 参数）\n`;
  } else if (nextLayer === 4 && subLayer) {
    const subNames: Record<string, string> = {
      '4a': '产品视角文档（requirements/）',
      '4b': '全局技术核心文档（overview/）',
      '4c': '全局技术扩展文档（overview/）',
      '4d': '各端技术文档（platforms/）',
    };
    guide += `   speccore analyze --scope global --layer 4\n`;
    guide += `   （即将生成: ${subNames[subLayer.next] || subLayer.next}）\n`;
  } else {
    guide += `   speccore analyze --scope global --layer ${nextLayer}\n`;
  }

  // 快捷命令提示
  guide += '\n💡 快捷命令:\n';
  guide += `   查看进度: speccore status\n`;
  if (completedLayer >= 3) {
    guide += `   深度分析单文档: speccore analyze --scope global --layer 4 --deep ARCHITECTURE.md\n`;
  }
  guide += `   全量重新分析: speccore analyze --scope global --with-code\n`;

  return guide;
}

// ── buildMultiDocPrompt: 多文档协议 ──
async function buildMultiDocPrompt(command: string, ctx: { iteration?: string; task?: string; type?: string; scope?: string; withCode?: boolean; platform?: string; phase?: string; autoMode?: boolean }, options?: AnalyzeOptions): Promise<string> {
  const iter = ctx.iteration || '当前迭代';
  const task = ctx.task ? ` — ${ctx.task}` : '';
  const taskType = ctx.type || 'feature';
  const now = new Date().toISOString().split('T')[0];
  const isTask = ctx.scope === 'task' || !!ctx.task;
  const isGlobal = ctx.scope === 'global';
  const autoMode = ctx.autoMode || false;

  // global 范围: 从源码反推需求 + 生成技术栈配置
  if (isGlobal) {
    // v6.74.0+: 流式全局分析模式
    if (ctx.withCode && (options?.streaming || options?.streamingPhase)) {
      return buildStreamingGlobalPrompt(command, ctx, options);
    }

    // v7.2.0+: 全局分析分层执行 — 检测当前进度，自动分配 layer
    const progress = await detectGlobalLayerProgress();
    const targetLayer = options?.layer || progress.nextLayer;
    const isLayered = !!options?.layer || progress.completedLayer < 4;

    // v7.2.0+: 结构化代码数据提取 — Layer 1 之前自动执行
    let structuredDataHint = '';
    if (targetLayer === 1 && ctx.withCode) {
      try {
        // 读取 CONSTITUTION.md 获取源码路径
        const constitutionPath = join(process.cwd(), '.speccore', 'CONSTITUTION.md');
        let sourcePaths: string[] = ['src'];
        if (await pathExists(constitutionPath)) {
          const content = await readFile(constitutionPath, 'utf-8');
          const match = content.match(/源码路径[\s\S]*?\n\s*-\s*`?([^`\n]+)`?/g);
          if (match) {
            sourcePaths = match.map(m => m.replace(/.*-\s*`?/, '').replace(/`?$/, '').trim()).filter(Boolean);
          }
        }
        await extractStructuredData(process.cwd(), sourcePaths);
        structuredDataHint = '\n> 📊 **结构化数据**: 已提取到 `.speccore/cache/structured-data.json`，包含 API/Entity/Route/Component 清单\n';
      } catch (e: any) {
        logger.warn(`   ⚠️ 结构化数据提取失败: ${e.message}`);
      }
    }

    // Layer 角色定义（v7.3.1+: 产出物明确列出关键文件，防止 AI 遗漏）
    const LAYER_ROLES: Record<number, { role: string; focus: string; output: string }> = {
      1: { role: '代码索引专家', focus: '全面扫描各端源码结构，提取目录/接口/实体/配置等索引信息', output: 'platforms/{端}/_INDEX.md（每端一个）+ PATTERNS/{端名}/{分类}/*.md（按端分目录）+ semantic-tags.json' },
      2: { role: '系统架构师', focus: '基于 Layer 1 索引进行跨端关联分析、接口匹配、模块聚类', output: 'platforms/_shared/_ASSOCIATION.md + _MODULES.md' },
      3: { role: '业务分析师', focus: '按功能模块深入分析业务逻辑、数据流、规则、时序', output: '各端功能模块深入文档 + PATTERNS/{端名}/{分类}/*.md' },
      4: { role: '产品总监 + 技术负责人', focus: '全局汇总，分 4 个子层执行（4a产品→4b技术核心→4c技术扩展→4d各端）', output: 'requirements/REQUIREMENT.md（必须）+ requirements/{前端端}/REQUIREMENT.md + overview/* + platforms/{端}/* + PATTERNS/*' },
    };
    const layerMeta = LAYER_ROLES[targetLayer];

    let prompt = `\n# 任务: ${command} (全局分析${ctx.withCode ? '+源码' : ''})\n\n`;

    // v7.2.0+: 分层专注指令 — 强烈约束 AI 只执行当前 layer
    prompt += `## 🎯 当前执行层级: Layer ${targetLayer}/4 — ${layerMeta.role}\n\n`;
    prompt += `> ⚠️ **重要约束**: 你当前只需要完成 **Layer ${targetLayer}** 的工作。不要提前做后续层的内容。\n`;
    prompt += `> 每层完成后通过 \`speccore analyze --scope global --layer ${targetLayer + 1 <= 4 ? targetLayer + 1 : 4}\` 进入下一层。\n\n`;
    prompt += `| 层级 | 角色 | 核心任务 | 产出物 |\n`;
    prompt += `| :--- | :--- | :--- | :--- |\n`;
    prompt += `| 1 | 代码索引专家 | 扫描源码结构，提取索引 | platforms/{端}/_INDEX.md + PATTERNS/{端名}/*.md |\n`;
    prompt += `| 2 | 系统架构师 | 跨端关联、接口匹配、模块聚类 | platforms/_shared/_ASSOCIATION.md + _MODULES.md |\n`;
    prompt += `| 3 | 业务分析师 | 功能模块深入分析 | 各端功能模块文档 + PATTERNS |\n`;
    prompt += `| 4 | 产品总监+技术负责人 | 全局汇总、需求总纲、一致性校验 | requirements/REQUIREMENT.md + overview/* + platforms/* |\n\n`;

    if (progress.completedLayer > 0) {
      prompt += `📊 检测进度: 已完成 Layer ${progress.completedLayer}/4`;
      if (progress.missing.length > 0) {
        prompt += `，待补齐: ${progress.missing.join('; ')}`;
      }
      prompt += `\n\n`;
    }

    prompt += `## 你的专注任务（Layer ${targetLayer}）\n`;
    prompt += `- **角色**: ${layerMeta.role}\n`;
    prompt += `- **核心任务**: ${layerMeta.focus}\n`;
    prompt += `- **预期产出**: ${layerMeta.output}\n\n`;

    prompt += `## 要求\n`;
    prompt += `1. **先读宪法**: Read .speccore/CONSTITUTION.md，获取工程名、源码路径、端列表。\n`;
    prompt += `2. Read .speccore/GLOBAL/ 下已有文档（特别是前一层的产物）作为输入。\n`;
    prompt += `3. **禁止行为**: 不要打开浏览器、不要模拟用户操作、不要访问 URL。所有分析基于直接 Read 源码。\n`;
    if (ctx.withCode) {
      prompt += `4. 从 CONSTITUTION.md 的「源码路径」列读取所有工程目录。\n`;
    }

    // 根据 targetLayer 注入对应的专注内容
    if (targetLayer === 1) {
      prompt += `\n## 📊 Layer 1: 快速扫描所有端（基于结构化数据生成索引）\n\n`;
      prompt += `${structuredDataHint}`;
      prompt += `**重要**: 不要直接扫描源码文件。已使用代码扫描工具提取了结构化数据，你只需要读取这些数据并整理成 _INDEX.md。\n\n`;
      prompt += `**步骤**: \n`;
      prompt += `1. Read \`.speccore/cache/structured-data.json\` — 获取所有端的 API/Entity/Route/Component 清单\n`;
      prompt += `2. 对每个端，基于结构化数据生成 \`_INDEX.md\`（补充扫描工具未覆盖的内容）\n`;
      prompt += `3. 扫描工具未覆盖的维度（消息队列、定时任务、配置、外部集成、日志监控、错误处理），需要 Read 相关配置文件补充\n\n`;
      prompt += `**后端端 _INDEX.md 维度（基于 structured-data.json + 补充扫描）**：\n`;
      prompt += `| 扫描项 | 读取位置 | 提取内容 |\n`;
      prompt += `| :--- | :--- | :--- |\n`;
      prompt += `| 接口层 | Controller/Handler/Resource 目录 | 接口类名、接口路径（从注解/装饰器推断）、鉴权注解 |\n`;
      prompt += `| 数据层 | Entity/Model/Schema/Domain 目录 | 实体名称、表名、敏感字段标记 |\n`;
      prompt += `| 业务层 | Service/UseCase/Application 目录 | 服务类名、核心方法名 |\n`;
      prompt += `| 中间件 | Middleware/Interceptor/Filter/Gateway 目录 | 中间件名、作用范围 |\n`;
      prompt += `| 消息队列 | 搜索消息相关代码（Kafka/RabbitMQ/NSQ/SQS/Redis PubSub） | 队列名、消费者/生产者类名 |\n`;
      prompt += `| 定时任务 | 搜索定时任务（@Scheduled/cron/agenda/node-cron） | 任务名、触发频率、执行类 |\n`;
      prompt += `| 配置管理 | 配置文件（application*.yml/.env/config/） | 环境变量名、Feature Flag、配置中心引用 |\n`;
      prompt += `| 外部集成 | 搜索第三方调用（HTTP client/SDK/微信支付/短信/邮件/OSS） | 集成目标、调用位置 |\n`;
      prompt += `| 日志监控 | 搜索日志/监控/埋点代码（logger/metrics/tracing） | 日志级别策略、埋点事件名 |\n`;
      prompt += `| 错误处理 | 搜索全局异常处理器（ExceptionHandler/ErrorBoundary） | 异常处理类名、错误码范围 |\n`;
      prompt += `| 依赖项 | pom.xml/package.json/go.mod/requirements.txt | 依赖项列表（识别公共服务候选、过期版本、已知 CVE） |\n\n`;
      prompt += `**前端端扫描维度（10项）**：\n`;
      prompt += `| 扫描项 | 读取位置 | 提取内容 |\n`;
      prompt += `| :--- | :--- | :--- |\n`;
      prompt += `| 路由 | router/routes 配置文件 | 页面路径、页面名称、组件名、懒加载标记 |\n`;
      prompt += `| 页面 | pages/views/screens 目录 | 页面名称、主要功能（从文件名推断） |\n`;
      prompt += `| API 调用 | 搜索 API 调用模式（axios/fetch/$.ajax/uni.request） | 调用的接口路径列表、调用位置 |\n`;
      prompt += `| 状态管理 | store/pinia/vuex/redux 目录 | 全局状态名称、actions 名称、持久化策略 |\n`;
      prompt += `| 组件库 | components/ui 目录、设计系统配置 | 组件名、复用度、设计 token |\n`;
      prompt += `| 拦截器 | 请求/响应拦截器配置 | 拦截器逻辑（鉴权头注入、错误统一处理） |\n`;
      prompt += `| 外部 SDK | 搜索第三方 SDK 引入（埋点/推送/地图/支付/分享） | SDK 名称、初始化位置、使用范围 |\n`;
      prompt += `| 国际化 | i18n/locales/lang 目录 | 支持语言、命名空间、 key 数量级 |\n`;
      prompt += `| 错误处理 | 错误边界/全局错误处理器 | 错误捕获范围、降级策略、上报机制 |\n`;
      prompt += `| 性能 | 搜索性能相关代码（懒加载/虚拟滚动/缓存/预加载） | 优化手段、适用场景 |\n\n`;
      prompt += `**输出**：每个端一个 \`_INDEX.md\`，按上述维度组织，只含名称和路径列表，不含详细逻辑\n`;
      prompt += `**存放**：\`.speccore/GLOBAL/platforms/{端名}/_INDEX.md\`\n\n`;
      prompt += `### Layer 1 附加任务：提取可复用模式（PATTERNS）\n`;
      prompt += `在扫描每个端时，同时识别该端的可复用设计模式，写入 \`.speccore/PATTERNS/\`。这是跨迭代复用的核心资产。\n\n`;
      prompt += `**后端端模式提取维度（6类）**：\n`;
      prompt += `| 模式类型 | 扫描位置 | 提取内容 | 存放路径 |\n`;
      prompt += `| :--- | :--- | :--- | :--- |\n`;
      prompt += `| 架构模式 | 项目结构、模块划分 | 分层架构、目录约定、模块组织方式 | \`PATTERNS/{端名}/architecture/\` |\n`;
      prompt += `| 数据模型模式 | Entity/Model/Schema | 通用字段设计（软删除、多租户、审计字段）、关联模式 | \`PATTERNS/{端名}/data-model/\` |\n`;
      prompt += `| API 契约模式 | Controller/Handler | 统一响应格式、分页模式、错误包装、鉴权装饰器 | \`PATTERNS/{端名}/api-contract/\` |\n`;
      prompt += `| 安全模式 | 鉴权/校验/加密代码 | JWT/RBAC 实现、输入校验策略、敏感数据处理 | \`PATTERNS/{端名}/security/\` |\n`;
      prompt += `| 性能模式 | 缓存/批量/异步代码 | 缓存策略、批量查询、异步处理、连接池配置 | \`PATTERNS/{端名}/performance/\` |\n`;
      prompt += `| 工具/中间件 | utils/middleware 目录 | 可复用的工具函数、通用中间件、拦截器 | \`PATTERNS/{端名}/utils/\` |\n`;
      prompt += `**前端端模式提取维度（6类）**：\n`;
      prompt += `| 模式类型 | 扫描位置 | 提取内容 | 存放路径 |\n`;
      prompt += `| :--- | :--- | :--- | :--- |\n`;
      prompt += `| 组件模式 | components/ui 目录 | 高复用组件、复合组件、设计 token 使用 | \`PATTERNS/{端名}/components/\` |\n`;
      prompt += `| Hooks 模式 | hooks/composables 目录 | 可复用逻辑抽离、状态封装、生命周期管理 | \`PATTERNS/{端名}/hooks/\` |\n`;
      prompt += `| 状态管理模式 | store/pinia/vuex/redux | 状态切片设计、actions 组织、持久化策略 | \`PATTERNS/{端名}/state/\` |\n`;
      prompt += `| 路由/导航模式 | router/routes 配置 | 路由守卫、权限路由、动态路由、面包屑 | \`PATTERNS/{端名}/routing/\` |\n`;
      prompt += `| 请求/拦截模式 | API 调用封装 | 请求封装、错误处理、重试策略、缓存策略 | \`PATTERNS/{端名}/api-client/\` |\n`;
      prompt += `| 布局/样式模式 | layouts/themes 目录 | 布局组件、响应式策略、主题切换、CSS 架构 | \`PATTERNS/{端名}/layout/\` |\n`;
      prompt += `**跨端通用模式**：如果某模式在 2+ 端出现，优先写入通用分类（如 \`PATTERNS/architecture/\`），端差异用段落标注。\n`;
      prompt += `**写入方式**：使用 \`PATTERNS/{端名}/{分类}/{kebab-case模式名}.md\` 作为文件名。\n\n`;
      prompt += `### Layer 1 附加任务：提取语义级节点标签（SEMANTIC TAGS）\n`;
      prompt += `在扫描每个端时，同时提取语义标签，写入 \`.speccore/cache/semantic-tags.json\`。这是知识图谱理解代码意图的关键资产。\n\n`;
      prompt += `**提取规则（本地解析，零 Token 消耗）**：\n`;
      prompt += `| 提取源 | 提取内容 | 示例 |\n`;
      prompt += `| :--- | :--- | :--- |\n`;
      prompt += `| JSDoc/TSDoc 注释 | 函数/类的 @description、@summary | \`用户认证入口，处理登录/注册/登出\` |\n`;
      prompt += `| 文件头注释 | 文件顶部的多行注释 | \`会议室预订服务的核心业务逻辑层\` |\n`;
      prompt += `| 文件名推断 | 文件名关键词映射到业务域 | auth → 认证授权, order → 订单交易 |\n`;
      prompt += `| 导出名称推断 | 类名后缀推断角色 | XxxController → 接口控制器, XxxService → 业务服务 |\n`;
      prompt += `| 目录结构推断 | 文件所在目录映射到模块 | src/user/ → 用户管理, src/order/ → 订单交易 |\n\n`;
      prompt += `**输出格式**：JSON 数组，每个文件一条记录\n`;
      prompt += `\`\`\`json\n`;
      prompt += `[\n`;
      prompt += `  {\n`;
      prompt += `    "file": "backend/src/auth/AuthController.ts",\n`;
      prompt += `    "semanticTags": ["认证授权", "用户管理"],\n`;
      prompt += `    "description": "用户认证控制器，处理登录/注册/Token刷新",\n`;
      prompt += `    "businessRole": "接口控制器"\n`;
      prompt += `  }\n`;
      prompt += `]\n`;
      prompt += `\`\`\`\n\n`;
    } // end if (targetLayer === 1)

    // ── Layer 2 指令（仅 targetLayer === 2 时注入）──
    if (targetLayer === 2) {
      prompt += `## 🔗 Layer 2: 跨端关联分析（基于 Layer 1 索引 + structured-data.json）\n\n`;
      prompt += `> 📊 **结构化数据**: Read \`.speccore/cache/structured-data.json\` 获取 API/Entity 清单，与 Layer 1 索引交叉验证\n\n`;
      prompt += `1. **匹配前后端接口**：\n`;
      prompt += `   - 前端 \`_INDEX.md\` 中的 API 调用路径 vs 后端 \`_INDEX.md\` 中的接口路径\n`;
      prompt += `   - **匹配上** → 建立「前端页面 → 前端 API 调用 → 后端接口 → 后端服务」链路\n`;
      prompt += `   - **前端有、后端没有** → 标注为「接口缺口」（可能调了第三方/遗留/错误接口）\n`;
      prompt += `   - **后端有、前端没调** → 标注为「未使用接口」（可能后台管理/内部调度用）\n\n`;
      prompt += `2. **识别公共服务**：\n`;
      prompt += `   - 被 2+ 个前端端调用的后端服务 → 公共服务候选\n`;
      prompt += `   - 被 2+ 个后端端调用的后端服务 → 公共服务候选\n`;
      prompt += `   - 依赖项中独立部署的服务（如 notification-service、file-service）→ 公共服务候选\n\n`;
      prompt += `3. **消息流关联**（跨端事件/消息链路）：\n`;
      prompt += `   - 后端生产者 ↔ 队列名 ↔ 后端消费者 ↔ 前端推送（WebSocket/SSE/轮询）\n`;
      prompt += `   - 识别「异步事件触发 → 多端状态同步」链路\n`;
      prompt += `   - 标注：无消费者的消息、无生产者的消息（ orphaned topic ）\n\n`;
      prompt += `4. **定时任务影响分析**：\n`;
      prompt += `   - 哪些定时任务修改了被前端展示的数据（数据新鲜度风险）\n`;
      prompt += `   - 哪些定时任务触发了前端需要感知的通知/推送\n`;
      prompt += `   - 批处理任务 vs 实时接口的数据竞争风险\n\n`;
      prompt += `5. **外部集成一致性检查**：\n`;
      prompt += `   - 多个端是否独立调用了同一第三方 API（重复集成 = 维护风险）\n`;
      prompt += `   - 前端 SDK 与后端 SDK 版本是否一致（如支付 SDK）\n`;
      prompt += `   - 第三方回调/Webhook 的接收端分布\n\n`;
      prompt += `6. **配置一致性检查**：\n`;
      prompt += `   - 各端的超时配置、重试策略、限流阈值是否一致\n`;
      prompt += `   - 跨端共享的 Feature Flag 定义是否一致\n`;
      prompt += `   - 环境变量命名是否规范（如 API_BASE_URL 在各端是否指向同一值）\n\n`;
      prompt += `7. **归纳功能模块**（从索引聚类，不是从代码反推）：\n`;
      prompt += `   - **从页面聚类**：哪些页面经常一起出现（如 RoomList + RoomDetail + RoomEdit）\n`;
      prompt += `   - **从接口聚类**：哪些接口共享同一实体前缀（如 /api/rooms/*）\n`;
      prompt += `   - **从消息聚类**：哪些消息队列共享同一业务领域\n`;
      prompt += `   - **交叉验证**：页面聚类 vs 接口聚类 vs 消息聚类 → 确定功能模块边界\n`;
      prompt += `   - 每个功能模块标注：涉及端、核心页面、核心接口、实体名称、消息队列\n\n`;
      prompt += `**输出**：\n`;
      prompt += `- \`_ASSOCIATION.md\`：前后端关联矩阵 + 接口缺口/未使用接口清单 + 消息流链路 + 定时任务影响 + 外部集成分布 + 配置一致性风险\n`;
      prompt += `  - 此文档中必须包含 **模块关系 Mermaid 图**（graph LR），展示各功能模块间的依赖关系\n`;
      prompt += `  - 此文档中必须包含 **接口依赖 Mermaid 图**（graph TD），展示前端页面 → 后端接口的调用关系\n`;
      prompt += `- \`_MODULES.md\`：功能模块候选清单（从源码聚类，含消息/定时任务维度，供 Layer 3 验证）\n`;
      prompt += `  - 此文档中必须包含 **模块全景 Mermaid 图**（graph LR），展示所有功能模块及其所属端\n`;
      prompt += `**存放**：\`.speccore/GLOBAL/platforms/_shared/\`\n\n`;
    } // end if (targetLayer === 2)

    // ── Layer 3 指令（仅 targetLayer === 3 时注入）──
    if (targetLayer === 3) {
      prompt += `## 🔍 Layer 3: 按功能模块深入分析（不是按端）\n\n`;
      prompt += `基于 Layer 2 的 \`_MODULES.md\`，逐个功能模块深入分析。\n`;
      prompt += `**每个功能模块涉及哪些端，就读取那些端的详细源码**：\n\n`;
      prompt += `**示例：「会议预订」功能模块**\n`;
      prompt += `- 涉及端：h5-mobile, booking-service, room-service\n`;
      prompt += `- 读取 h5-mobile: BookingForm.vue, BookingList.vue, BookingDetail.vue 的详细逻辑\n`;
      prompt += `- 读取 booking-service: BookingController, BookingService, BookingEntity 的详细逻辑\n`;
      prompt += `- 读取 room-service: RoomController#getAvailability, RoomService 的详细逻辑\n`;
      prompt += `- 关联验证：前端提交的数据字段 vs 后端接收的 DTO 字段是否一致\n`;
      prompt += `- 关联验证：前端展示的状态 vs 后端实体的状态枚举是否一致\n\n`;
      prompt += `**每个功能模块输出**：\n`;
      prompt += `- 后端端：该功能模块相关的 API 详细设计、数据模型、业务规则、安全策略\n`;
      prompt += `- 前端端：该功能模块相关的页面详细设计、交互流程、字段映射、错误处理\n`;
      prompt += `- 跨端：该功能模块的交互时序图（含异步消息链路，供 Layer 4 汇总到 INTERACTION_MAP.md）\n`;
      prompt += `  - 时序图用 **Mermaid sequenceDiagram** 语法嵌入到分析文档中\n`;
      prompt += `  - 关键操作流程用 **Mermaid flowchart** 语法嵌入到分析文档中\n`;
      prompt += `  - 状态流转用 **Mermaid stateDiagram** 语法嵌入到分析文档中\n`;
      prompt += `- 跨端：该功能模块涉及的外部集成清单（第三方 API、消息队列、定时任务）\n\n`;
      prompt += `### Layer 3 附加任务：功能模块级模式提取（PATTERNS）\n`;
      prompt += `每个功能模块分析完成后，提取该模块的可复用模式，补充到 \`.speccore/PATTERNS/\`。\n\n`;
      prompt += `**提取维度**：\n`;
      prompt += `- **跨端交互模式**：该模块的前后端交互方式是否有代表性（如表单提交+乐观更新、轮询刷新、WebSocket 实时推送）\n`;
      prompt += `- **业务规则模式**：该模块的业务规则是否有通用性（如审批流程、库存扣减、权限校验）\n`;
      prompt += `- **数据流模式**：该模块的数据流转是否有代表性（如缓存更新策略、数据同步机制、离线优先）\n`;
      prompt += `- **UI 交互模式**：该模块的页面交互是否有复用价值（如列表筛选、表单校验、弹窗确认、拖拽排序）\n`;
      prompt += `- **错误处理模式**：该模块的错误场景处理是否有代表性（如网络失败重试、权限不足提示、数据冲突解决）\n\n`;
      prompt += `**存放规则**：\n`;
      prompt += `- 单端模式 → \`PATTERNS/{端名}/{分类}/{模块名}-{模式类型}.md\`\n`;
      prompt += `- 跨端模式 → \`PATTERNS/{分类}/{模块名}-{模式类型}.md\`（不绑定端）\n`;
      prompt += `- 示例：\`PATTERNS/h5-mobile/components/booking-form-validation.md\`、\`PATTERNS/architecture/optimistic-update-pattern.md\`\n\n`;
      prompt += `### Layer 3 附加任务：功能模块语义标注\n`;
      prompt += `每个功能模块分析完成后，为该模块涉及的核心代码文件生成语义标注，追加到 \`semantic-tags.json\`。\n\n`;
      prompt += `**标注维度**：\n`;
      prompt += `- **业务功能标签**：该文件在功能模块中承担什么职责（如「表单提交校验」、「状态机驱动」、「数据持久化」）\n`;
      prompt += `- **交互角色标签**：该文件在跨端交互中扮演什么角色（如「请求发起者」、「事件生产者」、「状态同步者」）\n`;
      prompt += `- **数据流标签**：该文件处理的数据类型（如「用户输入数据」、「配置数据」、「缓存数据」、「消息事件」）\n`;
      prompt += `- **质量标签**：该文件的代码特征（如「高复用」、「核心业务」、「边界处理」、「性能敏感」）\n\n`;
    } // end if (targetLayer === 3)

    // ── Layer 4 指令（仅 targetLayer === 4 时注入）──
    if (targetLayer === 4) {
      prompt += `## 🌍 Layer 4: 全局汇总（所有功能模块分析完成后）\n\n`;
      prompt += `1. **一致性校验**：\n`;
      prompt += `   - 前端字段 vs 后端字段是否一致（名称、类型、必填性、校验规则）\n`;
      prompt += `   - 前端状态 vs 后端状态枚举是否一致\n`;
      prompt += `   - 接口缺口清单（前端调了但后端没有的接口）\n`;
      prompt += `   - 未使用接口清单（后端有但前端没调的接口）\n`;
      prompt += `   - 消息孤儿清单（无消费者/无生产者的队列）\n`;
      prompt += `   - 配置不一致清单（超时/重试/限流各端差异）\n`;
      prompt += `   → 输出 \`CONSISTENCY_CHECK.md\`\n\n`;
      prompt += `2. **生成全局文档**（按视角分离存放，v6.98.0+）：\n`;
      prompt += `   **产品视角 → 存放到 .speccore/GLOBAL/requirements/（以专业产品角色撰写，v6.99.0+）：**\n`;
      prompt += `   - \`requirements/REQUIREMENT.md\`：全局需求总纲（产品总监视角，按业务场景/用户旅程组织）\n`;
      prompt += `     - 必须包含：产品愿景、目标用户画像、核心场景地图、功能全景图\n`;
      prompt += `     - 按业务场景组织章节，每个场景：用户故事 → 操作流程 → 业务规则 → 边界条件 → 验收标准\n`;
      prompt += `     - 包含功能优先级矩阵（P0/P1/P2）、发布里程碑、风险预判\n`;
      prompt += `     - 包含与竞品的差异化分析（如有）、数据埋点需求、运营需求\n`;
      prompt += `     - 不要写技术实现细节，不要按端分章节\n`;
      prompt += `   - \`requirements/{前端端}/REQUIREMENT.md\`：各前端端的产品视角需求（前端产品经理视角）\n`;
      prompt += `     - 前端端示例: requirements/admin-web/REQUIREMENT.md, requirements/h5-mobile/REQUIREMENT.md\n`;
      prompt += `     - **信息架构**：页面层级结构、导航关系、面包屑、路由映射\n`;
      prompt += `     - **用户旅程**：从入口到完成目标的完整流程，标注关键决策点、情绪曲线\n`;
      prompt += `     - **页面清单**：每页含页面名称、URL/路由、核心功能、进入条件、离开条件\n`;
      prompt += `     - **交互设计**：表单填写流程、列表操作、搜索筛选、分页/无限滚动、弹窗/抽屉\n`;
      prompt += `     - **状态与反馈**：加载状态、空状态、错误状态、成功反馈、操作确认\n`;
      prompt += `     - **权限与角色**：各角色可见页面/可操作按钮/数据范围\n`;
      prompt += `     - **响应式/适配策略**：不同设备尺寸下的布局变化、断点设计\n`;
      prompt += `     - **无障碍要求**：键盘导航、屏幕阅读器、色彩对比度（如有要求）\n`;
      prompt += `     - 每个前端端需求目录下可放 images/（截图/流程图/原型图）和 prototypes/（可交互原型文件）\n`;
      prompt += `   **技术视角 → 存放到 .speccore/GLOBAL/overview/（不与 platforms/requirements 平级）：**\n`;
      prompt += `   - \`overview/FUNCTION_MAP.md\`：功能单元 × 端映射表\n`;
      prompt += `   - \`overview/INTERACTION_MAP.md\`：跨端交互时序图（含同步 API + 异步消息，从 Layer 3 汇总）\n`;
      prompt += `     - 必须包含 **Mermaid sequenceDiagram**，展示各端之间的核心交互时序\n`;
      prompt += `   - \`overview/API_CONTRACT.yaml\`：全局接口契约（汇总所有后端 API_INVENTORY，含 rate limit、幂等性、版本策略）\n`;
      prompt += `   - \`overview/ARCHITECTURE.md\`：全局架构文档（服务拓扑、数据流、部署关系、容错设计、降级策略、扩容方案）\n`;
      prompt += `     - 必须包含 **Mermaid architecture diagram**（graph TB），展示服务拓扑和部署关系\n`;
      prompt += `     - 必须包含 **Mermaid graph LR**，展示模块间的依赖关系\n`;
      prompt += `   - \`overview/SECURITY_AUDIT.md\`：全局安全审计（鉴权策略矩阵、敏感数据流、攻击面分析、CVE 清单、合规检查）\n`;
      prompt += `   - \`overview/PERFORMANCE_BASELINE.md\`：性能基线（慢查询清单、缓存策略矩阵、并发承载评估、关键路径耗时）\n`;
      prompt += `   - \`overview/DATA_FLOW.md\`：数据流与隐私分析（PII 识别与追踪、数据生命周期、存储/传输/归档策略、GDPR 合规检查）\n`;
      prompt += `     - 必须包含 **Mermaid flowchart**，展示数据从产生到销毁的完整生命周期\n`;
      prompt += `   - \`overview/EXTERNAL_INTEGRATIONS.md\`：外部集成审计（第三方服务清单、SDK 版本与风险、Webhook 接收分布、重复集成识别）\n`;
      prompt += `   - \`overview/DEPLOYMENT.md\`：部署运维分析（容器化状态、CI/CD 流水线、健康检查端点、环境配置差异、日志聚合方案）\n`;
      prompt += `     - 必须包含 **Mermaid flowchart**，展示 CI/CD 流水线流程\n`;
      prompt += `   - \`overview/OBSERVABILITY.md\`：可观测性分析（日志链路追踪、错误码体系、监控埋点清单、告警策略、SLA 定义）\n`;
      prompt += `   - \`overview/CONSISTENCY_CHECK.md\`：一致性校验报告（字段/状态/接口/消息/配置）\n\n`;
      prompt += `3. **生成各端详细文档**（技术视角，从 Layer 3 汇总）：\n`;
      prompt += `   > 存放: .speccore/GLOBAL/platforms/{端名}/\n`;
      prompt += `   **后端端（9项）**：\n`;
      prompt += `   - \`API_INVENTORY.md\`：完整接口清单（路径/方法/参数/响应/鉴权/rate limit/幂等性/版本/废弃标记）\n`;
      prompt += `   - \`DATA_MODEL.md\`：表结构+字段+关系+索引+数据量预估+归档策略+分库分表建议\n`;
      prompt += `   - \`BUSINESS_RULES.md\`：校验规则+业务约束+状态机+规则冲突检测+边界案例\n`;
      prompt += `   - \`SECURITY.md\`：端级安全分析（接口鉴权矩阵、输入校验策略、SQL 注入/XSS/CSRF 防护、敏感数据处理）\n`;
      prompt += `   - \`PERFORMANCE.md\`：端级性能分析（数据库索引评估、缓存命中率、N+1 查询识别、慢查询 TOP10、连接池配置）\n`;
      prompt += `   - \`INTEGRATION.md\`：外部集成清单（第三方 API 调用位置、SDK 配置、Webhook 处理、消息队列角色）\n`;
      prompt += `   - \`SCHEDULED_TASKS.md\`：定时任务/批处理清单（任务名、触发频率、执行逻辑、数据影响范围、失败处理）\n`;
      prompt += `   - \`CONFIG.md\`：配置管理分析（环境变量清单、Feature Flag、配置中心引用、各环境差异、敏感配置审计）\n`;
      prompt += `   - \`TECH_STACK.md\`：语言、框架、构建工具、运行时版本、依赖项清单（含过期/风险标记）\n`;
      prompt += `   **前端端（9项）**：\n`;
      prompt += `   - \`_INDEX.md\`：目录索引（页面/组件/接口列表，含路由守卫信息）\n`;
      prompt += `   - \`UI_FLOW.md\`：页面流转图、用户操作流程、权限控制点、异常分支\n`;
      prompt += `   - \`API_CALL_MAP.md\`：页面 → 接口 → 后端服务 映射表（含错误处理映射、重试策略）\n`;
      prompt += `   - \`STATE_MANAGEMENT.md\`：全局状态流分析（store 结构、actions 依赖、持久化策略、跨组件通信）\n`;
      prompt += `   - \`COMPONENT_LIBRARY.md\`：组件库/设计系统分析（组件清单、复用度、设计 token、主题策略）\n`;
      prompt += `   - \`ERROR_HANDLING.md\`：错误处理与降级策略（错误边界、全局错误处理、用户提示策略、错误上报）\n`;
      prompt += `   - \`PERFORMANCE.md\`：端级性能分析（包大小、代码分割、渲染性能、资源加载、缓存策略、Core Web Vitals）\n`;
      prompt += `   - \`INTEGRATION.md\`：外部集成清单（第三方 SDK、埋点、推送、地图、支付、分享、版本兼容性）\n`;
      prompt += `   - \`TECH_STACK.md\`：框架版本、构建配置、UI 库、工具链、浏览器兼容性\n`;
      prompt += `   **通用（2项）**：\n`;
      prompt += `   - \`DEPENDENCY_GRAPH.md\`：模块依赖拓扑（含循环依赖检测、依赖深度分析）\n`;
      prompt += `   - \`CODE_INDEX.md\`：目录结构+关键文件+模块职责+代码统计（行数/文件数/复杂度）\n\n`;
      prompt += `4. **知识沉淀（PATTERNS 目录）**: 从各端源码识别可复用模式，写入 .speccore/PATTERNS/。这是跨迭代、跨工程复用的核心资产。\n`;
      prompt += `\n`;
      prompt += `   **目录结构（分类 × 端 双层组织）**:\n`;
      prompt += `   \`\`\`\n`;
      prompt += `   PATTERNS/\n`;
      prompt += `   ├── architecture/          ← 跨端通用架构模式（不绑定特定端）\n`;
      prompt += `   ├── data-model/            ← 跨端通用数据模型模式\n`;
      prompt += `   ├── api-contract/          ← 跨端通用 API 契约模式\n`;
      prompt += `   ├── security/              ← 跨端通用安全模式\n`;
      prompt += `   ├── performance/           ← 跨端通用性能模式\n`;
      prompt += `   ├── {端名}/                ← 端专属模式（如 backend/ h5/ admin/）\n`;
      prompt += `   │   ├── architecture/\n`;
      prompt += `   │   ├── data-model/\n`;
      prompt += `   │   ├── api-contract/\n`;
      prompt += `   │   ├── security/\n`;
      prompt += `   │   └── performance/\n`;
      prompt += `   └── TEMPLATES/             ← 写作模板（已有，勿动）\n`;
      prompt += `   \`\`\`\n`;
      prompt += `\n`;
      prompt += `   **什么时候生成 PATTERNS（触发条件）**:\n`;
      prompt += `   - Layer 1 扫描时：发现某端有独特的项目结构或命名约定 → 记录为模式\n`;
      prompt += `   - Layer 2 关联时：发现跨端通用的接口契约格式或错误处理模式 → 记录为模式\n`;
      prompt += `   - Layer 3 深入时：发现可复用的组件、工具函数、中间件、装饰器 → 记录为模式\n`;
      prompt += `   - 只记录**可复用的、有代表性的**模式，不要每个文件都记录\n`;
      prompt += `   - 同一模式在多个端出现时，优先写入通用分类（architecture/ 等），端差异用段落标注\n`;
      prompt += `\n`;
      prompt += `   **文件命名规则**:\n`;
      prompt += `   - 通用模式: \`{分类}/{kebab-case模式名}.md\`（如 \`architecture/microservice-gateway.md\`）\n`;
      prompt += `   - 端专属模式: \`{端名}/{分类}/{kebab-case模式名}.md\`（如 \`backend/security/jwt-auth.md\`）\n`;
      prompt += `   - 模式名使用 kebab-case（短横线连接的小写英文）\n`;
      prompt += `\n`;
      prompt += `   **文件内容格式**（每个模式文件必须包含）:\n`;
      prompt += `   \`\`\`markdown\n`;
      prompt += `   # {模式名}\n`;
      prompt += `\n`;
      prompt += `   > 来源: {工程名} | 端: {端名或"跨端"} | 发现时间: YYYY-MM-DD\n`;
      prompt += `   > 分类: {architecture|data-model|api-contract|security|performance}\n`;
      prompt += `\n`;
      prompt += `   ## 适用场景\n`;
      prompt += `   什么情况下应该使用这个模式。\n`;
      prompt += `\n`;
      prompt += `   ## 核心实现\n`;
      prompt += `   \`\`\`{语言}\n`;
      prompt += `   // 最小可复用的代码片段（不是完整文件）\n`;
      prompt += `   \`\`\`\n`;
      prompt += `\n`;
      prompt += `   ## 使用示例\n`;
      prompt += `   如何在实际场景中应用这个模式。\n`;
      prompt += `\n`;
      prompt += `   ## 注意事项\n`;
      prompt += `   - 边界条件、限制、依赖\n`;
      prompt += `   - 与相似模式的区别\n`;
      prompt += `\n`;
      prompt += `   ## 反例\n`;
      prompt += `   不要这样用（常见错误写法）。\n`;
      prompt += `   \`\`\`\n`;
      prompt += `\n`;
      prompt += `   **写入方式**: 使用 \`PATTERNS/{完整路径}.md\` 作为文件名 Write 到 .speccore/PATTERNS/\n`;
      prompt += `   - 文件已存在 → 读取旧内容 → 在末尾追加新发现的变体（用 \`---\` 分隔）\n`;
      prompt += `   - 文件不存在 → 直接 Write 新文件\n\n`;
      prompt += `5. 以上文档输出到 .speccore/GLOBAL/ 和 .speccore/PATTERNS/，使用 Write 工具写入\n`;

      prompt += `\n`;
      prompt += `## 📊 图表生成规范（v7.0.0+）\n`;
      prompt += `全局分析必须生成丰富的可视化图表，帮助开发者直观理解系统结构和数据流。\n\n`;
      prompt += `### Mermaid 图表语法要求\n`;
      prompt += `所有图表使用标准 Mermaid 语法，嵌入到对应 Markdown 文档的代码块中：\n`;
      prompt += `\`\`\`mermaid\n`;
      prompt += `graph LR\n`;
      prompt += `    A[前端页面] -->|调用| B[后端接口]\n`;
      prompt += `    B --> C[数据库]\n`;
      prompt += `\`\`\`\n\n`;
      prompt += `### 各层级必须生成的图表\n`;
      prompt += `| 层级 | 文档 | 图表类型 | Mermaid 语法 | 内容 |\n`;
      prompt += `| :--- | :--- | :--- | :--- | :--- |\n`;
      prompt += `| Layer 2 | _ASSOCIATION.md | 模块关系图 | graph LR / graph TD | 功能模块间的依赖关系、接口调用链路 |\n`;
      prompt += `| Layer 2 | _MODULES.md | 模块全景图 | graph LR | 所有功能模块及所属端 |\n`;
      prompt += `| Layer 3 | 功能模块文档 | 时序图 | sequenceDiagram | 跨端交互时序（请求→处理→响应→推送） |\n`;
      prompt += `| Layer 3 | 功能模块文档 | 流程图 | flowchart TD | 关键业务流程（如下单、审批、支付） |\n`;
      prompt += `| Layer 3 | 功能模块文档 | 状态图 | stateDiagram-v2 | 实体状态流转（如订单状态机） |\n`;
      prompt += `| Layer 4 | INTERACTION_MAP.md | 交互时序图 | sequenceDiagram | 全系统核心跨端交互时序 |\n`;
      prompt += `| Layer 4 | ARCHITECTURE.md | 架构拓扑图 | graph TB | 服务拓扑、部署关系 |\n`;
      prompt += `| Layer 4 | ARCHITECTURE.md | 依赖关系图 | graph LR | 模块间依赖关系 |\n`;
      prompt += `| Layer 4 | DATA_FLOW.md | 数据流图 | flowchart LR | 数据生命周期（产生→传输→存储→归档→销毁） |\n`;
      prompt += `| Layer 4 | DEPLOYMENT.md | CI/CD 流程图 | flowchart LR | 从代码提交到部署的完整流水线 |\n\n`;
      prompt += `### 图表质量要求\n`;
      prompt += `- **节点命名**：使用中文或业务术语，不要使用文件名或类名\n`;
      prompt += `- **边标注**：标注调用关系（如「调用」、「依赖」、「推送」、「订阅」）\n`;
      prompt += `- **颜色区分**：用不同颜色区分端（前端=blue, 后端=green, 数据库=gray, 第三方=orange）\n`;
      prompt += `- **层次清晰**：从上到下或从左到右按逻辑层次排列，避免交叉线过多\n`;
      prompt += `- **聚焦核心**：不要试图把所有细节放进一张图，核心业务路径优先\n\n`;
      prompt += `### 独立图表文件（可选但推荐）\n`;
      prompt += `对于特别复杂的图表，除了嵌入文档外，还可以生成独立的 .mmd 文件到 \`diagrams/\` 目录：\n`;
      prompt += `- \`diagrams/module-relationship.mmd\`：模块关系图（从 _ASSOCIATION.md 提取）\n`;
      prompt += `- \`diagrams/architecture.mmd\`：架构拓扑图（从 ARCHITECTURE.md 提取）\n`;
      prompt += `- \`diagrams/data-flow.mmd\`：数据流图（从 DATA_FLOW.md 提取）\n`;
      prompt += `- \`diagrams/{模块名}-sequence.mmd\`：核心模块时序图\n`;
      prompt += `- \`diagrams/{模块名}-flow.mmd\`：核心模块流程图\n`;
      prompt += `独立 .mmd 文件只包含 Mermaid 代码（无 Markdown 包装），便于后续渲染为 HTML/PNG。\n`;
    } else {
      prompt += `4. 读取 .speccore/GLOBAL/ 下各项目需求文档，生成跨项目索引和需求目录\n`;
    }
    prompt += `\n## 输出文档\n`;
    if (ctx.withCode) {
      prompt += `\n### Layer 中间产物（分析过程中生成）\n`;
      prompt += `> 存放: .speccore/GLOBAL/platforms/\n\n`;
      prompt += `| 文档 | 层级 | 存放位置 | 内容 |\n`;
      prompt += `| :--- | :--- | :--- | :--- |\n`;
      prompt += `| _INDEX.md | Layer 1 | platforms/{端}/ | 各端全面索引（10维度扫描：接口/数据/业务/中间件/消息/定时/配置/外部/日志/错误） |\n`;
      prompt += `| _ASSOCIATION.md | Layer 2 | platforms/_shared/ | 前后端关联矩阵 + 接口缺口 + 消息流链路 + 定时任务影响 + 外部集成分布 + 配置一致性风险 |\n`;
      prompt += `| _MODULES.md | Layer 2 | platforms/_shared/ | 功能模块候选清单（含页面/接口/消息三维聚类） |\n`;
      prompt += `\n### 需求文档（产品视角，v6.99.0+）\n`;
      prompt += `> 存放: .speccore/GLOBAL/requirements/（含 images/ prototypes/ 子目录）\n\n`;
      prompt += `| 文档 | 视角 | 内容 |\n`;
      prompt += `| :--- | :--- | :--- |\n`;
      prompt += `| requirements/REQUIREMENT.md | 产品总监视角 | 需求总纲：愿景、用户画像、场景地图、功能全景、优先级矩阵、里程碑、风险预判 |\n`;
      prompt += `| requirements/{前端端}/REQUIREMENT.md | 前端产品经理视角 | 信息架构、用户旅程、页面清单、交互设计、状态反馈、权限角色、响应式策略 |\n`;
      prompt += `\n### 全局技术性文档（Layer 4 汇总生成，v7.2.0+）\n`;
      prompt += `> 存放: .speccore/GLOBAL/overview/（不与 platforms/requirements 平级）\n\n`;
      prompt += `| 文档 | 视角 | 内容 |\n`;
      prompt += `| :--- | :--- | :--- |\n`;
      prompt += `| overview/FUNCTION_MAP.md | 架构视角 | 功能单元 × 端映射表 |\n`;
      prompt += `| overview/INTERACTION_MAP.md | 架构视角 | 跨端交互时序图（同步 API + 异步消息） |\n`;
      prompt += `| overview/API_CONTRACT.yaml | 技术视角 | 全局接口契约（含 rate limit、幂等性、版本策略、废弃标记） |\n`;
      prompt += `| overview/ARCHITECTURE.md | 技术视角 | 全局架构（服务拓扑、数据流、部署关系、容错、降级、扩容） |\n`;
      prompt += `| overview/SECURITY_AUDIT.md | 安全视角 | 鉴权矩阵、敏感数据流、攻击面、CVE 清单、合规检查 |\n`;
      prompt += `| overview/PERFORMANCE_BASELINE.md | 性能视角 | 慢查询清单、缓存策略矩阵、并发承载、关键路径耗时 |\n`;
      prompt += `| overview/DATA_FLOW.md | 数据视角 | PII 识别追踪、数据生命周期、存储/传输/归档、GDPR 合规 |\n`;
      prompt += `| overview/EXTERNAL_INTEGRATIONS.md | 集成视角 | 第三方服务清单、SDK 风险、Webhook 分布、重复集成识别 |\n`;
      prompt += `| overview/DEPLOYMENT.md | 运维视角 | 容器化、CI/CD、健康检查、环境差异、日志聚合 |\n`;
      prompt += `| overview/OBSERVABILITY.md | 可观测视角 | 日志链路、错误码体系、监控埋点、告警策略、SLA |\n`;
      prompt += `| overview/CONSISTENCY_CHECK.md | 质量视角 | 一致性校验报告（字段/状态/接口/消息/配置） |\n`;
      prompt += `\n### 后端端技术性文档（9项，Layer 3/4 汇总）\n`;
      prompt += `> 存放: .speccore/GLOBAL/platforms/{后端端名}/\n\n`;
      prompt += `| 文档 | 内容 |\n`;
      prompt += `| :--- | :--- |\n`;
      prompt += `| API_INVENTORY.md | 接口清单（路径/方法/参数/响应/鉴权/rate limit/幂等性/版本/废弃） |\n`;
      prompt += `| DATA_MODEL.md | 表结构+字段+关系+索引+数据量预估+归档策略+分库分表建议 |\n`;
      prompt += `| BUSINESS_RULES.md | 校验规则+业务约束+状态机+规则冲突检测+边界案例 |\n`;
      prompt += `| SECURITY.md | 接口鉴权矩阵、输入校验、SQL注入/XSS/CSRF防护、敏感数据处理 |\n`;
      prompt += `| PERFORMANCE.md | 索引评估、缓存命中率、N+1查询、慢查询TOP10、连接池配置 |\n`;
      prompt += `| INTEGRATION.md | 第三方API调用、SDK配置、Webhook处理、消息队列角色 |\n`;
      prompt += `| SCHEDULED_TASKS.md | 定时任务清单（频率、逻辑、数据影响、失败处理） |\n`;
      prompt += `| CONFIG.md | 环境变量、Feature Flag、配置中心、环境差异、敏感配置审计 |\n`;
      prompt += `| TECH_STACK.md | 语言、框架、运行时版本、依赖项（含过期/风险标记） |\n`;
      prompt += `\n### 前端端技术性文档（9项，Layer 3/4 汇总）\n`;
      prompt += `> 存放: .speccore/GLOBAL/platforms/{前端端名}/\n\n`;
      prompt += `| 文档 | 内容 |\n`;
      prompt += `| :--- | :--- |\n`;
      prompt += `| _INDEX.md | 目录索引（页面/组件/接口列表，含路由守卫） |\n`;
      prompt += `| UI_FLOW.md | 页面流转图、操作流程、权限控制点、异常分支 |\n`;
      prompt += `| API_CALL_MAP.md | 页面→接口→后端映射（含错误处理、重试策略） |\n`;
      prompt += `| STATE_MANAGEMENT.md | store结构、actions依赖、持久化、跨组件通信 |\n`;
      prompt += `| COMPONENT_LIBRARY.md | 组件清单、复用度、设计token、主题策略 |\n`;
      prompt += `| ERROR_HANDLING.md | 错误边界、全局处理、用户提示、错误上报 |\n`;
      prompt += `| PERFORMANCE.md | 包大小、代码分割、渲染性能、资源加载、Core Web Vitals |\n`;
      prompt += `| INTEGRATION.md | 第三方SDK、埋点、推送、地图、支付、分享、版本兼容 |\n`;
      prompt += `| TECH_STACK.md | 框架版本、构建配置、UI库、工具链、浏览器兼容性 |\n`;
      prompt += `\n### 通用技术性文档（2项）\n`;
      prompt += `> 存放: .speccore/GLOBAL/platforms/{端名}/\n\n`;
      prompt += `| 文档 | 内容 |\n`;
      prompt += `| :--- | :--- |\n`;
      prompt += `| DEPENDENCY_GRAPH.md | 模块依赖拓扑（含循环依赖检测、依赖深度分析） |\n`;
      prompt += `| CODE_INDEX.md | 目录结构+关键文件+模块职责+代码统计（行数/文件数/复杂度） |\n`;
      prompt += `\n### 知识沉淀\n`;
      prompt += `> 存放: .speccore/PATTERNS/\n\n`;
      prompt += `| 文档 | 内容 |\n`;
      prompt += `| :--- | :--- |\n`;
      prompt += `| PATTERNS/*.md | 可复用设计模式（分类 × 端 双层组织） |\n`;
    } else {
      prompt += `- requirements/REQUIREMENT.md — 合并各迭代需求，生成跨项目需求索引\n`;
    }
    // 冲突处理指令
    prompt += `\n## ⚠️ 文件冲突处理（重要）\n`;
    prompt += `写入每个文件前，必须执行以下冲突检查:\n`;
    prompt += `1. Read 目标文件（如果存在）\n`;
    prompt += `2. 对比新旧内容：\n`;
    prompt += `   - 内容相同 → 跳过，不写入\n`;
    prompt += `   - 内容不同 → 先将旧内容 Write 为 \`{name}-{YYYYMMDDHHmmss}.md\`（同目录，如 \`TECH_STACK-20260813143025.md\`），再 Write 新内容到原文件名\n`;
    prompt += `   - 文件不存在 → 直接 Write\n`;
    prompt += `3. **PATTERNS/*.md 特殊处理**: 不覆盖，只追加。Read 旧文件 → 合并新内容 → Write 回原文件（不生成备份）\n`;
    prompt += `4. 所有文件写完后，输出冲突汇总:\n`;
    prompt += `   \`\`\`\n`;
    prompt += `   ⚠️  N 个文件有冲突，旧版已重命名为时间戳格式：\n`;
    prompt += `      📄 .speccore/GLOBAL/platforms/xxx/API_INVENTORY.md\n`;
    prompt += `         对比: diff API_INVENTORY.md API_INVENTORY-20260813143025.md\n`;
    prompt += `      💡 请对比时间戳文件，合并自定义内容后删除\n`;
    prompt += `   \`\`\`\n`;
    prompt += `\n⚠️ 如 CONSTITUTION.md 中「源码路径」为空或路径不存在: 提示用户先配置，给出三个选项：\n`;
    prompt += `   [1] 停止分析 → 配置后重来 | [2] 跳过源码 → 只用文档分析 | [3] 手动指定路径后继续\n`;
    prompt += '\n' + buildAutoModeInstruction('analyze', iter) + '\n';

    // v7.2.0+: Layer 专注指令 — 在 Prompt 末尾再次强化约束
    prompt += `\n## 🎯 Layer ${targetLayer} 执行清单（必须逐项完成）\n\n`;
    prompt += `> ⚠️ **再次强调**: 你只执行 Layer ${targetLayer}，不要提前做其他层。\n\n`;

    if (targetLayer === 1) {
      prompt += `- [ ] Read CONSTITUTION.md 获取所有端和源码路径\n`;
      prompt += `- [ ] 对每个端扫描 10 个维度，生成 _INDEX.md\n`;
      prompt += `- [ ] 提取可复用模式写入 PATTERNS/{端名}/{分类}/（必须按端分目录，不要写成一个合并文件）\n`;
      prompt += `- [ ] 提取语义标签写入 semantic-tags.json\n`;
      prompt += `- [ ] 写入完成后执行: \`speccore analyze --scope global --layer 2\`\n`;
    } else if (targetLayer === 2) {
      prompt += `- [ ] Read 所有 Layer 1 生成的 _INDEX.md\n`;
      prompt += `- [ ] 匹配前后端接口，生成关联矩阵\n`;
      prompt += `- [ ] 识别公共服务、消息流、定时任务影响\n`;
      prompt += `- [ ] 归纳功能模块，生成 _MODULES.md\n`;
      prompt += `- [ ] 写入 _ASSOCIATION.md + _MODULES.md\n`;
      prompt += `- [ ] 写入完成后执行: \`speccore analyze --scope global --layer 3\`\n`;
    } else if (targetLayer === 3) {
      const filter = options?.filter;
      prompt += `- [ ] Read Layer 2 的 _MODULES.md 获取功能模块清单\n`;
      if (filter) {
        prompt += `> 🔍 **按需分析**: 只分析与 "${filter}" 匹配的模块\n`;
        prompt += `> 从 _MODULES.md 中筛选涉及 ${filter} 的功能模块，其他模块跳过\n`;
      }
      prompt += `- [ ] ${filter ? '筛选匹配的模块，逐个' : '逐个功能模块'}深入分析（读详细源码）\n`;
      prompt += `- [ ] 每个模块生成：API 设计、数据模型、业务规则、交互时序\n`;
      prompt += `- [ ] 时序图/流程图/状态图用 Mermaid 嵌入\n`;
      prompt += `- [ ] 提取模块级模式补充到 PATTERNS/\n`;
      prompt += `- [ ] 写入完成后执行: \`speccore analyze --scope global --layer 4${filter ? ' --filter ' + filter : ''}\`\n`;
    } else if (targetLayer === 4) {
      // v7.2.0+: Layer 4 拆分子层或单文档深度分析
      const deepDoc = options?.deep;
      const subLayerTarget = progress.subLayer?.next || '4a';

      if (deepDoc) {
        // --deep 模式：单文档深度分析
        const outlinePath = join(process.cwd(), '.speccore', 'cache', `deep-outline-${deepDoc.replace(/\//g, '-')}.md`);
        const hasOutline = await pathExists(outlinePath);

        if (options?.iterative && !hasOutline) {
          // 迭代模式第一步：输出大纲
          prompt += `## 🎯 Layer 4 — 单文档深度分析: ${deepDoc}（大纲阶段）\n\n`;
          prompt += `> ⚠️ **当前阶段**: 你只需要输出 **${deepDoc} 的文档大纲**。\n`;
          prompt += `> 不要写详细内容，只输出章节结构 + 每个章节的一句话说明。\n\n`;
          prompt += `**强制输入**: \n`;
          prompt += `- Read Layer 1 的所有 _INDEX.md\n`;
          prompt += `- Read Layer 2 的 _ASSOCIATION.md + _MODULES.md\n`;
          prompt += `- Read Layer 3 的功能模块深入文档\n`;
          prompt += `- Read \`.speccore/cache/structured-data.json\`（API/Entity 结构化数据）\n\n`;
          prompt += `**输出格式**: \n`;
          prompt += `\`\`\`markdown\n`;
          prompt += `# ${deepDoc.replace('.md', '')}\n`;
          prompt += `\n`;
          prompt += `## 1. 章节标题\n`;
          prompt += `> 一句话说明该章节内容\n`;
          prompt += `\n`;
          prompt += `## 2. 章节标题\n`;
          prompt += `> 一句话说明该章节内容\n`;
          prompt += `\`\`\`\n\n`;
          prompt += `**下一步**: 大纲输出后，用户会审核修改，然后执行 \`speccore analyze --scope global --layer 4 --deep ${deepDoc} --iterative\` 进入逐节填充阶段。\n`;
        } else if (options?.iterative && hasOutline) {
          // 迭代模式第二步：根据大纲逐节填充
          const outlineContent = await readFile(outlinePath, 'utf-8');
          prompt += `## 🎯 Layer 4 — 单文档深度分析: ${deepDoc}（逐节填充阶段）\n\n`;
          prompt += `> ⚠️ **当前阶段**: 根据已确认的大纲，逐节填充详细内容。\n`;
          prompt += `> 每次只填充 **一节**，确保深度和质量。\n\n`;
          prompt += `**已确认大纲**: \n`;
          prompt += outlineContent.slice(0, 2000); // 限制长度
          prompt += `\n\n`;
          prompt += `**强制输入**: \n`;
          prompt += `- Read Layer 1-3 的所有产物\n`;
          prompt += `- Read \`.speccore/cache/structured-data.json\`\n`;
          prompt += `- 如涉及代码细节，Read 相关源码文件\n\n`;
          prompt += `**深度要求**: \n`;
          prompt += `- 不要写"待导入"、"待补充"等占位内容\n`;
          prompt += `- 每个表格必须有真实数据\n`;
          prompt += `- 每个结论必须有证据（引用文件名/类名/方法名）\n`;
          prompt += `- 必须包含 Mermaid 图表（如适用）\n\n`;
          prompt += `**输出**: 只输出当前节的完整内容（不是整份文档）\n`;
        } else {
          // 非迭代模式：一次性输出完整文档
          prompt += `## 🎯 Layer 4 — 单文档深度分析: ${deepDoc}\n\n`;
          prompt += `> ⚠️ **专注约束**: 你只生成 **${deepDoc}** 这一份文档，不要生成其他文档。\n`;
          prompt += `> 你必须深入分析，不要写框架/占位符。每节必须有实质性内容。\n\n`;
          prompt += `**强制输入**: \n`;
          prompt += `- Read Layer 1 的所有 _INDEX.md（获取源码结构索引）\n`;
          prompt += `- Read Layer 2 的 _ASSOCIATION.md + _MODULES.md（获取跨端关联）\n`;
          prompt += `- Read Layer 3 的功能模块深入文档（获取详细分析结果）\n`;
          prompt += `- Read \`.speccore/cache/structured-data.json\`（API/Entity 结构化数据）\n`;
          prompt += `- 如果涉及代码细节，直接 Read 相关源码文件，引用具体代码片段\n\n`;
          prompt += `**深度要求**: \n`;
          prompt += `- 不要写"待导入"、"待补充"、"示例"等占位内容\n`;
          prompt += `- 每个表格必须有真实数据（从 Layer 1-3 提取）\n`;
          prompt += `- 每个结论必须有证据（引用具体文件名/类名/方法名）\n`;
          prompt += `- 如果信息不足，明确标注"信息不足: 需要读取 xxx 文件"\n`;
          prompt += `- 必须包含 Mermaid 图表（如适用）\n\n`;
          prompt += `**输出**: 只输出 \`${deepDoc}\` 的完整内容\n`;
        }
      } else {
        // 子层模式：每次只生成一个子层
        prompt += `## 🌍 Layer 4: 全局汇总 — 子层 ${subLayerTarget}/4\n\n`;
        prompt += `> ⚠️ **专注约束**: 你当前只执行 **子层 ${subLayerTarget}**，不要生成其他子层的文档。\n`;
        prompt += `> 子层完成后执行: \`speccore analyze --scope global --layer 4\` 进入下一子层。\n\n`;
        prompt += `**强制输入**: \n`;
        prompt += `- Read Layer 1 的所有 _INDEX.md\n`;
        prompt += `- Read Layer 2 的 _ASSOCIATION.md + _MODULES.md\n`;
        prompt += `- Read Layer 3 的功能模块深入文档\n\n`;

        if (subLayerTarget === '4a') {
          prompt += `**子层 4a: 产品视角文档（2-3 份）**\n`;
          prompt += `> ⚠️ **REQUIREMENT.md 是必须生成的核心文档**，不可跳过！\n\n`;
          prompt += `1. \`requirements/REQUIREMENT.md\` — 全局需求总纲（**必须生成**）\n`;
          prompt += `   - 产品愿景、目标用户画像、核心场景地图\n`;
          prompt += `   - 按业务场景组织：用户故事 → 操作流程 → 业务规则 → 边界条件 → 验收标准\n`;
          prompt += `   - 功能优先级矩阵（P0/P1/P2）\n`;
          prompt += `   - 必须从 Layer 3 的功能模块分析中提取真实内容，不要臆造\n`;
          prompt += `2. 各前端端 \`requirements/{端}/REQUIREMENT.md\` — 只生成已有前端端的需求\n`;
          prompt += `   - 信息架构、用户旅程、页面清单、交互设计\n`;
          prompt += `   - 从 Layer 1 的前端 _INDEX.md 提取页面/路由信息\n`;
          prompt += `   - 从 Layer 3 的模块分析提取交互流程\n`;
        } else if (subLayerTarget === '4b') {
          prompt += `**子层 4b: 全局技术核心文档（3-4 份）**\n`;
          prompt += `1. \`overview/FUNCTION_MAP.md\` — 功能单元 × 端映射表\n`;
          prompt += `   - 从 Layer 2 的 _MODULES.md 提取功能模块\n`;
          prompt += `   - 每个功能单元标注：涉及端、核心页面、核心接口、状态枚举\n`;
          prompt += `2. \`overview/ARCHITECTURE.md\` — 全局架构\n`;
          prompt += `   - 服务拓扑（从 Layer 1 的后端 _INDEX.md 提取服务名和依赖）\n`;
          prompt += `   - 数据流（从 Layer 3 的模块分析提取）\n`;
          prompt += `   - 必须包含 Mermaid architecture diagram\n`;
          prompt += `3. \`overview/API_CONTRACT.yaml\` — 全局接口契约\n`;
          prompt += `   - 汇总所有后端端的 API_INVENTORY（从 Layer 1 提取）\n`;
          prompt += `   - 标注 rate limit、幂等性、版本策略\n`;
          prompt += `4. \`overview/INTERACTION_MAP.md\` — 跨端交互时序图\n`;
          prompt += `   - 从 Layer 3 的模块时序图汇总\n`;
          prompt += `   - 必须包含 Mermaid sequenceDiagram\n`;
        } else if (subLayerTarget === '4c') {
          prompt += `**子层 4c: 全局技术扩展文档（4-5 份）**\n`;
          prompt += `1. \`overview/SECURITY_AUDIT.md\` — 安全审计\n`;
          prompt += `2. \`overview/PERFORMANCE_BASELINE.md\` — 性能基线\n`;
          prompt += `3. \`overview/DATA_FLOW.md\` — 数据流与隐私\n`;
          prompt += `4. \`overview/DEPLOYMENT.md\` — 部署运维\n`;
          prompt += `5. \`overview/CONSISTENCY_CHECK.md\` — 一致性校验\n`;
          prompt += `   - 从 Layer 2 的关联分析提取不一致项\n`;
        } else if (subLayerTarget === '4d') {
          prompt += `**子层 4d: 各端技术文档**\n`;
          prompt += `后端端（每端 9 项，但本次只生成核心 3 项，其余后续补充）:\n`;
          prompt += `1. \`API_INVENTORY.md\` — 从 Layer 1 的 _INDEX.md 提取完整接口清单\n`;
          prompt += `2. \`DATA_MODEL.md\` — 从 Layer 1 的 Entity 目录 + Layer 3 的模块分析提取\n`;
          prompt += `3. \`BUSINESS_RULES.md\` — 从 Layer 3 的模块分析提取业务规则\n`;
          prompt += `前端端（每端 9 项，但本次只生成核心 3 项）:\n`;
          prompt += `1. \`UI_FLOW.md\` — 从 Layer 1 的路由 + Layer 3 的模块分析提取\n`;
          prompt += `2. \`API_CALL_MAP.md\` — 从 Layer 1 的 API 调用提取\n`;
          prompt += `3. \`STATE_MANAGEMENT.md\` — 从 Layer 1 的 store 目录提取\n`;
        }

        prompt += `\n**质量要求**: \n`;
        prompt += `- 禁止写"待导入"、"待补充"等占位符\n`;
        prompt += `- 每个表格必须有真实数据（从 Layer 1-3 提取）\n`;
        prompt += `- 如果信息不足，明确标注"信息不足: 需要读取 xxx"\n`;
      }
    }

    prompt += `\n## 📝 写入方式\n`;
    prompt += `使用 \`speccore analyze --apply '{"文件路径":"内容"}' --scope global\` 写入。\n`;
    prompt += `- platforms/ 和 requirements/ 下的文件按原路径写（如 \`platforms/backend/_INDEX.md\`）\n`;
    prompt += `- overview/ 下的文件写纯文件名即可（如 \`ARCHITECTURE.md\` 自动路由到 overview/）\n`;
    prompt += `- PATTERNS/ 下的文件写 \`PATTERNS/{分类}/{模式名}.md\`\n`;

    return await injectGraphSummary(prompt);
  }

  const docs: [string, string][] = [
    ['REQUIREMENT.md',
`# 需求规格说明书

> ${iter} | ${now}
> ⚠️ 迭代名称仅为目录标识，不代表需求内容。以下分析严格基于需求文档，严禁臆造文档中未提及的功能。

## 写作要求
将原始需求文档综合整理为一份结构化的需求规格说明书，不是简单复制原文，而是：
- 按功能模块组织，每个模块必须包含：
  - 功能描述、用户故事、验收标准、业务规则
  - **涉及端**：明确标注该功能涉及哪些端（如 H5移动端、后台管理端、room-service、booking-service），后续文档据此逐端展开
- 提取所有 API 接口需求（方法、路径、参数、响应格式）
- 提取数据模型和字段需求
- 标注异常场景和边界条件
- 去重合并多端需求的公共部分，标注差异
- **各端差异化需求**：同一功能在不同端的交互方式可能不同，必须分别说明：
  - 后端：接口规格、数据校验规则、事务约束
  - Web 管理端：页面布局、表格/表单交互、权限控制
  - H5/移动端：触摸交互、响应式适配、弱网处理
  - 小程序：包体积约束、平台 API 限制、原生能力调用
`],

    ['ANALYSIS.md',
`# 需求分析报告

> ${iter} | ${now}
> ⚠️ 迭代名称仅为目录标识，不代表需求内容。以下分析严格基于需求文档，严禁臆造文档中未提及的功能。

## 写作要求
这是一份完整的需求分析报告，不是填空表。请根据 READ 的需求文档，用自然段落、表格、列表自由组织内容，涵盖以下要点：
- 所有功能模块及其涉及的角色、核心流程
- 从业务功能推导出的接口清单（接口名、用途、关键参数）
- 从业务字段描述推导出的数据实体及字段
- 文档中标注的业务规则（R-XX-XX）
- 各功能的异常场景和边界条件
- **按端分析**：每个功能模块分别分析各端的实现需求：
  - 后端：接口设计、数据模型、业务逻辑、事务约束
  - 前端各端：页面结构、组件拆分、字段展示、交互流程、状态管理
- **跨端关联**：标注哪些功能需要跨端协作，数据如何在各端之间流转
`],

    ['TECH.md',
`# 技术方案

> ${iter}

## 写作要求
根据 REQUIREMENT.md 中的功能模块，**逐端**撰写技术方案。
**注意：后端端和前端端的 TECH.md 内容要求不同，请按端类型选择对应模板：**

### 后端端（*service）— 纯技术视角
- 整体架构和分层设计
- 模块划分、职责说明、核心接口设计（路径/方法/参数/响应/状态码/错误码）
- 数据库表结构（字段/类型/索引/约束/DDL）
- 业务规则实现（含边界条件和异常流）
- 缓存策略/并发与事务/消息队列（如涉及）
- 安全：SQL注入防护/接口鉴权/数据脱敏
- 性能：QPS预估/慢查询优化/连接池配置
- **不要写**用户旅程、业务场景、页面清单（这些在 overview/REQUIREMENT.md 中）

### 前端端（h5 / admin-web / miniapp）— 产品+技术双视角
- **产品视角（主要）**：
  - 用户旅程：该端用户如何完成核心任务（步骤流程图）
  - 页面清单：所有页面名称、路径、核心功能、入口位置
  - 交互设计：关键操作流程、状态变化、异常提示方式
  - 字段展示：每个页面展示哪些字段、字段来源（后端哪个接口）
  - 权限控制：哪些页面/按钮需要权限、权限粒度
- **技术视角（辅助）**：
  - 页面路由结构、组件拆分方案
  - API 调用清单：前端调用了哪些后端接口（路径+方法+用途）
  - 状态管理设计（全局状态、与后端数据同步策略）
  - 适配/性能/安全等前端专项（按端类型选择）

⚠️ 不要只写后端不写前端 — REQUIREMENT.md 中标注了涉及端的模块，每个端都要有对应的技术设计
`],

    ['TEST.md',
`# 测试计划

> ${iter}

## 写作要求
根据 REQUIREMENT.md 中的功能模块及其涉及端，**逐端**制定测试计划：
- **后端接口测试**：每个功能模块的核心测试用例（含前置条件、步骤、预期结果）
- **前端页面测试**：每个前端页面（H5/后台管理端等）的 UI 交互用例、页面流转测试
- **E2E 端到端测试**：跨端核心业务流程（如 H5 预订 → 后端处理 → 管理端查看）
- 边界值和异常输入测试
- 集成测试场景

⚠️ 不要只写后端接口测试 — 原始需求中前端页面的操作流程和验收标准，都要转化为页面级测试用例
`],

    ['REVIEW.md',
`# 评审检查清单

> ${iter}

## 写作要求
**按端分章节**，从安全、质量、性能三个维度，逐项列出本次需求的评审要点：

### 后端评审
- 安全: 每个接口的鉴权需求、数据校验、敏感信息保护、SQL 注入防护
- 质量: 幂等性、事务一致性、错误处理、并发安全
- 性能: 批量操作风险、缓存策略、查询优化、连接池配置

### 前端评审
- 安全: XSS 防护、CSRF Token、Token 存储安全
- 质量: 表单校验完整性、防重复提交、错误提示、内存泄漏
- 性能: 首屏加载、长列表优化、打包体积、图片优化
- 兼容性: 浏览器/设备兼容、响应式布局、触摸交互
`],

    ['RISK.md',
`# 风险评估

> ${iter}

## 写作要求
识别本次需求的技术和业务风险，逐项说明：
- 风险点、触发条件、影响范围
- 建议的缓解措施
- 如果需求文档已有风险评估，扩展补充
`],

    ['DEPS.md',
`# 依赖清单

> ${iter}

## 写作要求
列出本次需求涉及的外部依赖：
- 需要调用的外部服务及关键接口
- 需要的中间件（缓存、消息队列、定时任务等）
- 依赖的第三方库或 SDK
`],

    ['MONITOR.md',
`# 监控指标

> ${iter}

## 写作要求
**按端分章节**，根据需求中的业务功能和规则，定义监控指标：

### 业务指标
- 核心业务成功率、转化率、处理时延

### 后端技术指标
- 接口性能：响应时间(P50/P95/P99)、QPS、错误率
- 基础设施：CPU/内存/数据库连接数/慢查询/Redis 命中率
- 异常监控：未捕获异常、OOM 重启、死锁

### 前端技术指标
- 性能：FCP/LCP/FID/CLS（Core Web Vitals）
- 稳定性：JS 错误率、API 失败率、白屏率
- 体验：TTI、资源加载失败率、长任务数

### 告警规则
- 按 Fatal/Critical/Warning/Info 分级，定义触发条件、通知方式、响应时间
`],

    ['UI_SPEC.md',
`# 前端 UI 规格

> ${iter} | ${now}

## 写作要求
根据 REQUIREMENT.md 和 TECH.md 中的前端需求，逐端整理 UI 规格：
- 页面结构与路由（每个页面的路径、入口、权限）
- 组件清单（列表、表单、详情、仪表盘等）
- 字段→UI 映射（每个页面/表单展示哪些字段，来源哪个 API）
- 状态枚举（前后端共享的状态值定义，如 0=空闲 1=使用中 2=维护中）

⚠️ 这是前后端契约的关键桥梁 — 字段映射必须与后端 API 响应字段一一对应
`],

    ['FUNCTION_MAP.md',
`# 跨端功能映射表

> ${iter} | ${now}

## 写作要求
基于 REQUIREMENT.md 中的功能模块清单，生成本迭代所有功能单元的跨端映射表：

### 映射表格式
| # | 功能单元 | 涉及端 | 共享能力 | 依赖任务 | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |

### 列定义
- 「功能单元」：业务功能的最小可交付单元，与 REQUIREMENT.md 功能模块清单一一对应
- 「涉及端」：该功能单元需要新开发工作的所有端（标准端名，逗号分隔）。只标注需要写新接口/新页面/新逻辑的端
- 「共享能力」：如果该功能单元依赖或被其他功能单元共享的通用能力（如"审批引擎"、"消息通知"）
- 「依赖任务」：当前迭代内，该功能单元依赖的其他功能单元编号（如 M-03）
- 「说明」：跨端交互说明（如"admin-web 调用 booking-service 的 /api/rooms 接口"）

### 重要规则
- 每个功能单元一行，不允许合并多个功能单元到一行
- 「涉及端」必须与 CONSTITUTION.md「端列表」中的标准端名完全匹配
- 如果某功能单元只涉及一个端，也要列出（如纯前端优化）
- 共享能力标注为"无"表示该功能单元没有跨任务共享的通用组件
`],

    ['INTERACTION_MAP.md',
`# 跨端交互图谱

> ${iter} | ${now}

## 写作要求
基于 REQUIREMENT.md 中的业务场景和 FUNCTION_MAP.md 中的跨端映射，为每个功能单元生成交互时序图：

### 格式要求
- 使用 Mermaid sequenceDiagram 语法
- 每个功能单元一个独立的序列图
- actor 为用户角色（如"用户"、"Admin"）
- participant 为涉及的端（使用标准端名）
- 箭头标注调用的接口路径（如 \`POST /api/bookings\`）
- 标注 \`[contract]\` 表示该接口在 API_CONTRACT.yaml 中有定义
- 用 Note 标注业务规则（如边界条件、状态流转）
- 用 alt/else/end 标注分支逻辑

### 内容要求
- 展示完整的业务交互时序：用户操作 → 前端处理 → 后端调用 → 数据返回
- 明确标出后端服务之间的内部调用（产品文档中写"系统处理"的地方）
- 标注异步调用（虚线箭头）和同步调用（实线箭头）
- 在序列图后附上「接口契约索引」表格：步骤号、接口、消费者、提供者
- 在序列图后附上「状态流转」表格（如涉及状态变更）

### 示例结构
\`\`\`mermaid
sequenceDiagram
    actor U as 用户
    participant H5 as h5-mobile
    participant BS as booking-service
    participant RS as room-service
    U->>H5: 选择会议室/时间
    H5->>BS: POST /api/bookings [contract]
    BS->>RS: GET /api/rooms/{id}/availability [contract]
    RS-->>BS: 可用性状态
    alt 可用
        BS->>BS: 创建预订记录
        BS-->>H5: 201 Created
    else 不可用
        BS-->>H5: 409 Conflict
    end
\`\`\`
`],

    ['DEV_GUIDE.md',
`# 开发者实现指南

> ${iter} | ${now}
> 本文档面向开发者，提供具体实现步骤、代码模式和最佳实践。

## 写作要求

### 迭代级 DEV_GUIDE.md（020-specs/overview/）
- **技术栈与选型决策**：每个技术点的选型理由、替代方案对比
- **代码分层规范**：目录结构、各层职责、代码组织方式
- **通用设计模式**：Repository 模式、Service 模式、策略模式等具体实现
- **跨端数据流**：请求从入口到数据库的完整链路、数据转换规则
- **错误处理策略**：全局错误码、异常分类、降级策略
- **性能优化基线**：缓存策略、数据库优化、并发控制
- **安全基线**：鉴权流程、数据校验、敏感信息处理

### 端级 DEV_GUIDE.md（020-specs/{端}/）
- **端技术栈**：框架、库、工具链及选型理由
- **目录结构规范**：该端的代码组织方式
- **核心流程实现**：关键业务流程的伪代码/示例代码
- **API 调用模式**：请求封装、错误处理、重试策略
- **状态管理**：全局状态设计、与后端同步策略
- **端特定最佳实践**：该端特有的性能优化、安全策略

### 任务级 DEV_GUIDE.md（Task/00-specs/）
- **任务概述**：该任务在整体功能中的位置和职责
- **实现步骤**：Step-by-step 的开发步骤
- **关键代码示例**：核心逻辑的伪代码或代码片段
- **与存量功能的集成**：如何与已有代码交互、复用哪些模块
- **测试策略**：单元测试、集成测试的具体写法
- **注意事项**：常见坑点、边界条件、调试技巧

## 质量要求
- 必须是**可执行的实现指导**，不是抽象概念
- 包含具体的代码示例（伪代码或关键代码片段）
- 基于 020-specs/ 中已有的分析文档，不做重复分析
- 补充技术文档中未涉及的实现细节
- 如果涉及存量功能，说明复用方式和集成点
`],
  ];

  // 任务类型 × 文档矩阵: 每种类型生成哪些文档
  // v7.4.0+: DEV_GUIDE.md 是所有任务类型的标准文档，必须生成
  const DOC_MATRIX: Record<string, string[]> = {
    feature:    ['REQUIREMENT.md','ANALYSIS.md','TECH.md','TEST.md','REVIEW.md','RISK.md','DEPS.md','MONITOR.md','UI_SPEC.md','FUNCTION_MAP.md','INTERACTION_MAP.md','DEV_GUIDE.md'],
    refactor:   ['ANALYSIS.md','TECH.md','TEST.md','REVIEW.md','RISK.md','DEV_GUIDE.md'],
    bugfix:     ['ANALYSIS.md','TECH.md','TEST.md','DEV_GUIDE.md'],
    research:   ['ANALYSIS.md','DEV_GUIDE.md'],
    review:     ['REVIEW.md','RISK.md','DEV_GUIDE.md'],
    test:       ['TEST.md','RISK.md','DEV_GUIDE.md'],
    docs:       ['ANALYSIS.md','DEV_GUIDE.md'],
    deploy:     ['ANALYSIS.md','TECH.md','RISK.md','DEPS.md','MONITOR.md','DEV_GUIDE.md'],
    security:   ['ANALYSIS.md','TEST.md','REVIEW.md','RISK.md','DEV_GUIDE.md'],
    performance:['ANALYSIS.md','TECH.md','TEST.md','MONITOR.md','DEV_GUIDE.md'],
  };
  const includeDocs = isTask ? (DOC_MATRIX[taskType] || DOC_MATRIX['feature']) : DOC_MATRIX['feature'];

  // ── v6.61.0+: 恢复 Phase 1/Phase 2 分步逻辑，但 CLI 自动触发 Phase 2 ──
  // Phase 1: 生成综合文档(overview/REQUIREMENT.md、ANALYSIS.md、DEPS.md 等)
  // Phase 2: 生成各端专属文档({端}/TECH.md、TEST.md、UI_SPEC.md 等)
  const GLOBAL_DOCS = ['REQUIREMENT.md', 'ANALYSIS.md', 'TECH.md', 'RISK.md', 'DEPS.md', 'REVIEW.md', 'MONITOR.md', 'FUNCTION_MAP.md', 'INTERACTION_MAP.md'];
  const PLATFORM_DOCS = ['TECH.md', 'TEST.md', 'UI_SPEC.md'];
  let taskDocs = docs.filter(([n]) => includeDocs.includes(n));
  if (ctx.phase === '1') {
    taskDocs = taskDocs.filter(([n]) => GLOBAL_DOCS.includes(n));
  } else if (ctx.phase === '2') {
    taskDocs = taskDocs.filter(([n]) => PLATFORM_DOCS.includes(n));
  }

  // ── 任务级文档覆盖：00-specs/ 使用任务级文档集（v6.44.0+） ──
  if (isTask && !ctx.phase) {
    const TASK_DOCS: Record<string, string[]> = {
      feature:    ['REQ.md', 'TECH.md', 'TASK.md', 'SCHEMA.md'],
      refactor:   ['REQ.md', 'TECH.md', 'TASK.md'],
      bugfix:     ['REQ.md', 'TECH.md'],
      research:   ['REQ.md'],
      review:     ['REQ.md'],
      test:       ['REQ.md', 'TECH.md'],
      deploy:     ['REQ.md', 'TECH.md'],
      security:   ['REQ.md', 'TECH.md'],
      performance:['REQ.md', 'TECH.md'],
    };
    const taskDocNames = TASK_DOCS[taskType] || TASK_DOCS['feature'];
    taskDocs = taskDocs.filter(([n]) => taskDocNames.includes(n));
    // 补充 TASK.md 和 SCHEMA.md（不在全局 docs 数组中）
    if (taskDocNames.includes('TASK.md') && !taskDocs.find(([n]) => n === 'TASK.md')) {
      taskDocs.push(['TASK.md', '']);
    }
    if (taskDocNames.includes('SCHEMA.md') && !taskDocs.find(([n]) => n === 'SCHEMA.md')) {
      taskDocs.push(['SCHEMA.md', '']);
    }
    // 任务级模板覆盖（v6.44.0+）
    for (const doc of taskDocs) {
      if (doc[0] === 'REQ.md') {
        doc[1] = `# \u672c\u4efb\u52a1\u9700\u6c42\u89c4\u683c\n\n> ${iter} | ${ctx.task} | ${now}\n\n## \u5199\u4f5c\u8981\u6c42\n\u6839\u636e split \u4ea7\u51fa\u7684\u9700\u6c42\u5207\u7247\uff0c\u7ed3\u5408\u5168\u5c40\u4e0a\u4e0b\u6587\uff0c\u91cd\u65b0\u7ec4\u7ec7\u672c\u4efb\u52a1\u7684\u9700\u6c42\u89c4\u683c\uff1a\n- \u660e\u786e\u672c\u4efb\u52a1\u7684\u9a8c\u6536\u6807\u51c6\uff08\u53ef\u6d4b\u8bd5\u7684\u3001\u5177\u4f53\u7684\uff09\n- \u7ec6\u5316\u4e1a\u52a1\u89c4\u5219\u548c\u8fb9\u754c\u6761\u4ef6\n- \u5217\u51fa\u5f02\u5e38\u573a\u666f\u548c\u5904\u7406\u65b9\u5f0f\n- \u6807\u6ce8\u4e0e\u5176\u4ed6 Task \u7684\u4f9d\u8d56\u5173\u7cfb\n`;
      } else if (doc[0] === 'TECH.md') {
        doc[1] = `# \u672c\u4efb\u52a1\u6280\u672f\u65b9\u6848\n\n> ${iter} | ${ctx.task} | ${now}\n\n## \u5199\u4f5c\u8981\u6c42\n\u57fa\u4e8e overview/TECH.md \u7684\u6574\u4f53\u67b6\u6784\uff0c\u7ec6\u5316\u5230\u51fd\u6570/\u63a5\u53e3\u7ea7\u522b\uff1a\n- \u5177\u4f53\u7684\u63a5\u53e3\u5b9a\u4e49\uff08\u8def\u5f84/\u53c2\u6570/\u54cd\u5e94\uff09\n- \u6570\u636e\u6a21\u578b\u8bbe\u8ba1\uff08Entity/DTO/VO \u5b57\u6bb5\u6620\u5c04\uff09\n- \u6838\u5fc3\u4e1a\u52a1\u903b\u8f91\u7684\u4f2a\u4ee3\u7801\u6216\u6d41\u7a0b\u63cf\u8ff0\n- \u524d\u7aef\u7ec4\u4ef6\u62c6\u5206\u548c\u72b6\u6001\u8bbe\u8ba1\n- \u5fc5\u987b\u4e0e overview/TECH.md \u7684\u6574\u4f53\u67b6\u6784\u4fdd\u6301\u4e00\u81f4\n`;
      } else if (doc[0] === 'TASK.md') {
        doc[1] = `# \u5b9e\u65bd\u8ba1\u5212\n\n> ${iter} | ${ctx.task} | ${now}\n\n## \u5199\u4f5c\u8981\u6c42\n\u6839\u636e\u672c\u4efb\u52a1\u7684\u9700\u6c42\u548c\u6280\u672f\u65b9\u6848\uff0c\u5236\u5b9a\u5177\u4f53\u5b9e\u65bd\u6b65\u9aa4\uff1a\n- \u6309\u5f00\u53d1\u987a\u5e8f\u5217\u51fa\u5177\u4f53\u6b65\u9aa4\n- \u6bcf\u4e2a\u6b65\u9aa4\u6709\u660e\u786e\u7684\u5b8c\u6210\u6807\u51c6\n- \u6807\u6ce8\u6b65\u9aa4\u95f4\u7684\u4f9d\u8d56\u5173\u7cfb\n- \u4f30\u7b97\u6bcf\u6b65\u7684\u5de5\u4f5c\u91cf\n`;
      } else if (doc[0] === 'SCHEMA.md') {
        doc[1] = `# \u6570\u636e\u6a21\u578b\n\n> ${iter} | ${ctx.task} | ${now}\n\n## \u5199\u4f5c\u8981\u6c42\n\u68b3\u7406\u672c\u4efb\u52a1\u6d89\u53ca\u7684\u6570\u636e\u6a21\u578b\u53d8\u66f4\uff1a\n- \u5b8c\u6574\u7684\u5b57\u6bb5\u5b9a\u4e49\uff08\u540d\u79f0/\u7c7b\u578b/\u7ea6\u675f/\u8bf4\u660e\uff09\n- \u7d22\u5f15\u8bbe\u8ba1\n- DDL \u8bed\u53e5\uff08\u5982\u9002\u7528\uff09\n- \u5b57\u6bb5\u2192API \u54cd\u5e94\u5b57\u6bb5\u7684\u6620\u5c04\u5173\u7cfb\n`;
      }
    }
  }

  // v7.2.0+: 细粒度分析 — 只生成指定文档的指定功能
  if (options?.docName && options?.featureName && !isGlobal) {
    const targetDoc = options.docName.endsWith('.md') ? options.docName : `${options.docName}.md`;
    const filtered = taskDocs.filter(([n]) => n === targetDoc || n === options.docName);
    if (filtered.length > 0) {
      taskDocs = filtered;
    } else {
      // 不在默认文档列表中，创建单文档分析任务
      taskDocs = [[targetDoc, `# ${targetDoc.replace('.md', '')} — ${options.featureName}\n\n> ${iter} | ${now}\n> 分析范围: 仅「${options.featureName}」功能单元\n\n## 写作要求\n针对「${options.featureName}」进行深入分析，基于需求文档和代码上下文补充详细内容。\n`]];
    }
  }

  // ── 用户自定义模板集成（v6.45.0+）──
  const templateLevel = isGlobal ? 'global' : (isTask ? 'task' : 'iteration');
  const userTemplates = await loadUserTemplates(templateLevel, isTask ? taskType : undefined, ctx.platform);
  const hasUserTemplates = userTemplates.size > 0;

  if (hasUserTemplates) {
    // 用户模板覆盖/追加：用户放了什么文档就生成什么文档
    for (const [docName, docContent] of userTemplates) {
      const existing = taskDocs.find(([n]) => n === docName);
      if (existing) {
        // 同名覆盖：用户模板作为参考
        existing[1] = docContent;
      } else {
        // 新文档追加：用户自定义文档
        taskDocs.push([docName, docContent]);
      }
    }
  }

  // ── v6.60.0+: TECH.md 模板：global/ 侧重整体架构，{端}/ 侧重端专属方案 ──
  const techDoc = taskDocs.find(([n]) => n === 'TECH.md');
  if (techDoc) {
    // overview/TECH.md: 整体架构
    techDoc[1] = `# 技术架构（跨端全局）\n\n> ${iter}\n\n## 写作要求\n撰写整体技术架构，覆盖所有端的交互关系：\n- 系统整体分层设计（各端在架构中的位置）\n- 跨端交互协议（前端↔后端通信方式、数据流向）\n- 中间件选型（缓存、消息队列、网关等）\n- 数据库整体设计（核心表结构、ER 关系）\n- 技术栈选型及理由\n`;
  }

  let prompt = `\n# 任务: ${command}${task} (${taskDocs.length}个文档 · ${isTask ? `类型:${taskType}` : '迭代全量'}${ctx.phase ? ` · Phase ${ctx.phase}` : ''})\n\n`;

  // v7.2.0+: 迭代分析代码关联 — 注入结构化数据和语义定位上下文
  if (!isGlobal && ctx.withCode && ctx.iteration && ctx.iteration !== 'GLOBAL') {
    try {
      // 1. 提取结构化数据（如果还没有）
      const structuredDataPath = join(process.cwd(), '.speccore', 'cache', 'structured-data.json');
      if (!(await pathExists(structuredDataPath))) {
        const constitutionPath = join(process.cwd(), '.speccore', 'CONSTITUTION.md');
        let sourcePaths: string[] = ['src'];
        if (await pathExists(constitutionPath)) {
          const content = await readFile(constitutionPath, 'utf-8');
          const match = content.match(/源码路径[\s\S]*?\n\s*-\s*`?([^`\n]+)`?/g);
          if (match) {
            sourcePaths = match.map(m => m.replace(/.*-\s*`?/, '').replace(/`?$/, '').trim()).filter(Boolean);
          }
        }
        const { extractStructuredData } = await import('../core/structured-extractor');
        await extractStructuredData(process.cwd(), sourcePaths);
      }

      // 2. 注入结构化数据摘要到 Prompt
      if (await pathExists(structuredDataPath)) {
        const data = await readFile(structuredDataPath, 'utf-8');
        const structured = JSON.parse(data);
        const stats = structured.stats || {};
        prompt += `## 📊 代码结构化数据（自动提取）\n\n`;
        prompt += `> 已扫描项目源码，提取以下结构化信息供分析参考：\n\n`;
        prompt += `- API 接口: ${stats.totalApis || 0} 个\n`;
        prompt += `- 数据实体: ${stats.totalEntities || 0} 个\n`;
        prompt += `- 页面路由: ${stats.totalRoutes || 0} 个\n`;
        prompt += `- 前端组件: ${stats.totalComponents || 0} 个\n`;
        prompt += `- 扫描文件: ${stats.totalFiles || 0} 个\n\n`;
        prompt += `> 💡 分析技术方案时，可参考 \`.speccore/cache/structured-data.json\` 中的 API/Entity/Route/Component 清单\n`;
        prompt += `> 如需了解具体实现，直接 Read 对应源码文件\n\n`;
      }

      // 3. 语义定位：如果指定了功能名，自动关联上下文
      if (options?.featureName) {
        const { buildFeatureContext, buildFeatureContextPrompt } = await import('../core/semantic-locator');
        const iterDir = await getIterationDir(ctx.iteration);
        const featureCtx = await buildFeatureContext(process.cwd(), iterDir, options.featureName, options.docName);
        prompt += buildFeatureContextPrompt(featureCtx);
      }
    } catch (e: any) {
      logger.warn(`   ⚠️ 代码关联注入失败: ${e.message}`);
    }
  }

  // v6.80.0+: 注入需求质量上下文（迭代级分析时）
  if (!isGlobal && !isTask && ctx.iteration && ctx.iteration !== 'GLOBAL') {
    try {
      const iterDir = await getIterationDir(ctx.iteration);
      const reportPath = join(iterDir, '010-requirements', 'CLARIFY_REPORT.md');
      if (await pathExists(reportPath)) {
        const report = await readFile(reportPath, 'utf-8');
        // 提取汇总表和关键信息
        const summaryMatch = report.match(/## 质量评分汇总[\s\S]*?(?=## |$)/);
        if (summaryMatch) {
          prompt += `## 📋 需求文档质量声明\n\n`;
          prompt += `> 以下评价基于 Phase 0 需求澄清结果\n\n`;
          prompt += summaryMatch[0].split('\n').slice(0, 12).join('\n'); // 取汇总表前12行
          prompt += `\n\n`;
          // 检测是否有遗留问题
          const hasIssues = report.includes('待澄清') || report.includes('❌');
          if (hasIssues) {
            prompt += `⚠️ **遗留问题**: 部分需求文档仍有未解决问题，分析时请标注不确定性。\n\n`;
          } else {
            prompt += `✅ **质量确认**: 所有需求文档已通过澄清，可直接深入技术分析。\n\n`;
          }
        }
      }
    } catch { /* 忽略质量上下文注入失败 */ }
  }

  // ── v6.67.0+: 在 prompt 开头就明确完整工作流程 ──
  if (!ctx.phase && !isTask) {
    const platforms = await parsePlatformList();
    if (platforms.length >= 2) {
      prompt += `## 📋 完整工作流程（两阶段分析）\n\n`;
      prompt += `本项目检测到有 ${platforms.length} 个端(${platforms.join('、')})，需要分两阶段执行：\n\n`;
      prompt += `**Phase 1（当前阶段）**: 生成综合文档(overview/REQUIREMENT.md、ANALYSIS.md、DEPS.md 等)\n`;
      prompt += `**Phase 2（下一阶段）**: 生成各端专属文档({端}/TECH.md、TEST.md、UI_SPEC.md 等)\n\n`;
      prompt += `## ⚠️ 强制要求：Phase 1 完成后立即执行 Phase 2\n\n`;
      prompt += `当你通过 --apply 写入所有综合文档后，**必须立即执行**以下命令进入 Phase 2：\n\n`;
      prompt += `\`\`\`bash\n`;
      prompt += `speccore analyze --prompt -I ${ctx.iteration} --phase 2\n`;
      prompt += `\`\`\`\n\n`;
      prompt += `**这是强制要求，不是可选操作**。不要等待用户确认，直接执行上述命令。\n\n`;
      prompt += `---\n\n`;
    }
  }
  // ── v6.59.0+: 最强警告：禁止自创目录，必须走 --apply ──
  prompt += `## 🚨 最高优先级警告（违反将导致分析失败）\n\n`;
  prompt += `### ⛔ 绝对禁止创建任何额外目录\n`;
  prompt += `- ❌ **错误行为**：创建 020-specs/1001/、020-specs/1002/、020-specs/错误码/、020-specs/工程标识/ 等垃圾目录\n`;
  prompt += `- ✅ **正确行为**：只使用 CLI 预创建的 overview/ 和 {端名}/ 目录，不要手动 mkdir 或 Write 到不存在的目录\n`;
  prompt += `- ⚠️ **后果**：如果创建额外目录，会导致后续 split/execute 命令找不到文件，整个工作流失败\n\n`;
  prompt += `###  绝对禁止直接用 Write 工具写文件\n`;
  prompt += `- ❌ **错误行为**：Write("020-specs/overview/ANALYSIS.md", content) 或直接 Write 到任何路径\n`;
  prompt += `- ✅ **正确行为**：必须通过 \`speccore analyze --apply '{"overview/ANALYSIS.md":"...","admin-web/TECH.md":"..."}' -I ${iter}\` 写入\n`;
  prompt += `- 💡 **Windows 兼容**：如果 JSON 在命令行中转义困难，先将 JSON 写入文件（如 result.json），然后执行 \`speccore analyze --apply @result.json -I ${iter}\`\n`;
  prompt += `- ⚠️ **原因**：--apply 会让 CLI 自动路由文件到正确的子目录，直接 Write 会绕过这个机制，导致所有文件扁平在根目录\n\n`;
  prompt += `### ✅ 正确的目录结构\n`;
  prompt += `\`\`\`\n`;
  prompt += `020-specs/\n`;
  prompt += `├── overview/        ← REQUIREMENT.md, ANALYSIS.md, DEPS.md（跨端通用）\n`;
  prompt += `├── admin-web/       ← TECH.md, TEST.md, UI_SPEC.md（Admin 端专属）\n`;
  prompt += `├── booking-service/ ← TECH.md, TEST.md（后端服务专属）\n`;
  prompt += `├── h5-mobile/       ← TECH.md, TEST.md, UI_SPEC.md（H5 端专属）\n`;
  prompt += `└── room-service/    ← TECH.md, TEST.md（后端服务专属）\n`;
  prompt += `\`\`\`\n`;
  prompt += `- 每个端目录下只有该端的专属文档，不要混放\n`;
  prompt += `- 不要创建上述之外的任何子目录\n\n`;
  prompt += `## ⚠️ 迭代名称仅为目录标识（重要）\n\n`;
  prompt += `- 迭代名称（"${iter}"）仅为目录标识符，**不代表需求内容**\n`;
  prompt += `- **需求文档是唯一事实来源**：所有分析必须 100% 基于 010-requirements/ 下的文档内容\n`;
  prompt += `- 如果迭代名称与文档内容不一致（如迭代名叫"功能A"但文档描述"功能B"），**严格以文档内容为准**，完全忽略迭代名称\n`;
  prompt += `- **严禁基于迭代名称臆造功能**：不要补充文档中未提及的功能、接口、页面、字段、业务规则\n`;
  prompt += `- 如果文档内容不完整，标注"文档未提及"，不要自行脑补\n`;
  prompt += `- 分析过程中，始终把迭代名称当作透明信息处理，不做任何功能推断\n\n`;
  prompt += `## 分析范围说明\n`;
  if (isTask) {
    prompt += `- 当前是**任务级分析**，类型为 \`${taskType}\`，只需产出 ${taskDocs.length} 个文档：${taskDocs.map(([n]) => n).join('、')}\n`;
    prompt += `- bugfix: 聚焦根因分析和修复验证；research: 聚焦技术调研；review: 聚焦代码审查\n`;
    prompt += `- feature/refactor: 全量分析（功能、接口、数据、规则）\n`;
    prompt += `- **双层解耦**：分析结果写入 Task/00-specs/，不覆盖 020-specs/（迭代基线）\n`;
    // ── 任务级深度分析指令（v6.44.0+）──
    prompt += `\n## 🧠 任务级深度分析\n\n`;
    prompt += `当前是对 **单个 Task** 的深度分析。split 已在 00-specs/ 中生成了基础内容（机械提取），你需要 Read 这些内容 + 全局上下文，重新生成**任务级深度分析**。\n\n`;
    prompt += `### Step 1: 读取已有任务文档（split 产出）\n`;
    prompt += `- Read ${ctx.task}/00-specs/REQ.md → 本任务的需求切片\n`;
    prompt += `- Read ${ctx.task}/00-specs/TECH.md → 本任务的技术方案框架\n`;
    prompt += `- Read ${ctx.task}/00-specs/TASK.md（如存在）→ 已有的实施计划\n`;
    prompt += `- Read ${ctx.task}/00-specs/SCHEMA.md（如存在）→ 已有的数据模型\n`;
    prompt += `- Read ${ctx.task}/_shared/API_CONTRACT.yaml（如存在）→ 共享 API 契约\n\n`;
    prompt += `### Step 2: 读取全局上下文（作为参考）\n`;
    prompt += `- Read .speccore/CONSTITUTION.md → 项目配置\n`;
    prompt += `- Read 020-specs/PLATFORMS.md → 端列表\n`;
    prompt += `- Read 020-specs/overview/REQUIREMENT.md → 迭代综合需求规格\n`;
    prompt += `- Read 020-specs/overview/TECH.md → 迭代综合技术架构\n`;
    prompt += `- Read 020-specs/overview/ANALYSIS.md → 迭代综合分析报告\n`;
    prompt += `- Read 020-specs/{本任务端名}/TECH.md → 该端专属技术方案\n\n`;
    prompt += `### Step 3: 撰写任务级深度分析文档\n\n`;
    prompt += `**REQ.md** — 本任务的需求规格（不是 overview/REQUIREMENT.md 的复制）：\n`;
    prompt += `- 明确本任务的验收标准（可测试的、具体的）\n`;
    prompt += `- 细化业务规则和边界条件\n`;
    prompt += `- 列出本任务涉及的异常场景\n\n`;
    prompt += `**TECH.md** — 本任务的实现方案（基于全局架构，细化到函数/接口级）：\n`;
    prompt += `- 具体的接口定义（路径/参数/响应）\n`;
    prompt += `- 数据模型设计（Entity/DTO/VO 字段映射）\n`;
    prompt += `- 核心业务逻辑的伪代码或流程描述\n`;
    prompt += `- 前端组件拆分和状态设计\n`;
    prompt += `- 必须与 overview/TECH.md 的整体架构保持一致\n\n`;
    prompt += `**TASK.md** — 本任务的实施步骤：\n`;
    prompt += `- 按开发顺序列出具体步骤\n`;
    prompt += `- 每个步骤有明确的完成标准\n`;
    prompt += `- 标注步骤间的依赖关系\n\n`;
    prompt += `**SCHEMA.md** — 本任务涉及的数据模型：\n`;
    prompt += `- 完整的字段定义（名称/类型/约束/说明）\n`;
    prompt += `- 索引设计\n`;
    prompt += `- DDL 语句（如适用）\n\n`;
    prompt += `### 写入方式\n`;
    prompt += `speccore analyze --apply '{"REQ.md":"...","TECH.md":"...","TASK.md":"...","SCHEMA.md":"..."}' -I ${iter} --task ${ctx.task || 'Task-NNN'}\n\n`;
  } else {
    prompt += `- 当前是**迭代级分析**，需产出全部 8 个文档，覆盖需求→技术→测试→评审→风险→依赖→监控→UI规格\n`;
    if (ctx.platform) {
      prompt += `- **只分析 ${ctx.platform} 端**：从 CONSTITUTION.md 读取端列表，但只生成 ${ctx.platform} 端的专属文档\n`;
      prompt += `- 在 020-specs/${ctx.platform}/ 下写入该端专属文档（ANALYSIS.md、TECH.md、TEST.md 等）\n`;
      prompt += `- 迭代综合文档写入 020-specs/overview/（REQUIREMENT.md、DEPS.md、RISK.md 等）\n`;
      prompt += `- **不要生成**其他端的子目录和文档\n`;
    }
    // ── v6.61.0+: 阶段专属指令（Phase 2）──
    if (ctx.phase === '2') {
      prompt += `## 要求\n\n`;
      prompt += `### Step 1: 读取全局上下文（Phase 1 产出）\n`;
      prompt += `依次 Read 以下文件，建立全局技术架构认知：\n`;
      prompt += `- Read .speccore/CONSTITUTION.md\n`;
      prompt += `- Read 020-specs/PLATFORMS.md → 获取端列表\n`;
      prompt += `- Read 020-specs/overview/REQUIREMENT.md → 需求规格\n`;
      prompt += `- Read 020-specs/overview/ANALYSIS.md → 分析报告\n`;
      prompt += `- Read 020-specs/overview/TECH.md → 整体技术架构\n`;
      prompt += `- Read 020-specs/overview/RISK.md、DEPS.md、REVIEW.md、MONITOR.md（如存在）\n\n`;
      prompt += `### Step 2: 为每个端撰写专属文档\n`;
      prompt += `根据全局上下文，为 PLATFORMS.md 中的**每个端**分别撰写：\n`;
      prompt += `- **{端}/TECH.md**：该端专属技术方案（必须对齐 overview/TECH.md 架构）\n`;
      prompt += `  - ⚠️ **必须包含「业务-代码映射」章节**：在 TECH.md 末尾添加表格，列出本端涉及的业务模块及其对应的代码实体（文件/表/API/组件等），关系类型由你根据技术栈自主决定（如 api_controller、uses_table、page、component、route、middleware、interceptor、gateway 等）\n`;
      prompt += `  - 表格格式：| 业务模块 | 代码实体 | 关系类型 | 说明 |\n`;
      prompt += `  - 示例：| 会议室档案 | backend/RoomController.java | api_controller | REST 控制器 |\n`;
      prompt += `  - 示例：| 会议室档案 | admin-web/src/pages/RoomList.vue | page | 列表页 |\n`;
      prompt += `- **{端}/TEST.md**：该端专属测试计划\n`;
      prompt += `- **{端}/UI_SPEC.md**：该端专属 UI 规格（仅前端端需要）\n\n`;
      prompt += `### Step 3: 一致性检查\n`;
      prompt += `- 各端 TECH.md 的技术选型必须与 overview/TECH.md 一致\n`;
      prompt += `- UI_SPEC.md 的字段映射必须与后端 API 响应字段一一对应\n`;
      prompt += `- TEST.md 必须覆盖 REQUIREMENT.md 中该端的验收标准\n\n`;
      prompt += `### 写入方式\n`;
      prompt += `**Pipeline 模式**：一次 --apply 写入所有端的文档（推荐）\n`;
      prompt += `speccore analyze --apply '{"TECH.md":"...","TEST.md":"...","UI_SPEC.md":"..."}' -I ${iter} --platform all\n\n`;
      prompt += `**或者逐端写入**（每端一次 --apply）：\n`;
      prompt += `speccore analyze --apply '{"TECH.md":"...","TEST.md":"...","UI_SPEC.md":"..."}' -I ${iter} --platform {端名}\n\n`;
    } else {
      // v6.61.0+: 一次性生成所有文档（global/ + {端}/）
      prompt += `## 要求\n1. Read .speccore/PATTERNS/TEMPLATES/specs/ 下的专业模板（如目录不存在或为空，用你的专业知识自由撰写，绝不允许产出一行垃圾）\n`;
    const templateMap: Record<string, string> = {
      'ANALYSIS.md': 'ANALYSIS-template.md', 'TECH.md': 'TECH-template.md', 'TEST.md': 'TEST-template.md',
      'REVIEW.md': 'REVIEW-template.md', 'RISK.md': 'RISK-template.md', 'DEPS.md': 'DEPS-template.md',
      'MONITOR.md': 'MONITOR-template.md', 'UI_SPEC.md': 'UI_SPEC-template.md'
    };
    for (const doc of taskDocs) {
      const tpl = templateMap[doc[0]] || '';
      prompt += `   - ${doc[0]} → 参考 ${tpl}\n`;
    }
    prompt += `2. 读取全局层产物（建立全局视角，重要）\n`;
    prompt += `   在读取迭代需求之前，先 Read 全局层已有产物，了解系统当前状态：\n`;
    prompt += `   a. Read .speccore/GLOBAL/requirements/REQUIREMENT.md → 系统已有功能清单\n`;
    prompt += `   b. Read .speccore/GLOBAL/overview/FUNCTION_MAP.md → 已有功能单元和涉及端\n`;
    prompt += `   c. Read .speccore/GLOBAL/overview/API_CONTRACT.yaml → 已有接口契约\n`;
    prompt += `   d. Read .speccore/GLOBAL/overview/ARCHITECTURE.md → 全局架构（如有）\n`;
    prompt += `   e. Read .speccore/GLOBAL/platforms/{相关端}/_INDEX.md → 各端已有页面和接口索引\n`;
    prompt += `   f. Read .speccore/GLOBAL/platforms/_shared/_ASSOCIATION.md → 前后端关联矩阵（如有）\n`;
    prompt += `   g. Read .speccore/GLOBAL/platforms/_shared/_MODULES.md → 功能模块候选（如有）\n`;
    prompt += `   ⚠️ 如果全局层产物不存在，跳过该项，继续后续分析\n\n`;
    prompt += `3. 读取迭代需求文档（按优先级顺序）：\n`;
    prompt += `   a. 先读 010-requirements/INDEX.md — 了解需求全貌和文件清单\n`;
    prompt += `   b. 再读 010-requirements/converted/*.md — doc2spec 转换后的核心规格（主要依据）\n`;
    prompt += `   c. 再读 010-requirements/features/*/README.md — 功能级补充需求\n`;
    prompt += `   d. 读取 010-requirements/prototypes/ — 原型文件（HTML/图片/链接均读取）\n`;
    prompt += `      ⚠️ 需求文档中链接到原型的（如 \`![原型](../prototypes/xxx.png)\` 或 \`详见 prototypes/xxx.html\`），必须主动 Read 该原型文件\n`;
    prompt += `   e. 如用户指定了特定文档，优先读取指定文件；如要求全部，再读 sources/ 原始文档\n`;
    prompt += `   f. **文档长度自适应**：如果单个需求文档超过 5000 字，先快速扫描目录和章节标题，标记关键章节，再深入阅读。不要在非关键章节上花费过多 tokens\n`;
    prompt += `4. 读懂需求文档后，按专业模板标准自由撰写每个文档（不是填空表）\n`;
    prompt += `5. **文档忠实度约束（最高优先级）**：\n`;
    prompt += `   - **严禁臆造**：只能写需求文档中明确提及的功能、接口、页面、字段、业务规则\n`;
    prompt += `   - **严禁扩展**：不要基于迭代名称或你的知识补充文档中未提及的内容\n`;
    prompt += `   - **严禁推断**：不要从一句话推断出整个功能模块，只写文档中明确描述的内容\n`;
    prompt += `   - **边界处理**：如果文档对某功能描述不完整，标注"文档未充分描述"，不要自行脑补完整方案\n`;
    prompt += `   - **交叉验证**：每写一个功能点，回头检查需求文档中是否有对应描述，没有则删除\n`;
    prompt += `6. 每个文档都要具体内容（禁止"待填充"）\n`;
    prompt += `7. **端发现（重要）**：先确定项目有哪些端，再按端组织文档\n`;
    prompt += `   - 第 1 步：Read .speccore/CONSTITUTION.md\n`;
    prompt += `   - 第 2 步：从「## 端列表」章节提取端名（这是全局权威来源）\n`;
    prompt += `   - 第 3 步：如果没有「端列表」章节，从「对应端」列提取\n`;
    prompt += `   - 第 4 步：如果以上都无法确定，根据需求文档内容判断\n`;
    prompt += `   - 第 5 步：将发现的端列表写入 020-specs/PLATFORMS.md\n`;
    // v6.70.0+: REQUIREMENT.md 以产品视角撰写（不按端分章节）
    // v6.99.0+: 丰富需求文档章节要求
    prompt += `8. **REQUIREMENT.md 写作风格（重要）**：全局需求文档必须以产品/用户视角撰写\n`;
    prompt += `   - **按业务场景/用户旅程组织章节**，不按端分章节（如"H5端需求"、"后端需求"）\n`;
    prompt += `   - 文档结构必须包含（如需求文档中有相关信息）：\n`;
    prompt += `     - **产品愿景**：本迭代要解决的核心问题和目标价值（1-2段）\n`;
    prompt += `     - **目标用户画像**：主要用户角色、使用场景、痛点（如有）\n`;
    prompt += `     - **核心场景地图**：按业务流程组织的场景列表，每个场景标注优先级\n`;
    prompt += `     - **功能全景图**：所有功能模块的可视化列表（表格或脑图描述）\n`;
    prompt += `     - **功能优先级矩阵**：P0（必须）/ P1（重要）/ P2（可选）标注\n`;
    prompt += `     - **发布里程碑**：如有分期计划，标注各阶段交付内容\n`;
    prompt += `     - **风险预判**：技术风险、业务风险、依赖风险（如有）\n`;
    prompt += `   - 每个场景描述：用户操作 → 系统响应 → 业务规则 → 边界条件 → 验收标准\n`;
    prompt += `   - 系统响应中自然包含前后端交互，但不刻意标注技术实现细节\n`;
    prompt += `   - 示例正确写法：「用户选择时间段后点击预订，系统检查会议室可用性，如可用则锁定会议室并创建待支付订单」\n`;
    prompt += `   - 示例错误写法：「后端 booking-service 需要新增 /api/bookings 接口，接收 roomId 参数」\n`;
    prompt += `   - 技术实现细节留在 TECH.md 和各端专属文档中，不在 REQUIREMENT.md 展开\n`;
    prompt += `   - 端的信息只在「功能模块清单」表格中标注，正文不区分端\n`;
    // v6.49.14+: 功能模块清单必须含涉及端列 + 来源链接
    // v6.71.3+: 增加「与全局层对比」列
    prompt += `9. **功能模块清单（重要）**：写入 overview/REQUIREMENT.md 时，功能模块清单表格必须包含以下列\n`;
    prompt += `   - 表格格式：| # | 功能模块 | 涉及端 | 全局对比 | 来源 | 说明 |\n`;
    prompt += `   - 「涉及端」：每个模块标注需要**新开发工作**的端（标准端名，逗号分隔）\n`;
    prompt += `     - 「涉及」= 该端需要写新接口/新页面/新逻辑\n`;
    prompt += `     - 「不涉及」= 只是提到、调用已有接口、纯展示 → 不标注\n`;
    prompt += `     - 端名必须与 CONSTITUTION.md「端列表」中的标准端名完全匹配\n`;
    prompt += `   - 「全局对比」：该功能模块与全局层已有功能的关系（必须标注）\n`;
    prompt += `     - 「新增」：全局层不存在，本迭代全新开发\n`;
    prompt += `     - 「扩展」：全局层已有基础功能，本迭代增加新字段/新接口/新页面\n`;
    prompt += `     - 「重构」：全局层已有，本迭代修改实现方式（不新增功能）\n`;
    prompt += `     - 「复用」：全局层已有，本迭代直接使用（无需开发）\n`;
    prompt += `     - 示例：「扩展：增加会议室设备管理」或「新增」\n`;
    prompt += `   - 「来源」：该功能模块在需求文档中的具体位置，用 Markdown 链接格式\n`;
    prompt += `     - 格式：[文档名](相对路径#章节锚点)，如 [PRD v2.0](../010-requirements/sources/PRD-v2.0.md#3-2-会议室管理)\n`;
    prompt += `     - 如果模块来自 converted 文档：[xxx需求](../010-requirements/converted/xxx.md#相关章节)\n`;
    prompt += `     - 如果来自 features 目录：[xxx功能](../010-requirements/features/xxx/README.md)\n`;
    prompt += `     - 目的是让阅读者能直接点击跳转到原始需求位置\n`;
    prompt += `   - 示例：| M-01 | 会议室档案管理 | room-service, admin-web | 扩展：增加设备管理 | [PRD v2.0](../010-requirements/sources/PRD-v2.0.md#2-1) | 会议室 CRUD、设备管理 |\n`;
    prompt += `   - split 命令将读取「涉及端」列来决定创建哪些端的子任务目录\n`;
    // v6.70.0+: 跨端功能映射表（FUNCTION_MAP.md）
    // v6.71.3+: 增加与全局层关联分析
    prompt += `7a. **迭代需求与全局层关联分析（重要）**：在生成功能模块清单时，必须对比全局层产物\n`;
    prompt += `   - 对比迭代需求中的功能模块 vs .speccore/GLOBAL/overview/FUNCTION_MAP.md 中的功能单元\n`;
    prompt += `   - 标注每个功能模块的「全局对比」类型（新增/扩展/重构/复用）\n`;
    prompt += `   - 识别冲突：如迭代需求修改了全局层已有接口的字段/路径 → 在 RISK.md 中标注\n`;
    prompt += `   - 识别依赖：如迭代的新功能依赖全局层的某个功能 → 在 FUNCTION_MAP.md「依赖任务」中标注\n\n`;
    prompt += `7b. **跨端功能映射表（重要）**：在 REQUIREMENT.md 完成后，必须生成 overview/FUNCTION_MAP.md\n`;
    prompt += `   - 这是 split 阶段的核心输入，决定任务如何按功能单元拆分\n`;
    prompt += `   - 表格格式：| # | 功能单元 | 涉及端 | 全局对比 | 共享能力 | 依赖任务 | 说明 |\n`;
    prompt += `   - 「功能单元」必须与 REQUIREMENT.md 功能模块清单一一对应，不允许合并\n`;
    prompt += `   - 「涉及端」标注所有需要新开发工作的端（标准端名，逗号分隔）\n`;
    prompt += `   - 「全局对比」标注与全局层的关系（新增/扩展/重构/复用）\n`;
    prompt += `   - 「共享能力」标注跨任务共享的通用组件（如"审批引擎"、"消息通知"），无则填"无"\n`;
    prompt += `   - 「依赖任务」标注当前迭代内该功能单元依赖的其他功能单元编号\n`;
    prompt += `   - 「说明」描述跨端交互关系（如"admin-web 调用 booking-service 的 /api/rooms 接口"）\n`;
    prompt += `   - **示例**：| M-01 | 会议室档案管理 | room-service, admin-web | 扩展 | 无 | 无 | admin-web 调用 room-service CRUD 接口 |\n`;
    prompt += `   - **错误示例**（禁止）：将"审批流程"和"定时任务"合并为一行\n`;
    prompt += `   - FUNCTION_MAP.md 生成后，split 将**严格按此表**创建任务目录，不再由 AI 推断\n`;
    // v6.70.0+: 跨端交互图谱（INTERACTION_MAP.md）
    prompt += `7c. **跨端交互图谱（重要）**：在 FUNCTION_MAP.md 完成后，必须生成 overview/INTERACTION_MAP.md\n`;
    prompt += `   - 按功能单元组织，每个功能单元一个 Mermaid sequenceDiagram\n`;
    prompt += `   - 展示完整的业务交互时序：用户操作 → 前端处理 → 后端调用 → 数据返回\n`;
    prompt += `   - 明确标出后端服务之间的内部调用（产品文档写"系统处理"的地方）\n`;
    prompt += `   - 箭头标注接口路径，标注 [contract] 表示接口在 API_CONTRACT.yaml 中有定义\n`;
    prompt += `   - 序列图后附「接口契约索引」表格：步骤号、接口、消费者端、提供者端\n`;
    prompt += `   - 如涉及状态变更，附「状态流转」表格\n`;
    prompt += `   - INTERACTION_MAP.md 是前后端开发者的共同参考，补全产品文档中隐含的技术交互\n`;
    // 注入工程类型信息（v6.49.0+）
    const platformTypes = await parsePlatformTypes();
    if (platformTypes.size > 0) {
      prompt += `8. **工程类型识别**：CONSTITUTION.md 已配置各端的工程类型，请据此生成针对性内容\n`;
      prompt += `   | 工程标识 | 工程类型 |\n`;
      prompt += `   | :--- | :--- |\n`;
      for (const [name, type] of platformTypes) {
        prompt += `   | ${name} | ${type} |\n`;
      }
      prompt += `\n   **根据工程类型应用对应的专业维度**：\n`;
      prompt += `   - Java服务 → API设计、数据库、缓存、消息队列、安全、性能\n`;
      prompt += `   - Node服务 → API设计、数据库、中间件、异步处理、安全\n`;
      prompt += `   - Go服务 → API设计、数据库、并发、微服务、性能\n`;
      prompt += `   - Python服务 → API设计、数据库、数据分析、AI/ML集成\n`;
      prompt += `   - H5微信公众号 → 微信JS-SDK、OAuth授权、分享、支付、模板消息\n`;
      prompt += `   - H5移动端 → 响应式、viewport适配、触摸交互、弱网优化、首屏性能\n`;
      prompt += `   - Android移动端 → 生命周期、权限、推送、适配、内存优化\n`;
      prompt += `   - iOS移动端 → Swift/SwiftUI、App Store规范、推送、性能\n`;
      prompt += `   - 微信小程序 → 包体积(2MB)、平台API、setData优化、页面栈\n`;
      prompt += `   - Web管理后台 → 复杂表单、数据表格、权限UI、状态管理\n`;
      prompt += `   - 桌面应用 → 本地存储、系统API、自动更新、离线支持\n`;
    }
    const dirStepNum = platformTypes.size > 0 ? 9 : 8;
    prompt += `${dirStepNum}. **目录结构（严格遵循，禁止自创目录）**：\n`;
    prompt += `   - **综合文档**（跨端通用）→ 通过 --apply 写入，CLI 自动路由到 \`020-specs/overview/{文件名}\`\n`;
    prompt += `     - REQUIREMENT.md（需求文档，含功能模块清单+涉及端列）\n`;
    prompt += `     - ANALYSIS.md（需求分析）\n`;
    prompt += `     - DEPS.md（依赖清单）\n`;
    prompt += `   - **端专属文档**（每端各一份）→ 通过 --apply 写入，CLI 自动路由到 \`020-specs/{端名}/{文件名}\`\n`;
    prompt += `     - TECH.md（技术方案：API/数据库/组件/路由等）\n`;
    prompt += `     - TEST.md（测试用例）\n`;
    prompt += `     - UI_SPEC.md（UI 规范，仅前端端）\n`;
    prompt += `     - RISK.md（风险评估）\n`;
    prompt += `     - REVIEW.md（评审检查项）\n`;
    prompt += `     - MONITOR.md（监控指标）\n`;
    prompt += `   - **禁止**：不要创建 020-specs/ 下的任何额外子目录（如数字编号、中文名称等）\n`;
    prompt += `   - **禁止直接用 Write 工具写文件到 020-specs/**：必须通过 \`speccore analyze --apply '{"文件名":"内容"}' -I ${iter}\` 写入\n`;
    prompt += `   - ⚠️ 直接 Write 会导致目录结构错误（所有文件扁平在根目录），必须走 --apply 让 CLI 自动路由到 overview/ 或 {端名}/ 子目录\n`;
    if (ctx.phase !== '1') {
      // 端专业性约束只在默认模式（全量）中输出
      prompt += `\n## ⚠️ 端专业性约束\n`;
      prompt += `CONSTITUTION.md 中配置了多个端，每个端的文档必须有该端专属内容。\n`;
      prompt += `**先识别端类型，再应用对应的专业维度**：\n\n`;
      // v6.71.0+: 前后端文档差异化
      prompt += `### 后端服务（*service）必含内容 — 技术视角\n`;
      prompt += `- API 接口定义（路径/方法/参数/响应字段/状态码/错误码）\n`;
      prompt += `- 数据库表结构（字段/类型/索引/约束）\n`;
      prompt += `- 业务规则（含边界条件和异常流）\n`;
      prompt += `- 缓存策略/并发与事务/消息队列（如涉及）\n`;
      prompt += `- 安全：SQL 注入防护/接口鉴权/数据脱敏\n`;
      prompt += `- 性能：QPS 预估/慢查询优化/连接池配置\n`;
      prompt += `- **不需要**产品视角的需求描述（用户故事、业务场景已在 overview/REQUIREMENT.md 中）\n\n`;
      prompt += `### 前端端（h5 / admin-web / miniapp）必含内容 — 产品+技术双视角\n`;
      prompt += `- **产品视角（主要）**：\n`;
      prompt += `  - 用户旅程：该端用户如何完成核心任务（步骤流程图）\n`;
      prompt += `  - 页面清单：所有页面名称、路径、核心功能、入口位置\n`;
      prompt += `  - 交互设计：关键操作流程、状态变化、异常提示方式\n`;
      prompt += `  - 字段展示：每个页面展示哪些字段、字段来源（后端哪个接口）\n`;
      prompt += `  - 权限控制：哪些页面/按钮需要权限、权限粒度\n`;
      prompt += `- **技术视角（辅助）**：\n`;
      prompt += `  - 页面路由表 + 组件清单\n`;
      prompt += `  - API 调用清单：前端调用了哪些后端接口（路径+方法+用途）\n`;
      prompt += `  - 状态管理：全局状态设计、与后端数据同步策略\n`;
      prompt += `  - 适配/性能/安全等前端专项（按端类型选择）\n\n`;
    }
  }
  // v6.60.0+: 文档与端的对应关系（不再分 Phase）
  // v6.71.0+: 前后端文档差异化
  prompt += `### 文档与端的对应关系\n`;
  prompt += `- **overview/REQUIREMENT.md**：整体需求（产品视角，按业务场景组织）\n`;
  prompt += `- **overview/ANALYSIS.md**：整体需求分析\n`;
  prompt += `- **overview/DEPS.md**：整体依赖清单\n`;
  prompt += `- **overview/FUNCTION_MAP.md**：功能单元 × 端映射表\n`;
  prompt += `- **overview/INTERACTION_MAP.md**：跨端交互时序图\n`;
  prompt += `- **后端端（*service）/{端}/TECH.md**：纯技术视角 — 接口设计+数据模型+架构+性能\n`;
  prompt += `- **前端端（h5/admin/miniapp）/{端}/TECH.md**：产品+技术双视角 — 用户旅程+页面清单+交互流程+API调用链\n`;
  prompt += `- **前端端/{端}/UI_SPEC.md**：UI 规格（字段映射、组件设计、交互细节）\n`;
    prompt += `  - ⚠️ **必须包含「业务-代码映射」章节**：在 TECH.md 末尾添加一个表格，列出本端涉及的业务模块及其对应的代码实体（文件/表/API/组件等），关系类型由你根据技术栈自主决定（如 api_controller、uses_table、page、component、route、middleware、interceptor、gateway 等）\n`;
    prompt += `  - 表格格式：| 业务模块 | 代码实体 | 关系类型 | 说明 |\n`;
    prompt += `  - 示例：| 会议室档案 | backend/RoomController.java | api_controller | REST 控制器 |\n`;
    prompt += `  - 示例：| 会议室档案 | admin-web/src/pages/RoomList.vue | page | 列表页 |\n`;
    prompt += `- **{端}/TEST.md**：该端专属测试计划\n`;
    prompt += `- **{端}/RISK.md**：该端专属风险评估\n`;
    prompt += `- **{端}/REVIEW.md**：该端专属评审检查项\n`;
    prompt += `- **{端}/MONITOR.md**：该端专属监控指标\n`;
    prompt += `- **{端}/UI_SPEC.md**：前端端专属 UI 规格，字段映射必须与后端 API 响应字段一一对应\n`;
    prompt += `- 分析完成后会自动生成 QUALITY_AUDIT.md 质量报告，检查各端内容是否完整\n`;
    }
  // 步骤 2-7 已在上面的 phase 分支中处理
  const taskFlag = isTask && ctx.task ? ` --task ${ctx.task}` : '';
  const platformFlag = ctx.platform ? ` --platform ${ctx.platform}` : '';

  // ── 链式生成指令（v6.45.0+）──
  if (hasUserTemplates || isTask) {
    prompt += `\n## 🔗 链式生成（重要）\n\n`;
    prompt += `请按以下顺序**逐个生成**文档，每个文档生成后立即 --apply 写入，然后 Read 自己的产出再生成下一个：\n\n`;
    // 定义生成顺序
    const chainOrder = isTask
      ? ['REQ.md', 'TECH.md', 'SCHEMA.md', 'TASK.md']
      : ['REQUIREMENT.md', 'FUNCTION_MAP.md', 'INTERACTION_MAP.md', 'API_CONTRACT.yaml', 'ANALYSIS.md', 'TECH.md', 'TEST.md', 'REVIEW.md', 'RISK.md', 'DEPS.md', 'MONITOR.md', 'UI_SPEC.md'];
    const orderedDocs = taskDocs.filter(([n]) => chainOrder.includes(n));
    const customDocs = taskDocs.filter(([n]) => !chainOrder.includes(n));
    const ordered = [...orderedDocs.sort((a, b) => chainOrder.indexOf(a[0]) - chainOrder.indexOf(b[0])), ...customDocs];
    for (let i = 0; i < ordered.length; i++) {
      const prevDocs = ordered.slice(0, i).map(([n]) => n);
      prompt += `${i + 1}. **${ordered[i][0]}**`;
      if (prevDocs.length > 0) {
        prompt += ` ← 先 Read ${prevDocs.slice(-2).join(' + ')}`;
      }
      prompt += `\n`;
    }
    prompt += `\n每个文档用单独的 --apply 调用写入：\n`;
    for (const doc of ordered) {
      prompt += `speccore analyze --apply '{"${doc[0]}":"..."}' -I ${iter}${taskFlag}${platformFlag}\n`;
    }
    prompt += `\n`;
  } else if (ctx.phase !== '2') {
    // 传统模式：一次性写入
    prompt += `7. 写入: speccore analyze --apply '{${taskDocs.map(([n]) => `"${n}":"..."`).join(',')}}' -I ${iter}${taskFlag}${platformFlag}\n\n`;
  }
  // v6.60.0+: 移除两阶段分析提示，一次性生成所有文档
  prompt += '\n' + buildAutoModeInstruction('analyze', iter) + '\n';

  // ── v6.65.0+: Phase 1 完成后主动询问用户是否继续 Phase 2 ──
  // v6.70.0+: 自动模式下跳过确认，AI 直接推断执行
  if (!ctx.phase && !isTask && !autoMode) {
    prompt += `\n## ⚠️ 重要：Phase 1 完成后的下一步\n\n`;
    prompt += `当你通过 --apply 写入所有综合文档后，CLI 会检测到项目有多个端（≥2 个端）。\n`;
    prompt += `**此时你需要主动询问用户**：\n\n`;
    prompt += `"✅ Phase 1 已完成，生成了 overview/ 的综合文档。\n`;
    prompt += `检测到项目有 ${'{'}端列表{'}'} 个端，需要继续执行 Phase 2 生成各端专属文档吗？\n`;
    prompt += `请确认：输入 '继续' 或 'yes' 以执行 Phase 2"\n\n`;
    prompt += `**如果用户确认继续**，你需要执行：\n`;
    prompt += `\`speccore analyze --prompt -I ${iter} --phase 2\`\n\n`;
    prompt += `**不要等待 CLI 的提示信息**，CLI 的输出你可能看不到。你需要主动询问用户。\n\n`;
  }
  if (autoMode && !ctx.phase && !isTask) {
    prompt += `\n## 🤖 自动模式说明\n\n`;
    prompt += `当前处于自动模式（--auto），不需要人工确认。\n`;
    prompt += `请在生成综合文档后，**直接继续**生成各端专属文档（Phase 2）。\n`;
    prompt += `执行命令：\`speccore analyze --prompt -I ${iter} --phase 2\`\n\n`;
  }

  // ── v6.52.0+: 图谱 RAG 上下文注入（analyze 阶段也检索项目关联内容）──
  if (!isTask && ctx.phase !== '2') {
    try {
      const ragResult = await unifiedSearch(process.cwd(), {
        query: ctx.iteration || '',
        iteration: ctx.iteration,
        platform: ctx.platform,
      });
      if (ragResult.documentChunks.length > 0 || ragResult.codeSlices.length > 0 || ragResult.graphContext) {
        prompt += `\n##  项目关联上下文（图谱 RAG 智能检索）\n\n`;
        prompt += `以下是从项目知识图谱、代码索引和文档 RAG 中检索到的关联内容，请在分析时参考：\n\n`;
        prompt += formatUnifiedContext(ragResult);
        prompt += `\n> ⚠️ 以上是检索到的关联上下文，不是需求文档本身。请结合需求文档和这些上下文综合分析。\n\n`;
        logger?.info?.(`   🔍 analyze RAG: ${ragResult.stats.docChunksFound} 文档块 + ${ragResult.stats.codeSlicesFound} 代码切片`);
      }
    } catch (e) {
      logger?.debug?.('analyze RAG 检索失败（非关键）:', e);
    }
  }

  // 文档模板展示（有用户模板时只展示用户模板，无用户模板时展示内置模板）
  if (hasUserTemplates) {
    prompt += `## 📄 参考模板（用户自定义）\n\n`;
    prompt += `以下文档使用了用户自定义模板，请参考其结构和风格来生成内容：\n\n`;
    for (let i = 0; i < taskDocs.length; i++) {
      if (taskDocs[i][1]) {
        prompt += `### ${i + 1}/${taskDocs.length}: ${taskDocs[i][0]}\n\`\`\`markdown\n${taskDocs[i][1]}\n\`\`\`\n\n`;
      }
    }
  } else {
    for (let i = 0; i < taskDocs.length; i++) {
      prompt += `### ${i + 1}/${taskDocs.length}: ${taskDocs[i][0]}\n\`\`\`markdown\n${taskDocs[i][1]}\n\`\`\`\n\n`;
    }
  }

  // ── v6.69.2+: 强制自检清单（生成所有文档后必须执行）──
  prompt += `\n## 🔍 强制自检清单（生成完成后必须执行）\n\n`;
  prompt += `在调用 --apply 写入任何文档**之前**，必须逐条完成以下自检。自检未通过时，**必须修正文档后再写入**。\n\n`;
  prompt += `### 1. 功能覆盖完整性\n`;
  prompt += `- [ ] 对比原始需求文档的功能清单，确认每个功能模块都有对应的分析内容\n`;
  prompt += `- [ ] 确认没有遗漏任何页面、接口、组件或业务规则\n`;
  prompt += `- [ ] 如果发现有遗漏，先补充完整再写入\n\n`;
  prompt += `### 2. 枚举值一致性（跨文档必检）\n`;
  prompt += `- [ ] 检查所有文档中状态/类型枚举的定义是否完全一致\n`;
  prompt += `- [ ] 示例：如果在 REQUIREMENT.md 中定义 status: 0=可用, 1=维修中，则 TECH.md、UI_SPEC.md 中必须完全使用相同的值和含义\n`;
  prompt += `- [ ] **禁止**在不同文档中对同一枚举使用不同数值或含义\n\n`;
  prompt += `### 3. 接口路径统一性\n`;
  prompt += `- [ ] 检查全局 REQUIREMENT.md 中的接口路径与各端 TECH.md 中的接口路径是否完全一致\n`;
  prompt += `- [ ] 示例：如果全局文档使用 /checkin，则各端文档不能写成 /check-in 或 /check_in\n`;
  prompt += `- [ ] 路径、方法、参数名必须跨文档一致\n\n`;
  prompt += `### 4. 跨文档引用一致性\n`;
  prompt += `- [ ] 检查 UI_SPEC.md 中的字段映射是否与后端 API 响应字段一一对应\n`;
  prompt += `- [ ] 检查 TEST.md 中的测试场景是否覆盖了 REQUIREMENT.md 中的所有验收标准\n`;
  prompt += `- [ ] 检查各端 TECH.md 的技术选型是否与 overview/TECH.md 的整体架构一致\n\n`;
  prompt += `### 5. 目录结构合法性\n`;
  prompt += `- [ ] 确认 --apply 的 JSON 键名只包含合法文件名或「合法端名/文件名」格式\n`;
  prompt += `- [ ] **禁止**包含数字编号目录（如 1001/、1002/）、中文目录（如 错误码/）、特殊符号目录（如 .../）\n`;
  prompt += `- [ ] 合法格式示例：\`overview/ANALYSIS.md\`、\`admin-web/TECH.md\`、\`REQUIREMENT.md\`\n\n`;
  prompt += `### 自检通过标准\n`;
  prompt += `以上 5 项全部勾选通过后，方可执行 --apply 写入。如果任何一项未通过，先修正问题，重新自检，直到全部通过。\n`;

  return await injectGraphSummary(prompt);
}

// ── v6.74.0+: 流式全局分析 Prompt 生成 ──
async function buildStreamingGlobalPrompt(
  command: string,
  ctx: { iteration?: string; withCode?: boolean },
  options?: AnalyzeOptions
): Promise<string> {
  const iter = ctx.iteration || '当前迭代';
  const platforms = await parsePlatformList();
  const platformTypes = await parsePlatformTypes();

  // 确定当前 Phase
  let currentPhase: AnalyzePhase = 'phase0-scan';
  if (options?.streamingPhase) {
    currentPhase = options.streamingPhase as AnalyzePhase;
  }

  const phaseCtx: PhaseContext = {
    iteration: iter,
    phase: currentPhase,
    platforms,
    platformTypes,
    completedPhases: [],
  };

  let prompt = `\n# 任务: ${command} (流式全局分析 — ${getPhaseDisplayName(currentPhase)})\n\n`;

  // 流式分析总览
  prompt += `## 📋 流式分析架构说明\n\n`;
  prompt += `本次分析采用 **七阶段流式处理**，每个阶段产出写入文件，作为后续阶段的输入。\n\n`;
  prompt += `| Phase | 名称 | 目标 | 产出 |\n`;
  prompt += `| :--- | :--- | :--- | :--- |\n`;
  prompt += `| Phase 0 | 快速全局扫描 | 所有端并行索引 | platforms/{端}/_INDEX.md |\n`;
  prompt += `| Phase 1 | 后端深度分析 | 拓扑排序，从依赖源头开始 | platforms/{后端端}/API_INVENTORY.md, DATA_MODEL.md, ... |\n`;
  prompt += `| Phase 2 | 迭代综合实时更新 | 后端完成后更新迭代综合文档 | overview/API_CONTRACT.yaml, ARCHITECTURE.md, ... |\n`;
  prompt += `| Phase 3 | 前端深度分析 | 对齐后端契约 | platforms/{前端端}/FEATURES.md, UI_SPEC.md, ... |\n`;
  prompt += `| Phase 4 | 横向关联检查 | 前后端字段/接口一致性 | overview/CROSS_CHECK.md |\n`;
  prompt += `| Phase 5 | 纵向关联检查 | 功能模块跨端完整性 | overview/VERTICAL_CHECK.md |\n`;
  prompt += `| Phase 6 | 最终核对检查 | 完整性+一致性+遗漏检测 | overview/FINAL_AUDIT.md |\n\n`;

  prompt += `## ⚠️ 实时关联调整机制\n\n`;
  prompt += `分析过程中，如果当前阶段发现与前期文档冲突或不一致：\n`;
  prompt += `1. **在当前阶段文档中标注冲突点**\n`;
  prompt += `2. **输出需要回退修正的前期文档列表**\n`;
  prompt += `3. **执行修正**：用 \`speccore analyze --apply\` 更新需要修正的文档\n`;
  prompt += `4. **修正后重新执行当前阶段**，确保一致性\n\n`;

  prompt += `## 🎯 当前阶段: ${getPhaseDisplayName(currentPhase)}\n\n`;

  // 生成当前 Phase 的详细 Prompt
  const phasePrompt = await buildPhasePrompt(phaseCtx);
  prompt += phasePrompt;

  // 后续阶段提示
  const allPhases = getPhaseSequence();
  const currentIndex = allPhases.indexOf(currentPhase);
  const nextPhases = allPhases.slice(currentIndex + 1);

  if (nextPhases.length > 0) {
    prompt += `\n## ⏭️ 后续阶段\n\n`;
    prompt += `完成当前阶段后，继续执行以下阶段（按顺序）：\n\n`;
    for (const np of nextPhases) {
      prompt += `- ${getPhaseDisplayName(np)}\n`;
    }
    prompt += `\n每个阶段使用命令：\n`;
    prompt += `\`\`\`bash\n`;
    for (const np of nextPhases) {
      prompt += `speccore analyze --prompt -I ${iter} --global --with-code --streaming-phase ${np}\n`;
    }
    prompt += `\`\`\`\n`;
  }

  // 端类型针对性总结
  prompt += `\n## 🏗️ 端类型针对性要求\n\n`;
  prompt += `本项目共有 ${platforms.length} 个端，各端类型如下：\n\n`;
  prompt += `| 端名 | 类型 | 分析侧重点 |\n`;
  prompt += `| :--- | :--- | :--- |\n`;
  for (const p of platforms) {
    const t = platformTypes.get(p) || 'unknown';
    const isBackend = t.includes('service') || t.includes('Java') || t.includes('Node') || t.includes('Go') || t.includes('Python') || t.includes('后端');
    if (isBackend) {
      prompt += `| ${p} | ${t} | API设计+数据模型+业务规则+性能+安全 |\n`;
    } else if (t.includes('微信') || t.includes('公众号')) {
      prompt += `| ${p} | ${t} | 微信JS-SDK+OAuth+分享+支付+模板消息 |\n`;
    } else if (t.includes('小程序')) {
      prompt += `| ${p} | ${t} | 包体积+平台API+setData优化+页面栈 |\n`;
    } else if (t.includes('H5')) {
      prompt += `| ${p} | ${t} | 响应式+触摸交互+弱网优化+首屏性能 |\n`;
    } else if (t.includes('Web') || t.includes('管理')) {
      prompt += `| ${p} | ${t} | 复杂表单+数据表格+权限UI+状态管理 |\n`;
    } else if (t.includes('Android')) {
      prompt += `| ${p} | ${t} | 生命周期+权限+推送+适配+内存优化 |\n`;
    } else if (t.includes('iOS')) {
      prompt += `| ${p} | ${t} | Swift/SwiftUI+App Store规范+推送+性能 |\n`;
    } else if (t.includes('桌面')) {
      prompt += `| ${p} | ${t} | 本地存储+系统API+自动更新+离线支持 |\n`;
    } else {
      prompt += `| ${p} | ${t} | 前端框架+状态管理+路由+组件库 |\n`;
    }
  }
  prompt += `\n`;

  // 全局分析指令
  prompt += `## 📝 通用指令\n\n`;
  prompt += `1. **先读宪法**: Read .speccore/CONSTITUTION.md，获取端列表和源码路径\n`;
  prompt += `2. **严格按阶段执行**: 不要跳过阶段，每个阶段的产出是后续阶段的输入\n`;
  prompt += `3. **实时更新综合文档**: 后端分析完成后必须更新综合文档，前端分析完成后必须更新前端文档\n`;
  prompt += `4. **冲突时回退修正**: 发现不一致时，优先修正源头文档，再推进当前阶段\n`;
  prompt += `5. **写入方式**: 所有文档通过 \`speccore analyze --apply '{"文件路径":"内容"}' -I ${iter} --global\` 写入\n`;
  prompt += `6. **知识图谱**: 每阶段完成后自动刷新知识图谱\n`;

  return await injectGraphSummary(prompt);
}

// ── v6.69.0+: 契约先行 Prompt 生成（增强策略一）──
async function buildContractFirstPrompt(iteration: string): Promise<string> {
  const iterDir = await getIterationDir(iteration);
  const globalDir = join(iterDir, '020-specs', GLOBAL_SPECS_DIR);

  let prompt = `\n# 任务: 跨端 API 契约定义（契约先行阶段）\n\n`;
  prompt += `## 背景\n\n`;
  prompt += `Phase 1 迭代分析已完成。现在需要在各端开始专属技术方案分析之前，**先定义跨端 API 契约**。\n\n`;
  prompt += `## 读取内容\n\n`;
  prompt += `1. Read .speccore/CONSTITUTION.md → 获取端列表和项目配置\n`;
  prompt += `2. Read 020-specs/overview/REQUIREMENT.md → 迭代综合需求规格\n`;
  prompt += `3. Read 020-specs/overview/ANALYSIS.md → 迭代综合分析报告\n`;
  prompt += `4. Read 020-specs/overview/TECH.md → 迭代综合技术架构\n`;
  prompt += `5. Read 020-specs/overview/DEPS.md → 依赖关系（如存在）\n\n`;

  prompt += `## 输出要求\n\n`;
  prompt += `基于上述文档，生成一份 **API_CONTRACT.yaml**，使用标准 YAML 格式：\n\n`;
  prompt += `### 格式要求\n`;
  prompt += `- 使用 YAML 格式（不是 Markdown）\n`;
  prompt += `- 文件内容必须是合法 YAML，可被解析器直接读取\n`;
  prompt += `- 不要包含 Markdown 标题、代码块标记或解释性文字\n\n`;
  prompt += `### 内容结构\n`;
  prompt += `\`\`\`yaml\n`;
  prompt += `openapi: "3.0.0"\n`;
  prompt += `info:\n`;
  prompt += `  title: "跨端 API 契约"\n`;
  prompt += `  version: "1.0.0"\n`;
  prompt += `  description: "本迭代所有前后端交互接口的统一契约"\n\n`;
  prompt += `# 接口按模块分组\n`;
  prompt += `paths:\n`;
  prompt += `  /api/example:\n`;
  prompt += `    get:\n`;
  prompt += `      tags: [module-name]\n`;
  prompt += `      summary: "接口说明"\n`;
  prompt += `      consumers: [admin-web, h5-mobile]  # 消费者端列表\n`;
  prompt += `      provider: booking-service         # 提供者端\n`;
  prompt += `      parameters:\n`;
  prompt += `        - name: param1\n`;
  prompt += `          in: query\n`;
  prompt += `          type: string\n`;
  prompt += `      responses:\n`;
  prompt += `        "200":\n`;
  prompt += `          description: Success\n`;
  prompt += `          schema:\n`;
  prompt += `            type: object\n`;
  prompt += `            properties:\n`;
  prompt += `              field1: { type: string }\n`;
  prompt += `        "400": { description: Bad Request }\n\n`;
  prompt += `# 共享数据模型\n`;
  prompt += `components:\n`;
  prompt += `  schemas:\n`;
  prompt += `    ExampleDTO:\n`;
  prompt += `      type: object\n`;
  prompt += `      properties:\n`;
  prompt += `        field1: { type: string, description: "字段说明" }\n\n`;
  prompt += `# 枚举定义（前后端共享）\n`;
  prompt += `enums:\n`;
  prompt += `  StatusEnum:\n`;
  prompt += `    0: { label: "空闲", desc: "可用状态" }\n`;
  prompt += `    1: { label: "使用中", desc: "已被预约" }\n\n`;
  prompt += `# 事件/消息契约（如有）\n`;
  prompt += `events:\n`;
  prompt += `  - name: OrderCreated\n`;
  prompt += `    topic: order.events\n`;
  prompt += `    producer: booking-service\n`;
  prompt += `    consumers: [notification-service]\n`;
  prompt += `    payload: OrderDTO\n\n`;
  prompt += `# 模块依赖关系\n`;
  prompt += `dependencies:\n`;
  prompt += `  - module: 会议室档案\n`;
  prompt += `    dependsOn: []\n`;
  prompt += `  - module: 审批流程\n`;
  prompt += `    dependsOn: [会议室档案]\n`;
  prompt += `\`\`\`\n\n`;
  prompt += `## 写入方式\n\n`;
  prompt += `speccore analyze --apply '{"API_CONTRACT.yaml":"..."}' -I ${iteration}\n\n`;
  prompt += `⚠️ **注意**：\n`;
  prompt += `- 契约文件写入 020-specs/overview/API_CONTRACT.yaml（迭代综合共享）\n`;
  prompt += `- 这是各端技术方案分析的**前置输入**，后续各端分析必须遵循此契约\n`;
  prompt += `- 契约应**精确且完整**，避免后续各端分析时出现接口不一致\n\n`;

  return await injectGraphSummary(prompt);
}

// ── v6.49.9+: 扫描平铺的端目录，返回所有子任务目录路径 ──
async function getSubtaskDirs(taskDir: string): Promise<string[]> {
  const result: string[] = [];
  const platformList = await parsePlatformList();
  for (const platform of platformList) {
    const platDir = join(taskDir, platform);
    if (!(await pathExists(platDir))) continue;
    try {
      const entries = await readdir(platDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          result.push(join(platDir, entry.name));
        }
      }
    } catch { /* ignore */ }
  }
  // 回退: 旧结构 10-backend/ 和 20-frontend/
  if (result.length === 0) {
    for (const catDir of ['10-backend', '20-frontend']) {
      const catPath = join(taskDir, catDir);
      if (!(await pathExists(catPath))) continue;
      try {
        for (const svc of await readdir(catPath, { withFileTypes: true })) {
          if (!svc.isDirectory()) continue;
          for (const sub of await readdir(join(catPath, svc.name), { withFileTypes: true })) {
            if (sub.isDirectory() && !sub.name.startsWith('.')) {
              result.push(join(catPath, svc.name, sub.name));
            }
          }
        }
      } catch { /* ignore */ }
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════
// v6.80.0+: 需求澄清 Phase Prompt 构建
// ═══════════════════════════════════════════════════════════

async function buildClarifyPhasePrompt(iteration: string): Promise<string> {
  const iterDir = await getIterationDir(iteration);
  const reqDir = join(iterDir, '010-requirements');

  // 收集所有需求文档
  const docPaths: string[] = [];
  for (const sub of ['sources', 'converted', 'features']) {
    const subDir = join(reqDir, sub);
    if (await pathExists(subDir)) {
      try {
        const entries = await readdir(subDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('.')) {
            docPaths.push(join(subDir, e.name));
          } else if (e.isDirectory()) {
            const files = await readdir(join(subDir, e.name));
            for (const f of files) {
              if (f.endsWith('.md') && !f.startsWith('.')) docPaths.push(join(subDir, e.name, f));
            }
          }
        }
      } catch { /* ignore */ }
    }
  }

  // 读取并评估每个文档
  const qualityReports: RequirementQualityReport[] = [];
  for (const p of docPaths) {
    try {
      const content = await readFile(p, 'utf-8');
      const report = assessRequirementQuality(content, p);
      qualityReports.push(report);
    } catch { /* ignore */ }
  }

  // 生成质量报告文件
  if (qualityReports.length > 0) {
    await writeClarifyReport(iterDir, qualityReports);
  }

  // v6.84.0+: 从 AGENTS 规范数据库动态加载角色
  let prompt = `\n# 任务: 需求专业化（Phase 0: 需求澄清，v6.84.0+)\n\n`;

  const projectRoot = findProjectRoot() || process.cwd();
  const agentContext: AgentContext = {
    iteration,
    iterationDir: iterDir,
  };

  try {
    const resolvedAgents = await resolveAgentsForPhase('analyze', 'clarify', agentContext, projectRoot);
    if (resolvedAgents.length > 0) {
      // 动态注入角色定义
      for (const ra of resolvedAgents) {
        prompt += ra.definition.rolePrompt;
        prompt += '\n\n';
      }
    } else {
      // 回退到硬编码角色（向后兼容）
      prompt += PRODUCT_ANALYST_ROLE;
      prompt += '\n\n';
      prompt += INTERACTION_DESIGNER_ROLE;
      prompt += '\n\n';
    }
  } catch {
    // 回退到硬编码角色（向后兼容）
    prompt += PRODUCT_ANALYST_ROLE;
    prompt += '\n\n';
    prompt += INTERACTION_DESIGNER_ROLE;
    prompt += '\n\n';
  }

  prompt += `## 质量评价摘要（7维度）\n\n`;
  for (const r of qualityReports) {
    const name = r.filePath.split('/').pop() || '-';
    prompt += `### ${name} — 综合评分 ${r.overallScore}/100 (${r.level.toUpperCase()})\n\n`;
    prompt += `| 维度 | 评分 | 问题数 | 状态 |\n`;
    prompt += `| :--- | :--- | :--- | :--- |\n`;
    for (const dim of r.dimensions) {
      const badge = dim.score >= 80 ? '🟢' : dim.score >= 50 ? '🟡' : '🔴';
      prompt += `| ${badge} ${dim.name} | ${dim.score}/100 | ${dim.issues.length} | ${dim.issues.length === 0 ? '✅' : '⚠️ 需改进'} |\n`;
    }
    prompt += '\n';
    // 详细问题（只列出问题项）
    for (const dim of r.dimensions) {
      if (dim.issues.length > 0) {
        prompt += `**${dim.name}** 需改进：\n`;
        for (let i = 0; i < dim.issues.length; i++) {
          prompt += `- ${dim.issues[i]} → ${dim.suggestions[i] || '请优化'}\n`;
        }
        prompt += '\n';
      }
    }
  }

  prompt += `\n## 读取需求文档\n\n`;
  prompt += `依次读取以下文档（按优先级）：\n`;
  prompt += `1. \`010-requirements/INDEX.md\` — 需求全貌\n`;
  prompt += `2. \`010-requirements/sources/*.md\` — 原始需求（主要依据）\n`;
  prompt += `3. \`010-requirements/converted/*.md\` — 已转换文档\n`;
  prompt += `4. \`010-requirements/features/*/README.md\` — 功能级补充\n`;
  prompt += `5. \`010-requirements/prototypes/\` — 原型文件\n\n`;

  prompt += `---\n\n`;
  prompt += `# 📋 五步迭代澄清流程\n\n`;
  prompt += `> 本阶段要求你先以专业角色深度分析，再生成改写版，与用户反复迭代确认，最终写入。\n\n`;

  prompt += `## Step 1: 深度专业分析\n\n`;
  prompt += `对每份需求文档，分别以 **产品分析师** 和 **交互设计师** 两个角色进行深度审查：\n\n`;
  prompt += `**产品分析师审查清单**：\n`;
  prompt += `- [ ] 每条业务流程是否有明确的起点、步骤、分支、终点\n`;
  prompt += `- [ ] 状态流转是否闭环（所有状态都有进入和退出条件）\n`;
  prompt += `- [ ] 是否遗漏了异常分支（网络失败、权限不足、数据为空、超时）\n`;
  prompt += `- [ ] 是否遗漏了逆向流程（取消、退款、退货、撤销）\n`;
  prompt += `- [ ] 关键状态变化是否有通知机制（站内信/推送/邮件/短信）\n`;
  prompt += `- [ ] 并发场景是否有处理（重复提交、幂等性）\n`;
  prompt += `- [ ] 术语是否统一（同一概念不能有两个名称）\n\n`;
  prompt += `**交互设计师审查清单**：\n`;
  prompt += `- [ ] 每个页面/组件是否有 Loading 状态定义\n`;
  prompt += `- [ ] 每个列表/表格是否有 Empty State 定义\n`;
  prompt += `- [ ] 每个操作是否有 Error State 定义\n`;
  prompt += `- [ ] 列表/表格是否有分页/筛选/排序逻辑\n`;
  prompt += `- [ ] 不可逆操作是否有二次确认\n`;
  prompt += `- [ ] 表单是否有完整的校验规则\n`;
  prompt += `- [ ] 不同角色的权限控制是否明确\n`;
  prompt += `- [ ] 前后端校验规则是否一致\n`;
  prompt += `- [ ] 数据刷新策略是什么（实时/手动/轮询/WebSocket）\n\n`;
  prompt += `**输出**：输出一份《深度审查报告》，列出所有发现的问题和修改建议。\n\n`;

  prompt += `## Step 2: 生成改写版（Draft v1）\n\n`;
  prompt += `基于 Step 1 的审查报告，生成一份 **完整的专业 PRD 文档**，要求：\n\n`;
  prompt += `### 必须包含的章节\n`;
  prompt += `1. **背景与目标**：为什么要做这个功能，解决什么问题，预期收益\n`;
  prompt += `2. **术语表（Glossary）**：文档中所有专业术语的统一表述\n`;
  prompt += `3. **用户故事**：作为 [角色]，我希望 [目标]，以便 [价值]（每个功能一个）\n`;
  prompt += `4. **功能规格**（按模块组织）：\n`;
  prompt += `   - 功能清单（带唯一需求编号 R-01, R-02...）\n`;
  prompt += `   - 每个功能的详细描述（输入、处理、输出）\n`;
  prompt += `   - 业务流程（正常流程 + 异常分支 + 状态流转图）\n`;
  prompt += `   - 页面交互逻辑（页面结构、用户操作、反馈机制、权限控制）\n`;
  prompt += `   - 业务规则（校验、约束、状态流转条件）\n`;
  prompt += `   - 异常场景和边界条件（网络失败、权限不足、数据为空、超时）\n`;
  prompt += `5. **验收标准（AC）**：可测试的、具体的验收条件，每条用 \`[ ]\` 标记，必须量化\n`;
  prompt += `6. **非功能需求**：性能、安全、兼容性、可访问性等\n`;
  prompt += `7. **依赖与约束**：依赖的其他系统/模块，技术/业务约束\n`;
  prompt += `8. **功能边界**：明确「做什么」和「不做什么」\n`;
  prompt += `9. **待确认事项**：标注需要用户确认的内容（不要编造）\n\n`;
  prompt += `### 质量要求\n`;
  prompt += `- 统一术语，建立术语表\n`;
  prompt += `- 验收标准必须量化（如响应时间<200ms，成功率>99%）\n`;
  prompt += `- 业务流程必须包含异常分支\n`;
  prompt += `- 前端交互必须包含 Loading/Empty/Error 状态\n`;
  prompt += `- 不要添加文档中未提及的功能\n`;
  prompt += `- 如果原始描述不完整，标注「待确认」而不是编造\n\n`;
  prompt += `**输出**：将 Draft v1 的内容暂存，进入 Step 3。\n\n`;

  prompt += `## Step 3: 生成对比视图\n\n`;
  prompt += `生成一份 **原文档 vs 改写版（Draft v1）的对比报告**，格式如下：\n\n`;
  prompt += `\`\`\`\n`;
  prompt += `## 需求澄清对比报告\n\n`;
  prompt += `### 重大改进（原文缺失 → 改写版补充）\n`;
  prompt += `| 改进项 | 原文状态 | 改写版补充 | 影响 |\n`;
  prompt += `| :--- | :--- | :--- | :--- |\n`;
  prompt += `| 示例：订单状态流转 | ❌ 未定义 | ✅ 定义了 5 种状态及转换条件 | 避免状态不一致 bug |\n\n`;
  prompt += `### 交互完善（原文模糊 → 改写版明确）\n`;
  prompt += `| 改进项 | 原文描述 | 改写版描述 |\n`;
  prompt += `| :--- | :--- | :--- |\n`;
  prompt += `| 示例：提交按钮 | 「点击提交」 | 「点击后显示 Loading，成功后跳转，失败后显示错误信息」 |\n\n`;
  prompt += `### 待确认事项\n`;
  prompt += `- [ ] 事项 1：需要用户确认的业务规则\n`;
  prompt += `- [ ] 事项 2：需要用户补充的边界条件\n\n`;
  prompt += `### 建议取舍\n`;
  prompt += `- 建议保留改写版的改进（原因）\n`;
  prompt += `- 建议保留原文的表述（原因）\n`;
  prompt += `\`\`\`\n\n`;
  prompt += `**输出**：将对比报告展示给用户，进入 Step 4。\n\n`;

  prompt += `## Step 4: 迭代确认（多轮对话）\n\n`;
  prompt += `将 **对比报告** 和 **Draft v1** 一起展示给用户，然后：\n\n`;
  prompt += `1. **询问用户意见**：\n`;
  prompt += `   - "以上是我对需求文档的专业分析和改写，请检查是否有以下问题："\n`;
  prompt += `   - "业务流程是否正确？"\n`;
  prompt += `   - "交互逻辑是否完整？"\n`;
  prompt += `   - "是否有遗漏的功能点？"\n`;
  prompt += `   - "是否有不需要的功能？"\n\n`;
  prompt += `2. **接收用户反馈**：\n`;
  prompt += `   - 如果用户提出修改意见 → 生成 **Draft v2** → 重新生成对比 → 回到步骤 1 询问\n`;
  prompt += `   - 可以迭代多轮（v1 → v2 → v3 ...），直到用户满意\n`;
  prompt += `   - 每轮迭代都要生成新的对比报告，标注本轮修改\n\n`;
  prompt += `3. **迭代原则**：\n`;
  prompt += `   - 尊重用户决策：用户说保留原文的，保留原文\n`;
  prompt += `   - 专业建议：用户遗漏的，以「建议补充」形式提出，不强加\n`;
  prompt += `   - 记录取舍：每轮迭代记录「采纳/拒绝/待确认」的决策\n\n`;

  prompt += `## Step 5: 确认写入\n\n`;
  prompt += `当用户确认 "满意，可以写入" 后：\n\n`;
  prompt += `1. 将最终版 PRD 写入 \`010-requirements/converted/clarified-{源文件名}-{日期}.md\`\n`;
  prompt += `2. 同时生成 \`010-requirements/converted/clarified-{源文件名}-{日期}-diff.md\` 保存最终对比报告\n`;
  prompt += `3. 使用以下命令写入：\n\n`;
  prompt += `\`\`\`bash\n`;
  prompt += `speccore analyze --apply '{"010-requirements/converted/clarified-xxx.md":"...","010-requirements/converted/clarified-xxx-diff.md":"..."}' -I ${iteration}\n`;
  prompt += `\`\`\`\n\n`;
  prompt += `> 注意：写入后 CLI 会自动推进到需求确认阶段。\n`;

  return await injectGraphSummary(prompt);
}

async function buildConfirmCheckPrompt(iteration: string): Promise<string> {
  const iterDir = await getIterationDir(iteration);
  const reportPath = join(iterDir, '010-requirements', 'CLARIFY_REPORT.md');
  const convertedDir = join(iterDir, '010-requirements', 'converted');

  let prompt = `\n# 任务: 需求确认（Phase 0: 确认检查，v6.83.0+）\n\n`;

  if (await pathExists(reportPath)) {
    const report = await readFile(reportPath, 'utf-8');
    prompt += `## 需求澄清报告\n\n`;
    prompt += report.slice(0, 3000); // 截取前 3000 字符
    if (report.length > 3000) {
      prompt += `\n\n... (报告共 ${report.length} 字符，已截断)\n`;
    }
  }

  // v6.83.0+: 检查是否有 diff 文件
  let diffFiles: string[] = [];
  if (await pathExists(convertedDir)) {
    try {
      const entries = await readdir(convertedDir);
      diffFiles = entries.filter(f => f.includes('-diff.md'));
    } catch { /* ignore */ }
  }
  if (diffFiles.length > 0) {
    prompt += `\n## 已生成的对比报告\n\n`;
    for (const f of diffFiles) {
      prompt += `- \`converted/${f}\` — 需求澄清对比记录\n`;
    }
    prompt += '\n';
  }

  prompt += `## 确认检查清单\n\n`;
  prompt += `请逐项确认：\n\n`;
  prompt += `- [ ] clarified-*.md 已写入 \`010-requirements/converted/\`\n`;
  prompt += `- [ ] 验收标准可测试、可量化\n`;
  prompt += `- [ ] 功能边界明确（不做什么）\n`;
  prompt += `- [ ] 业务流程完整（含异常分支）\n`;
  prompt += `- [ ] 交互逻辑完整（Loading/Empty/Error 状态）\n`;
  prompt += `- [ ] 术语统一（已建立术语表）\n`;
  prompt += `- [ ] 所有「待确认」事项已解决\n\n`;

  prompt += `## 操作选项\n\n`;
  prompt += `**选项 A：确认通过，进入技术方案生成**\n`;
  prompt += `\`\`\`bash\n`;
  prompt += `speccore analyze --prompt -I ${iteration} --pipeline\n`;
  prompt += `\`\`\`\n\n`;

  prompt += `**选项 B：需要重新澄清（返回迭代）**\n`;
  prompt += `如果对需求文档不满意，可以返回重新澄清：\n`;
  prompt += `\`\`\`bash\n`;
  prompt += `speccore analyze --prompt -I ${iteration} --pipeline --skip-clarify=false\n`;
  prompt += `\`\`\`\n`;
  prompt += `> 重新进入 clarify-prompt 阶段，AI 会基于已有 draft 继续迭代。\n\n`;

  prompt += `**选项 C：跳过确认，直接进入分析（风险自负）**\n`;
  prompt += `\`\`\`bash\n`;
  prompt += `speccore analyze --prompt -I ${iteration} --pipeline --skip-clarify\n`;
  prompt += `\`\`\`\n`;

  return await injectGraphSummary(prompt);
}
