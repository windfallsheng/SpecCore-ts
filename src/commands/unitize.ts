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
 *
 * v8.3.303+: 未指定 --file/--files 时默认发现本迭代全部端级需求文档（converted/ 下
 * 匹配端名白名单的 {端名}.md / {端名}requirements.md），逐一切分；REQUIREMENT.md 总纲
 * 与无端文档不参与自动发现。显式指定 --file 时照旧只切点名的。
 */
import { pathExists, readdir } from 'fs-extra';
import { join, basename } from 'path';
import { logger } from '../utils/logger';
import { loadProjectConfig } from '../core/unified-config';
import { splitDocumentToUnits } from './doc2spec';
import { detectActiveIteration } from '../core/context';

interface UnitizeOptions {
  file?: string;
  files?: string; // batch: "a.md=平台1,b.md=平台2"
  iter?: string;
  platform?: string;
  translateEn?: string; // --translate-en: auto(默认) | host | off（单元标题英译）
  translateResponse?: string; // --translate-response: 接收宿主 AI 英译 JSON（配合 host）
  onDuplicate?: string; // --on-duplicate: 同名单元处理 ask(默认) | skip | overwrite | rename | abort
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

/**
 * v8.3.303+: 判定文件名是否为端级需求文档。
 * 新命名 {端名}.md（与源文档同名）；旧命名 {端名}requirements.md（v8.3.223~302，兼容不迁移）。
 * 总纲 REQUIREMENT.md、无端文档（如 PRD 全量）不在此列。
 */
export function matchPlatformDoc(filename: string, platformNames: Set<string>): { matched: boolean; platform?: string } {
  const base = filename.replace(/\.md$/i, '');
  if (!base) return { matched: false };
  if (platformNames.has(base)) return { matched: true, platform: base };
  const legacy = base.replace(/requirements$/i, '');
  if (legacy !== base && platformNames.has(legacy)) return { matched: true, platform: legacy };
  return { matched: false };
}

async function unitizeSingle(file: string, platform: string, iterName: string, translateEn?: string, translateResponse?: string, onDuplicate?: string): Promise<void> {
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
  // v8.3.303+: REQUIREMENT.md 总纲不参与切分（切分以端命名需求文档为准）
  if (/^REQUIREMENT\.md$/i.test(basename(file))) {
    logger.error(`REQUIREMENT.md 是需求总纲，不参与切分: ${basename(file)}`);
    logger.info('  💡 请指定端级需求文档（如 admin-web.md），或直接运行 speccore unitize 自动切分全部端');
    return;
  }
  // v8.3.303+: platform 未显式指定时，从文件名匹配端列表自动识别（{端名}.md 命名免传 --platform）
  if (!platform) {
    const base = basename(file).replace(/\.md$/i, '');
    try {
      const projectConfig = await loadProjectConfig();
      const matched = projectConfig.platforms.find(p => p.name === base || `${p.name}requirements` === base);
      if (matched) platform = matched.name;
    } catch { /* PROJECT.yaml 缺失时保持无端 */ }
  }
  const iterDir = `Iteration-${iterName.replace(/^Iteration-/, '')}`;
  if (!(await pathExists(iterDir))) {
    logger.error(`迭代目录不存在: ${iterDir}`);
    return;
  }
  logger.info(`\n🔪 切分: ${basename(file)}${platform ? `（端: ${platform}）` : ''}`);
  await splitDocumentToUnits(iterDir, file, platform, basename(file), translateEn, translateResponse, onDuplicate);
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
      await unitizeSingle(file, platform, iterName, options.translateEn, options.translateResponse, options.onDuplicate);
    }
    return;
  }

  // ── 默认发现模式（v8.3.303+）：未指定 --file/--files 时，自动切分本迭代全部端级需求文档 ──
  if (!options.file) {
    const iterName = options.iter || (await detectActiveIteration());
    if (!iterName) {
      logger.error('请指定迭代: speccore unitize --iter=<迭代>');
      return;
    }
    const iterDir = `Iteration-${iterName.replace(/^Iteration-/, '')}`;
    const convDir = join(iterDir, '010-requirements', 'converted');
    if (!(await pathExists(convDir))) {
      logger.error(`需求目录不存在: ${convDir}`);
      logger.info('  💡 请先转换需求文档: speccore doc2spec --file=xxx.docx --iter=' + iterName);
      return;
    }
    // 端名白名单（PROJECT.yaml platforms）——总纲/无端文档等不在列，天然排除
    let platformNames = new Set<string>();
    try {
      const projectConfig = await loadProjectConfig();
      platformNames = new Set(projectConfig.platforms.map(p => p.name));
    } catch { /* PROJECT.yaml 缺失时白名单为空，走下方报错指路 */ }

    const allFiles = (await readdir(convDir)).filter(f => f.endsWith('.md'));
    const platformFiles: { file: string; platform: string }[] = [];
    for (const f of allFiles) {
      const hit = matchPlatformDoc(f, platformNames);
      if (hit.matched && hit.platform) platformFiles.push({ file: f, platform: hit.platform });
    }
    if (platformFiles.length === 0) {
      logger.error('converted/ 中没有匹配端名的需求文档');
      logger.info('  💡 端文档命名: {端名}.md（如 admin-web.md），端名须在 .speccore/PROJECT.yaml platforms 中');
      logger.info('     也可显式指定: speccore unitize --file=<md 路径>');
      return;
    }
    logger.info(`🔎 自动发现 ${platformFiles.length} 份端级需求文档:`);
    for (const { file } of platformFiles) {
      logger.info(`   · ${file}`);
    }
    const skipped = allFiles.filter(f => !platformFiles.some(p => p.file === f));
    if (skipped.length > 0) {
      logger.info('⏭️  以下文档非端命名需求，未自动切分（总纲/无端文档可 --file 显式切分）:');
      for (const f of skipped) {
        logger.info(`   · ${f}`);
      }
    }
    for (const { file, platform } of platformFiles) {
      await unitizeSingle(join(convDir, file), platform, iterName, options.translateEn, options.translateResponse, options.onDuplicate);
    }
    return;
  }

  // ── 单文件模式（显式指定，绝不越界）──
  const iterName = options.iter || (await detectActiveIteration());
  if (!iterName) {
    logger.error('请指定迭代: speccore unitize --file=<md 路径> --iter=<迭代>');
    return;
  }
  await unitizeSingle(options.file, options.platform || '', iterName, options.translateEn, options.translateResponse, options.onDuplicate);
}
