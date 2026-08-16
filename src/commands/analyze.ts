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

export interface AnalyzeOptions {
  iteration?: string;
  output?: string;
  auto?: boolean;
  interactive?: boolean;
  task?: string;
  type?: string;   // 任务类型: feature|bugfix|refactor|...
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

    // 【v6.40.2 修复】--auto 不再跳过 AI，而是自动生成 prompt 让宿主 AI 执行专业分析
    logger.info(` Auto 分析: ${iter} (${requirements.length} 个需求文档 → AI 专业分析)`);
    // 设置 prompt 模式，fall through 到下面的 prompt 生成逻辑
    options.prompt = true;
  }

  // ── v6.49.13+: 预创建 020-specs/ 目录结构（CLI 控制目录，AI 只填内容）──
  if (options.prompt) {
    const iterForDirs = options.iteration || await getDefaultIteration();
    if (iterForDirs) {
      await preCreateSpecDirectories(iterForDirs);
    }
  }

  // ── 非 prompt/apply 模式 → 全部转 AI prompt，不再走代码模板分析 ──
  if (!options.prompt && !options.apply) {
    options.prompt = true;
  }

  // ── Prompt 模式 ──
  if (options.prompt) {
    const iter = options.iteration || await getDefaultIteration();
    const prompt = await buildMultiDocPrompt('analyze', { iteration: iter, task: options.task, type: options.type, scope: options.scope, withCode: options.withCode, platform: options.platform, phase: options.phase });
    process.stdout.write(`[SPECCORE_PROMPT]\n${prompt}`);
    process.exitCode = 10;
    return;
  }

  // ── Apply 模式 ──
  // 两层解耦：迭代级分析写 020-specs/，任务级分析只写 Task 目录（不覆盖迭代级基线）
  if (options.apply) {
    if (!options.iteration) { logger.error('--apply 需要 --iteration'); return; }
    const iterDir = await getIterationDir(options.iteration);
    const isTaskLevel = !!options.task;
    let taskDir: string | null = null;
    if (isTaskLevel) {
      const taskId = options.task!.startsWith('Task-') ? options.task! : `Task-${options.task!}`;
      taskDir = await findTaskDir(join(iterDir, '030-tasks'), taskId);
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
        } else {
          // 迭代级：写 020-specs/（全局文档写入 global/ 子目录，v6.41.0+）
          const specDir = join(iterDir, '020-specs');
          await ensureDir(specDir);
          const globalSet = new Set(GLOBAL_SPEC_FILES);
          for (const [filename, content] of Object.entries(docs)) {
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
          logger.success(`✅ ${count} 个 Spec 文档已写入 020-specs/`);
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
    } else {
      // 迭代级：写 020-specs/global/（全局文档，v6.41.0+）
      const specDir = join(iterDir, '020-specs');
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
        const iterDirPath = iterDir;
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
    return;
  }

  // ── 非 prompt/apply 模式 → 自动转为 prompt 模式，所有分析必须经 AI 执行 ──
  if (!options.prompt && !options.apply) {
    options.prompt = true;
  }

  // ── Prompt 模式 ──
  if (options.prompt) {
    const iter = options.iteration || await getDefaultIteration();
    const prompt = await buildMultiDocPrompt('analyze', { iteration: iter, task: options.task, type: options.type, scope: options.scope, withCode: options.withCode, platform: options.platform, phase: options.phase });
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

// ── buildMultiDocPrompt: 多文档协议 ──
async function buildMultiDocPrompt(command: string, ctx: { iteration?: string; task?: string; type?: string; scope?: string; withCode?: boolean; platform?: string; phase?: string }): Promise<string> {
  const iter = ctx.iteration || '当前迭代';
  const task = ctx.task ? ` — ${ctx.task}` : '';
  const taskType = ctx.type || 'feature';
  const now = new Date().toISOString().split('T')[0];
  const isTask = ctx.scope === 'task' || !!ctx.task;
  const isGlobal = ctx.scope === 'global';

  // global 范围: 从源码反推需求 + 生成技术栈配置
  if (isGlobal) {
    let prompt = `\n# 任务: ${command} (全局分析${ctx.withCode ? '+源码' : ''})\n\n`;
    prompt += `## 要求\n`;
    prompt += `1. **先读宪法**: Read .speccore/CONSTITUTION.md，这是项目配置的唯一权威来源。获取:\n`;
    prompt += `   - 「工程」列 → 所有工程名（如 meeting-system, booking-service）\n`;
    prompt += `   - 「源码路径」列 → 各工程的代码目录（用于 Read 源码）\n`;
    prompt += `   - 「## 端列表」章节 → 全局权威端名列表（如 backend/h5/admin）\n`;
    prompt += `   - 每个工程独立分析，文档输出到: .speccore/GLOBAL/platforms/{端名}/\n`;
    prompt += `2. Read .speccore/GLOBAL/ 下所有文档了解跨项目需求\n`;
    if (ctx.withCode) {
      prompt += `3. 从 CONSTITUTION.md 的「源码路径」列读取各工程目录，逐个 Read 源码\n`;
      prompt += `4. **按端和语言分别分析**，先识别每个工程的平台和语言，再针对性提取:\n`;
      prompt += `   > 识别规则: 扫 package.json → Node/Vue/React；扫 pom.xml → Java/SpringBoot；扫 go.mod → Go；扫 requirements.txt → Python\n`;
      prompt += `   > 端分类: admin(Web管理端)、h5(移动H5)、miniapp(小程序)、app(后端服务)、android、ios\n`;
      prompt += `   - TECH_STACK.md: 按端分表列出语言、框架、构建工具、UI库、运行时版本\n`;
      prompt += `   - API_INVENTORY.md: Controller/Route/handler → 完整接口清单（标记所属端和语言）\n`;
      prompt += `   - DATA_MODEL.md: Entity/Schema/Model → 数据模型（Java JPA / Node Sequelize / Go GORM 分别标注）\n`;
      prompt += `   - BUSINESS_RULES.md: validator/middleware/guard → 业务规则（标注实现语言和框架）\n`;
      prompt += `   - CONFIG_MAP.md: .env/yml/json → 环境变量和配置（标记所属端）\n`;
      prompt += `   - ERROR_CODES.md: Exception/enum → 错误码清单（Java/Node/Go 分别列出）\n`;
      prompt += `   - DEPENDENCY_GRAPH.md: import/require → 模块依赖拓扑（按端分图）\n`;
      prompt += `   - CODE_INDEX.md: 各端目录结构、关键文件、语言和框架标注\n`;
      prompt += `5. **知识沉淀（按工程+端区分）**: 从各端源码识别可复用模式，写入 .speccore/PATTERNS/:\n`;
      prompt += `   - 命名规则: **{CONSTITUTION中的工程名}-{端}-{分类}-{模式名}.md**\n`;
      prompt += `   - 工程名从 CONSTITUTION.md 的「工程」列读取\n`;
      prompt += `   - 端从 CONSTITUTION.md 的「## 端列表」章节读取（如: admin/h5/miniapp/backend）\n`;
      prompt += `   - 示例: meeting-system-admin-auth-jwt.md | booking-service-app-data-repo.md | meeting-system-h5-comp-table.md\n`;
      prompt += `   - 后台分类: auth(鉴权)、api(接口设计)、data(数据访问)、error(异常)、log(日志)、util(工具)、arch(架构)\n`;
      prompt += `   - 前端分类: comp(组件)、state(状态管理)、router(路由)、request(请求)、form(表单)、style(样式)、build(构建)\n`;
      prompt += `   - 每个文件含: 工程名/端/分类 + 适用场景 + 核心代码片段 + 注意事项 + 反例\n`;
      prompt += `6. 以上文档输出到 .speccore/GLOBAL/ 和 .speccore/PATTERNS/，使用 Write 工具写入\n`;
    } else {
      prompt += `3. 读取 .speccore/GLOBAL/ 下各项目需求文档，生成跨项目索引和需求目录\n`;
    }
    prompt += `\n## 输出文档 (12 个/工程 + 1 个全局)\n`;
    if (ctx.withCode) {
      prompt += `> 以下文档按端分目录存放: .speccore/GLOBAL/platforms/{端名}/\n`;
      prompt += `> 端名从 CONSTITUTION 的「## 端列表」章节读取（backend/h5/admin 等）\n\n`;
      prompt += `| 文档 | 存放位置 | 从源码提取内容 |\n`;
      prompt += `| :--- | :--- | :--- |\n`;
      prompt += `| TECH_STACK.md | platforms/{端}/ | 语言、框架、构建工具、UI库 |\n`;
      prompt += `| API_INVENTORY.md | platforms/{端}/ | 接口路径、方法、参数、响应、鉴权 |\n`;
      prompt += `| DATA_MODEL.md | platforms/{端}/ | 表结构+字段+关系（后台）+ Store/State（前端） |\n`;
      prompt += `| BUSINESS_RULES.md | platforms/{端}/ | 校验规则+业务约束+状态机 |\n`;
      prompt += `| CONFIG_MAP.md | platforms/{端}/ | 环境变量+开关+密钥（脱敏） |\n`;
      prompt += `| ERROR_CODES.md | platforms/{端}/ | 错误码清单+含义 |\n`;
      prompt += `| DEPENDENCY_GRAPH.md | platforms/{端}/ | 模块依赖拓扑 |\n`;
      prompt += `| CODE_INDEX.md | platforms/{端}/ | 目录结构+关键文件+模块职责 |\n`;
      prompt += `| TEST.md | platforms/{端}/ | 测试计划（用例矩阵+边界+集成） |\n`;
      prompt += `| REVIEW.md | platforms/{端}/ | 评审清单（安全+质量+性能） |\n`;
      prompt += `| RISK.md | platforms/{端}/ | 风险评估（矩阵+缓解+预案） |\n`;
      prompt += `| DEPS.md | platforms/{端}/ | 依赖清单（服务+中间件+库） |\n`;
      prompt += `| MONITOR.md | platforms/{端}/ | 监控方案（指标+告警+追踪） |\n`;
      prompt += `| PATTERNS/*.md | 可复用设计模式，前后端分别提取： | PATTERNS/ |\n`;
      prompt += `  - 后台: 架构(mvc/ddd)、鉴权(jwt/oauth)、API(pagination/restful)、数据(repository)、异常(handler)、日志(aop)\n`;
      prompt += `  - 前端: 组件(composable/hook)、状态管理(pinia/redux)、路由(guard/layout)、请求(interceptor)、表单(validation)、UI(theme/layout)\n`;
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
根据 REQUIREMENT.md 中的功能模块，**逐端**撰写技术方案：
- 整体架构和分层设计（含各端交互关系）
- **后端服务**：每个微服务的模块划分、职责说明、核心接口设计
- **前端各端**：每个前端（如 H5移动端、后台管理端）的页面路由结构、组件拆分方案、状态管理设计
- 数据存储方案（表结构或 DDL）
- 核心业务流程的技术实现路径（跨端时序图）
- 外部依赖和中间件选型建议

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
  ];

  // 任务类型 × 文档矩阵: 每种类型生成哪些文档
  const DOC_MATRIX: Record<string, string[]> = {
    feature:    ['REQUIREMENT.md','ANALYSIS.md','TECH.md','TEST.md','REVIEW.md','RISK.md','DEPS.md','MONITOR.md','UI_SPEC.md'],
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
  const includeDocs = isTask ? (DOC_MATRIX[taskType] || DOC_MATRIX['feature']) : DOC_MATRIX['feature'];

  // ── 两阶段分析：Phase 1 全局文档 / Phase 2 各端专属 ──
  const GLOBAL_DOCS = ['REQUIREMENT.md', 'ANALYSIS.md', 'TECH.md', 'RISK.md', 'DEPS.md', 'REVIEW.md', 'MONITOR.md'];
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

  // Phase 1: TECH.md 模板侧重整体架构
  if (ctx.phase === '1') {
    const techDoc = taskDocs.find(([n]) => n === 'TECH.md');
    if (techDoc) {
      techDoc[1] = `# 技术架构（跨端全局）\n\n> ${iter}\n\n## 写作要求\n撰写整体技术架构，覆盖所有端的交互关系：\n- 系统整体分层设计（各端在架构中的位置）\n- 跨端交互协议（前端↔后端通信方式、数据流向）\n- 中间件选型（缓存、消息队列、网关等）\n- 数据库整体设计（核心表结构、ER 关系）\n- 技术栈选型及理由\n`;
    }
  }
  // Phase 2: TECH.md 模板侧重端专属方案
  if (ctx.phase === '2') {
    const techDoc = taskDocs.find(([n]) => n === 'TECH.md');
    if (techDoc) {
      techDoc[1] = `# 技术方案（端专属）\n\n> ${iter}\n\n## 写作要求\n根据 global/TECH.md 的整体架构，撰写本端专属技术方案：\n- 后端：接口设计（路径/参数/响应）、数据模型、业务逻辑、事务约束\n- Web 管理端：页面路由结构、组件拆分、状态管理、权限控制\n- H5/小程序：页面结构、组件设计、平台 API 适配、性能约束\n\n⚠️ 必须与 global/TECH.md 的整体架构保持一致\n`;
    }
  }

  let prompt = `\n# 任务: ${command}${task} (${taskDocs.length}个文档 · ${isTask ? `类型:${taskType}` : '迭代全量'}${ctx.phase ? ` · Phase ${ctx.phase}` : ''})\n\n`;
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
  }
  // ── 阶段专属指令 ──
  if (ctx.phase === '2') {
    // Phase 2: 读取 Phase 1 产出 → 各端专属文档
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
    prompt += `- **{端}/TEST.md**：该端专属测试计划\n`;
    prompt += `- **{端}/UI_SPEC.md**：该端专属 UI 规格（仅前端端需要）\n\n`;
    prompt += `### Step 3: 一致性检查\n`;
    prompt += `- 各端 TECH.md 的技术选型必须与 global/TECH.md 一致\n`;
    prompt += `- UI_SPEC.md 的字段映射必须与后端 API 响应字段一一对应\n`;
    prompt += `- TEST.md 必须覆盖 REQUIREMENT.md 中该端的验收标准\n\n`;
    prompt += `### 写入方式\n`;
    prompt += `逐端写入，每个端一次 --apply 调用：\n`;
    prompt += `speccore analyze --apply '{"TECH.md":"...","TEST.md":"...","UI_SPEC.md":"..."}' -I ${iter} --platform {端名}\n\n`;
  } else {
    // Phase 1（或默认）: 全局文档 + 端发现
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
    prompt += `2. 读取需求文档（按优先级顺序）：\n`;
    prompt += `   a. 先读 010-requirements/INDEX.md — 了解需求全貌和文件清单\n`;
    prompt += `   b. 再读 010-requirements/converted/*.md — doc2spec 转换后的核心规格（主要依据）\n`;
    prompt += `   c. 再读 010-requirements/features/*/README.md — 功能级补充需求\n`;
    prompt += `   d. 读取 010-requirements/prototypes/ — 原型文件（HTML/图片/链接均读取）\n`;
    prompt += `      ⚠️ 需求文档中链接到原型的（如 \`![原型](../prototypes/xxx.png)\` 或 \`详见 prototypes/xxx.html\`），必须主动 Read 该原型文件\n`;
    prompt += `   e. 如用户指定了特定文档，优先读取指定文件；如要求全部，再读 sources/ 原始文档\n`;
    prompt += `3. 读懂需求文档后，按专业模板标准自由撰写每个文档（不是填空表）\n`;
    prompt += `4. 每个文档都要具体内容（禁止"待填充"）\n`;
    prompt += `5. **端发现（重要）**：先确定项目有哪些端，再按端组织文档\n`;
    prompt += `   - 第 1 步：Read .speccore/CONSTITUTION.md\n`;
    prompt += `   - 第 2 步：从「## 端列表」章节提取端名（这是全局权威来源）\n`;
    prompt += `   - 第 3 步：如果没有「端列表」章节，从「对应端」列提取\n`;
    prompt += `   - 第 4 步：如果以上都无法确定，根据需求文档内容判断\n`;
    prompt += `   - 第 5 步：将发现的端列表写入 020-specs/PLATFORMS.md\n`;
    // 注入工程类型信息（v6.49.0+）
    const platformTypes = await parsePlatformTypes();
    if (platformTypes.size > 0) {
      prompt += `7. **工程类型识别**：CONSTITUTION.md 已配置各端的工程类型，请据此生成针对性内容\n`;
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
    prompt += `6. **目录结构（已预创建，直接用 Write 工具写入）**：\n`;
    prompt += `   - 全局文档 → Write 到 \`020-specs/global/{文件名}\`\n`;
    prompt += `   - 端专属文档 → Write 到 \`020-specs/{端名}/{文件名}\`\n`;
    prompt += `   - 目录已由 CLI 预创建，无需手动创建，直接用 Write 工具写入即可\n`;
    if (ctx.phase !== '1') {
      // 端专业性约束只在默认模式（全量）中输出
      prompt += `\n## ⚠️ 端专业性约束\n`;
      prompt += `CONSTITUTION.md 中配置了多个端，每个端的文档必须有该端专属内容。\n`;
      prompt += `**先识别端类型，再应用对应的专业维度**：\n\n`;
      prompt += `### 后端服务必含内容\n`;
      prompt += `- API 接口定义（路径/方法/参数/响应字段/状态码/错误码）\n`;
      prompt += `- 数据库表结构（字段/类型/索引/约束）\n`;
      prompt += `- 业务规则（含边界条件和异常流）\n`;
      prompt += `- 缓存策略/并发与事务/消息队列（如涉及）\n`;
      prompt += `- 安全：SQL 注入防护/接口鉴权/数据脱敏\n`;
      prompt += `- 性能：QPS 预估/慢查询优化/连接池配置\n\n`;
      prompt += `### Web 管理端（Admin）必含内容\n`;
      prompt += `- 页面路由表 + 组件清单 + 字段→UI 映射\n`;
      prompt += `- 复杂组件：大数据表格/复杂表单联动/树形结构\n`;
      prompt += `- 权限 UI：菜单权限/按钮权限/数据权限\n`;
      prompt += `- 状态枚举（与后端一致）+ 交互设计\n`;
      prompt += `- 安全：XSS 防护/CSRF Token/Token 安全存储\n\n`;
      prompt += `### 移动 H5 必含内容\n`;
      prompt += `- 页面路由表 + 组件清单 + 字段→UI 映射\n`;
      prompt += `- 适配方案：viewport/rem/vw/刘海屏/底部安全区\n`;
      prompt += `- 触摸交互：手势识别/滑动冲突/触摸反馈\n`;
      prompt += `- 首屏性能：骨架屏/资源预加载/关键 CSS\n`;
      prompt += `- 弱网优化：离线缓存/请求合并/图片懒加载\n\n`;
      prompt += `### 小程序必含内容\n`;
      prompt += `- 页面路由表 + 组件清单 + 字段→UI 映射\n`;
      prompt += `- 包体积约束：主包 2MB 限制/分包策略\n`;
      prompt += `- 平台 API 约束：微信/支付宝差异/权限申请\n`;
      prompt += `- 渲染限制：无 DOM 操作/setData 性能优化\n`;
      prompt += `- 导航：页面栈限制(10层)/TabBar/分享扫码\n\n`;
    }
  }
  // 文档与端的对应关系（Phase 2 专属）
  if (ctx.phase === '2') {
    prompt += `### 文档与端的对应关系\n`;
    prompt += `- **TECH.md**：该端专属技术方案，必须对齐 global/TECH.md 的整体架构\n`;
    prompt += `- **TEST.md**：该端专属测试计划，覆盖该端的验收标准\n`;
    prompt += `- **UI_SPEC.md**：该端专属 UI 规格，字段映射必须与后端 API 响应字段一一对应\n`;
    prompt += `- 分析完成后会自动生成 QUALITY_AUDIT.md 质量报告，检查各端内容是否完整\n`;
  } else if (ctx.phase !== '1') {
    // 默认模式（全量）的文档对应关系
    prompt += `### 文档与端的对应关系\n`;
    prompt += `- **global/TECH.md**：整体技术架构（跨端交互、中间件选型、整体分层）\n`;
    prompt += `- **{端}/TECH.md**：该端专属技术方案（后端：接口设计+数据模型；前端：页面结构+组件设计）\n`;
    prompt += `- **TEST.md**：各端分别撰写自己的测试计划\n`;
    prompt += `- **REVIEW.md**：按端分章节 — 后端安全/事务/性能 + 前端兼容/体验/性能\n`;
    prompt += `- **MONITOR.md**：后端指标(QPS/延迟) + 前端指标(FCP/LCP/CLS/JS错误率)\n`;
    prompt += `- **UI_SPEC.md**：按端分章节，字段映射必须与后端 API 响应字段一一对应\n`;
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
      : ['REQUIREMENT.md', 'ANALYSIS.md', 'TECH.md', 'TEST.md', 'REVIEW.md', 'RISK.md', 'DEPS.md', 'MONITOR.md', 'UI_SPEC.md'];
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
  // Phase 2 提示：Phase 1 完成后引导进入 Phase 2
  if (!ctx.phase) {
    prompt += `## ⚡ 两阶段分析流程\n`;
    prompt += `当前为全量模式。推荐分两阶段执行以获得更高质量：\n`;
    prompt += `1. 先执行 Phase 1（全局文档）：speccore analyze --phase 1 -I ${iter}\n`;
    prompt += `2. Phase 1 完成后，执行 Phase 2（各端专属）：speccore analyze --phase 2 -I ${iter}\n`;
    prompt += `Phase 2 会 Read Phase 1 的全局文档作为上下文，确保各端方案与整体架构一致。\n\n`;
  }
  prompt += '\n' + buildAutoModeInstruction('analyze', iter) + '\n';
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
