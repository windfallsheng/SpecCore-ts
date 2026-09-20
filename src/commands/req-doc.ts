/**
 * req-doc — 需求文档化命令（原 clarify，v8.3.189 改名消除「澄清」歧义）
 *
 * 将用户原始需求描述（口语化/非专业）整理为 PRD 级专业需求文档，
 * 写入 010-requirements/converted/，供 analyze 使用。
 *
 * v6.76.0+
 *
 * 用法:
 *   speccore req-doc "我要加个购物车功能，能加商品、改数量、算总价"
 *   speccore req-doc --from docs/raw-notes.md --to Iteration-001
 *   speccore req-doc --from docs/raw-notes.md --prompt          # 输出 prompt 给 AI
 *   speccore req-doc --apply "<AI 返回的 PRD>" --to Iteration-001
 */
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, getIterationDir } from '../core/context';
import { readFile, pathExists, ensureDir, writeFile } from 'fs-extra';
import { join, basename, relative } from 'path';
import {
  detectProfessionalLevel,
  buildClarifyPrompt,
  parseClarifiedRequirement,
  writeClarifiedDoc,
  assessRequirementDoc,
  buildClarifiedHeader,
  loadFeatureUnits,
  buildUnitClarifyPrompt,
  consolidateClarifiedUnits,
  type ClarifyUnit,
  type ClarifiedUnit,
} from '../core/requirement-clarifier';
import { stageContent, writeWorkspaceOutput, promoteToIteration } from '../core/workspace-manager';
import { dispatchSubagent, type AgentContext } from '../core/agent-adapter';

export interface ReqDocOptions {
  input?: string;       // 直接输入的需求描述
  from?: string;        // --from: 从文件读取原始需求
  to?: string;          // --to: 目标迭代
  prompt?: boolean;     // --prompt: 输出整理 Prompt 到 stdout
  apply?: string;       // --apply: 接收 AI 整理结果写入文件
  check?: string;       // --check: 检测指定文件的专业度，不整理
  force?: boolean;      // --force: 强制覆盖已有文件
  // v8.2.0+: 功能单元聚焦澄清（解决注意力漂移）
  extractUnits?: boolean; // --extract-units: 从原始需求提取功能单元清单
  unit?: string;          // --unit <ID>: 澄清单个功能单元，支持逗号分隔多个（如 M-01,M-03）
  autoUnits?: boolean;    // --auto-units: 自动遍历所有待澄清的功能单元
  consolidate?: boolean;  // --consolidate: 汇总所有单元澄清为统一 PRD
  resumeUnits?: boolean;  // --resume-units: 断点续跑未完成的单元澄清
  // v8.3.0+: 临时工作区模式
  local?: boolean;        // --local: 不绑定迭代，输出到临时工作区
  promote?: string;       // --promote <entryId>: 将工作区内容提升到迭代层
}

export async function reqDocCommand(options: ReqDocOptions): Promise<void> {
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
        logger.info(`   ${relative(process.cwd(), p)}`);
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

  // ── v8.3.191+: 功能单元聚焦澄清模式（切分独立于澄清）──
  // 切分由 doc2spec --split 完成（产出 features/），澄清只读已切分的单元，不再自己切分
  if (options.extractUnits || options.unit || options.consolidate || options.resumeUnits || options.autoUnits) {
    const units = await loadFeatureUnits(iterDir);

    if (options.extractUnits) {
      if (units.length === 0) {
        logger.warn('⚠️ 未找到功能单元，请先切分: speccore doc2spec --split');
        return;
      }
      logger.info(`📋 已切分的功能单元: ${units.length} 个`);
      for (const u of units) {
        logger.info(`   ${u.id}`);
      }
      logger.info('');
      logger.info('📋 下一步: 逐个澄清功能单元');
      logger.info(`   speccore req-doc --to ${iteration} --unit ${units[0].id} --prompt`);
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
        logger.success(`✅ 统一 PRD 已写入: ${relative(process.cwd(), writtenPath)}`);
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

    // 确定目标功能单元集合（--auto-units / --resume-units / --unit 可逗号分隔）
    const goldenDir = join(iterDir, '020-specs', 'requirements');
    let targetUnitIds: string[] = [];

    // --auto-units: 自动遍历所有待澄清单元
    if (options.autoUnits) {
      const pending: ClarifyUnit[] = [];
      for (const u of units) {
        const unitFile = join(goldenDir, `unit-${u.id}.md`);
        if (!await pathExists(unitFile)) pending.push(u);
      }
      if (pending.length === 0) {
        logger.success('🎉 所有功能单元澄清已完成！');
        logger.info('   运行 --consolidate 汇总为统一 PRD');
        return;
      }
      targetUnitIds = pending.map(u => u.id);
      logger.info(`🚀 自动遍历 ${targetUnitIds.length} 个待澄清单元: ${targetUnitIds.join(', ')}`);
    }

    // 断点续跑（--resume-units）
    if (options.resumeUnits) {
      const pending: ClarifyUnit[] = [];
      for (const u of units) {
        const unitFile = join(goldenDir, `unit-${u.id}.md`);
        if (!await pathExists(unitFile)) pending.push(u);
      }
      if (pending.length === 0) {
        logger.success('🎉 所有功能单元澄清已完成！');
        logger.info('   运行 --consolidate 汇总为统一 PRD');
        return;
      }
      targetUnitIds = [pending[0].id];
      logger.info(`🔄 断点续跑: ${pending[0].id} ${pending[0].name}（剩余 ${pending.length} 个）`);
    }

    // 澄清单个/多个单元（--unit M-01,M-03）
    if (options.unit) {
      targetUnitIds = options.unit.split(',').map(s => s.trim()).filter(Boolean);
      const invalid = targetUnitIds.filter(id => !units.some(u => u.id === id));
      if (invalid.length > 0) {
        logger.error(`未找到功能单元: ${invalid.join(', ')}`);
        logger.info(`   可用单元: ${units.map(u => u.id).join(', ')}`);
        return;
      }
    }

    const targetUnits = targetUnitIds
      .map(id => units.find(u => u.id === id))
      .filter((u): u is ClarifyUnit => !!u);

    // 单单元：保持原有行为
    if (targetUnits.length === 1) {
      const targetUnit = targetUnits[0];
      if (options.prompt) {
        // v8.3.191+: 上下文用已切分单元拼接（替代 rawContent，澄清不依赖原始全文切分）
        const allContent = units.map(u => u.content).join('\n\n');
        const prompt = await buildUnitClarifyPrompt(targetUnit, allContent, {
          iteration, sourceFile: sourceName, iterDir, allUnits: units,
        });
        process.stdout.write(prompt);
        process.exitCode = 10;
        return;
      }
      if (options.apply) {
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
      logger.info(`📋 功能单元: ${targetUnit.id} ${targetUnit.name}`);
      logger.info('   使用 --prompt 生成澄清 Prompt，或 --apply 写入澄清结果');
      return;
    }

    // 多单元：逐个输出独立 Prompt（保持每个单元独立上下文）
    if (targetUnits.length > 1) {
      if (options.prompt) {
        const allContent = units.map(u => u.content).join('\n\n');
        const parts: string[] = [];
        parts.push(`# 功能单元批量澄清指令（${targetUnits.length} 个单元）`);
        parts.push('');
        parts.push('> ⚠️ **步骤隔离要求**：每个功能单元独立澄清、独立提交，不要跨单元混合内容。');
        parts.push('> 请**逐个单元**处理：每完成一个单元，立即用对应命令提交该单元结果，再处理下一个。');
        parts.push('');
        for (const u of targetUnits) {
          const p = await buildUnitClarifyPrompt(u, allContent, {
            iteration, sourceFile: sourceName, iterDir, allUnits: units,
          });
          parts.push(`\n\n===== 功能单元 ${u.id}: ${u.name} =====\n`);
          parts.push(p);
          parts.push(`\n> 提交本单元: speccore req-doc --to ${iteration} --unit ${u.id} --apply '[UNIT:${u.id}]...'\n`);
        }
        process.stdout.write(parts.join('\n'));
        process.exitCode = 10;
        return;
      }
      if (options.apply) {
        logger.warn('⚠️ 多单元模式下 --apply 请逐个单元执行（指定单个 --unit）');
        logger.info(`   待澄清单元: ${targetUnits.map(u => u.id).join(', ')}`);
        return;
      }
      logger.info(`📋 已选择 ${targetUnits.length} 个功能单元: ${targetUnits.map(u => u.id).join(', ')}`);
      logger.info('   使用 --prompt 逐个生成澄清 Prompt，或 --auto-units 自动遍历全部待澄清单元');
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

    // v8.3.196+: provider=llm 时用自配 LLM 生成 PRD（复用 --apply 落盘）
    let aiProvider = 'host';
    try {
      const { loadConfigWithMeta } = await import('../core/unified-config');
      const { config } = await loadConfigWithMeta();
      aiProvider = config.settings.ai?.provider || 'host';
    } catch { /* 默认 host */ }

    const tryLlmReqDoc = async (): Promise<boolean> => {
      try {
        const { callLlm, resolveAiProviders } = await import('../core/ask-llm');
        const providers = await resolveAiProviders('req-doc');
        const llmContent = await callLlm(
          '你是产品分析师。请按 prompt 要求将原始需求整理为专业的需求文档（PRD），只输出 Markdown 文档内容，不要输出其他文字。',
          prompt,
          providers,
          8000
        );
        if (llmContent) {
          options.apply = llmContent;
          return true;
        }
      } catch (e: any) {
        logger.debug(`[req-doc] 自配 LLM 生成失败: ${e.message}`);
      }
      return false;
    };

    // llm 优先模式：先用自配 LLM，失败回退宿主
    if (aiProvider === 'llm') {
      if (!(await tryLlmReqDoc())) {
        logger.warn('⚠️ [llm] 自配 LLM 未生成结果，回退宿主模式');
      }
    }

    // v8.3.189+: 非 TTY 下尝试通过 Qoder SDK 直接调度 product-analyst 完成需求文档化
    if (!options.apply && !process.stdout.isTTY) {
      try {
        const agentCtx: AgentContext = {
          subagent: 'product-analyst',
          iteration: iteration || '',
          contextBudget: 10000,
          contextType: 'full',
          cwd: process.cwd(),
        };
        const dispatchResult = await dispatchSubagent(agentCtx, prompt);
        if (dispatchResult && dispatchResult.success) {
          logger.info(`[req-doc] 子 Agent product-analyst SDK 调度成功`);
          process.stdout.write(`\n[SPECCORE_RESULT] 子 Agent product-analyst 通过 Qoder SDK 完成执行\n`);
          if (dispatchResult.filesChanged && dispatchResult.filesChanged.length > 0) {
            process.stdout.write(`📄 文件变更: ${dispatchResult.filesChanged.join(', ')}\n`);
          }
          if (dispatchResult.content) {
            process.stdout.write(`\n--- 执行结果 ---\n${dispatchResult.content.slice(0, 3000)}${dispatchResult.content.length > 3000 ? '\n... (截断)' : ''}\n`);
          }
          process.stdout.write(`\n> 请审查上述结果，确认后执行 speccore req-doc --apply '<PRD内容>' 写入文档\n`);
          process.exitCode = 0;
          return;
        }
        // 宿主 SDK 调度失败（success=false）→ auto 时回退自配 LLM
        if (aiProvider === 'auto') await tryLlmReqDoc();
      } catch (e: any) {
        logger.debug(`[req-doc] SDK 调度尝试失败: ${e.message}`);
        // 宿主异常 → auto 时回退自配 LLM
        if (aiProvider === 'auto') await tryLlmReqDoc();
      }
    }

    // 有自配 LLM 结果则 fall through 到下方 Apply 落盘；否则输出 Prompt
    if (!options.apply) {
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
        logger.info(`   然后执行: speccore req-doc --apply '<PRD内容>' --local`);
      }
      return;
    }
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
        logger.info(`  2. 提升到迭代层: speccore req-doc --promote ${entryId} --to <iteration>`);
      } else {
        const writtenPath = await writeClarifiedDoc(finalContent, iterDir, sourceName);
        spinner.stop('✅ 需求文档已整理并写入');
        logger.info('');
        logger.info(`📄 文件: ${relative(process.cwd(), writtenPath)}`);
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
  logger.info(`   speccore req-doc --from "${sourceName}" --to ${iteration} --prompt`);
  logger.info('');
  logger.info('Step 2: 将 Prompt 发给 AI，获取整理后的 PRD');
  logger.info('');
  logger.info('Step 3: 将 AI 返回的 PRD 写入文件');
  logger.info(`   speccore req-doc --apply '<AI 返回的内容>' --to ${iteration}`);
  logger.info('');
  logger.info('💡 或直接一步完成（如果 AI 在你的环境中）:');
  logger.info(`   speccore req-doc "${rawContent.slice(0, 40)}..." --to ${iteration} --prompt | ai | speccore req-doc --apply - --to ${iteration}`);
}
