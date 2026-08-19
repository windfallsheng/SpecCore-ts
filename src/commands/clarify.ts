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
import { readFile, pathExists } from 'fs-extra';
import { join, basename } from 'path';
import {
  detectProfessionalLevel,
  buildClarifyPrompt,
  parseClarifiedRequirement,
  writeClarifiedDoc,
  assessRequirementDoc,
  buildClarifiedHeader,
} from '../core/requirement-clarifier';

export interface ClarifyOptions {
  input?: string;       // 直接输入的需求描述
  from?: string;        // --from: 从文件读取原始需求
  to?: string;          // --to: 目标迭代（决定写入哪个迭代的 010-requirements/converted/）
  prompt?: boolean;     // --prompt: 输出整理 Prompt 到 stdout
  apply?: string;       // --apply: 接收 AI 整理结果写入文件
  check?: string;       // --check: 检测指定文件的专业度，不整理
  force?: boolean;      // --force: 强制覆盖已有文件
}

export async function clarifyCommand(options: ClarifyOptions): Promise<void> {
  // ── 确定目标迭代 ──
  const iteration = options.to || await getDefaultIteration() || '';
  if (!iteration) {
    logger.error('请指定目标迭代: --to <iteration> 或确保有默认迭代');
    return;
  }
  const iterDir = await getIterationDir(iteration);

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

      const writtenPath = await writeClarifiedDoc(finalContent, iterDir, sourceName);
      spinner.stop('✅ 需求文档已整理并写入');
      logger.info('');
      logger.info(`📄 文件: ${writtenPath.replace(process.cwd() + '/', '')}`);
      logger.info(`📁 位置: ${iteration}/010-requirements/converted/`);
      logger.info('');
      logger.info('下一步:');
      logger.info(`  1. 查看并确认文档内容`);
      logger.info(`  2. 如需调整，手动编辑或重新执行 clarify`);
      logger.info(`  3. 确认无误后: speccore analyze --auto -I ${iteration}`);
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
