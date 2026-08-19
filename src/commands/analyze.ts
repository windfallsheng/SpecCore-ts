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
import { writeFile, pathExists, ensureDir } from 'fs-extra';
import { join, dirname } from 'path';
import { backupWithTimestamp, isTimestampBackup, shouldOverwrite } from '../utils/task-utils';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, getIterationDir } from '../core/context';
import { findTaskDir } from '../core/task-paths';
import { extractQuestions, showQuestionChecklist } from '../core/question-checklist';
import { showNextSteps } from '../core/next-steps';
import { runAnalysis, AnalyzeInput, supplementAnalysis, analyzeSingleFeature, generateSpecsFromRequirements } from '../core/analyze-engine';
import { readFile, readdir, readdirSync } from 'fs-extra';
import { generateGlobalArtifacts } from '../core/global-artifacts';
import { buildPrompt, formatPrompt } from '../core/prompt-builder';
import { buildAutoModeInstruction } from '../core/questions';
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
  // 开发者实现指南 (v6.76.0+)
  devGuide?: boolean;     // --dev-guide: 生成 DEV_GUIDE.md 实现指南
}

export async function analyzeCommand(options: AnalyzeOptions): Promise<void> {
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
  await warnIfIndexStale(process.cwd(), 'analyze', options.iteration);

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
      const globalDir = join(process.cwd(), '.speccore', 'GLOBAL');
      await ensureDir(globalDir);
      await ensureDir(join(globalDir, 'platforms'));
      logger.info(`📁 已预创建 .speccore/GLOBAL/ 目录结构`);
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
      // 迭代层：使用 createAnalyzePipeline（支持契约先行 + 逐端推进 + 变更感知 + 关键路径优先）
      const result = await createAnalyzePipeline(iter!, process.cwd(), {
        affectedPlatforms: affectedPlatforms && affectedPlatforms.length > 0 ? affectedPlatforms : undefined,
        platformOrder: platformOrder && platformOrder.length > 0 ? platformOrder : undefined,
      });
      engine = result.engine;
      steps = result.steps;
      pipelineKey = iter!;
      initStep = 'phase1-prompt';
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
      progressLabel = currentStep === 'phase1-prompt'
        ? 'Phase 1/3: 全局文档'
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
              if (parts[0] === 'platforms') {
                // platforms/admin-web/_INDEX.md → .speccore/GLOBAL/platforms/admin-web/
                targetDir = join(globalBaseDir, ...parts.slice(0, -1));
                targetFilename = parts[parts.length - 1];
              } else {
                // admin-web/FEATURES.md → .speccore/GLOBAL/platforms/admin-web/
                targetDir = join(globalBaseDir, 'platforms', parts[0]);
                targetFilename = parts[parts.length - 1];
              }
            } else if (globalSet.has(filename)) {
              targetDir = globalBaseDir;
              targetFilename = filename;
            } else {
              targetDir = globalBaseDir;
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
        } else {
          // 迭代级：写 020-specs/（全局文档写入 global/ 子目录，v6.41.0+）
          // v6.69.2+: 增加端名白名单校验，防止 AI 创建非法目录
          const specDir = join(iterDir!, '020-specs');
          await ensureDir(specDir);
          const globalSet = new Set(GLOBAL_SPEC_FILES);
          const validPlatforms = new Set([GLOBAL_SPECS_DIR, ...(await parsePlatformList())]);
          let skippedCount = 0;

          for (const [filename, content] of Object.entries(docs)) {
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

            // 解析目录名（如 "admin-web/TECH.md" → "admin-web"）
            const platformDir = filename.includes('/') ? filename.split('/')[0] : null;

            // 白名单校验：如果包含目录前缀，必须是合法端名
            if (platformDir && !validPlatforms.has(platformDir)) {
              logger.warn(`   ⚠️ 跳过非法端目录: ${platformDir}（文件: ${filename}）`);
              logger.warn(`      合法端: ${Array.from(validPlatforms).join(', ')}`);
              skippedCount++;
              continue;
            }

            // 全局文档写入 global/ 子目录，端专属文档写入 {端}/ 子目录
            const targetDir = globalSet.has(filename)
              ? join(specDir, GLOBAL_SPECS_DIR)
              : options.platform ? join(specDir, options.platform) : specDir;
            await ensureDir(targetDir);
            const fp = join(targetDir, filename);
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
          const fmContent = docs['FUNCTION_MAP.md'] || docs['global/FUNCTION_MAP.md'];
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
      // 迭代级：写 020-specs/global/（全局文档，v6.41.0+）
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
        logger.success(`✅ ANALYSIS.md 已写入 020-specs/global/`);
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
      // - Phase 1: 生成全局文档(global/REQUIREMENT.md、ANALYSIS.md、DEPS.md)
      // - Phase 2: 生成各端专属文档({端}/TECH.md、TEST.md、UI_SPEC.md)
      // 
      // 单端项目(=1 个端)不需要分阶段:
      // - Phase 1 生成的 global/TECH.md 本身就是该端的专属文档
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
    const iter = options.iteration || await getDefaultIteration();
    const prompt = await buildMultiDocPrompt('analyze', { iteration: iter, task: options.task, type: options.type, scope: options.scope, withCode: options.withCode, platform: options.platform, phase: options.phase, autoMode: options.auto }, options);
    process.stdout.write(`[SPECCORE_PROMPT]\n${prompt}`);
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

  // 预创建 global/ 子目录
  const globalDir = join(specDir, GLOBAL_SPECS_DIR);
  await ensureDir(globalDir);

  // 读取端列表并预创建各端目录
  const platforms = await parsePlatformList();
  for (const platform of platforms) {
    await ensureDir(join(specDir, platform));
  }

  if (platforms.length > 0) {
    logger.info(`📁 已预创建 020-specs/ 目录结构: global/ + ${platforms.length} 个端目录 (${platforms.join(', ')})`);
  } else {
    logger.info(`📁 已预创建 020-specs/ 目录结构: global/`);
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
  // 全局文档模板 → 写入 global/ 子目录（v6.41.0+）
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
  // 写入全局文档到 global/
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

    let prompt = `\n# 任务: ${command} (全局分析${ctx.withCode ? '+源码' : ''})\n\n`;
    prompt += `## 要求\n`;
    prompt += `1. **先读宪法**: Read .speccore/CONSTITUTION.md，这是项目配置的唯一权威来源。获取:\n`;
    prompt += `   - 「工程」列 → 所有工程名（如 meeting-system, booking-service）\n`;
    prompt += `   - 「源码路径」列 → 各工程的代码目录（用于 Read 源码）\n`;
    prompt += `   - 「## 端列表」章节 → 全局权威端名列表（如 backend/h5/admin）\n`;
    prompt += `   - 每个工程独立分析，文档输出到: .speccore/GLOBAL/platforms/{端名}/\n`;
    prompt += `2. Read .speccore/GLOBAL/ 下所有文档了解跨项目需求\n`;
    prompt += `3. **禁止行为（重要）**: 不要打开浏览器、不要模拟用户操作、不要访问 URL。所有分析必须基于直接 Read 源码文件完成。如果文件不存在，跳过即可，不要尝试其他方式获取。\n`;
    if (ctx.withCode) {
      // v6.71.2+: 双层扫描 + 功能模块驱动（替代原来的按端顺序分析）
      prompt += `4. 从 CONSTITUTION.md 的「源码路径」列读取所有工程目录\n`;
      prompt += `\n## 📊 Layer 1: 快速扫描所有端（并行，只提取索引）\n\n`;
      prompt += `对每个端，只读取关键索引文件（不深入代码逻辑）：\n\n`;
      prompt += `**后端端**：\n`;
      prompt += `- 读取 Controller/Handler/Resource 目录文件列表 → 提取：接口类名、接口路径（从注解/装饰器推断）\n`;
      prompt += `- 读取 Entity/Model/Schema/Domain 目录文件列表 → 提取：实体名称、表名\n`;
      prompt += `- 读取 Service/UseCase/Application 目录文件列表 → 提取：服务类名\n`;
      prompt += `- 读取 pom.xml/package.json/go.mod/requirements.txt → 提取：依赖项列表（识别公共服务候选）\n\n`;
      prompt += `**前端端**：\n`;
      prompt += `- 读取 router/routes 配置文件 → 提取：页面路径、页面名称、组件名\n`;
      prompt += `- 读取 pages/views/screens 目录文件列表 → 提取：页面名称、主要功能（从文件名推断）\n`;
      prompt += `- 搜索 API 调用模式（axios/fetch/$.ajax/uni.request）→ 提取：调用的接口路径列表\n`;
      prompt += `- 读取 store/pinia/vuex/redux 目录 → 提取：全局状态名称、actions 名称\n\n`;
      prompt += `**输出**：每个端一个 \`_INDEX.md\`，只含名称和路径列表，不含详细逻辑\n`;
      prompt += `**存放**：\`.speccore/GLOBAL/platforms/{端名}/_INDEX.md\`\n\n`;
      prompt += `## 🔗 Layer 2: 跨端关联分析（基于 Layer 1 的索引）\n\n`;
      prompt += `1. **匹配前后端接口**：\n`;
      prompt += `   - 前端 \`_INDEX.md\` 中的 API 调用路径 vs 后端 \`_INDEX.md\` 中的接口路径\n`;
      prompt += `   - **匹配上** → 建立「前端页面 → 前端 API 调用 → 后端接口 → 后端服务」链路\n`;
      prompt += `   - **前端有、后端没有** → 标注为「接口缺口」（可能调了第三方/遗留/错误接口）\n`;
      prompt += `   - **后端有、前端没调** → 标注为「未使用接口」（可能后台管理/内部调度用）\n\n`;
      prompt += `2. **识别公共服务**：\n`;
      prompt += `   - 被 2+ 个前端端调用的后端服务 → 公共服务候选\n`;
      prompt += `   - 被 2+ 个后端端调用的后端服务 → 公共服务候选\n`;
      prompt += `   - 依赖项中独立部署的服务（如 notification-service、file-service）→ 公共服务候选\n\n`;
      prompt += `3. **归纳功能模块**（从索引聚类，不是从代码反推）：\n`;
      prompt += `   - **从页面聚类**：哪些页面经常一起出现（如 RoomList + RoomDetail + RoomEdit）\n`;
      prompt += `   - **从接口聚类**：哪些接口共享同一实体前缀（如 /api/rooms/*）\n`;
      prompt += `   - **交叉验证**：页面聚类 vs 接口聚类 → 确定功能模块边界\n`;
      prompt += `   - 每个功能模块标注：涉及端、核心页面、核心接口、实体名称\n\n`;
      prompt += `**输出**：\n`;
      prompt += `- \`_ASSOCIATION.md\`：前后端关联矩阵 + 接口缺口/未使用接口清单\n`;
      prompt += `- \`_MODULES.md\`：功能模块候选清单（从源码聚类，供 Layer 3 验证）\n`;
      prompt += `**存放**：\`.speccore/GLOBAL/platforms/_shared/\`\n\n`;
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
      prompt += `- 后端端：该功能模块相关的 API 详细设计、数据模型、业务规则\n`;
      prompt += `- 前端端：该功能模块相关的页面详细设计、交互流程、字段映射\n`;
      prompt += `- 跨端：该功能模块的交互时序图（供 Layer 4 汇总到 INTERACTION_MAP.md）\n\n`;
      prompt += `## 🌍 Layer 4: 全局汇总（所有功能模块分析完成后）\n\n`;
      prompt += `1. **一致性校验**：\n`;
      prompt += `   - 前端字段 vs 后端字段是否一致（名称、类型、必填性）\n`;
      prompt += `   - 前端状态 vs 后端状态枚举是否一致\n`;
      prompt += `   - 接口缺口清单（前端调了但后端没有的接口）\n`;
      prompt += `   - 未使用接口清单（后端有但前端没调的接口）\n`;
      prompt += `   → 输出 \`CONSISTENCY_CHECK.md\`\n\n`;
      prompt += `2. **生成全局文档**（产品视角，从功能模块汇总）：\n`;
      prompt += `   - \`REQUIREMENT.md\`：现有功能清单（按业务场景组织，产品视角）\n`;
      prompt += `   - \`FUNCTION_MAP.md\`：功能单元 × 端映射表\n`;
      prompt += `   - \`INTERACTION_MAP.md\`：跨端交互时序图（从 Layer 3 的时序汇总）\n`;
      prompt += `   - \`API_CONTRACT.yaml\`：全局接口契约（汇总所有后端 API_INVENTORY）\n`;
      prompt += `   - \`ARCHITECTURE.md\`：全局架构文档（服务拓扑、数据流、部署关系）\n\n`;
      prompt += `3. **生成各端详细文档**（技术视角，从 Layer 3 汇总）：\n`;
      prompt += `   - 后端端：API_INVENTORY.md、DATA_MODEL.md、BUSINESS_RULES.md、TECH_STACK.md\n`;
      prompt += `   - 前端端：FEATURES.md、UI_FLOW.md、API_CALL_MAP.md、TECH_STACK.md\n\n`;
      prompt += `4. **知识沉淀（按工程+端区分）**: 从各端源码识别可复用模式，写入 .speccore/PATTERNS/:\n`;
      prompt += `   - 命名规则: **{CONSTITUTION中的工程名}-{端}-{分类}-{模式名}.md**\n`;
      prompt += `   - 后台分类: auth(鉴权)、api(接口设计)、data(数据访问)、error(异常)、log(日志)、util(工具)、arch(架构)\n`;
      prompt += `   - 前端分类: comp(组件)、state(状态管理)、router(路由)、request(请求)、form(表单)、style(样式)、build(构建)\n`;
      prompt += `   - 每个文件含: 工程名/端/分类 + 适用场景 + 核心代码片段 + 注意事项 + 反例\n\n`;
      prompt += `5. 以上文档输出到 .speccore/GLOBAL/ 和 .speccore/PATTERNS/，使用 Write 工具写入\n`;
    } else {
      prompt += `4. 读取 .speccore/GLOBAL/ 下各项目需求文档，生成跨项目索引和需求目录\n`;
    }
    prompt += `\n## 输出文档\n`;
    if (ctx.withCode) {
      prompt += `\n### Layer 中间产物（分析过程中生成）\n`;
      prompt += `> 存放: .speccore/GLOBAL/platforms/\n\n`;
      prompt += `| 文档 | 层级 | 存放位置 | 内容 |\n`;
      prompt += `| :--- | :--- | :--- | :--- |\n`;
      prompt += `| _INDEX.md | Layer 1 | platforms/{端}/ | 各端目录索引（页面/接口/实体/依赖列表） |\n`;
      prompt += `| _ASSOCIATION.md | Layer 2 | platforms/_shared/ | 前后端关联矩阵 + 接口缺口/未使用接口 |\n`;
      prompt += `| _MODULES.md | Layer 2 | platforms/_shared/ | 功能模块候选清单（从源码聚类） |\n`;
      prompt += `\n### 全局最终产物（Layer 4 汇总生成）\n`;
      prompt += `> 存放: .speccore/GLOBAL/\n\n`;
      prompt += `| 文档 | 视角 | 内容 |\n`;
      prompt += `| :--- | :--- | :--- |\n`;
      prompt += `| REQUIREMENT.md | 产品视角 | 现有功能清单（按业务场景组织，从功能模块汇总） |\n`;
      prompt += `| FUNCTION_MAP.md | 架构视角 | 功能单元 × 端映射表 |\n`;
      prompt += `| INTERACTION_MAP.md | 架构视角 | 跨端交互时序图（从 Layer 3 汇总） |\n`;
      prompt += `| API_CONTRACT.yaml | 技术视角 | 全局接口契约（汇总所有后端 API） |\n`;
      prompt += `| ARCHITECTURE.md | 技术视角 | 全局架构文档（服务拓扑、数据流、部署关系） |\n`;
      prompt += `| CONSISTENCY_CHECK.md | 质量视角 | 一致性校验报告（前后端字段/状态/接口缺口） |\n`;
      prompt += `\n### 各端最终产物（Layer 3/4 汇总生成）\n`;
      prompt += `> 存放: .speccore/GLOBAL/platforms/{端名}/\n\n`;
      prompt += `| 文档 | 适用端 | 内容 |\n`;
      prompt += `| :--- | :--- | :--- |\n`;
      prompt += `| FEATURES.md | **前端端** | 产品视角功能清单（页面+交互+API调用链） |\n`;
      prompt += `| UI_FLOW.md | **前端端** | 页面流转图、用户操作流程 |\n`;
      prompt += `| API_CALL_MAP.md | **前端端** | 页面 → 接口 → 后端服务 映射表 |\n`;
      prompt += `| API_INVENTORY.md | **后端端** | 完整接口清单（路径/方法/参数/响应/鉴权） |\n`;
      prompt += `| DATA_MODEL.md | **后端端** | 表结构+字段+关系+索引 |\n`;
      prompt += `| BUSINESS_RULES.md | **后端端** | 校验规则+业务约束+状态机 |\n`;
      prompt += `| TECH_STACK.md | 通用 | 语言、框架、构建工具、UI库 |\n`;
      prompt += `| DEPENDENCY_GRAPH.md | 通用 | 模块依赖拓扑 |\n`;
      prompt += `| CODE_INDEX.md | 通用 | 目录结构+关键文件+模块职责 |\n`;
      prompt += `| PATTERNS/*.md | 通用 | 可复用设计模式 |\n`;
    } else {
      prompt += `- REQUIREMENT.md — 合并各迭代需求，生成跨项目需求索引\n`;
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
    return prompt;
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
- **不要写**用户旅程、业务场景、页面清单（这些在 global/REQUIREMENT.md 中）

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

### 全局级 DEV_GUIDE.md（020-specs/global/）
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
  const DOC_MATRIX: Record<string, string[]> = {
    feature:    ['REQUIREMENT.md','ANALYSIS.md','TECH.md','TEST.md','REVIEW.md','RISK.md','DEPS.md','MONITOR.md','UI_SPEC.md','FUNCTION_MAP.md','INTERACTION_MAP.md'],
    refactor:   ['ANALYSIS.md','TECH.md','TEST.md','REVIEW.md','RISK.md'],
    bugfix:     ['ANALYSIS.md','TECH.md','TEST.md'],
    research:   ['ANALYSIS.md'],
    review:     ['REVIEW.md','RISK.md'],
    test:       ['TEST.md','RISK.md'],
    docs:       ['ANALYSIS.md'],
    deploy:     ['ANALYSIS.md','TECH.md','RISK.md','DEPS.md','MONITOR.md'],
    security:   ['ANALYSIS.md','TEST.md','REVIEW.md','RISK.md'],
    performance:['ANALYSIS.md','TECH.md','TEST.md','MONITOR.md'],
  };
  let includeDocs = isTask ? (DOC_MATRIX[taskType] || DOC_MATRIX['feature']) : DOC_MATRIX['feature'];
  // v6.76.0+: --dev-guide 模式下增加 DEV_GUIDE.md
  if (options?.devGuide) {
    includeDocs = [...includeDocs, 'DEV_GUIDE.md'];
  }

  // ── v6.61.0+: 恢复 Phase 1/Phase 2 分步逻辑，但 CLI 自动触发 Phase 2 ──
  // Phase 1: 生成全局文档(global/REQUIREMENT.md、ANALYSIS.md、DEPS.md 等)
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
        doc[1] = `# \u672c\u4efb\u52a1\u6280\u672f\u65b9\u6848\n\n> ${iter} | ${ctx.task} | ${now}\n\n## \u5199\u4f5c\u8981\u6c42\n\u57fa\u4e8e global/TECH.md \u7684\u6574\u4f53\u67b6\u6784\uff0c\u7ec6\u5316\u5230\u51fd\u6570/\u63a5\u53e3\u7ea7\u522b\uff1a\n- \u5177\u4f53\u7684\u63a5\u53e3\u5b9a\u4e49\uff08\u8def\u5f84/\u53c2\u6570/\u54cd\u5e94\uff09\n- \u6570\u636e\u6a21\u578b\u8bbe\u8ba1\uff08Entity/DTO/VO \u5b57\u6bb5\u6620\u5c04\uff09\n- \u6838\u5fc3\u4e1a\u52a1\u903b\u8f91\u7684\u4f2a\u4ee3\u7801\u6216\u6d41\u7a0b\u63cf\u8ff0\n- \u524d\u7aef\u7ec4\u4ef6\u62c6\u5206\u548c\u72b6\u6001\u8bbe\u8ba1\n- \u5fc5\u987b\u4e0e global/TECH.md \u7684\u6574\u4f53\u67b6\u6784\u4fdd\u6301\u4e00\u81f4\n`;
      } else if (doc[0] === 'TASK.md') {
        doc[1] = `# \u5b9e\u65bd\u8ba1\u5212\n\n> ${iter} | ${ctx.task} | ${now}\n\n## \u5199\u4f5c\u8981\u6c42\n\u6839\u636e\u672c\u4efb\u52a1\u7684\u9700\u6c42\u548c\u6280\u672f\u65b9\u6848\uff0c\u5236\u5b9a\u5177\u4f53\u5b9e\u65bd\u6b65\u9aa4\uff1a\n- \u6309\u5f00\u53d1\u987a\u5e8f\u5217\u51fa\u5177\u4f53\u6b65\u9aa4\n- \u6bcf\u4e2a\u6b65\u9aa4\u6709\u660e\u786e\u7684\u5b8c\u6210\u6807\u51c6\n- \u6807\u6ce8\u6b65\u9aa4\u95f4\u7684\u4f9d\u8d56\u5173\u7cfb\n- \u4f30\u7b97\u6bcf\u6b65\u7684\u5de5\u4f5c\u91cf\n`;
      } else if (doc[0] === 'SCHEMA.md') {
        doc[1] = `# \u6570\u636e\u6a21\u578b\n\n> ${iter} | ${ctx.task} | ${now}\n\n## \u5199\u4f5c\u8981\u6c42\n\u68b3\u7406\u672c\u4efb\u52a1\u6d89\u53ca\u7684\u6570\u636e\u6a21\u578b\u53d8\u66f4\uff1a\n- \u5b8c\u6574\u7684\u5b57\u6bb5\u5b9a\u4e49\uff08\u540d\u79f0/\u7c7b\u578b/\u7ea6\u675f/\u8bf4\u660e\uff09\n- \u7d22\u5f15\u8bbe\u8ba1\n- DDL \u8bed\u53e5\uff08\u5982\u9002\u7528\uff09\n- \u5b57\u6bb5\u2192API \u54cd\u5e94\u5b57\u6bb5\u7684\u6620\u5c04\u5173\u7cfb\n`;
      }
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
    // global/TECH.md: 整体架构
    techDoc[1] = `# 技术架构（跨端全局）\n\n> ${iter}\n\n## 写作要求\n撰写整体技术架构，覆盖所有端的交互关系：\n- 系统整体分层设计（各端在架构中的位置）\n- 跨端交互协议（前端↔后端通信方式、数据流向）\n- 中间件选型（缓存、消息队列、网关等）\n- 数据库整体设计（核心表结构、ER 关系）\n- 技术栈选型及理由\n`;
  }

  let prompt = `\n# 任务: ${command}${task} (${taskDocs.length}个文档 · ${isTask ? `类型:${taskType}` : '迭代全量'}${ctx.phase ? ` · Phase ${ctx.phase}` : ''})\n\n`;
  // ── v6.67.0+: 在 prompt 开头就明确完整工作流程 ──
  if (!ctx.phase && !isTask) {
    const platforms = await parsePlatformList();
    if (platforms.length >= 2) {
      prompt += `## 📋 完整工作流程（两阶段分析）\n\n`;
      prompt += `本项目检测到有 ${platforms.length} 个端(${platforms.join('、')})，需要分两阶段执行：\n\n`;
      prompt += `**Phase 1（当前阶段）**: 生成全局文档(global/REQUIREMENT.md、ANALYSIS.md、DEPS.md 等)\n`;
      prompt += `**Phase 2（下一阶段）**: 生成各端专属文档({端}/TECH.md、TEST.md、UI_SPEC.md 等)\n\n`;
      prompt += `## ⚠️ 强制要求：Phase 1 完成后立即执行 Phase 2\n\n`;
      prompt += `当你通过 --apply 写入所有全局文档后，**必须立即执行**以下命令进入 Phase 2：\n\n`;
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
  prompt += `- ✅ **正确行为**：只使用 CLI 预创建的 global/ 和 {端名}/ 目录，不要手动 mkdir 或 Write 到不存在的目录\n`;
  prompt += `- ⚠️ **后果**：如果创建额外目录，会导致后续 split/execute 命令找不到文件，整个工作流失败\n\n`;
  prompt += `###  绝对禁止直接用 Write 工具写文件\n`;
  prompt += `- ❌ **错误行为**：Write("020-specs/global/ANALYSIS.md", content) 或直接 Write 到任何路径\n`;
  prompt += `- ✅ **正确行为**：必须通过 \`speccore analyze --apply '{"global/ANALYSIS.md":"...","admin-web/TECH.md":"..."}' -I ${iter}\` 写入\n`;
  prompt += `- 💡 **Windows 兼容**：如果 JSON 在命令行中转义困难，先将 JSON 写入文件（如 result.json），然后执行 \`speccore analyze --apply @result.json -I ${iter}\`\n`;
  prompt += `- ⚠️ **原因**：--apply 会让 CLI 自动路由文件到正确的子目录，直接 Write 会绕过这个机制，导致所有文件扁平在根目录\n\n`;
  prompt += `### ✅ 正确的目录结构\n`;
  prompt += `\`\`\`\n`;
  prompt += `020-specs/\n`;
  prompt += `├── global/          ← REQUIREMENT.md, ANALYSIS.md, DEPS.md（跨端通用）\n`;
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
    prompt += `- Read 020-specs/global/REQUIREMENT.md → 全局需求规格\n`;
    prompt += `- Read 020-specs/global/TECH.md → 整体技术架构\n`;
    prompt += `- Read 020-specs/global/ANALYSIS.md → 全局分析报告\n`;
    prompt += `- Read 020-specs/{本任务端名}/TECH.md → 该端专属技术方案\n\n`;
    prompt += `### Step 3: 撰写任务级深度分析文档\n\n`;
    prompt += `**REQ.md** — 本任务的需求规格（不是 global/REQUIREMENT.md 的复制）：\n`;
    prompt += `- 明确本任务的验收标准（可测试的、具体的）\n`;
    prompt += `- 细化业务规则和边界条件\n`;
    prompt += `- 列出本任务涉及的异常场景\n\n`;
    prompt += `**TECH.md** — 本任务的实现方案（基于全局架构，细化到函数/接口级）：\n`;
    prompt += `- 具体的接口定义（路径/参数/响应）\n`;
    prompt += `- 数据模型设计（Entity/DTO/VO 字段映射）\n`;
    prompt += `- 核心业务逻辑的伪代码或流程描述\n`;
    prompt += `- 前端组件拆分和状态设计\n`;
    prompt += `- 必须与 global/TECH.md 的整体架构保持一致\n\n`;
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
      prompt += `- 全局跨端文档写入 020-specs/global/（REQUIREMENT.md、DEPS.md、RISK.md 等）\n`;
      prompt += `- **不要生成**其他端的子目录和文档\n`;
    }
    // ── v6.61.0+: 阶段专属指令（Phase 2）──
    if (ctx.phase === '2') {
      prompt += `## 要求\n\n`;
      prompt += `### Step 1: 读取全局上下文（Phase 1 产出）\n`;
      prompt += `依次 Read 以下文件，建立全局技术架构认知：\n`;
      prompt += `- Read .speccore/CONSTITUTION.md\n`;
      prompt += `- Read 020-specs/PLATFORMS.md → 获取端列表\n`;
      prompt += `- Read 020-specs/global/REQUIREMENT.md → 需求规格\n`;
      prompt += `- Read 020-specs/global/ANALYSIS.md → 分析报告\n`;
      prompt += `- Read 020-specs/global/TECH.md → 整体技术架构\n`;
      prompt += `- Read 020-specs/global/RISK.md、DEPS.md、REVIEW.md、MONITOR.md（如存在）\n\n`;
      prompt += `### Step 2: 为每个端撰写专属文档\n`;
      prompt += `根据全局上下文，为 PLATFORMS.md 中的**每个端**分别撰写：\n`;
      prompt += `- **{端}/TECH.md**：该端专属技术方案（必须对齐 global/TECH.md 架构）\n`;
      prompt += `  - ⚠️ **必须包含「业务-代码映射」章节**：在 TECH.md 末尾添加表格，列出本端涉及的业务模块及其对应的代码实体（文件/表/API/组件等），关系类型由你根据技术栈自主决定（如 api_controller、uses_table、page、component、route、middleware、interceptor、gateway 等）\n`;
      prompt += `  - 表格格式：| 业务模块 | 代码实体 | 关系类型 | 说明 |\n`;
      prompt += `  - 示例：| 会议室档案 | backend/RoomController.java | api_controller | REST 控制器 |\n`;
      prompt += `  - 示例：| 会议室档案 | admin-web/src/pages/RoomList.vue | page | 列表页 |\n`;
      prompt += `- **{端}/TEST.md**：该端专属测试计划\n`;
      prompt += `- **{端}/UI_SPEC.md**：该端专属 UI 规格（仅前端端需要）\n\n`;
      prompt += `### Step 3: 一致性检查\n`;
      prompt += `- 各端 TECH.md 的技术选型必须与 global/TECH.md 一致\n`;
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
    prompt += `   a. Read .speccore/GLOBAL/REQUIREMENT.md → 系统已有功能清单\n`;
    prompt += `   b. Read .speccore/GLOBAL/FUNCTION_MAP.md → 已有功能单元和涉及端\n`;
    prompt += `   c. Read .speccore/GLOBAL/API_CONTRACT.yaml → 已有接口契约\n`;
    prompt += `   d. Read .speccore/GLOBAL/ARCHITECTURE.md → 全局架构（如有）\n`;
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
    prompt += `8. **REQUIREMENT.md 写作风格（重要）**：全局需求文档必须以产品/用户视角撰写\n`;
    prompt += `   - **按业务场景/用户旅程组织章节**，不按端分章节（如"H5端需求"、"后端需求"）\n`;
    prompt += `   - 每个场景描述：用户操作 → 系统响应 → 业务规则 → 边界条件\n`;
    prompt += `   - 系统响应中自然包含前后端交互，但不刻意标注技术实现细节\n`;
    prompt += `   - 示例正确写法：「用户选择时间段后点击预订，系统检查会议室可用性，如可用则锁定会议室并创建待支付订单」\n`;
    prompt += `   - 示例错误写法：「后端 booking-service 需要新增 /api/bookings 接口，接收 roomId 参数」\n`;
    prompt += `   - 技术实现细节留在 TECH.md 和各端专属文档中，不在 REQUIREMENT.md 展开\n`;
    prompt += `   - 端的信息只在「功能模块清单」表格中标注，正文不区分端\n`;
    // v6.49.14+: 功能模块清单必须含涉及端列 + 来源链接
    // v6.71.3+: 增加「与全局层对比」列
    prompt += `9. **功能模块清单（重要）**：写入 global/REQUIREMENT.md 时，功能模块清单表格必须包含以下列\n`;
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
    prompt += `   - 对比迭代需求中的功能模块 vs .speccore/GLOBAL/FUNCTION_MAP.md 中的功能单元\n`;
    prompt += `   - 标注每个功能模块的「全局对比」类型（新增/扩展/重构/复用）\n`;
    prompt += `   - 识别冲突：如迭代需求修改了全局层已有接口的字段/路径 → 在 RISK.md 中标注\n`;
    prompt += `   - 识别依赖：如迭代的新功能依赖全局层的某个功能 → 在 FUNCTION_MAP.md「依赖任务」中标注\n\n`;
    prompt += `7b. **跨端功能映射表（重要）**：在 REQUIREMENT.md 完成后，必须生成 global/FUNCTION_MAP.md\n`;
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
    prompt += `7c. **跨端交互图谱（重要）**：在 FUNCTION_MAP.md 完成后，必须生成 global/INTERACTION_MAP.md\n`;
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
    prompt += `   - **全局文档**（跨端通用）→ 通过 --apply 写入，CLI 自动路由到 \`020-specs/global/{文件名}\`\n`;
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
    prompt += `   - ⚠️ 直接 Write 会导致目录结构错误（所有文件扁平在根目录），必须走 --apply 让 CLI 自动路由到 global/ 或 {端名}/ 子目录\n`;
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
      prompt += `- **不需要**产品视角的需求描述（用户故事、业务场景已在 global/REQUIREMENT.md 中）\n\n`;
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
  prompt += `- **global/REQUIREMENT.md**：整体需求（产品视角，按业务场景组织）\n`;
  prompt += `- **global/ANALYSIS.md**：整体需求分析\n`;
  prompt += `- **global/DEPS.md**：整体依赖清单\n`;
  prompt += `- **global/FUNCTION_MAP.md**：功能单元 × 端映射表\n`;
  prompt += `- **global/INTERACTION_MAP.md**：跨端交互时序图\n`;
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
    prompt += `当你通过 --apply 写入所有全局文档后，CLI 会检测到项目有多个端（≥2 个端）。\n`;
    prompt += `**此时你需要主动询问用户**：\n\n`;
    prompt += `"✅ Phase 1 已完成，生成了 global/ 的全局文档。\n`;
    prompt += `检测到项目有 ${'{'}端列表{'}'} 个端，需要继续执行 Phase 2 生成各端专属文档吗？\n`;
    prompt += `请确认：输入 '继续' 或 'yes' 以执行 Phase 2"\n\n`;
    prompt += `**如果用户确认继续**，你需要执行：\n`;
    prompt += `\`speccore analyze --prompt -I ${iter} --phase 2\`\n\n`;
    prompt += `**不要等待 CLI 的提示信息**，CLI 的输出你可能看不到。你需要主动询问用户。\n\n`;
  }
  if (autoMode && !ctx.phase && !isTask) {
    prompt += `\n## 🤖 自动模式说明\n\n`;
    prompt += `当前处于自动模式（--auto），不需要人工确认。\n`;
    prompt += `请在生成全局文档后，**直接继续**生成各端专属文档（Phase 2）。\n`;
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
  prompt += `- [ ] 检查各端 TECH.md 的技术选型是否与 global/TECH.md 的整体架构一致\n\n`;
  prompt += `### 5. 目录结构合法性\n`;
  prompt += `- [ ] 确认 --apply 的 JSON 键名只包含合法文件名或「合法端名/文件名」格式\n`;
  prompt += `- [ ] **禁止**包含数字编号目录（如 1001/、1002/）、中文目录（如 错误码/）、特殊符号目录（如 .../）\n`;
  prompt += `- [ ] 合法格式示例：\`global/ANALYSIS.md\`、\`admin-web/TECH.md\`、\`REQUIREMENT.md\`\n\n`;
  prompt += `### 自检通过标准\n`;
  prompt += `以上 5 项全部勾选通过后，方可执行 --apply 写入。如果任何一项未通过，先修正问题，重新自检，直到全部通过。\n`;

  return prompt;
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
  prompt += `| Phase 2 | 全局实时更新 | 后端完成后更新全局文档 | global/API_CONTRACT.yaml, ARCHITECTURE.md, ... |\n`;
  prompt += `| Phase 3 | 前端深度分析 | 对齐后端契约 | platforms/{前端端}/FEATURES.md, UI_SPEC.md, ... |\n`;
  prompt += `| Phase 4 | 横向关联检查 | 前后端字段/接口一致性 | global/CROSS_CHECK.md |\n`;
  prompt += `| Phase 5 | 纵向关联检查 | 功能模块跨端完整性 | global/VERTICAL_CHECK.md |\n`;
  prompt += `| Phase 6 | 最终核对检查 | 完整性+一致性+遗漏检测 | global/FINAL_AUDIT.md |\n\n`;

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
  prompt += `3. **实时更新全局**: 后端分析完成后必须更新全局文档，前端分析完成后必须更新前端文档\n`;
  prompt += `4. **冲突时回退修正**: 发现不一致时，优先修正源头文档，再推进当前阶段\n`;
  prompt += `5. **写入方式**: 所有文档通过 \`speccore analyze --apply '{"文件路径":"内容"}' -I ${iter} --global\` 写入\n`;
  prompt += `6. **知识图谱**: 每阶段完成后自动刷新知识图谱\n`;

  return prompt;
}

// ── v6.69.0+: 契约先行 Prompt 生成（增强策略一）──
async function buildContractFirstPrompt(iteration: string): Promise<string> {
  const iterDir = await getIterationDir(iteration);
  const globalDir = join(iterDir, '020-specs', GLOBAL_SPECS_DIR);

  let prompt = `\n# 任务: 跨端 API 契约定义（契约先行阶段）\n\n`;
  prompt += `## 背景\n\n`;
  prompt += `Phase 1 全局分析已完成。现在需要在各端开始专属技术方案分析之前，**先定义跨端 API 契约**。\n\n`;
  prompt += `## 读取内容\n\n`;
  prompt += `1. Read .speccore/CONSTITUTION.md → 获取端列表和项目配置\n`;
  prompt += `2. Read 020-specs/global/REQUIREMENT.md → 全局需求规格\n`;
  prompt += `3. Read 020-specs/global/ANALYSIS.md → 全局分析报告\n`;
  prompt += `4. Read 020-specs/global/TECH.md → 整体技术架构\n`;
  prompt += `5. Read 020-specs/global/DEPS.md → 依赖关系（如存在）\n\n`;

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
  prompt += `- 契约文件写入 020-specs/global/API_CONTRACT.yaml（全局共享）\n`;
  prompt += `- 这是各端技术方案分析的**前置输入**，后续各端分析必须遵循此契约\n`;
  prompt += `- 契约应**精确且完整**，避免后续各端分析时出现接口不一致\n\n`;

  return prompt;
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
