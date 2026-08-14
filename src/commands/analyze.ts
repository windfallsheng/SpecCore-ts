/**
 * analyze — 统一分析命令
 * 
 * 支持:
 *   - 需求分析: --req docs/a.md docs/b.md
 *   - 代码分析: --src backend/src 20-frontend/src
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
import { runAnalysis, AnalyzeInput, supplementAnalysis, analyzeSingleFeature } from '../core/analyze-engine';
import { readFile, readdir } from 'fs-extra';
import { generateGlobalArtifacts } from '../core/global-artifacts';
import { buildPrompt, formatPrompt } from '../core/prompt-builder';
import { buildAutoModeInstruction } from '../core/questions';
import { resolvePlatform } from '../core/platform-registry';
import { warnIfIndexStale } from '../core/index-guard';

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
}

export async function analyzeCommand(options: AnalyzeOptions): Promise<void> {
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

  // ── --auto 模式: 用分析引擎直接生成报告，不走 AI prompt ──
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

    const input: AnalyzeInput = {
      sources: [],
      requirements,
      scope: (options.scope as any) || 'iteration',
      iteration: iter,
      depth: (options.depth as any) || 'normal',
      readSource: options.noSource ? false : true,
      sourceScope: options.sourceScope,
    };

    logger.info(`🤖 Auto 分析: ${iter} (${requirements.length} 个需求文档)`);
    const result = await runAnalysis(input);
    const analysisPath = join(specDir, 'ANALYSIS.md');
    if (await shouldOverwrite(analysisPath, !!options.interactive)) {
      const backup = await backupWithTimestamp(analysisPath);
      if (backup) {
        backups.push(backup);
        logger.info(`   📦 旧版已备份: ${backup.split('/').pop()}`);
      }
      await writeFile(analysisPath, result.report);
      logger.success(`✅ 分析报告已生成: 020-specs/ANALYSIS.md`);
    } else {
      logger.info(`   ⏭️  用户取消覆盖，跳过写入`);
    }
    if (result.summary) {
      logger.info(`   📊 分析: ${result.summary.filesAnalyzed} 文件, ${result.summary.apisFound} 接口, ${result.summary.issues} 问题, ${result.summary.risks} 风险`);
    }
    printBackupSummary();
    return;
  }

  // ── 非 prompt/apply 模式 → 全部转 AI prompt，不再走代码模板分析 ──
  if (!options.prompt && !options.apply) {
    options.prompt = true;
  }

  // ── Prompt 模式 ──
  if (options.prompt) {
    const iter = options.iteration || await getDefaultIteration();
    const prompt = await buildMultiDocPrompt('analyze', { iteration: iter, task: options.task, type: options.type, scope: options.scope, withCode: options.withCode, platform: options.platform });
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
          // 任务级：写 Task/{platform}/ 或 Task/_shared/
          const targetSubDir = options.platform || '_shared';
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
          // 迭代级：写 020-specs/
          const specDir = join(iterDir, '020-specs');
          await ensureDir(specDir);
          for (const [filename, content] of Object.entries(docs)) {
            const fp = join(specDir, filename);
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
      // 任务级：写 Task/{platform}/ 或 Task/_shared/
      const targetSubDir = options.platform || '_shared';
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
      // 迭代级：写 020-specs/
      const specDir = join(iterDir, '020-specs');
      await ensureDir(specDir);
      const iterAnalysisPath = join(specDir, 'ANALYSIS.md');
      if (await shouldOverwrite(iterAnalysisPath, !!options.interactive)) {
        const iterBackup = await backupWithTimestamp(iterAnalysisPath);
        if (iterBackup) {
          backups.push(iterBackup);
          logger.info(`   📦 旧版已备份: ${iterBackup.split('/').pop()}`);
        }
        await writeFile(iterAnalysisPath, options.apply);
        logger.success(`✅ ANALYSIS.md 已写入 020-specs/`);
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
    return;
  }

  // ── 非 prompt/apply 模式 → 自动转为 prompt 模式，所有分析必须经 AI 执行 ──
  if (!options.prompt && !options.apply) {
    options.prompt = true;
  }

  // ── Prompt 模式 ──
  if (options.prompt) {
    const iter = options.iteration || await getDefaultIteration();
    const prompt = await buildMultiDocPrompt('analyze', { iteration: iter, task: options.task, type: options.type, scope: options.scope, withCode: options.withCode, platform: options.platform });
    process.stdout.write(`[SPECCORE_PROMPT]\n${prompt}`);
    process.exitCode = 10;
    return;
  }
}

/**
 * 迭代创建全套规范文件
 */
async function generateIterationSpecDocs(iteration: string): Promise<void> {
  const iterDir = await getIterationDir(iteration);
  const specDir = join(iterDir, '020-specs');

  const now = new Date().toISOString().split('T')[0];
  const templates: [string, string][] = [
    // ANALYSIS.md 由分析引擎自动生成，此处不覆盖
    ['TECH.md',
      `# 技术方案\n\n> 迭代: ${iteration} | 生成: ${now}\n\n`
      + `## 架构\n\n_待填充_\n\n`
      + `## 数据库设计\n\n| 表名 | 字段 | 索引 | 说明 |\n| :--- | :--- | :--- | :--- |\n| | | | |\n\n`
      + `## API 设计\n\n| 方法 | 路径 | 说明 |\n| :--- | :--- | :--- |\n| | | |\n\n`
      + `## 缓存策略\n\n_待填充_\n`],
    ['TEST.md',
      `# 测试计划\n\n> 迭代: ${iteration} | 生成: ${now}\n\n`
      + `## 单元测试\n\n- [ ] 核心模块覆盖\n\n`
      + `## 集成测试\n\n- [ ] API 端到端\n\n`
      + `## 边界测试\n\n- [ ] 异常参数\n- [ ] 超时重试\n- [ ] 并发冲突\n\n`
      + `## 性能测试\n\n- [ ] 压测方案\n`],
    ['REVIEW.md',
      `# Code Review 清单\n\n> 迭代: ${iteration}\n\n`
      + `## 检查项\n\n- [ ] 参数校验完整性\n- [ ] 幂等性处理\n- [ ] 索引覆盖\n- [ ] 迁移脚本可回滚\n- [ ] 鉴权配置\n- [ ] 日志规范\n`],
    ['RISK.md',
      `# 风险评估\n\n> 迭代: ${iteration} | 生成: ${now}\n\n`
      + `## 风险矩阵\n\n| 风险 | 可能性 | 影响 | 缓解措施 |\n| :--- | :--- | :--- | :--- |\n| | | | |\n\n`
      + `## 回滚方案\n\n1. 触发条件: _待定_\n2. 回滚步骤: _待定_\n`],
    ['DEPS.md',
      `# 依赖清单\n\n> 迭代: ${iteration}\n\n`
      + `## 上游依赖\n\n| 服务 | 版本 | 用途 | SLA |\n| :--- | :--- | :--- | :--- |\n| | | | |\n\n`
      + `## 下游影响\n\n| 消费方 | 接口 | 影响 |\n| :--- | :--- | :--- |\n| | | |\n`],
    ['MONITOR.md',
      `# 监控指标\n\n> 迭代: ${iteration}\n\n`
      + `## 业务指标\n\n| 指标 | 阈值 | 级别 |\n| :--- | :--- | :--- |\n| 成功率 | <99.9% | P1 |\n| P99延迟 | >1000ms | P2 |\n\n`
      + `## 告警规则\n\n| 规则 | 条件 | 通知 |\n| :--- | :--- | :--- |\n| | | |\n`],
  ];

  let created = 0;
  let skipped = 0;
  for (const [filename, content] of templates) {
    const filePath = join(specDir, filename);
    if (!(await pathExists(filePath))) {
      await writeFile(filePath, content);
      created++;
    } else {
      skipped++;
    }
  }

  logger.info(`\n📄 Spec 文档: 新建 ${created} 个, 跳过 ${skipped} 个 (已存在) → ${specDir}/`);
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

  // 补全 TEST.md
  const testPath = join(fullTaskDir, '99-artifacts', 'TEST.md');
  if (await pathExists(testPath)) {
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
        logger.info(`   📄 更新 TEST.md`);
      }
    }
  }

  // 补全 REVIEW.md
  const reviewPath = join(fullTaskDir, '99-artifacts', 'REVIEW.md');
  if (await pathExists(reviewPath)) {
    let reviewContent = await require('fs-extra').readFile(reviewPath, 'utf-8');
    if (!reviewContent.includes('## 本任务专项检查')) {
      const items: string[] = [];
      if (reqContent.includes('POST') || reqContent.includes('创建')) items.push('[ ] 参数校验 + 幂等性处理');
      if (reqContent.includes('数据库') || reqContent.includes('表')) items.push('[ ] 索引覆盖 + 迁移脚本可回滚');
      if (reqContent.includes('权限') || reqContent.includes('RBAC')) items.push('[ ] 鉴权注解/中间件正确配置');
      if (items.length > 0) {
        reviewContent += `\n\n---\n\n## 本任务专项检查\n${items.join('\n')}\n`;
        await writeFile(reviewPath, reviewContent);
        logger.info(`   📄 更新 REVIEW.md`);
      }
    }
  }

  // 创建缺失文件
  const templates: [string, string][] = [
    ['RISK.md', `# 风险评估\n\n> analyze | ${new Date().toISOString().split('T')[0]}\n\n## 风险矩阵\n| 风险 | 可能 | 影响 | 缓解 |\n| :--- | :--- | :--- | :--- |\n| 兼容性 | 中 | 高 | 版本号+测试 |\n\n## 回滚\n1. 触发: 线上错误率 > 1%\n2. 步骤: git revert → 重部署\n`],
    ['DEPS.md', `# 依赖清单\n\n## 上游依赖\n| 服务 | 版本 | 用途 |\n| :--- | :--- | :--- |\n| _待补充_ | — | — |\n`],
    ['MONITOR.md', `# 监控\n\n## 关键指标\n| 指标 | 阈值 | 级别 |\n| :--- | :--- | :--- |\n| 成功率 | <99.9% | P1 |\n| P99延迟 | >1000ms | P2 |\n`],
  ];

  for (const [filename, content] of templates) {
    const fp = join(fullTaskDir, '99-artifacts', filename);
    if (!(await pathExists(fp))) {
      await writeFile(fp, content);
      logger.info(`   📄 创建 99-artifacts/${filename}`);
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

// ── buildMultiDocPrompt: 多文档协议 ──
async function buildMultiDocPrompt(command: string, ctx: { iteration?: string; task?: string; type?: string; scope?: string; withCode?: boolean; platform?: string }): Promise<string> {
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
    prompt += `   - 「对应需求端」列 → admin/h5/miniapp/app/android/ios（决定文档分端维度）\n`;
    prompt += `   - 每个工程独立分析，文档输出到: .speccore/GLOBAL/PROJECTS/{工程名}/\n`;
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
      prompt += `   - ERROR_CODES.md: 扫描 Error/Exception/enum 提取错误码清单和含义\n`;
      prompt += `   - DEPENDENCY_GRAPH.md: 分析模块间 import/require 依赖关系，生成依赖拓扑图\n`;
      prompt += `   - CODE_INDEX.md: 各工程目录结构、关键文件清单、模块职责说明\n`;
      prompt += `5. **知识沉淀（按工程+端区分）**: 从各端源码识别可复用模式，写入 .speccore/PATTERNS/:\n`;
      prompt += `   - 命名规则: **{CONSTITUTION中的工程名}-{端}-{分类}-{模式名}.md**\n`;
      prompt += `   - 工程名从 CONSTITUTION.md 的「工程」列读取\n`;
      prompt += `   - 端从 CONSTITUTION.md 的「对应需求端」列读取，如: admin/h5/miniapp/app/android/web\n`;
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
      prompt += `> 以下文档按工程分目录存放: .speccore/GLOBAL/PROJECTS/{工程名}/\n`;
      prompt += `> 工程名从 CONSTITUTION 的「工程」列读取\n\n`;
      prompt += `| 文档 | 存放位置 | 从源码提取内容 |\n`;
      prompt += `| :--- | :--- | :--- |\n`;
      prompt += `| TECH_STACK.md | PROJECTS/{工程}/ | 语言、框架、构建工具、UI库 |\n`;
      prompt += `| API_INVENTORY.md | PROJECTS/{工程}/ | 接口路径、方法、参数、响应、鉴权 |\n`;
      prompt += `| DATA_MODEL.md | PROJECTS/{工程}/ | 表结构+字段+关系（后台）+ Store/State（前端） |\n`;
      prompt += `| BUSINESS_RULES.md | PROJECTS/{工程}/ | 校验规则+业务约束+状态机 |\n`;
      prompt += `| CONFIG_MAP.md | PROJECTS/{工程}/ | 环境变量+开关+密钥（脱敏） |\n`;
      prompt += `| ERROR_CODES.md | PROJECTS/{工程}/ | 错误码清单+含义 |\n`;
      prompt += `| DEPENDENCY_GRAPH.md | PROJECTS/{工程}/ | 模块依赖拓扑 |\n`;
      prompt += `| CODE_INDEX.md | PROJECTS/{工程}/ | 目录结构+关键文件+模块职责 |\n`;
      prompt += `| TEST.md | PROJECTS/{工程}/ | 测试计划（用例矩阵+边界+集成） |\n`;
      prompt += `| REVIEW.md | PROJECTS/{工程}/ | 评审清单（安全+质量+性能） |\n`;
      prompt += `| RISK.md | PROJECTS/{工程}/ | 风险评估（矩阵+缓解+预案） |\n`;
      prompt += `| DEPS.md | PROJECTS/{工程}/ | 依赖清单（服务+中间件+库） |\n`;
      prompt += `| MONITOR.md | PROJECTS/{工程}/ | 监控方案（指标+告警+追踪） |\n`;
      prompt += `| REQUIREMENT.md | GLOBAL/ (全局1份) | 跨项目需求索引 |\n`;
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
    prompt += `      📄 .speccore/GLOBAL/PROJECTS/xxx/API_INVENTORY.md\n`;
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
从安全、质量、性能三个维度，逐项列出本次需求的评审要点：
- 安全: 每个接口的鉴权需求、数据校验、敏感信息保护
- 质量: 幂等性、事务一致性、错误处理
- 性能: 批量操作风险、缓存策略、查询优化
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
根据需求中的业务功能和规则，定义监控指标：
- 业务指标（如预订成功率、审批超时率）
- 技术指标（如接口响应时间、错误率）
- 告警阈值和级别
`],
  ];

  // 任务类型 × 文档矩阵: 每种类型生成哪些文档
  const DOC_MATRIX: Record<string, string[]> = {
    feature:    ['REQUIREMENT.md','ANALYSIS.md','TECH.md','TEST.md','REVIEW.md','RISK.md','DEPS.md','MONITOR.md'],
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
  const taskDocs = docs.filter(([n]) => includeDocs.includes(n));

  let prompt = `\n# 任务: ${command}${task} (${taskDocs.length}个文档 · ${isTask ? `类型:${taskType}` : '迭代全量'})\n\n`;
  prompt += `## 分析范围说明\n`;
  if (isTask) {
    prompt += `- 当前是**任务级分析**，类型为 \`${taskType}\`，只需产出 ${taskDocs.length} 个文档：${taskDocs.map(([n]) => n).join('、')}\n`;
    prompt += `- bugfix: 聚焦根因分析和修复验证；research: 聚焦技术调研；review: 聚焦代码审查\n`;
    prompt += `- feature/refactor: 全量分析（功能、接口、数据、规则）\n`;
    prompt += `- **双层解耦**：先读 \`020-specs/\` 了解迭代级基线，再读 \`_shared/REQ.md\` 了解本任务已有的需求切片\n`;
    if (ctx.platform) {
      prompt += `- **只分析 ${ctx.platform} 端**：只关注 ${ctx.platform} 端的需求/技术/测试，分析结果写入 \`${ctx.platform}/\` 目录\n`;
      prompt += `- **不要修改**其他端的内容，只写入 \`${ctx.platform}/\` 目录\n`;
    } else {
      prompt += `- 分析结果写入 \`_shared/\`（任务独立），**不覆盖** \`020-specs/\`（迭代基线）\n`;
    }
  } else {
    prompt += `- 当前是**迭代级分析**，需产出全部 7 个文档，覆盖需求→技术→测试→评审→风险→依赖→监控\n`;
  }
  prompt += `\n## 要求\n1. Read .speccore/PATTERNS/TEMPLATES/specs/ 下的专业模板（如目录不存在或为空，用你的专业知识自由撰写，绝不允许产出一行垃圾）\n`;
  const templateMap: Record<string, string> = {
    'ANALYSIS.md': 'ANALYSIS-template.md', 'TECH.md': 'TECH-template.md', 'TEST.md': 'TEST-template.md',
    'REVIEW.md': 'REVIEW-template.md', 'RISK.md': 'RISK-template.md', 'DEPS.md': 'DEPS-template.md', 'MONITOR.md': 'MONITOR-template.md'
  };
  for (const doc of taskDocs) {
    const tpl = templateMap[doc[0]] || '';
    prompt += `   - ${doc[0]} → 参考 ${tpl}\n`;
  }
  prompt += `2. 读取需求文档（按优先级顺序）：\n`;
  prompt += `   a. 先读 010-requirements/INDEX.md — 了解需求全貌和文件清单\n`;
  prompt += `   b. 再读 010-requirements/converted/*.md — doc2spec 转换后的核心规格（主要依据）\n`;
  prompt += `   c. 再读 010-requirements/features/*/README.md — 功能级补充需求\n`;
  prompt += `   d. 参考 010-requirements/assets/prototypes/ 和 designs/ — 原型和设计稿\n`;
  prompt += `   e. 如用户指定了特定文档，优先读取指定文件；如要求全部，再读 sources/ 原始文档\n`;
  prompt += `3. 读懂需求文档后，按专业模板标准自由撰写每个文档（不是填空表）\n`;
  prompt += `4. 每个文档都要具体内容（禁止"待填充"），分析完成后支持交互编辑任意文档的任意章节\n`;
  const taskFlag = isTask && ctx.task ? ` --task ${ctx.task}` : '';
  const platformFlag = ctx.platform ? ` --platform ${ctx.platform}` : '';
  prompt += `5. 写入: speccore analyze --apply '{"${taskDocs.map(([n]) => `${n}:"..."`).join(',')}...}' -I ${iter}${taskFlag}${platformFlag}\n\n`;
  prompt += '\n' + buildAutoModeInstruction('analyze', iter) + '\n';
  for (let i = 0; i < taskDocs.length; i++) {
    prompt += `### ${i+1}/${taskDocs.length}: ${taskDocs[i][0]}\n\`\`\`markdown\n${taskDocs[i][1]}\n\`\`\`\n\n`;
  }
  return prompt;
}
