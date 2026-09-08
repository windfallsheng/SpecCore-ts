/**
 * clarify — 需求专业化命令
 *
 * 将用户原始需求描述（口语化/非专业）整理为 PRD 级专业需求文档，
 * 写入 010-requirements/converted/，供 analyze 使用。
 *
 * v6.76.0+
 *
 * 用法:
 *   speccore clarify "我要加个购物车功能，能加商品、改数量、算总价"
 *   speccore clarify --from docs/raw-notes.md --to Iteration-001
 *   speccore clarify --from docs/raw-notes.md --prompt          # 输出 prompt 给 AI
 *   speccore clarify --apply "<AI 返回的 PRD>" --to Iteration-001
 */
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, getIterationDir } from '../core/context';
import { readFile, pathExists, ensureDir, writeFile } from 'fs-extra';
import { join, basename } from 'path';
import {
  detectProfessionalLevel,
  buildClarifyPrompt,
  parseClarifiedRequirement,
  writeClarifiedDoc,
  assessRequirementDoc,
  buildClarifiedHeader,
  extractUnitsFromText,
  buildUnitClarifyPrompt,
  consolidateClarifiedUnits,
  type ClarifyUnit,
  type ClarifiedUnit,
} from '../core/requirement-clarifier';
import { stageContent, writeWorkspaceOutput, promoteToIteration } from '../core/workspace-manager';

export interface ClarifyOptions {
  input?: string;       // 直接输入的需求描述
  from?: string;        // --from: 从文件读取原始需求
  to?: string;          // --to: 目标迭代
  prompt?: boolean;     // --prompt: 输出整理 Prompt 到 stdout
  apply?: string;       // --apply: 接收 AI 整理结果写入文件
  check?: string;       // --check: 检测指定文件的专业度，不整理
  force?: boolean;      // --force: 强制覆盖已有文件
  // v8.2.0+: 功能单元聚焦澄清（解决注意力漂移）
  extractUnits?: boolean; // --extract-units: 从原始需求提取功能单元清单
  unit?: string;          // --unit <ID>: 澄清单个功能单元（如 M-01）
  consolidate?: boolean;  // --consolidate: 汇总所有单元澄清为统一 PRD
  resumeUnits?: boolean;  // --resume-units: 断点续跑未完成的单元澄清
  // v8.3.0+: 临时工作区模式
  local?: boolean;        // --local: 不绑定迭代，输出到临时工作区
  promote?: string;       // --promote <entryId>: 将工作区内容提升到迭代层
}

export async function clarifyCommand(options: ClarifyOptions): Promise<void> {
  // ── v8.3.0+: --promote 模式：将工作区内容提升到迭代层 ──
  if (options.promote) {
    const iteration = options.to || await getDefaultIteration() || '';
    if (!iteration) {
      logger.error('请指定目标迭代: --to <iteration>');
      return;
    }
    const iterDir = await getIterationDir(iteration);
    try {
      const written = await promoteToIteration(process.cwd(), options.promote, iteration, iterDir);
      logger.success(`✅ 已提升到迭代 ${iteration}:`);
      for (const p of written) {
        logger.info(`   ${p.replace(process.cwd() + '/', '')}`);
      }
    } catch (e: any) {
      logger.error(`提升失败: ${e.message}`);
    }
    return;
  }

  // ── 确定目标迭代（--local 模式下不强制要求） ──
  const isLocal = options.local || false;
  const iteration = isLocal ? '' : (options.to || await getDefaultIteration() || '');
  if (!isLocal && !iteration) {
    logger.error('请指定目标迭代: --to <iteration> 或确保有默认迭代');
    logger.info('   或使用 --local 保存到临时工作区（不绑定迭代）');
    return;
  }
  const iterDir = iteration ? await getIterationDir(iteration) : '';

  // ── 获取原始需求内容 ──
  let rawContent = '';
  let sourceName = 'direct-input';

  if (options.from) {
    // 从文件读取
    if (!(await pathExists(options.from))) {
      logger.error(`文件不存在: ${options.from}`);
      return;
    }
    rawContent = await readFile(options.from, 'utf-8');
    sourceName = basename(options.from);
    logger.info(`📄 已读取: ${options.from} (${rawContent.length} 字符)`);
  } else if (options.input) {
    // 直接输入
    rawContent = options.input;
    sourceName = 'cli-input';
  } else if (options.check) {
    // 只检测专业度
    if (!(await pathExists(options.check))) {
      logger.error(`文件不存在: ${options.check}`);
      return;
    }
    const result = await assessRequirementDoc(options.check);
    logger.info('');
    logger.info(`📊 专业度评估: ${result.level.toUpperCase()}`);
    if (result.issues.length > 0) {
      logger.info('📝 发现的问题:');
      for (const issue of result.issues) {
        logger.info(`   • ${issue}`);
      }
    } else {
      logger.info('✅ 文档质量良好');
    }
    return;
  } else {
    logger.error('请提供需求描述: clarify "描述" 或 --from <文件>');
    return;
  }

  // ── v8.2.0+: 功能单元聚焦澄清模式 ──
  if (options.extractUnits || options.unit || options.consolidate || options.resumeUnits) {
    const units = extractUnitsFromText(rawContent);

    if (options.extractUnits) {
      logger.info(`📋 功能单元清单已提取: ${units.length} 个`);
      for (const u of units) {
        logger.info(`   ${u.id}: ${u.name}`);
      }
      logger.info('');
      logger.info('📋 下一步: 逐个澄清功能单元');
      logger.info(`   speccore clarify --from "${sourceName}" --to ${iteration} --unit M-01 --prompt`);
      return;
    }

    // 汇总模式（--consolidate）
    if (options.consolidate) {
      // 从黄金需求目录读取已澄清的单元
      const goldenDir = join(iterDir, '020-specs', 'requirements');
      const clarifiedUnits: ClarifiedUnit[] = [];
      for (const u of units) {
        const unitFile = join(goldenDir, `unit-${u.id}.md`);
        if (await pathExists(unitFile)) {
          const content = await readFile(unitFile, 'utf-8');
          clarifiedUnits.push({ id: u.id, name: u.name, clarifiedContent: content, timestamp: new Date().toISOString() });
        }
      }
      if (clarifiedUnits.length === 0) {
        logger.warn('⚠️ 尚未完成任何单元澄清，请先运行 --unit 模式');
        return;
      }
      const prd = consolidateClarifiedUnits(clarifiedUnits, sourceName);
      if (options.apply) {
        const writtenPath = await writeClarifiedDoc(prd, iterDir, sourceName);
        logger.success(`✅ 统一 PRD 已写入: ${writtenPath.replace(process.cwd() + '/', '')}`);
        return;
      }
      if (options.prompt) {
        process.stdout.write(prd);
        process.exitCode = 10;
        return;
      }
      logger.info(`📋 统一 PRD 已生成（${clarifiedUnits.length}/${units.length} 个单元）`);
      return;
    }

    // 断点续跑（--resume-units）
    let targetUnit: ClarifyUnit | undefined;
    if (options.resumeUnits) {
      const goldenDir = join(iterDir, '020-specs', 'requirements');
      const pending = [];
      for (const u of units) {
        const unitFile = join(goldenDir, `unit-${u.id}.md`);
        if (!await pathExists(unitFile)) pending.push(u);
      }
      if (pending.length === 0) {
        logger.success('🎉 所有功能单元澄清已完成！');
        logger.info('   运行 --consolidate 汇总为统一 PRD');
        return;
      }
      targetUnit = pending[0];
      logger.info(`🔄 断点续跑: ${targetUnit.id} ${targetUnit.name}（剩余 ${pending.length} 个）`);
    }

    // 澄清单个单元（--unit M-01）
    if (options.unit) {
      targetUnit = units.find(u => u.id === options.unit);
      if (!targetUnit) {
        logger.error(`未找到功能单元: ${options.unit}`);
        logger.info(`   可用单元: ${units.map(u => u.id).join(', ')}`);
        return;
      }
    }

    if (targetUnit && options.prompt) {
      const prompt = await buildUnitClarifyPrompt(targetUnit, rawContent, {
        iteration, sourceFile: sourceName, iterDir, allUnits: units,
      });
      process.stdout.write(prompt);
      process.exitCode = 10;
      return;
    }

    if (targetUnit && options.apply) {
      const goldenDir = join(iterDir, '020-specs', 'requirements');
      await ensureDir(goldenDir);
      const unitFile = join(goldenDir, `unit-${targetUnit.id}.md`);
      let finalContent = options.apply;
      // 提取 [UNIT:xxx] 标记中的内容
      const markerMatch = finalContent.match(/\[UNIT:[^\]]+\]([\s\S]*?)(?=\[UNIT:|$)/);
      if (markerMatch) finalContent = markerMatch[1].trim();
      if (!finalContent.startsWith('---')) finalContent = buildClarifiedHeader(`${sourceName}#${targetUnit.id}`) + finalContent;
      await writeFile(unitFile, finalContent);
      logger.success(`✅ 单元澄清已写入: 020-specs/requirements/unit-${targetUnit.id}.md`);
      return;
    }

    if (targetUnit) {
      logger.info(`📋 功能单元: ${targetUnit.id} ${targetUnit.name}`);
      logger.info('   使用 --prompt 生成澄清 Prompt，或 --apply 写入澄清结果');
      return;
    }
  }

  // ── 检测专业度 ──
  const level = detectProfessionalLevel(rawContent);
  logger.info(`📊 专业度检测: ${level.toUpperCase()}`);

  if (level === 'high' && !options.force) {
    logger.info('✅ 文档已足够专业，无需整理');
    logger.info('   如仍要整理，加 --force');
    return;
  }

  // ── Prompt 模式：输出整理 Prompt ──
  if (options.prompt) {
    const prompt = buildClarifyPrompt(rawContent, {
      iteration,
      sourceFile: sourceName,
    });
    process.stdout.write(prompt);
    process.exitCode = 10;

    // v8.3.0+: local 模式下提示闭环命令
    if (isLocal) {
      const entryId = await stageContent(process.cwd(), rawContent, {
        type: 'clarify',
        source: options.from ? 'file' : 'direct',
        sourcePath: options.from,
      });
      logger.info('');
      logger.info('📋 临时工作区条目已创建:');
      logger.info(`   ID: ${entryId}`);
      logger.info('');
      logger.info('下一步:');
      logger.info(`   将 Prompt 发给 AI，获取整理后的 PRD`);
      logger.info(`   然后执行: speccore clarify --apply '<PRD内容>' --local`);
    }
    return;
  }

  // ── Apply 模式：接收 AI 结果写入文件 ──
  if (options.apply) {
    const spinner = new Spinner('正在写入整理后的需求文档...');
    spinner.start();

    try {
      const { content, hasOriginalSection } = parseClarifiedRequirement(options.apply);

      // 如果 AI 没有附加原始输入章节，自动追加
      let finalContent = content;
      if (!hasOriginalSection) {
        finalContent += '\n\n---\n\n## 原始输入\n\n';
        finalContent += '> 以下内容为用户原始需求描述，保留用于溯源:\n\n';
        finalContent += '```\n' + rawContent + '\n```\n';
      }

      // 添加 frontmatter 头部
      finalContent = buildClarifiedHeader(sourceName) + finalContent;

      if (isLocal) {
        // v8.3.0+: 临时工作区模式
        const entryId = await stageContent(process.cwd(), rawContent, {
          type: 'clarify',
          source: options.from ? 'file' : 'direct',
          sourcePath: options.from,
        });
        await writeWorkspaceOutput(process.cwd(), entryId, 'clarify', {
          'PRD.md': finalContent,
        });
        spinner.stop('✅ 需求文档已整理并写入临时工作区');
        logger.info('');
        logger.info(`📄 工作区条目: ${entryId}`);
        logger.info(`📁 位置: .speccore/local/workspace/clarify/${entryId}/`);
        logger.info('');
        logger.info('后续操作:');
        logger.info(`  1. 查看文档内容确认无误`);
        logger.info(`  2. 提升到迭代层: speccore clarify --promote ${entryId} --to <iteration>`);
      } else {
        const writtenPath = await writeClarifiedDoc(finalContent, iterDir, sourceName);
        spinner.stop('✅ 需求文档已整理并写入');
        logger.info('');
        logger.info(`📄 文件: ${writtenPath.replace(process.cwd() + '/', '')}`);
        logger.info(`📁 位置: ${iteration}/020-specs/requirements/（黄金需求目录）`);
        logger.info('');

        // v8.3.65+: 自动刷新知识图谱和 RAG 索引
        try {
          const { refreshKnowledgeGraph } = await import('../core/knowledge-graph');
          await refreshKnowledgeGraph(process.cwd(), iteration);
          logger.info('🧠 知识图谱已刷新');
        } catch {}
        try {
          const { indexDirectoryDocuments } = await import('../core/rag-engine');
          const specsDir = join(iterDir, '020-specs');
          const reqDir = join(iterDir, '010-requirements');
          const dirs: string[] = [];
          if (await pathExists(specsDir)) dirs.push(specsDir);
          if (await pathExists(reqDir)) dirs.push(reqDir);
          if (dirs.length > 0) {
            await indexDirectoryDocuments(process.cwd(), dirs, `${iteration}_iteration_all`, `rag-index-${iteration}.json`);
            logger.info('🔍 迭代 RAG 索引已刷新');
          }
        } catch {}

        logger.info('下一步:');
        logger.info(`  1. 查看并确认文档内容`);
        logger.info(`  2. 如需调整，手动编辑或重新执行 clarify`);
        logger.info(`  3. 确认无误后: speccore analyze --auto -I ${iteration}`);
      }
    } catch (error) {
      spinner.fail(`写入失败: ${error}`);
      throw error;
    }
    return;
  }

  // ── 默认模式：提示用户使用 prompt → AI → apply 流程 ──
  logger.info('');
  logger.info('📝 需求整理流程:');
  logger.info('');
  logger.info('Step 1: 生成整理 Prompt');
  logger.info(`   speccore clarify --from "${sourceName}" --to ${iteration} --prompt`);
  logger.info('');
  logger.info('Step 2: 将 Prompt 发给 AI，获取整理后的 PRD');
  logger.info('');
  logger.info('Step 3: 将 AI 返回的 PRD 写入文件');
  logger.info(`   speccore clarify --apply '<AI 返回的内容>' --to ${iteration}`);
  logger.info('');
  logger.info('💡 或直接一步完成（如果 AI 在你的环境中）:');
  logger.info(`   speccore clarify "${rawContent.slice(0, 40)}..." --to ${iteration} --prompt | ai | speccore clarify --apply - --to ${iteration}`);
}
