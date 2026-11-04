/**
 * analyze 模式：--from-code 源码反推需求（两跳 IR→UR）+ 全局技术分析
 * v8.3.359+: 从 analyze.ts 拆分（渐进重构批次 B，逻辑不搬家、行为不变）
 */
import { join } from 'path';
import { pathExists, readdir } from 'fs-extra';
import { logger } from '../../utils/logger';
import { emitAiPrompt, type AnalyzeOptions } from './shared';

export async function analyzeFromCode(options: AnalyzeOptions): Promise<void> {
  // v8.3.367+: QA 环（对齐 recipe-reverse-engineer 五阶段）——
  // --verify 验证环（锚点门禁+完整性基线+code-verifier 剧本）/ --review 语义审查 / --revise 有条件修订
  if (options.verify || options.review || options.revise) {
    const { runReverseVerify, runReverseReview, runReverseRevision } = await import('../../core/reverse-qa');
    // v8.3.379: 按端组织——反推产物落 GLOBAL/requirements/{端}/（REQUIREMENT.md + _ir/ + _qa/），
    // QA 环逐端执行；显式 --out-dir 视为单端目录直接使用。
    const baseDir = options.outDir || join('.speccore', 'GLOBAL', 'requirements');
    const units: string[] = [];
    if (options.outDir) {
      units.push(baseDir);
    } else {
      // 1) 新域：requirements/ 下自包含的端级单元（REQUIREMENT.md + _ir 或 REVERSE_PROMPT.md）
      const children = await readdir(baseDir, { withFileTypes: true }).catch(() => [] as never[]);
      for (const c of children as Array<{ name: string; isDirectory(): boolean }>) {
        if (!c.isDirectory()) continue;
        const d = join(baseDir, c.name);
        const hasReq = await pathExists(join(d, 'REQUIREMENT.md'));
        const hasIr = await pathExists(join(d, '_ir'));
        const hasPrompt = await pathExists(join(d, 'REVERSE_PROMPT.md'));
        if (hasReq && (hasIr || hasPrompt)) units.push(d);
      }
      // 2) 旧域兜底（v8.3.368-378）：GLOBAL/_reverse/ 单目录域，存量项目继续可用
      if (units.length === 0) {
        const reverseDir = join('.speccore', 'GLOBAL', '_reverse');
        if (await pathExists(join(reverseDir, '_ir'))) {
          units.push(reverseDir);
          logger.warn('⚠️  检测到旧域反推产物（GLOBAL/_reverse/），本次继续使用旧域；');
          logger.warn('   建议迁移到 GLOBAL/requirements/{端}/（新域，按端组织，语义更清晰）。');
        }
      }
      // 3) 旧域兜底（v8.3.368 前）：requirements/ 根级直铺（_ir + REVERSE_PROMPT.md）
      if (units.length === 0) {
        const hasIr = await pathExists(join(baseDir, '_ir'));
        const hasPrompt = await pathExists(join(baseDir, 'REVERSE_PROMPT.md'));
        if (hasIr || hasPrompt) {
          units.push(baseDir);
          logger.warn('⚠️  检测到 v8.3.368 前旧域反推产物（GLOBAL/requirements/ 根级直铺），本次继续使用旧域。');
        }
      }
    }
    if (units.length === 0) {
      logger.warn(`未找到反推产物（GLOBAL/requirements/{端}/ 下无 REQUIREMENT.md/_ir），请先运行 speccore global from-source --src <dirs> 完成反推。`);
      return;
    }
    for (const unit of units) {
      const unitLabel = units.length > 1 ? ` [${unit.split('/').pop()}]` : '';
      try {
        if (options.verify) {
          logger.info('');
          logger.info(`🔍 验证环（--verify）${unitLabel}：锚点门禁 + 完整性基线 + code-verifier 剧本`);
          await runReverseVerify(unit);
        }
        if (options.review) {
          logger.info('');
          logger.info(`📖 语义审查（--review）${unitLabel}：document-reviewer 审查剧本`);
          await runReverseReview(unit);
        }
        if (options.revise) {
          await runReverseRevision(unit);
        }
      } catch (e: any) {
        logger.error(`QA 环失败${unitLabel}: ${e?.message || e}`);
      }
    }
    return;
  }
  const { generateGlobalArtifacts, applySemanticContent, buildGlobalDocsPrompt } = await import('../../core/global-artifacts');
  const { reverseRequirementsFromCode } = await import('../../core/reverse-requirement');
  const sources = options.source
    ? options.source.split(',').map(s => s.trim()).filter(Boolean)
    : options.sourceScope
      ? options.sourceScope.split(',').map(s => s.trim()).filter(Boolean)
      : [];

  // v8.3.369: AI 接力闭环 —— 确定性骨架 + _DOCS_PLAYBOOK 剧本 → 宿主 AI 语义回填。
  // --prompt: 生成骨架+剧本后输出接力 Prompt；--apply: 接收语义内容按「标题定位」合并进骨架文档。
  if (options.prompt || options.apply) {
    if (options.prompt) {
      await generateGlobalArtifacts(sources, options.depth || 'normal');
      logger.info('');
      logger.info('📝 技术文档骨架已生成（确定性事实层），接力剧本: .speccore/GLOBAL/_DOCS_PLAYBOOK.md');
      logger.info('   下一步：宿主 AI 读取剧本完成语义抽象，用 --apply 回填占位');
      await emitAiPrompt('GLOBAL', buildGlobalDocsPrompt(), { mode: 'global-docs-relay' });
      process.exitCode = 10;
      return;
    }
    try {
      const result = await applySemanticContent(options.apply!);
      logger.info('');
      logger.info(`✅ 语义回填完成: ${result.filled}/${result.total} 节`);
      if (result.missing.length > 0) {
        logger.warn(`⚠️ 未命中占位（${result.missing.length} 项）:`);
        for (const m of result.missing.slice(0, 10)) logger.warn(`   - ${m}`);
      }
    } catch (e: any) {
      logger.error(`语义回填失败: ${e?.message || e}`);
    }
    return;
  }
  try {
    // 1. 全局技术分析文档（TECH_STACK/CODE_INDEX/ARCHITECTURE/API_INVENTORY/DATA_MODEL/GLOSSARY/按端 OVERVIEW+TECH）
    await generateGlobalArtifacts(sources, options.depth || 'normal');
    // 2. 从源码反推需求（两跳 IR→UR）
    const result = await reverseRequirementsFromCode({
      sources,
      depth: options.depth,
      platforms: options.platform ? options.platform.split(',').map(p => p.trim()).filter(Boolean) : undefined,
      outputDir: options.outDir,
    });
    logger.info('');
    logger.info(`🎯 源码反推需求完成（status: candidate，澄清后才成 Spec）`);
    logger.info(`   🗂️ 按端组织: .speccore/GLOBAL/requirements/{端}/（共 ${result.outputDirs.length} 端）`);
    for (const d of result.outputDirs) {
      logger.info(`      - ${d.replace(process.cwd() + '/', '')}/（REQUIREMENT.md + _ir/ + REVERSE_PROMPT.md）`);
    }
    logger.info(`   🧩 IR 总数: ${result.irCount} 个模块`);
    logger.info('');
    logger.info(`   下一步：让宿主 AI 按各端 REVERSE_PROMPT.md 完成两跳语义抽象，再人工确认功能单元边界。`);

    // v8.3.356+: 需求↔代码联动（requirement-linker 从零接入变为链上消费）——
    // 反推需求落盘后立即与源码图谱建立关联（REQ_CODE_LINK.json），
    // 让「源码→需求」的产物可反向追溯到代码节点。
    try {
      const { linkRequirementsToCode } = await import('../../core/code-graph');
      const link = await linkRequirementsToCode(process.cwd(), undefined);
      logger.info(`   🔗 需求↔代码联动: ${link.totalRequirements} 需求 ↔ ${link.totalLinkedNodes} 节点（覆盖率 ${(link.coverageRatio * 100).toFixed(0)}%）`);
    } catch (linkError: any) {
      logger.warn(`   ⚠️ 需求↔代码联动跳过: ${linkError?.message || linkError}`);
    }
  } catch (e: any) {
    logger.error(`源码反推需求失败: ${e?.message || e}`);
  }
}
