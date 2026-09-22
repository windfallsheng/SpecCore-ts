/**
 * unitize — 切分需求文档为功能单元（独立能力命令）
 *
 * v8.3.229+: 将「切需求」从 doc2spec --split 选项提升为独立命令，与「拆任务」
 * （taskify）语义对称、命名区分：
 *   - unitize：需求文档 → 功能单元（010-requirements/features/{单元}/，SOURCE.md 切片）
 *   - taskify：功能单元 → 开发任务（030-tasks/Task-xxx/）
 *
 * 输入为 Markdown 需求文档（通常是 doc2spec 转换产物 converted/*.md 或 PRD 的 .md）。
 * docx/pdf 需先经 `speccore doc2spec --file=xxx.docx` 转换后再 unitize。
 */
import { pathExists } from 'fs-extra';
import { basename } from 'path';
import { logger } from '../utils/logger';
import { splitDocumentToUnits } from './doc2spec';
import { detectActiveIteration } from '../core/context';

interface UnitizeOptions {
  file?: string;
  files?: string; // batch: "a.md=平台1,b.md=平台2"
  iter?: string;
  platform?: string;
}

/** 批量参数解析（与 doc2spec --files 同格式："path1.md=平台1,path2.md=平台2"） */
function parseBatch(files: string): [string, string][] {
  const pairs: [string, string][] = [];
  for (const item of files.split(/[,，]/)) {
    const [file, platform] = item.split('=').map(s => s.trim());
    if (file) pairs.push([file, platform || '']);
  }
  return pairs;
}

async function unitizeSingle(file: string, platform: string, iterName: string): Promise<void> {
  if (!(await pathExists(file))) {
    logger.error(`文件不存在: ${file}`);
    return;
  }
  // v8.3.232+: 非 Markdown 直接报错指路（unitize 只切 .md；docx/pdf 需先 doc2spec 转换）
  if (!/\.md$/i.test(file)) {
    logger.error(`unitize 只切分 Markdown: ${basename(file)}`);
    logger.info(`  💡 请先转换: speccore doc2spec --file=${file} --iter=${iterName}`);
    return;
  }
  const iterDir = `Iteration-${iterName.replace(/^Iteration-/, '')}`;
  if (!(await pathExists(iterDir))) {
    logger.error(`迭代目录不存在: ${iterDir}`);
    return;
  }
  logger.info(`\n🔪 切分: ${basename(file)}${platform ? `（端: ${platform}）` : ''}`);
  await splitDocumentToUnits(iterDir, file, platform, basename(file));
}

export async function unitizeCommand(options: UnitizeOptions): Promise<void> {
  // ── 批量模式 ──
  if (options.files) {
    const pairs = parseBatch(options.files);
    if (pairs.length === 0) {
      logger.error('格式错误。用法: --files "a.md=平台1,b.md=平台2"');
      return;
    }
    const iterName = options.iter || (await detectActiveIteration());
    if (!iterName) {
      logger.error('请指定迭代: speccore unitize --files "..." --iter=<迭代>');
      return;
    }
    logger.info(`📦 批量切分 ${pairs.length} 个文档...`);
    for (const [file, platform] of pairs) {
      await unitizeSingle(file, platform, iterName);
    }
    return;
  }

  // ── 单文件模式 ──
  if (!options.file) {
    logger.error('请指定需求文档: speccore unitize --file=<md 路径>（可 --files 批量）');
    logger.info('  💡 docx/pdf 请先转换: speccore doc2spec --file=xxx.docx --iter=<迭代>');
    return;
  }
  const iterName = options.iter || (await detectActiveIteration());
  if (!iterName) {
    logger.error('请指定迭代: speccore unitize --file=<md 路径> --iter=<迭代>');
    return;
  }
  await unitizeSingle(options.file, options.platform || '', iterName);
}
