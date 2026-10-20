/**
 * doc2spec — 文档导入 → SpecCore Markdown
 *
 * 将多种格式的 PRD 需求文档转换为 SpecCore 兼容的 Markdown，
 * 自动放入对应迭代的 010-requirements/ 目录。
 *
 * 支持格式: .docx / .doc / .md / .pdf / .html / .pptx / .odt / .ipynb
 * 依赖: pandoc (macOS: brew install pandoc)
 *
 * 图片路径设计:
 *   提取到 → Iteration-xxx/010-requirements/assets/extracted/
 *   Task 引用 → 由 pandoc --extract-media 自动修正相对路径
 *   这样所有 Task 共享同一份原型图，不需要重复存放。
 *
 * 依赖: pandoc (macOS: brew install pandoc)
 * 可选: LibreOffice (处理 .doc 格式: brew install libreoffice)
 */
import { logger, Spinner } from '../utils/logger';
import { pinyin } from 'pinyin-pro';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { pathExists, ensureDir, readFile, writeFile, readdir, stat, unlink, copy } from 'fs-extra';
import { join, basename, extname, dirname, resolve, relative } from 'path';
import { existsSync } from 'fs';
import { createInterface } from 'readline';
import { tmpdir } from 'os';
import { backupWithTimestamp, backupDirWithTimestamp, isTimestampBackup } from '../utils/task-utils';
import { imgTagsToMarkdown } from '../utils/markdown-image';
import { nextTaskId } from '../core/global-counters';
import { resolveUnitSourcePath } from '../core/feature-source';
import { detectProfessionalLevel } from '../core/requirement-clarifier';

import { showNextSteps } from '../core/next-steps';
import { validateContent, generateReport } from '../core/doc-validator';
import { buildPrompt, formatPrompt } from '../core/prompt-builder';
import { loadConfig, loadConfigWithMeta, loadProjectConfig } from '../core/unified-config';
import { callLlm, resolveAiProviders, parseTranslationResponse } from '../core/ask-llm';
function findCommand(cmd: string, customPath?: string): string | null {
  // v8.3.70+: 优先使用配置中指定的路径
  if (customPath && customPath.trim()) {
    try { require('fs').accessSync(customPath); return customPath; } catch {}
  }

  try {
    // v8.3.69+: Windows 使用 where 代替 which
    const isWin = process.platform === 'win32';
    const findCmd = isWin ? `where ${cmd}` : `which ${cmd}`;
    const result = execSync(findCmd, { stdio: 'pipe', encoding: 'utf-8' }).trim();
    // where 可能返回多行（每个 PATH 匹配一行），取第一行
    return result.split(/\r?\n/)[0].trim();
  } catch {
    // PATH 找不到时，检查常见安装位置
    const commonPaths: Record<string, string[]> = {
      pandoc: ['/usr/local/bin/pandoc', '/opt/homebrew/bin/pandoc', '/usr/bin/pandoc', 'C:\\Program Files\\Pandoc\\pandoc.exe'],
      libreoffice: ['/Applications/LibreOffice.app/Contents/MacOS/soffice', '/usr/bin/soffice'],
    };
    const paths = commonPaths[cmd] || [];
    for (const p of paths) {
      try { require('fs').accessSync(p); return p; } catch {}
    }
    return null;
  }
}

function parseBatchFiles(files: string): [string, string][] {
  return files.split(',').map(pair => {
    const trimmed = pair.trim();
    if (!trimmed) return null;
    const eq = trimmed.lastIndexOf('=');
    // v8.3.240+: 无 = 的元素视为「无端文档」（端名为空）而非静默丢弃，
    // 否则「4 份输入只导 2 份」的静默丢失难以察觉，成功率提示还会误导用户
    if (eq < 0) return [trimmed, ''] as [string, string];
    return [trimmed.substring(0, eq).trim(), trimmed.substring(eq + 1).trim()] as [string, string];
  }).filter(Boolean) as [string, string][];
}

/**
 * 图片引用路径修正：把 pandoc 写出的图片路径统一转为「相对 MD 文件」的正斜杠路径。
 *
 * 实测 pandoc 行为（gfm writer + --extract-media=DIR）：
 *   <img src="DIR/media/rId9.png" style=... />  —— 相对 cwd 的完整路径（HTML 标签）
 *   ![x](DIR/media/rId9.png)                   —— 同上的 markdown 形态
 *   旧版 pandoc 偶发简写 ![x](media/rId9.png)  —— 相对 MD 文件所在目录
 * 而 MD 文件落在 converted/ 子目录——相对 cwd 的路径从 MD 文件位置解析是错的，
 * 必须剥掉前缀换成「MD 文件 → assets/extracted」的相对路径。
 * Windows 上 join 产出反斜杠，pandoc src 也会带反斜杠（Markdown 转义符，必裂），统一归一化。
 */
export function fixImageRefs(content: string, mdDir: string, imageDir: string): string {
  const relAssets = relative(mdDir, imageDir).replace(/\\/g, '/');
  const mediaPrefix = `${imageDir.replace(/\\/g, '/')}/media/`;
  const fixPath = (raw: string): string => {
    const posix = raw.replace(/\\/g, '/');
    // pandoc 完整路径形态：剥掉相对 cwd 的 imageDir 前缀，换成相对 MD 文件
    if (posix.startsWith(mediaPrefix)) return `${relAssets}/media/${posix.slice(mediaPrefix.length)}`;
    // 简写形态 media/xxx
    if (posix.startsWith('media/')) return `${relAssets}/${posix}`;
    // 外链 / 锚点 / 绝对路径不动
    return posix;
  };
  return content
    .replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/g, (_m, pre: string, path: string, post: string) => pre + fixPath(path) + post)
    .replace(/(!\[[^\]]*\]\()([^)]+)(\))/g, (_m, pre: string, path: string, post: string) => pre + fixPath(path) + post);
}

function detectPlatform(): 'macos' | 'linux' | 'win' {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'win';
  return 'linux';
}

function getInstallCmd(tool: string): string {
  const map: Record<string, Record<string, string>> = {
    pandoc: { macos: 'brew install pandoc', linux: 'sudo apt install pandoc', win: 'winget install Pandoc.Pandoc' },
    libreoffice: { macos: 'brew install libreoffice', linux: 'sudo apt install libreoffice', win: 'winget install LibreOffice.LibreOffice' },
  };
  return map[tool]?.[detectPlatform()] || tool;
}

async function promptUser(question: string, defaultYes = false): Promise<boolean> {
  const suffix = defaultYes ? ' (Y/n) ' : ' (y/N) ';
  try {
    process.stdout.write(question + suffix);
    return new Promise((resolve) => {
      const onData = (data: Buffer) => {
        const answer = data.toString().trim().toLowerCase();
        process.stdin.removeListener('data', onData);
        if (process.stdin.isTTY) process.stdin.pause();
        resolve(answer === 'y' || answer === 'yes' || (defaultYes && answer === ''));
      };
      if (process.stdin.isTTY) {
        process.stdin.resume();
      }
      process.stdin.once('data', onData);
      // Non-TTY fallback: auto-deny
      if (!process.stdin.isTTY) {
        resolve(false);
      }
    });
  } catch {
    return false;
  }
}

export /**
 * 文件扩展名 → pandoc 输入格式映射
 */
const PANDOC_FORMAT_MAP: Record<string, string> = {
  docx: 'docx',
  doc: 'docx',      // .doc 先转 .docx
  md: 'markdown',   // 直接复用
  pdf: 'pdf',       // ← 新增
  html: 'html',
  pptx: 'pptx',
  odt: 'odt',
  ipynb: 'ipynb',
};

/** 需要 pandoc 转换的格式（非 md 也非 doc 特殊处理） */
function needsPandoc(ext: string | undefined): boolean {
  return ext !== undefined && ext !== 'md' && ext !== 'doc' && !!PANDOC_FORMAT_MAP[ext];
}

/** 获取 pandoc 输入格式 */
function getPandocInputFormat(ext: string): string {
  return PANDOC_FORMAT_MAP[ext] || ext;
}

interface Word2SpecOptions {
  file: string;
  iter: string;
  platform?: string;
  task?: string;     // --task: 导入到指定 Task 目录
  files?: string;    // batch: "path1.docx=平台1,path2.docx=平台2"
  ai?: boolean;
  prompt?: boolean;   // --prompt: 输出验证 Prompt 到 stdout
  response?: string;  // --response: 接收 AI 修正后的内容
  classify?: boolean; // --classify: AI 智能分类 → staging/
  split?: boolean;    // --split: 拆分为功能单元 → features/
  translateEn?: string; // --translate-en: auto(默认) | host | off（单元标题英译）
  translateResponse?: string; // --translate-response: 接收宿主 AI 英译 JSON（配合 host）
  onDuplicate?: string; // --on-duplicate: 同名单元处理 ask(默认，TTY 交互三选一) | skip | overwrite | rename | abort
}

export async function doc2specCommand(options: Word2SpecOptions): Promise<void> {
  // ── --classify: AI 智能分类模式 ──
  if (options.classify) {
    await classifySources(options);
    return;
  }

  // ── Excel/CSV Bug 列表导入 ──
  if (options.file && /\.(xlsx|csv|xls)$/i.test(options.file) && options.iter) {
    await importExcelBugList(options.file, options.iter);
    return;
  }

  // ── Prompt 模式: 输出 AI 验证 Prompt ──
  if (options.prompt) {
    if (!options.file) { logger.error('--prompt 需要 --file'); return; }
    const sourceContent = await readFile(options.file, 'utf-8').catch(() => '');
    const prompt = await buildPrompt('analyze', { iteration: options.iter });
    process.stdout.write(formatPrompt(prompt));
    process.exitCode = 10;
    return;
  }
  // ── Response 模式: 接收 AI 修正 ──
  if (options.response && options.iter && options.file) {
    const iterDir = `Iteration-${options.iter}`;
    const targetDir = join(iterDir, '010-requirements', 'converted');
    await ensureDir(targetDir);
    const outFile = join(targetDir, basename(options.file).replace(/\.[^.]+$/, '') + '.md');
    await writeFile(outFile, options.response);
    logger.success(`✅ 已写入: ${outFile}`);
    return;
  }
  // ── 批量模式 ──
  if (options.files) {
    const pairs = parseBatchFiles(options.files);
    if (pairs.length === 0) {
      logger.error('格式错误。用法: --files "path1.docx=平台1,path2.docx=平台2"');
      return;
    }
    logger.info(`📦 批量导入 ${pairs.length} 个文件...\n`);
    let success = 0;
    for (const [file, platform] of pairs) {
      logger.info(`  → ${file} (${platform})`);
      await processSingle({ ...options, file, platform });
      success++;
    }
    logger.info(`\n✅ ${success}/${pairs.length} 个文件导入完成`);
    return;
  }

  // ── 单文件模式 ──
  if (!options.file) {
    logger.error('请指定 Word 文件: speccore doc2spec --file=<路径> 或 --files');
    return;
  }
  await processSingle(options);
}

async function processSingle(options: Word2SpecOptions): Promise<void> {
  if (!options.iter) {
    logger.error('请指定迭代: speccore doc2spec --iter=<迭代>');
    return;
  }

  if (!(await pathExists(options.file))) {
    logger.error(`文件不存在: ${options.file}`);
    return;
  }

  // v8.3.70+: 加载配置，支持自定义工具路径
  const config = await loadConfig();
  const customPandoc = config.tools?.pandoc;
  const customLibreoffice = config.tools?.libreoffice;

  // pandoc 前置检测
  const pandocBin = findCommand('pandoc', customPandoc);
  if (!pandocBin) {
    const installCmd = getInstallCmd('pandoc');
    logger.warn('⚠️  未检测到 pandoc。doc2spec 依赖 pandoc 进行 Word → Markdown 转换。');
    logger.info('');
    logger.info(`   📦 安装命令: ${installCmd}`);
    logger.info('   💡 替代方案: AI 对话中可用 word2md 技能（无需 pandoc）');
    logger.info('   📄 备选方案: 在 Word 中用"另存为" → 选择 .md 格式');
    logger.info('   🔧 自定义路径: 若已安装但不在 PATH 中，可在 .speccore.yml 中配置');
    logger.info('      tools:');
    logger.info('        pandoc: "/path/to/pandoc"');
    logger.info('');

    // 非 TTY（AI 调用）→ 自动尝试安装，失败则报错
    if (!process.stdout.isTTY) {
      logger.info(`🤖 AI 上下文，自动尝试安装 pandoc: ${installCmd}`);
      try {
        execSync(installCmd, { stdio: 'inherit', timeout: 120000 });
        logger.success('pandoc 安装成功！继续转换...\n');
      } catch {
        logger.error('自动安装失败，请在 WorkBuddy 中使用 word2md 技能（无需 pandoc）。');
        return;
      }
    }

    const answer = await promptUser('是否要自动安装 pandoc？(y/N): ');
    if (answer) {
      logger.info(`正在安装 pandoc: ${installCmd}`);
      try {
        execSync(installCmd, { stdio: 'inherit' });
        logger.success('pandoc 安装成功！继续转换...\n');
      } catch {
        logger.error('安装失败。替代方案: Word 另存为 .md, 或在 WorkBuddy 中使用 word2md 技能');
        return;
      }
    } else {
      logger.info('已跳过安装。');
      logger.info('  备选方案: word2md 技能（对话中可用）或 Word 另存为 .md');
      return;
    }
  }

  const spinner = new Spinner('正在转换 Word → Markdown...');
  spinner.start();

  try {
    const iterName = options.iter.replace(/^Iteration-/, '');
    const iterDir = `Iteration-${iterName}`;
    // 目标目录：指定 --task 则放入 Task 目录，否则放入 01-产品需求
    const taskId = options.task ? (options.task.startsWith('Task-') ? options.task : `Task-${options.task}`) : null;
    const baseDir = taskId ? join(iterDir, taskId) : join(iterDir, '010-requirements', 'converted');
    const targetDir = baseDir;
    const imageDir = join(iterDir, '010-requirements', 'assets', 'extracted'); // PRD 提取的图片
    let platform = options.platform || '';
    // v8.3.223+: 输出文件名基于源文件名，修复「多文档导入互相覆盖 requirements.md」的问题
    const sourceBase = sanitizeUnitName(basename(options.file, extname(options.file))) || 'requirements';
    // v8.3.303+: platform 未显式指定时，从源文件名匹配端列表自动识别
    // （源文档按 {端名}.md 命名时免传 --platform，产物与源文档同名）
    if (!platform && sourceBase !== 'requirements') {
      try {
        const projectConfig = await loadProjectConfig();
        const matched = projectConfig.platforms.find(p => p.name === sourceBase);
        if (matched) platform = matched.name;
      } catch { /* PROJECT.yaml 缺失时保持无端文档回退 */ }
    }
    // v8.3.303+: 端文档产物与源文档同名（{端名}.md）；无端文档回退 {源名}-requirements.md
    const outputFilename = platform ? `${platform}.md` : `${sourceBase}-requirements.md`;
    const outputPath = join(targetDir, outputFilename);

    await ensureDir(targetDir);
    await ensureDir(imageDir);

    // ── 保存原始文件到 sources/（只读存档，方便溯源）──
    if (!taskId) {
      try {
        const sourcesDir = join(iterDir, '010-requirements', 'sources');
        await ensureDir(sourcesDir);
        const sourceDestName = basename(options.file);
        const sourceDestPath = join(sourcesDir, sourceDestName);
        if (!(await pathExists(sourceDestPath))) {
          await copy(options.file, sourceDestPath);
          logger.info(`📁 原始文件已存档 → ${sourceDestPath}`);
        }
      } catch {}
    }

    let sourceFile = options.file;
    let cleanupFile: string | null = null;
    const ext = sourceFile.split('.').pop()?.toLowerCase();

    // .md 文件直接复制导入，也需要后处理图片路径
    if (ext === 'md') {
      let converted = await readFile(sourceFile, 'utf-8');
      // 修正图片引用路径（pandoc 完整路径 / 简写 media/ / Windows 反斜杠 统一归一化）
      const mdDir = dirname(outputPath);
      converted = imgTagsToMarkdown(fixImageRefs(converted, mdDir, join(iterDir, '010-requirements', 'assets', 'extracted')));
      await writeFile(outputPath, converted);
      spinner.stop('📝 .md 直接导入');
    } else if (ext === 'doc') {
      // .doc 格式 → LibreOffice 转 .docx
      try {
        const tmpDir = tmpdir();
        const sofficeBin = findCommand('libreoffice', customLibreoffice) || 'soffice';
        execSync(`"${sofficeBin}" --headless --convert-to docx "${sourceFile}" --outdir "${tmpDir}"`, { stdio: 'pipe' });
        const name = basename(sourceFile, '.doc');
        sourceFile = join(tmpDir, `${name}.docx`);
        if (!(await pathExists(sourceFile))) {
          throw new Error('LibreOffice conversion failed');
        }
        cleanupFile = sourceFile;
        spinner.stop('📄 .doc → .docx');
      } catch {
        spinner.fail('需要 LibreOffice 来处理 .doc 格式。请安装: brew install libreoffice');
        return;
      }
    } else if (ext === 'pdf') {
      spinner.stop('📄 PDF 检测到，开始提取...');
    } else if (ext === 'html') {
      spinner.stop('🌐 HTML 检测到，开始转换...');
    } else if (needsPandoc(ext)) {
      spinner.stop(`📄 .${ext} 检测到，开始转换...`);
    }

    // pandoc 转换（除了 .md 之外的所有格式）
    if (ext && ext !== 'md') {
      const inputFormat = getPandocInputFormat(ext);
      try {
        execSync(
          `"${pandocBin}" "${sourceFile}" -f ${inputFormat} -t gfm --wrap=none --extract-media="${imageDir}" -o "${outputPath}"`,
          { stdio: 'pipe', encoding: 'utf-8', env: { ...process.env, LANG: 'zh_CN.UTF-8' } }
        );
        spinner.stop(`✅ 转换完成 → ${outputPath}`);
      } catch (e: any) {
        spinner.fail(`pandoc 转换失败 (${inputFormat}): ${e.message}`);
        if (ext === 'pdf') {
          logger.info('💡 PDF 文本提取有局限——图片/表格/排版会丢失，复杂 PDF 建议先 OCR。');
        }
        return;
      }
    }

    // 清理临时文件
    if (cleanupFile && await pathExists(cleanupFile)) {
      await unlink(cleanupFile);
    }

    // ── 后处理 ──
    let content = await readFile(outputPath, 'utf-8');

    // 1. 标题层级规范化
    // v8.3.223+: 单次替换把 #~##### 全部降一级——修复旧两步替换的层级错乱
    //（旧顺序先 ##→### 再 #→##，原文档的 ### 未降级，会与原 ## 压到同一层级）
    content = content.replace(/^(#{1,5}) /gm, '#$1 ');

    // 2. 空行清理
    content = content.replace(/\n{3,}/g, '\n\n');

    // 3. 图片路径修正：pandoc 写的是相对 cwd 的完整路径（<img src=...>），
    //    从 MD 文件位置解析是错的——统一转为相对 MD 文件的正斜杠路径
    const mdDir = dirname(outputPath);
    content = imgTagsToMarkdown(fixImageRefs(content, mdDir, join(iterDir, '010-requirements', 'assets', 'extracted')));

    // 4. 接口表格检测 + 提示
    const hasInterfaceTable = /\|\s*方法\s*\|/i.test(content) || /\|\s*METHOD\s*\|/i.test(content);
    if (!hasInterfaceTable) {
      content += `\n---\n> ⚠️ Word 自动转换，请在下方补充接口定义表格后运行 speccore execute：\n\n| 方法 | 路径 | 说明 |\n| :--- | :--- | :--- |\n| | | |\n`;
    }

    // 5. 图片引用注释（告知 Task 如何引用这些图）
    // v8.3.75+: 修正 Task 引用路径（从 030-tasks/Task-NNN/00-specs/ 出发需 ../../../）
    content = content.replace(
      /^#/,
      `# ${platform || '通用'}需求\n\n<!-- \n  原型图片路径: 010-requirements/assets/extracted/\n  converted/ 引用方式: ![原型](../assets/extracted/xxx.png)\n  Task 引用方式: ![原型](../../../010-requirements/assets/extracted/xxx.png)\n  所有 Task 共享此目录，无需重复存放。\n-->\n\n#`
    );

    await writeFile(outputPath, content);

    // ── 更新 INDEX.md ──
    const indexPath = join(iterDir, '010-requirements', 'INDEX.md');
    let indexContent = '';
    if (await pathExists(indexPath)) {
      indexContent = await readFile(indexPath, 'utf-8');
    } else {
      indexContent = '# 本期需求文档索引\n\n> doc2spec 自动生成\n\n| 端 | 文件 | 转换时间 | 来源 |\n| :--- | :--- | :--- | :--- |\n';
    }
    const platformLabel = platform || '通用';
    // v8.3.223+: outputFilename 已在转换阶段按源文件名生成，此处直接复用（INDEX 表）
    if (!indexContent.includes(`| ${platformLabel} |`)) {
      const entry = `| ${platformLabel} | ${outputFilename} | ${new Date().toISOString().split('T')[0]} | ${basename(options.file)} |`;
      indexContent += entry + '\n';
    }
    await writeFile(indexPath, indexContent);

    // v8.3.303+: 需求总纲（REQUIREMENT.md）不再由转换自动生成——机械拼盘冒充总纲，
    // 改由用户按需经 synthesize 命令或 AI 生成。此处仅检测多端文档并提示。
    const convDir = join(iterDir, '010-requirements', 'converted');
    if (await pathExists(convDir)) {
      const convFiles = (await readdir(convDir)).filter(f => f.endsWith('.md') && !f.startsWith('REQUIREMENT'));
      if (convFiles.length >= 2) {
        logger.info('');
        logger.info(`📄 已转换 ${convFiles.length} 份需求文档（converted/）`);
        logger.info(`   🧩 如需需求总纲（REQUIREMENT.md），请按需生成:`);
        logger.info(`   speccore synthesize -I ${options.iter || '当前迭代'}`);
        logger.info(`   → 章节原子化 · 去重合并 · 跨端关联 · 冲突标注`);
      }
    }

    // ── 内置质量验证 ──
    const report = await validateContent(content, targetDir, iterDir);
    const reportPath = join(iterDir, '010-requirements', 'VALIDATION.md');
    await writeFile(reportPath, generateReport(report, basename(options.file)));
    const grade = report.score >= 90 ? '🟢' : report.score >= 75 ? '🟡' : '🔴';

    // ── 统计 ──
    const imageCount = (await pathExists(imageDir))
      ? (await readdir(imageDir, { recursive: true })).filter((f: string | Buffer) => 
          typeof f === 'string' && !f.startsWith('.')
        ).length
      : 0;

    spinner.stop('转换完成');
    logger.info('');
    const fileStat = await stat(outputPath);
    logger.success(`输出: ${outputPath} (${fileStat.size} bytes)`);
    logger.info(`图片: ${imageCount} 张 → ${imageDir}/`);
    logger.info(`接口表: ${hasInterfaceTable ? '✅' : '⚠️ 缺失（已追加提示）'}`
    );
    logger.info(`🔍 质量: ${grade} ${report.score}/100 (${report.errors}错误 ${report.warnings}警告)`);
    logger.info(`   详见: ${reportPath}`);
    logger.info('');
    logger.info('📋 下一步:');
    if (options.ai !== false) {
      // ── AI 精炼提示（默认）──
      logger.info('  ⚡ pandoc 快速转换完成（CLI 模式）');
      logger.info(`  🧠 推荐 AI 精炼模式：在 WorkBuddy 中说`);
      logger.info(`     "AI 双路验证 ${sourceFile} → ${iterDir}"`);
      logger.info(`     → AI 直接读原文 + pandoc 交叉对比 = 零数据丢失`);
      logger.info('');
      logger.info('  💡 纯 CLI 快转: speccore doc2spec --no-ai');
    } else {
      // ── 纯 pandoc 模式 ──
      logger.info('  ⚠️ 纯 pandoc 模式（无 AI 精炼）');
      logger.info(`  1. 检查自动转换的标题层级`);
      logger.info(`  2. 补充接口定义表格`);
      logger.info(`  3. speccore iteration taskify`);
      logger.info(`  4. speccore execute --task=Task-001 --force`);
    }

    // ── 功能单元拆分（--split）──
    if (options.split && !taskId) {
      logger.info('');
      logger.info('🔪 开始功能单元拆分...');
      await splitDocumentToUnits(iterDir, outputPath, platformLabel, basename(options.file), options.translateEn, options.translateResponse, options.onDuplicate);
    }
  } catch (error) {
    spinner.fail(`转换失败: ${error}`);
    throw error;
  }
}

/**
 * --classify 模式：扫描 sources/ 下所有文件，AI 智能分类后输出到 staging/
 *
 * 流程:
 *   1. 扫描 010-requirements/sources/ 下所有文件
 *   2. 读取内容（.md/.txt 直接读，其它格式尝试 pandoc 转换）
 *   3. --prompt: 输出分类 Prompt 给 AI
 *   4. --response: 接收 AI 分类结果，写入 staging/
 */
async function classifySources(options: Word2SpecOptions): Promise<void> {
  const iter = options.iter;
  if (!iter) {
    logger.error('请指定迭代: speccore doc2spec --classify -I <迭代>');
    return;
  }
  const iterDir = `Iteration-${iter.replace(/^Iteration-/, '')}`;
  const sourcesDir = join(iterDir, '010-requirements', 'sources');
  const stagingDir = join(iterDir, '010-requirements', 'staging');

  if (!(await pathExists(sourcesDir))) {
    logger.error(`未找到 sources 目录: ${sourcesDir}`);
    logger.info('请先将文件放入该目录，再运行 --classify');
    return;
  }

  // v8.3.70+: 加载配置，支持自定义工具路径
  const config = await loadConfig();
  const customPandoc = config.tools?.pandoc;

  // 扫描 sources/ 下所有文件
  const entries = await readdir(sourcesDir, { withFileTypes: true });
  const sourceFiles = entries.filter(e => e.isFile() && !e.name.startsWith('.'));
  if (sourceFiles.length === 0) {
    logger.warn('sources/ 目录为空，请先放入待分类的文档');
    return;
  }

  // 读取每个文件的内容
  const fileContents: { name: string; content: string }[] = [];
  for (const entry of sourceFiles) {
    const filePath = join(sourcesDir, entry.name);
    const ext = entry.name.split('.').pop()?.toLowerCase();
    let content = '';

    if (ext === 'md' || ext === 'txt' || ext === 'markdown') {
      content = await readFile(filePath, 'utf-8');
    } else if (ext === 'csv') {
      content = await readFile(filePath, 'utf-8');
    } else {
      // 尝试 pandoc 转换
      const pandocBin = findCommand('pandoc', customPandoc);
      if (pandocBin && ext && PANDOC_FORMAT_MAP[ext]) {
        try {
          const tmpOut = join(sourcesDir, `.${entry.name}.tmp.md`);
          execSync(
            `"${pandocBin}" "${filePath}" -f ${PANDOC_FORMAT_MAP[ext]} -t gfm --wrap=none -o "${tmpOut}"`,
            { stdio: 'pipe', encoding: 'utf-8', env: { ...process.env, LANG: 'zh_CN.UTF-8' } }
          );
          content = await readFile(tmpOut, 'utf-8');
          await unlink(tmpOut);
        } catch {
          content = `[无法转换的 ${ext} 格式文件]`;
        }
      } else {
        content = `[不支持的格式: .${ext}]`;
      }
    }

    fileContents.push({ name: entry.name, content: content.slice(0, 5000) });
  }

  // ── --prompt 模式: 输出分类 Prompt ──
  if (options.prompt) {
    let prompt = `# SpecCore 智能分类\n\n`;
    prompt += `> 迭代: ${iter} | 来源: ${sourceFiles.length} 个文件\n\n`;
    prompt += `请仔细阅读每份文档，理解其意图，然后提取需求条目并分类。\n\n`;
    prompt += `## 第一步：理解文档意图\n\n`;
    prompt += `对每个条目，先判断它**实际上在说什么**（nature），再映射到任务类型（type）：\n\n`;
    prompt += `| nature（文档实际意图） | type（映射任务类型） | 示例 |\n`;
    prompt += `|:---|:---|:---|\n`;
    prompt += `| 新功能、功能需求、产品规格 | feature | "用户需要扫码登录" |\n`;
    prompt += `| 缺陷、故障、异常、安全问题 | bugfix | "登录超时页面卡死"、"SQL注入漏洞" |\n`;
    prompt += `| 技术债、架构改进、性能优化 | refactor | "数据库连接池过小"、"模块耦合过高" |\n`;
    prompt += `| 调研、选型、方案对比、可行性分析 | research | "WebSocket vs SSE 对比" |\n`;
    prompt += `| 安全审计、渗透测试、合规检查 | bugfix | "XSS 漏洞报告"、"GDPR 合规差距" |\n`;
    prompt += `| 性能瓶颈、响应慢、资源浪费 | refactor | "首页加载超 3 秒"、"内存泄漏" |\n\n`;
    prompt += `## 第二步：提取并结构化\n\n`;
    prompt += `- 一份文档可能包含多种类型的条目，请分别提取\n`;
    prompt += `- 每个条目应该是独立的需求单元（一个功能/一个 bug/一个重构项/一个调研主题）\n`;
    prompt += `- 为每个条目生成简洁的英文 slug 作为文件名（如 login-timeout, xss-prevention）\n`;
    prompt += `- content 必须包含：原始描述的关键细节、影响范围、验收标准（如原文有）\n\n`;
    prompt += `## 输出格式\n\n`;
    prompt += `请输出 JSON 数组:\n`;
    prompt += '```json\n[\n  {\n';
    prompt += `    "nature": "文档实际意图的简短描述（如：安全漏洞、新功能、性能瓶颈）",\n`;
    prompt += `    "type": "feature|bugfix|refactor|research",\n`;
    prompt += `    "title": "中文标题",\n`;
    prompt += `    "slug": "english-slug",\n`;
    prompt += `    "content": "结构化的 Markdown 内容（包含完整的需求描述、背景、验收标准等）"\n`;
    prompt += `  }\n]\n`;
    prompt += '```\n\n';
    prompt += `## 待分类文档\n\n`;
    for (const fc of fileContents) {
      prompt += `### 📄 ${fc.name}\n\n${fc.content}\n\n---\n\n`;
    }
    process.stdout.write(prompt);
    process.exitCode = 10;
    return;
  }

  // ── --response 模式: 接收 AI 分类结果，写入 staging/ ──
  if (options.response) {
    await ensureDir(stagingDir);
    let items: { type: string; nature?: string; title: string; slug: string; content: string }[];
    try {
      // 尝试解析 JSON（可能被 markdown 代码块包裹）
      const jsonMatch = options.response.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : options.response.trim();
      items = JSON.parse(jsonStr);
    } catch (e: any) {
      logger.error(`AI 返回内容解析失败: ${e.message}`);
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      logger.warn('未提取到任何需求条目');
      return;
    }

    // 类型到目录的映射
    const typeToDir: Record<string, string> = {
      feature: 'features',
      bugfix: 'bugs',
      refactor: 'refactors',
      research: 'research',
    };

    let written = 0;
    for (const item of items) {
      const type = typeToDir[item.type] ? item.type : 'feature';
      const slug = item.slug || item.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '');
      const fileName = `${slug}.md`;
      const filePath = join(stagingDir, fileName);

      // 写入带 frontmatter 的 MD 文件
      const nature = item.nature || '';
      const md = `---\ntype: ${type}\nnature: ${nature}\ntitle: ${item.title}\nsource: sources/\ncreated: ${new Date().toISOString().split('T')[0]}\n---\n\n# ${item.title}\n\n${item.content}\n`;
      await writeFile(filePath, md);
      written++;
      logger.info(`   ✅ [${type}] ${fileName}${nature ? ` — ${nature}` : ''}`);
    }

    logger.success(`\n✅ ${written} 个条目已分类到 staging/`);
    logger.info(`   📂 ${stagingDir}/`);
    logger.info('');
    logger.info('📋 下一步:');
    logger.info(`   speccore analyze -I ${iter}     # 分析 staging/ 中的文档`);
    logger.info(`   # 分析完成后可清理 staging/ 目录`);
    return;
  }

  // ── 无 --prompt/--response: 列出 sources/ 内容并提示 ──
  logger.info(`📂 sources/ 目录包含 ${sourceFiles.length} 个文件:\n`);
  for (const fc of fileContents) {
    const preview = fc.content.slice(0, 80).replace(/\n/g, ' ').trim();
    logger.info(`   📄 ${fc.name} — ${preview}...`);
  }
  logger.info('');
  logger.info('📋 使用 --prompt 让 AI 分类这些文档:');
  logger.info(`   speccore doc2spec --classify --prompt -I ${iter}`);
}

async function importExcelBugList(file: string, iteration: string): Promise<void> {
  const iterDir = `Iteration-${iteration}`;
  const taskDir = join(iterDir, '030-tasks');
  await ensureDir(taskDir);

  const backups: string[] = [];
  let rows: Record<string, string>[] = [];

  if (/\.csv$/i.test(file)) {
    const csv = await readFile(file, 'utf-8');
    const lines = csv.trim().split(/\r?\n/);
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const row: Record<string, string> = {};
      headers.forEach((h, i) => row[h] = vals[i] || '');
      rows.push(row);
    }
  } else {
    // .xlsx/.xls: 解析数据 + 提取图片
    const XLSX = require('xlsx');
    const JSZip = require('jszip');
    const wb = XLSX.readFile(file);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    // 提取 Excel 嵌入图片
    try {
      const buf = await require('fs-extra').readFile(file);
      const zip = await JSZip.loadAsync(buf);
      const imagesDir = join(iterDir, '010-requirements', 'assets', 'extracted');
      
      // 遍历 zip 寻找 xl/media/ 下的图片文件
      const mediaFiles = Object.keys(zip.files).filter(k => k.startsWith('xl/media/'));
      for (const mf of mediaFiles) {
        const imgData = await zip.files[mf].async('nodebuffer');
        const imgName = basename(mf);
        await ensureDir(imagesDir);
        await writeFile(join(imagesDir, imgName), imgData);
      }
      if (mediaFiles.length > 0) {
        logger.info(`   📷 提取 ${mediaFiles.length} 张图片 → ${imagesDir}/`);
      }
    } catch (e: any) {
      // 图片提取非关键，静默降级
    }
  }

  if (rows.length === 0) {
    logger.warn('未找到数据行');
    return;
  }

  // 列名智能检测: 标题/描述/优先级/负责人
  const cols = Object.keys(rows[0]);
  const titleCol = cols.find(c => /标题|title|名称|name|概要|summary/i.test(c)) || cols[0];
  const descCol = cols.find(c => /描述|description|详情|detail|内容|content|bug.*描述/i.test(c)) || '';
  const priorityCol = cols.find(c => /优先级|priority|严重|severity/i.test(c)) || '';
  const ownerCol = cols.find(c => /负责人|owner|assignee|处理人/i.test(c)) || '';

  let created = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const title = String(row[titleCol] || `Bug #${i + 1}`).trim();
    const { id: taskId } = await nextTaskId(title);
    const taskPath = join(taskDir, taskId);
    await ensureDir(taskPath);

    const reqLines = [
      `# ${title}`,
      '',
      `| 属性 | 值 |`,
      `| :--- | :--- |`,
      `| 编号 | ${taskId} |`,
      `| 类型 | bugfix |`,
      `| 迭代 | ${iteration} |`,
    ];
    if (row[priorityCol]) reqLines.push(`| 优先级 | ${row[priorityCol]} |`);
    if (row[ownerCol]) reqLines.push(`| 负责人 | ${row[ownerCol]} |`);
    reqLines.push('');
    reqLines.push('## 问题描述');
    reqLines.push('');
    if (descCol && row[descCol]) {
      reqLines.push(String(row[descCol]));
    } else {
      // 用所有非标题列作为描述
      for (const c of cols) {
        if (c !== titleCol && row[c]) {
          reqLines.push(`**${c}**: ${row[c]}`);
        }
      }
    }
    reqLines.push('');

    const taskReqPath = join(taskPath, 'REQUIREMENT.md');
    const bk = await backupWithTimestamp(taskReqPath);
    if (bk) {
      backups.push(bk);
      logger.info(`   📦 已备份: ${basename(bk)}`);
    }
    await writeFile(taskReqPath, reqLines.join('\n'));
    created++;
  }

  logger.success(`✅ 从 ${basename(file)} 导入 ${created} 个 Bug 任务`);
  logger.info(`   📂 位置: ${taskDir}/`);
  
  // 备份汇总
  if (backups.length > 0) {
    logger.info('');
    logger.info(`📦 备份文件 (${backups.length} 个):`);
    for (const bp of backups) {
      logger.info(`   ${bp}`);
    }
    logger.info('   💡 如不再需要可手动删除');
  }
  
  logger.info('');
  logger.info('💡 推荐下一步:');
  logger.info(`   speccore analyze --prompt -I ${iteration}`);
  logger.info(`   speccore execute --prompt -t Task-001 -I ${iteration}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 功能单元拆分
// ═══════════════════════════════════════════════════════════════════════════════

interface ScannedUnit {
  title: string;
  level: number;
  startLine: number;
  endLine: number;
  sourceSection: string;
  /** v8.3.228+: 单元类型——feature（页面/业务流程）或 global-rule（跨端业务规则） */
  unitType: 'feature' | 'global-rule';
}

type DuplicateAction = 'skip' | 'overwrite' | 'rename' | 'abort';

/**
 * v8.3.275: 同名单元处理——TTY 交互三选一，非 TTY 按 --on-duplicate（默认 skip 保幂等）。
 * 不静默跳过、不静默覆盖：覆盖重建前备份 SOURCE.md，重命名加 -2/-3 后缀。
 */
async function resolveDuplicateAction(
  unitTitle: string,
  unitDirName: string,
  onDuplicate: string | undefined,
  rl: ReturnType<typeof createInterface> | null
): Promise<DuplicateAction> {
  const mode = onDuplicate || 'ask';
  if (['skip', 'overwrite', 'rename', 'abort'].includes(mode)) {
    return mode as DuplicateAction;
  }
  // v8.3.275: stdin+stdout 双 TTY 才算真交互（仅 stdin TTY 的管道环境仍会阻塞等输入）
  if (!process.stdin.isTTY || !process.stdout.isTTY || !rl) {
    logger.warn(`   ⚠️  非交互环境遇同名单元 ${unitDirName}，默认跳过（--on-duplicate overwrite|rename 可改）`);
    return 'skip';
  }
  const answer = await new Promise<string>((resolve) => {
    rl.question(
      `   ❓ 功能单元「${unitTitle}」已存在（${unitDirName}）:\n      [s] 跳过（默认）  [o] 覆盖重建  [r] 重命名加后缀  [a] 全部中止\n      → `,
      (a) => resolve(a.trim().toLowerCase())
    );
  });
  if (answer === 'o' || answer === 'overwrite') return 'overwrite';
  if (answer === 'r' || answer === 'rename') return 'rename';
  if (answer === 'a' || answer === 'abort') return 'abort';
  return 'skip';
}

/**
 * v8.3.278: 读已有单元的显示标题（SOURCE.md 首个 H1，兼容旧 README.md），
 * 用于拼音→英文换名重切时的「标题命中 + 指纹相同」同名检测。
 */
async function readUnitTitle(unitDir: string): Promise<string> {
  try {
    const src = await readFile(await resolveUnitSourcePath(unitDir), 'utf-8');
    // 兼容多级标题（如 `## 1. 站内信通知`）与序号前缀，剥离后与 unit.title 对齐
    const m = src.match(/^#{1,6}\s+(.+)$/m);
    return m ? stripSectionNo(m[1].trim()).trim() : '';
  } catch { return ''; }
}

/**
 * 将转换后的文档拆分为功能单元，写入 features/
 * v8.3.191+: 导出供 run 流水线「切分功能单元」步骤复用（对已转换文档切分，无需 --file）
 */
export async function splitDocumentToUnits(
  iterDir: string,
  outputPath: string,
  platformLabel: string,
  sourceFileName: string,
  translateEn?: string,
  translateResponse?: string,
  onDuplicate?: string,
  titles?: string[]
): Promise<void> {
  const content = await readFile(outputPath, 'utf-8');
  // v8.3.263: 收集同目录其它文档名（端级文档）——总纲文档（如 overview-requirements.md）
  // 的端级汇总章节与端文档切出的单元语义重复（文本层面不相似，Jaccard 拦不住），
  // 需由 AI 切分阶段识别「该章节是端级汇总」并归入 global
  const siblingDocNames: string[] = [];
  try {
    const convertedDir = dirname(outputPath);
    for (const f of await readdir(convertedDir)) {
      if (f.endsWith('.md') && f !== basename(outputPath)) siblingDocNames.push(f);
    }
  } catch { /* 无同级文档不影响切分 */ }
  // v8.3.194+: 优先 AI 语义切分（识别业务功能 + 全局信息），失败回退本地正则切 分（兜底）
  const aiResult = await scanUnitsWithAI(content, siblingDocNames);
  let units: ScannedUnit[];
  let globalSections: string[] = [];
  if (aiResult) {
    units = aiResult.units;
    globalSections = aiResult.globalSections;
  } else {
    units = scanUnits(content);
    // 本地兜底：被过滤掉的非功能章节（产品定位/名词/验收标准等）作为全局上下文
    globalSections = getGlobalSections(content, units);
    // v8.3.263: 本地兜底端级汇总章节过滤——AI 不可用时，章节标题与同级端文档
    // 词元匹配（如「Web管理后台」含 admin-web 的 web 词元）视为端级汇总章节，
    // 移入 globalSections，避免与端文档切出的单元语义重复
    if (siblingDocNames.length > 0) {
      const docTokens = new Set<string>();
      for (const n of siblingDocNames) {
        for (const tok of n.replace(/\.md$/i, '').split(/[^a-z0-9]+/i)) {
          if (tok.length >= 2) docTokens.add(tok.toLowerCase());
        }
      }
      const kept: ScannedUnit[] = [];
      const moved: string[] = [];
      for (const u of units) {
        const title = u.title || '';
        const t = title.toLowerCase();
        const hitToken = [...docTokens].some((tok) => t.includes(tok));
        const hitZh = ((/web|admin/i.test(t) && /管理后台|后台/.test(title)) ||
          (/mobile|h5/i.test(t) && /移动端/.test(title)));
        if ((hitToken || hitZh) && !/通用|规则|标准|总则|业务规则/.test(title)) {
          moved.push(title);
          continue;
        }
        kept.push(u);
      }
      for (const m of moved) {
        if (!globalSections.includes(m)) globalSections.push(m);
      }
      units = kept;
      if (moved.length > 0) {
        logger.info(`   📋 端级汇总章节归入 global（与同级端文档重复，不拆单元）: ${moved.join('、')}`);
      }
    }
  }

  // 无功能单元且无全局信息才跳过（纯总览文档如 PRD 的全局信息仍要归到 overview）
  if (units.length === 0 && globalSections.length === 0) {
    logger.warn('未检测到可拆分的功能单元，跳过拆分');
    return;
  }

  if (units.length > 0) {
    logger.info(`🔍 检测到 ${units.length} 个候选功能单元`);
    for (const u of units) {
      logger.info(`   • ${u.title}`);
    }
  }
  if (globalSections.length > 0) {
    logger.info(`   📋 ${globalSections.length} 个全局信息章节 → overview/（产品定位/名词/验收标准等，不拆分）`);
  }

  const featuresDir = join(iterDir, '010-requirements', 'features');
  await ensureDir(featuresDir);

  // v8.3.223+: 幂等——先收集已存在的功能单元目录，重复运行不再重写覆盖
  // v8.3.277: 排除时间戳备份目录（overwrite 产生的 xxx-20260924083058），
  // 否则备份目录会被当功能单元污染指纹比对与 taskify/analyze 的单元清单
  const existingUnitDirs = new Set<string>();
  try {
    for (const e of await readdir(featuresDir, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.') && !isTimestampBackup(e.name)) existingUnitDirs.add(e.name);
    }
  } catch {}
  // v8.3.226+: 跨文档重复防护——收集已有单元的内容指纹，新切单元内容与已有单元
  // 完全一致时跳过（如 REQUIREMENT.md 与 converted/overview.md 含相同章节，重复切分
  // 会产出 13 对内容一模一样的单元，污染 taskify/execute）
  const existingContentHashes = new Map<string, string>();
  // v8.3.240+: 同时保留原文内容，供近似重复（Jaccard 相似度）比对
  const existingUnitContents = new Map<string, string>();
  for (const dir of existingUnitDirs) {
    try {
      const existing = await readFile(await resolveUnitSourcePath(join(featuresDir, dir)), 'utf-8');
      existingContentHashes.set(dir, contentFingerprint(existing));
      existingUnitContents.set(dir, existing);
    } catch { /* 无需求原文的目录不参与指纹比对 */ }
  }

  // v8.3.240+: 文档级近似重复检测——合并版 REQUIREMENT.md 的「## {端}端需求」
  // 大节内容与端文档全文高度相似，端文档已切过时该大节应跳过，
  // 否则产出「父级聚合单元」，analyze 会对同一需求重复分析
  const docFullContents = new Map<string, string>();
  try {
    const convertedDir = dirname(outputPath);
    for (const f of await readdir(convertedDir)) {
      if (!f.endsWith('.md') || f === basename(outputPath)) continue;
      try {
        docFullContents.set(f, await readFile(join(convertedDir, f), 'utf-8'));
      } catch { /* 读失败跳过 */ }
    }
  } catch {}
  
  // v8.3.334+: 标题过滤——用户指定只切某些标题的章节时，其余功能单元不参与
  // 英译/写盘（不占序号）；globalSections 不受影响，照常归 overview
  if (titles && titles.length > 0) {
    const { kept, dropped, unmatched } = filterUnitsByTitles(units, titles);
    units = kept;
    if (dropped.length > 0) {
      logger.info(`   🎯 标题过滤: 指定 ${titles.length} 个标题，保留 ${kept.length}/${kept.length + dropped.length} 个单元`);
      logger.info(`   ⏭️  跳过 ${dropped.length} 个非指定单元: ${dropped.join('、')}`);
    }
    if (unmatched.length > 0) {
      logger.warn(`   ⚠️  以下标题未在文档中命中（检查名字/编号）: ${unmatched.join('、')}`);
    }
    if (units.length === 0) {
      logger.warn('   ⏹️  标题过滤后无剩余功能单元，仅处理全局章节（如有）');
    }
  }

  let written = 0;
  let skipped = 0;
  // v8.3.272+: 标题英译（循环外批量：LLM 翻译 + 缓存，失败回落拼音）
  // v8.3.273+: host 模式无 LLM 环境 → [SPECCORE_PROMPT] 接力，宿主 AI 经 --translate-response 续跑
  for (const u of units) {
    u.title = stripSectionPrefix(u.title) || u.title;
  }
  const unitNames = translateEn === 'off'
    ? new Map<string, string>()
    : await translateUnitTitles(units.map(u => u.title), featuresDir, translateEn || 'auto', translateResponse);
  if (unitNames === null) {
    // 接力中断：已输出 [SPECCORE_PROMPT] 且 exitCode 置 10，等待宿主 AI 翻译后 --translate-response 续跑
    return;
  }
  const seenUnitDirs = new Set<string>(existingUnitDirs);
  // v8.3.275: 同名单元处理三选一（TTY 交互 / --on-duplicate），懒创建 readline
  let rl: ReturnType<typeof createInterface> | null = null;
  for (let unitIndex = 0; unitIndex < units.length; unitIndex++) {
    const unit = units[unitIndex];
    // v8.3.277: docSlug 避开全局保留词（overview/global）——
    // converted/ 下常见 overview.md 这类文件名，直接作前缀会让全部单元目录名
    // 以 overview- 开头，被下方「全局章节拦截」误杀
    let docSlug = sanitizeUnitName(basename(sourceFileName, '.md')) || 'doc';
    docSlug = docSlug.replace(/^(overview|global)(-|$)/i, 'doc$2');
    // v8.3.316+: docSlug 统一以字母结尾（如 plan-24 → plan、2026 → doc）——
    // taskify 的 stripUnitSeqPrefix 靠「前段以字母结尾的 -NN- 才是序号段」锚定 seq，
    // 若 docSlug 尾数字残留，plan-24-01-inbox 会被误剥成 01-inbox（序号冒充语义段）
    docSlug = docSlug.replace(/\d+$/, '') || 'doc';
    // v8.3.227+: 目录名加两位序号前缀（按文档内章节顺序），
    // 保证文件系统排序 == 文档顺序，解决切分目录乱序问题
    // v8.3.318: 序号回到文档章节序号（unitIndex+1）——v8.3.240 的 written+1 方案
    // 在增量重切时错乱：已有 01/02/03 被 skip 后，新章节（第 4 章）written=0 拿 01，
    // 与 01-inbox 序号撞车且破坏「排序==文档顺序」；章节序号幂等稳定，重切不变
    const seq = String(unitIndex + 1).padStart(2, '0');
    // v8.3.271+: 目录名尾段用英文 slug（v8.3.272+ 优先 LLM 英译，失败拼音兜底）；
    // 中文显示名保留在 SOURCE.md 标题与 _matrix.md feature 字段
    // v8.3.282: slug 剥离括号注释——「通知触发机制（跨页面通用）」只取「通知触发机制」主体，
    // 避免「kuayemiantongyong」这类说明性后缀污染目录名（单元内容不受影响）
    const slugSource = stripParenthetical(unitNames.get(unit.title) || unit.title);
    let unitDirName = sanitizeUnitName(`${docSlug}-${seq}-${toEnglishSlug(slugSource)}`);
    // v8.3.278: 同名检测两级——目录名命中，或「标题命中 + 内容指纹相同」的换名场景
    // （拼音→英文重切时目录名变了但内容同源，仍应走三选一而非被指纹检测误拦；
    // 标题相同但内容不同的同名章节不命中，避免误伤）
    const unitContent = extractUnitContent(content, unit);
    const fp = contentFingerprint(unitContent);
    let conflictDir = seenUnitDirs.has(unitDirName) ? unitDirName : '';
    if (!conflictDir) {
      for (const d of existingUnitDirs) {
        if (d === unitDirName) continue;
        // v8.3.317: 标题是第一身份（两侧均剥章节序号对齐），命中后再判内容：
        // 指纹相同 → 同名；指纹不同但高度相似（Jaccard>0.6）也视为同名——
        // 重切时 platform 缺失导致「涉及端: admin」元数据行差异（相似度 0.833）
        // 曾被 0.85 阈值漏拦，产出 01/03 两个「系统公告」重复单元
        const titleA = stripSectionNo((await readUnitTitle(join(featuresDir, d)))).trim();
        const titleB = stripSectionNo(unit.title).trim();
        if (titleA !== titleB || !titleA) continue;
        const existing = existingUnitContents.get(d);
        if (existingContentHashes.get(d) === fp || (existing && contentSimilarity(unitContent, existing) > 0.6)) {
          conflictDir = d;
          break;
        }
      }
    }
    // v8.3.223+: 同名/已存在单元三选一（v8.3.275 由静默跳过升级为交互裁决）
    if (conflictDir) {
      if (!rl && process.stdin.isTTY && process.stdout.isTTY) rl = createInterface({ input: process.stdin, output: process.stdout });
      const action = await resolveDuplicateAction(unit.title, conflictDir, onDuplicate, rl);
      if (action === 'abort') {
        logger.warn('   ⏹️  用户中止切分');
        break;
      }
      if (action === 'skip') {
        logger.info(`   ⏭️  ${unit.title} 已存在（同名单元），跳过`);
        skipped++;
        continue;
      }
      if (action === 'overwrite') {
        // 覆盖重建：旧目录整体改名为时间戳备份（保留完整旧内容），再走下方创建流程
        // 同时绕过全部指纹检测——用户已裁决覆盖，不得被其它同名内容单元误拦
        logger.info(`   🔄 ${unit.title} 覆盖重建: ${conflictDir}`);
        const bak = await backupDirWithTimestamp(join(featuresDir, conflictDir)).catch(() => null);
        if (bak) logger.info(`   📦 旧单元已备份: ${bak.split('/').pop()}`);
        existingContentHashes.delete(conflictDir);
        existingUnitContents.delete(conflictDir);
        existingUnitDirs.delete(conflictDir);
        seenUnitDirs.delete(conflictDir);
        (unit as any)._skipDupCheck = true;
        // 继续走下方创建流程
      } else {
        // 重命名：加 -2/-3 递增后缀，保留两个单元（用户已裁决为不同内容）
        let candidate = `${unitDirName}-2`;
        let n = 2;
        while (seenUnitDirs.has(candidate)) candidate = `${unitDirName}-${++n}`;
        unitDirName = candidate;
        // 绕过内容指纹检测（旧目录同内容仍在，不绕过会被「跨文档重复」误拦）
        (unit as any)._skipDupCheck = true;
        logger.info(`   ✏️  ${unit.title} 重命名为 ${unitDirName}`);
      }
    }
    seenUnitDirs.add(unitDirName);

    // v8.3.226+: 跨文档重复章节检测（内容指纹比对，与幂等目录跳过互补）——
    // 必须在目录创建前完成，避免重复单元残留空壳目录
    // v8.3.275: 用户已裁决重命名的单元绕过指纹检测
    const dupEntry = !(unit as any)._skipDupCheck
      ? [...existingContentHashes.entries()].find(([, h]) => h === fp)
      : undefined;
    if (dupEntry) {
      logger.info(`   ⏭️  ${unit.title} 与已有单元 ${dupEntry[0]} 内容重复（跨文档重复章节），跳过`);
      skipped++;
      continue;
    }
    // v8.3.240+: 近似重复检测——与已有单元 Jaccard 相似度 > 0.85 即视为同一需求
    // 被重复切分（标题层级/段落缺失等小差异不会阻止跳过）
    let nearDup: string | null = null;
    if (!(unit as any)._skipDupCheck) {
      for (const [dir, existing] of existingUnitContents) {
        if (contentSimilarity(unitContent, existing) > 0.85) { nearDup = dir; break; }
      }
    }
    if (nearDup) {
      logger.info(`   ⏭️  ${unit.title} 与已有单元 ${nearDup} 内容高度相似（>85%），视为重复切分跳过`);
      skipped++;
      continue;
    }
    // v8.3.240+: 文档级近似重复——候选单元与 converted/ 其他文档全文相似度 > 0.85
    // （典型：合并版 REQUIREMENT.md 的「## admin-web端需求」大节 = 端文档全文），
    // 跳过避免 analyze 重复分析同一需求
    let docDup: string | null = null;
    if (!(unit as any)._skipDupCheck) {
      for (const [docName, full] of docFullContents) {
        if (contentSimilarity(unitContent, full) > 0.85) { docDup = docName; break; }
      }
    }
    if (docDup) {
      logger.info(`   ⏭️  ${unit.title} 与文档 ${docDup} 全文高度相似（>85%，合并版大节），跳过`);
      skipped++;
      continue;
    }
    // v8.3.240+: 兜底——内容极短的「桩章节」（仅标题，如被 H1 倒挂截断的
    // 合并版大节）不构成有效功能单元，跳过避免 analyze 拿到空需求
    const bodyText = unitContent.replace(/^#{1,3}\s+[^\n]*\n?/gm, '').trim();
    if (bodyText.length < 40) {
      logger.info(`   ⏭️  ${unit.title} 内容过短（桩章节，仅 ${bodyText.length}  字），跳过`);
      skipped++;
      continue;
    }
    // v8.3.267: 全局章节兕底——unitize 可能把「核心业务规则（跨端通用）」等
    // 全局信息切成 overview- 前缀目录（违反「全局信息不进 features」规范）。
    // 此类章节应进 010-requirements/overview/GLOBAL_CONTEXT-*.md，
    // 写盘前拦截，防止假单元污染 analyze/taskify 的单元清单
    // v8.3.268: 第五处漏网——「文档名-序号」模式的全局章节（如
    // metting-system-prd-01-核心业务规则跨端通用，源自 PRD「5.3 核心业务规则（跨端通用）」）。
    // overview- 前缀拦不住，需语义检测：标题括号注释为全局修饰词（跨端通用/全局/公共），
    // 且剥括号后是规则/说明/规范等容器词——全局共享章节，应进 GLOBAL_CONTEXT 而非功能单元。
    // 「计费规则」「签到窗口规则」等无括号注释的具体规则不受影响。
    const isRuleLikeGlobal = isGlobalAnnotatedTitle(unit.title || '');
    if (unitDirName.startsWith('overview-') || isRuleLikeGlobal) {
      logger.info(`   ⏭️  ${unit.title} 是全局章节（${unitDirName.startsWith('overview-') ? 'overview- 前缀' : '跨端通用语义'}），跳过切分（应进 GLOBAL_CONTEXT）`);
      skipped++;
      // v8.3.284: 被拦截的全局章节回流 globalSections——此前只 continue，
      // 单元既不进 features 也不进 GLOBAL_CONTEXT，跨端核心规则（如 PRD 5.3
      // 的 R-RM/R-BK/R-FEE 规则表）在迭代产物中凭空消失；
      // 回流后经 findSectionRange 切原文写入 GLOBAL_CONTEXT-*.md
      const gsTitle = (unit.sourceSection || unit.title).trim();
      if (gsTitle && !globalSections.includes(gsTitle)) globalSections.push(gsTitle);
      continue;
    }
    existingContentHashes.set(unitDirName, fp);
    existingUnitContents.set(unitDirName, unitContent);

    const unitDir = join(featuresDir, unitDirName);
    await ensureDir(unitDir);
    await ensureDir(join(unitDir, '.meta'));

    // v8.3.226+: 需求原文切片写 SOURCE.md（语义名，取代 README.md），
    // 读取端经 resolveUnitSourcePath 兼容旧 README.md
    // v8.3.241+: 写入前重写相对引用——原文档在 converted/，单元目录比它深一层，
    // 原文的「../assets/…」「./overview.md」等相对路径在 SOURCE.md 语境下全部失效
    const readmePath = join(unitDir, 'SOURCE.md');
    const rw = rewriteUnitLinks(unitContent, dirname(outputPath), unitDir);
    await writeFile(readmePath, rw.content);
    if (rw.broken.length > 0) {
      logger.warn(`   ⚠️  ${rw.broken.length} 个引用未找到目标文件（保留层级重写，可能断链）: ${rw.broken.slice(0, 5).join(', ')}`);
    }

    // 来源标记
    const sourceMeta = `---\norigin: doc2spec\nsource_file: ${sourceFileName}\nsource_section: "${unit.sourceSection}"\nplatform: ${platformLabel}\ncreated_at: ${new Date().toISOString().split('T')[0]}\nstatus: draft\n---\n`;
    await writeFile(join(unitDir, '.meta', 'source'), sourceMeta);
    
    // 端覆盖矩阵（初始值，后续由 analyze / 用户调整）
    // v8.3.224+: 未指定端时写空数组，由 analyze 的端推断（platform-inference）填充，
    // 不再兜底成 'backend'（非标准端名会以 0.95 置信度被误采信，污染全部分析）
    const platforms = platformLabel
      .split(/[,，;；]/)
      .map(p => p.trim())
      .filter(Boolean);
    // v8.3.302+: 单元级澄清需求度标记——对需求原文切片做专业度检测，
    // analyze auto 模式只对标记 needed 的单元产出 CLARIFY.md（从全局专业度细化为单元级模糊度）
    // v8.3.302+: owners 空声明——analyze 端推断回填 platforms 后推导候选写入 pending，人工拍板 confirmed
    const clarifyLevel = detectProfessionalLevel(unitContent);
    const matrixContent = `# ${unit.title} - 端覆盖矩阵\n\nfeature: ${unit.title}\ntype: ${unit.unitType}\nplatforms:\n${platforms.map(p => `  - ${p}`).join('\n') || '  []'}\nclarify: ${clarifyLevel === 'high' ? 'optional' : 'needed'}\nowners: []\ndependencies: []\napis: []\n`;
    await writeFile(join(unitDir, '_matrix.md'), matrixContent);
    
    // 初始变更记录
    const changelogContent = `# ${unit.title} - 变更履历\n\n## v1 - ${new Date().toISOString().split('T')[0]}\n**类型**: 新增\n**来源**: unitize\n**说明**: 从 ${sourceFileName} 的「${unit.sourceSection}」章节拆分\n`;
    await writeFile(join(unitDir, 'CHANGELOG.md'), changelogContent);

    written++;
    logger.info(`   ✅ ${unit.title} → features/${unitDirName}/`);
  }

  // 更新 features/INDEX.md（v8.3.223+: 增量合并——保留已有条目、追加新条目，
  // 修复重复运行整体重写/丢行的问题）
  // v8.3.240+: 去重键改为「功能单元名 + 来源章节」（前两列，不含端标签列），
  // 修复同一单元跨切分批次（端标签不同）或同文档内同名章节重复追加的问题
  const featuresIndexPath = join(featuresDir, 'INDEX.md');
  let featuresIndex = '# 功能单元索引\n\n> 由 unitize 自动生成\n\n';
  featuresIndex += '| 功能单元 | 来源章节 | 状态 | 涉及端 |\n';
  featuresIndex += '| :--- | :--- | :--- | :--- |\n';
  const seenRows = new Set<string>();
  const preservedRows: string[] = [];
  if (await pathExists(featuresIndexPath)) {
    try {
      const prev = await readFile(featuresIndexPath, 'utf-8');
      for (const line of prev.split('\n')) {
        if (line.startsWith('|') && !line.startsWith('| :') && !line.startsWith('| 功能单元')) {
          const cells = line.split('|').map(c => c.trim());
          const dedupKey = `${cells[1]}|${cells[2]}`;
          if (seenRows.has(dedupKey)) continue;
          // v8.3.282: 清理历史幽灵行——曾被全局章节拦截（v8.3.268+）的单元，
          // 其旧行会永久残留在增量合并的 INDEX 中（如「核心业务规则（跨端通用）」）。
          // 重切时按全局章节语义过滤，不再保留。
          if (isGlobalAnnotatedTitle(cells[1] || '')) continue;
          seenRows.add(dedupKey);
          preservedRows.push(line);
        }
      }
    } catch {}
  }
  if (preservedRows.length > 0) featuresIndex += preservedRows.join('\n') + '\n';
  for (const unit of units) {
    // v8.3.283: 全局章节（目录创建处被拦截的残留单元对象）不再写回 INDEX——
    // 修复 v8.3.282 幽灵行清理不彻底（旧行过滤生效，但 units 残留经本循环复活幽灵行）
    if (isGlobalAnnotatedTitle(unit.title || '')) continue;
    // v8.3.273: 状态列由无意义的英文 draft 改为「待分析」（语义与 Task 状态体系一致；
    // 分析完成后的状态流转由 overview/FUNCTION_MAP 承担，INDEX 仅在切分时初始化）
    const row = `| ${unit.title} | ${unit.sourceSection} | 待分析 | ${platformLabel} |`;
    const cells = row.split('|').map(c => c.trim());
    const dedupKey = `${cells[1]}|${cells[2]}`;
    if (seenRows.has(dedupKey)) continue;
    seenRows.add(dedupKey);
    featuresIndex += row + '\n';
  }
  await writeFile(featuresIndexPath, featuresIndex);

  // v8.3.194+: 全局信息章节（产品定位/名词约定/验收标准等）归到 overview/，不丢弃
  // 按源文档名分文件，避免多文档的全局信息互相覆盖
  if (globalSections.length > 0) {
    const overviewDir = join(iterDir, '010-requirements', 'overview');
    await ensureDir(overviewDir);
    const docSlug = sanitizeUnitName(basename(sourceFileName, '.md') || 'context');
    let globalContent = `# 项目全局上下文 — ${sourceFileName}\n\n> 由 unitize 自动整理（非功能内容：产品定位/名词约定/非功能需求/验收标准汇总等）\n> 来源: ${sourceFileName}\n> 生成时间: ${new Date().toISOString().split('T')[0]}\n\n`;
    let collected = 0;
    for (const gs of globalSections) {
      const range = findSectionRange(content, gs);
      if (!range) continue;
      const sectionContent = content.split('\n').slice(range.start, range.end + 1).join('\n');
      globalContent += `\n---\n\n${sectionContent.trim()}\n`;
      collected++;
    }
    if (collected > 0) {
      // v8.3.241+: 与单元切片一致重写相对引用（文档互链 ./overview.md 等指向 converted/）
      const grw = rewriteUnitLinks(globalContent, dirname(outputPath), overviewDir);
      await writeFile(join(overviewDir, `GLOBAL_CONTEXT-${docSlug}.md`), grw.content);
      if (grw.broken.length > 0) {
        logger.warn(`   ⚠️  GLOBAL_CONTEXT 中 ${grw.broken.length} 个引用未找到目标文件: ${grw.broken.slice(0, 5).join(', ')}`);
      }
      logger.info(`   📋 全局上下文已写入: overview/GLOBAL_CONTEXT-${docSlug}.md (${collected} 个章节)`);
    }
  }

  // v8.3.283: 跳过计数含「已存在/重复切分/全局章节拦截」三类，文案不限定「已存在」
  logger.success(`✅ 已拆分 ${written} 个功能单元到 features/${skipped > 0 ? `（跳过 ${skipped} 个）` : ''}`);
  if (rl) rl.close();
  logger.info(`   📂 ${featuresDir}/`);
}

/**
 * v8.3.223+: 「非功能章节」判定（getGlobalSections 与 scanUnits 共享，保证两处过滤规则一致）。
 * 修复宽泛 contains 误杀：「背景/目标/概述/名词」等弱语义词必须位于标题首/尾
 * 才算非功能章节——「绩效目标」「订单背景」「会议目标管理」这类真实功能单元不再被误杀。
 */
function stripSectionNo(t: string): string {
  return t
    .replace(/^[一二三四五六七八九十百]+[、.．\s]+/, '')
    .replace(/^\d+(\.\d+)*[、.．\s]+/, '')
    .replace(/^[A-Za-z]-\d+[、.．\s]+/, '')
    .replace(/^第[一二三四五六七八九十百\d]+[章节篇部分]+[、.．\s]*/, '');
}

const NON_FUNCTION_PREFIX = /^(附录|术语表|参考文献|目录|引言|总结|致谢|版权声明|修订记录|changelog|glossary|references|table of contents|introduction|summary|acknowledgments)/i;
// 强语义：任意位置包含即视为非功能章节
const NON_FUNCTION_CONTAINS = ['验收标准', '上线计划', '关联文档', '功能需求', '非功能需求', '用户画像', '功能架构', '风险与缓解', '产品视角', 'overview'];
// 弱语义：标题以这些词开头即视为非功能章节（「概述…」「背景介绍」「目标与原则」「名词解释」）
const NON_FUNCTION_STARTS = ['概述', '背景', '目标', '名词'];
// 弱语义组合：{修饰词}{弱义词} 的短标题（「项目背景」「总体目标」「产品概述」），
// 支持「项目背景与目标」「产品目标与范围」等复合形式
// 功能单元「绩效目标」「订单背景」等不含修饰词前缀，不会被误杀
const NON_FUNCTION_TAIL = /^(项目|需求|产品|总体|整体|建设|设计|开发|实施|运营|文档|全文)(背景|目标|概述|范围|定位)((与|和|及|、)?(背景|目标|概述|范围|定位))?$/;
// v8.3.226+: UI 交互说明类章节（操作步骤/页面布局/动效/手势等）不是功能单元——
// 它们描述「怎么操作」，不构成可开发的独立功能，归为全局上下文（GLOBAL_CONTEXT）
const NON_FUNCTION_UI_TAIL = /(操作步骤|操作流程|操作指引|操作指南|页面布局|页面结构|页面动效|交互动效|动画说明|手势操作|交互手势|交互方式|字段说明|数据字典|字典说明)$/;
// v8.3.227+: 功能章节内部的「描述维度」小节——标题（去编号后）精确等于这些通用
// 维度词时不是功能单元，而是父功能的组成部分（如「三、会议室管理」下的「3.1 用户
// 场景」「3.5 业务规则」）。精确匹配而非 contains，避免误杀「会议室资源规则」
// 「计费规则」这类具体业务规则（它们标题不精确等于维度词，是真正的功能单元）
const NON_FUNCTION_DIMENSION_EXACT = new Set([
  '用户场景', '业务规则', '异常场景处理', '页面布局', '操作步骤', '操作流程',
  '页面动效', '手势操作', '字段说明', '验收标准', '状态流转规则', '订单状态说明',
  '计费标准', '可配置参数', '通知业务规则', '通知事件一览', '通知消息模板',
  '消息类型与内容', '用户故事', '核心用户流程', '页面清单', '数据字典',
  '列表与操作规则', '预订状态展示规则', '签到窗口规则', '签到时间窗口规则',
  '离线场景降级', '二维码规范', '交互动效', '页面结构', '操作指引', '操作指南',
  '计费规则', '智能推荐规则', '用户角色权限表', '超时未签到处理', '签到操作流程',
]);

/**
 * v8.3.227+: 「规则/说明」类容器章节——自身不是功能单元，其后代才是
 * （如 REQUIREMENT.md 的「5.3 核心业务规则」下的「计费规则」「冲突检测规则」）。
 * 判定：标题（剥离括号注释后）以规则/说明/规范/一览/模板结尾，且有更深层的候选后代。
 * 括号注释如「核心业务规则（跨端通用）」需先剥离，否则尾部不匹配导致容器误判
 */
function isRuleContainerHeading(rawTitle: string, hasDeeperCandidate: boolean): boolean {
  if (!hasDeeperCandidate) return false;
  const title = stripParenthetical(stripSectionNo(rawTitle)).trim();
  return /(规则|说明|规范|一览|模板)$/.test(title);
}

/**
 * v8.3.228+: 判定功能单元类型（初始值，后续可被 AI/人工修正）
 * 信号（确定性规则，会议系统 29 单元实测 100% 命中）：
 *   1. 父是「规则/说明」容器（如 5.3 核心业务规则）→ global-rule
 *   2. 标题（剥括号注释后）以规则/策略/规范/机制/概览/模板/一览/字典结尾 → global-rule
 *   3. 其他 → feature
 */
function classifyUnitType(rawTitle: string, parentIsRuleContainer: boolean): 'feature' | 'global-rule' {
  if (parentIsRuleContainer) return 'global-rule';
  const title = stripParenthetical(stripSectionNo(rawTitle)).trim();
  if (/(规则|策略|规范|机制|概览|模板|一览|字典)$/.test(title)) return 'global-rule';
  return 'feature';
}

/** 归一化内容指纹（剔除生成时间等易变行后 sha1），用于跨文档重复章节检测 */
/** 归一化内容为行数组（去时间戳/空行/trim），供指纹与相似度共用 */
function normalizedLines(content: string): string[] {
  return content
    .split('\n')
    .filter(l => !/^> 生成时间:/.test(l.trim()))
    .map(l => l.trim())
    .filter(Boolean);
}

function contentFingerprint(content: string): string {
  return createHash('sha1').update(normalizedLines(content).join('\n')).digest('hex');
}

/**
 * v8.3.240+: 跨文档近似重复检测——行集合 Jaccard 相似度。
 * 同一份 PRD 被不同源文档各切一遍时，切片往往不完全逐字一致
 * （标题层级 ### vs ##、个别段落缺失），完全一致的指纹比对拦不住。
 */
function contentSimilarity(a: string, b: string): number {
  const la = new Set(normalizedLines(a));
  const lb = new Set(normalizedLines(b));
  if (la.size === 0 && lb.size === 0) return 1;
  let inter = 0;
  for (const l of la) if (lb.has(l)) inter++;
  return inter / Math.max(la.size, lb.size);
}

/**
 * 判定标题是否非功能章节（不切为功能单元）
 * parentIsRuleContainer：父是「规则/说明」容器（如 5.3 核心业务规则）时，
 * 维度词豁免——容器下的「计费规则」是功能单元而非维度小节
 * v8.3.227+: 先剥离括号注释再匹配——「操作流程（预订完整流程）」应命中「操作流程」
 */
function isNonFunctionalSection(rawTitle: string, parentIsRuleContainer = false): boolean {
  const title = stripParenthetical(stripSectionNo(rawTitle)).trim();
  if (!title) return true;
  if (NON_FUNCTION_PREFIX.test(title)) return true;
  if (NON_FUNCTION_CONTAINS.some(w => title.includes(w))) return true;
  if (NON_FUNCTION_STARTS.some(w => title.startsWith(w))) return true;
  if (NON_FUNCTION_TAIL.test(title)) return true;
  if (NON_FUNCTION_UI_TAIL.test(title)) return true;
  if (NON_FUNCTION_DIMENSION_EXACT.has(title) && !parentIsRuleContainer) return true;
  return false;
}

/** 剥离括号注释（如「操作流程（预订完整流程）」「核心业务规则（跨端通用）」） */
function stripParenthetical(rawTitle: string): string {
  return rawTitle.replace(/[（(][^（）()]*[）)]/g, '').trim();
}

/** v8.3.283: 全局注释语义判定——标题带括号注释且为跨端/全局/公共等修饰词，
 * 且剥括号后是规则/说明/规范等容器词（「核心业务规则（跨端通用）」命中；
 * 「计费规则」「签到窗口规则」等无括号注释的具体规则不命中）。
 * 目录创建拦截、INDEX 旧行过滤、INDEX 新行写入三处共用同一判定，
 * 修复 v8.3.282 只过滤旧行、units 残留对象经 INDEX 循环复活幽灵行的问题 */
function isGlobalAnnotatedTitle(rawTitle: string): boolean {
  const bracketNote = rawTitle.match(/[（(]([^）)]+)[）)]/);
  const isGlobalAnnotated = !!bracketNote && /(跨端通用|全局通用|全局|通用|公共)/.test(bracketNote[1]);
  const baseTitle = stripParenthetical(stripSectionNo(rawTitle)).trim();
  return isGlobalAnnotated && /(规则|说明|规范|一览|模板|约定)$/.test(baseTitle);
}

/**
 * 本地兜底：识别被过滤掉的非功能章节（产品定位/名词/验收标准等），作为全局上下文
 * （与 scanUnits 的过滤规则保持一致——共用 isNonFunctionalSection）
 * v8.3.224+: 改为 H2~H6 全层级扫描 + 子树传播，只收集「被排除子树的根」，
 * 修复旧逻辑只认 ## 层级导致深层级非功能章节（如 ### 一、项目背景与目标）漏收
 * v8.3.227+: 维度小节若父标题是功能单元（内容已在单元内），不重复收集到全局
 */
function getGlobalSections(content: string, units: ScannedUnit[]): string[] {
  const lines = content.split('\n');
  const unitTitles = new Set(units.map((u) => stripSectionNo(u.title).trim()));
  const global: string[] = [];
  const headings: { level: number; title: string; line: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{2,6})\s+(.+)$/);
    if (m) headings.push({ level: m[1].length, title: m[2].trim(), line: i });
  }
  if (headings.length === 0) return global;
  // 文档标题不作为全局章节（避免收集整个文档范围）
  const minLevel = Math.min(...headings.map(h => h.level));
  const shallowest = headings.filter(h => h.level === minLevel);
  const docTitleLine = (shallowest.length === 1 && headings.length > shallowest.length)
    ? shallowest[0].line
    : -1;
  // v8.3.227+: 预计算 hasDeeperCandidate（与 scanUnits 一致）
  const hasDeeper: boolean[] = new Array(headings.length).fill(false);
  for (let i = 0; i < headings.length; i++) {
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= headings[i].level) break;
      hasDeeper[i] = true;
      break;
    }
  }
  const stack: { level: number; excluded: boolean; ruleContainer: boolean; title: string }[] = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    while (stack.length > 0 && h.level <= stack[stack.length - 1].level) stack.pop();
    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    const parentExcluded = parent ? parent.excluded : false;
    const parentIsRuleContainer = parent ? parent.ruleContainer : false;
    // （负向后行断言排除「非功能需求」——它包含「功能需求」子串但应整体排除子树）
    const isContainer = /(?<!非)功能需求|功能清单|功能列表/.test(h.title);
    const ruleContainer = isRuleContainerHeading(h.title, hasDeeper[i]);
    const excluded = parentExcluded || (isNonFunctionalSection(h.title, parentIsRuleContainer) && !isContainer);
    stack.push({ level: h.level, excluded, ruleContainer, title: h.title });
    if (excluded && !parentExcluded && h.line !== docTitleLine) {
      const title = stripSectionNo(h.title).trim();
      // v8.3.227+: 父标题是功能单元时，维度小节内容已在单元内，不重复收集
      const parentTitle = parent && !parent.excluded ? stripSectionNo(parent.title).trim() : '';
      if (parentTitle && unitTitles.has(parentTitle)) continue;
      if (title && !unitTitles.has(h.title) && !unitTitles.has(title)) global.push(h.title);
    }
  }
  return global;
}

/** AI 语义切分结果 */
interface UnitScanResult {
  /** 业务功能单元（切分到 features/） */
  units: ScannedUnit[];
  /** 项目级通用信息章节名（产品定位/名词约定/验收标准等，归到 overview，不丢弃） */
  globalSections: string[];
}

/**
 * AI 语义切分功能单元（v8.3.194+）
 * 让 LLM 理解 PRD 内容，识别「业务功能」和「项目级通用信息」两类：
 * - 业务功能（units）→ 切分到 features/
 * - 通用信息（global，如产品定位/名词约定/非功能需求/验收标准汇总）→ 归到 overview，不丢弃
 * 失败返回 null（调用方回退本地正则切分兜底）。
 */
async function scanUnitsWithAI(content: string, siblingDocNames: string[] = []): Promise<UnitScanResult | null> {
  try {
    const systemPrompt = [
      '你是资深产品需求分析师。任务：从 PRD 文档中识别「业务功能单元」和「项目级通用信息」。',
      '',
      '业务功能单元（units）的定义：',
      '- 是用户可以感知、可独立交付的业务能力（如「会议室管理」「快速预订」「扫 码签到」「费用管理」「消息通知」）',
      '- 一个业务功能可能横跨多个章节；一个章节也可能只包含某功能的一部分',
      '',
      '项目级通用信息（global）的定义：',
      '- 不是某个具体功能，而是项目/产品的通用背景与规则',
      '- 例如：产品定位、项目背景、名词约定、术语表、用户画像、功能架构、非功能 需求（性能/安全等）、验收标准汇总、上线计划、风险与缓解、关联文档、文档概述',
      '- 这些内容不应拆成功能单元，而应作为「全局上下文」保留',
    ];
    // v8.3.263: 同目录已有端级文档时注入上下文——总纲文档的端级汇总章节
    // （如「Web管理后台」「H5移动端」）与端文档内容语义重复，应归入 global
    if (siblingDocNames.length > 0) {
      systemPrompt.push(
        '',
        '重要约束（端级汇总章节识别）：',
        `当前文档所在目录已存在以下独立文档: ${siblingDocNames.join(', ')}`,
        '- 这些文档通常是各端（Web后台/移动端/服务端）的详细需求',
        '- 如果当前文档的某个章节与这些文档主题相同（如「Web管理后台」对应 admin-web、「H5移动端」对应 h5-mobile），说明该章节是端级需求的汇总章节',
        '- 这类汇总章节必须归入 global，不得拆成功能单元，避免与端文档切出的单元重复',
      );
    }
    systemPrompt.push(
      '',
      '严格只返回 JSON，格式：',
      '{"units":[{"name":"功能名","sections":["对应的章节标题1","章节标题2"]}],"global":["全局信息章节标题1","全局信息章节标题2"]}',
      'sections 和 global 必须是文档中真实存在的章节标题（去掉编号前缀，如「会议室管理」而非「三、会议室管理」）。',
      '如果某章节既含功能描述又含通用规则，优先归入最相关的功能。',
      '不要输出任何 JSON 以外的文字。',
    );

    // v8.3.235+: 大文档不再只传前 8000 字符（后半章节 AI 看不到导致漏切）——
    //   改为「全文标题大纲 + 正文前 30000 字符」，保证功能边界识别覆盖全文
    const outline = content
      .split('\n')
      .filter((l) => /^#{1,4}\s+/.test(l))
      .join('\n');
    const truncated = content.length > 30000;
    const body = content.slice(0, 30000);
    const userPrompt = `以下是 PRD 文档的完整标题大纲：\n\n${outline}\n\n` +
      `以下是文档正文${truncated ? '（较长，仅前 30000 字符，结合大纲判断完整功能边界）' : ''}：\n\n${body}`;

    // v8.3.196+: 读 settings.ai.providers 池，按 defaults.split/priority 降级
    const providers = await resolveAiProviders('split');
    const response = await callLlm(systemPrompt.join('\n'), userPrompt, providers, 2000);
    if (!response) return null;

    const parsed = parseUnitsJson(response);
    if (!parsed || !Array.isArray(parsed.units) || parsed.units.length === 0) return null;

    const units: ScannedUnit[] = [];
    for (const u of parsed.units) {
      const name = String(u.name || '').trim();
      const sections: string[] = Array.isArray(u.sections) ? u.sections.map(String) : [];
      if (!name || sections.length === 0) continue;
      // 将章节名映射回文档行号范围
      const ranges = sections
        .map((s) => findSectionRange(content, s))
        .filter((r): r is { start: number; end: number } => r !== null);
      if (ranges.length === 0) continue;
      const startLine = Math.min(...ranges.map((r) => r.start));
      const endLine = Math.max(...ranges.map((r) => r.end));
      units.push({
        title: name,
        level: 2,
        startLine,
        endLine,
        sourceSection: sections.join('、'),
        unitType: classifyUnitType(name, false),
      });
    }

    const globalSections = Array.isArray(parsed.global) ? parsed.global.map(String).filter(Boolean) : [];

    return units.length > 0 ? { units, globalSections } : null;
  } catch {
    return null;
  }
}

/** 解析 AI 返回的功能单元 JSON（含 global 全局信息章节） */
function parseUnitsJson(text: string): { units: { name: string; sections: string[] }[]; global?: string[] } | null {
  try {
    const trimmed = text.trim();
    const jsonStr = trimmed.startsWith('{') ? trimmed : trimmed.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonStr) return null;
    const obj = JSON.parse(jsonStr);
    if (obj && Array.isArray(obj.units)) return obj;
    return null;
  } catch {
    return null;
  }
}

/** 在文档中找到指定章节标题的行号范围（返回该章节到下一同级/更高级标题之间） */
function findSectionRange(content: string, sectionTitle: string): { start: number; end: number } | null {
  const lines = content.split('\n');
  const target = sectionTitle.trim();
  if (!target) return null;

  const rangeOf = (i: number): { start: number; end: number } => {
    const level = (lines[i].match(/^#+/) || ['#'])[0].length;
    let end = lines.length - 1;
    for (let j = i + 1; j < lines.length; j++) {
      const m2 = lines[j].match(/^#{1,4}\s+/);
      if (m2) {
        const l2 = (lines[j].match(/^#+/) || ['#'])[0].length;
        if (l2 <= level) { end = j - 1; break; }
      }
    }
    return { start: i, end };
  };

  // 归一化：去章节号 + 去空白（忽略全角/半角空格差异）
  const norm = (t: string) => stripSectionNo(t).replace(/\s+/g, '').toLowerCase();
  const targetNorm = norm(target);

  // v8.3.223+: 第一轮精确匹配（忽略章节号）——修复「用户管理」命中「用户管理权限」
  // 导致边界错切的互相包含歧义
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#{1,4}\s+(.+)$/);
    if (!m) continue;
    if (norm(m[1]) === targetNorm) return rangeOf(i);
  }

  // 第二轮包含匹配兜底（仅当目标足够具体：归一化后 ≥4 字符，
  // 且标题与目标互为前缀关系，避免短词大面积误命中）
  if (targetNorm.length >= 4) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^#{1,4}\s+(.+)$/);
      if (!m) continue;
      const headingNorm = norm(m[1]);
      if (headingNorm.startsWith(targetNorm) || targetNorm.startsWith(headingNorm)) {
        return rangeOf(i);
      }
    }
  }
  return null;
}

/**
 * 扫描 Markdown 内容，识别功能单元边界（v8.3.224+: 层级自适应）
 * 旧策略硬编码「## 为单元边界、### 为子章节」，在功能单元位于深层级（如 ####/#####）
 * 的文档中只能切出文档标题一个假单元。新策略：
 *   1. 收集 H2~H6 标题构建层级栈，非功能章节（背景/目标/名词/验收标准等）排除其整棵子树
 *   2. 「功能需求/功能清单/功能列表」类容器章节仅排除自身，不排除后代（其后代才是功能单元）
 *   3. 文档唯一最浅层标题视为文档标题，不作为单元
 *   4. 单元 = 过滤后剩余标题中的叶子（其后没有更深层级的候选标题）
 * v8.3.227+:
 *   5. 「描述维度」小节（用户场景/业务规则/操作步骤等）随父功能合并——维度小节
 *      过滤后，其父功能章节成为叶子单元（如「三、会议室管理」含 3.1~3.7 全维度内容）
 *   6. 「规则/说明」容器（如 5.3 核心业务规则）不切自身，其下具体规则是功能单元，
 *      维度词在容器下豁免（「计费规则」在 5.3 下是单元，在费用管理下是维度）
 */
function scanUnits(content: string): ScannedUnit[] {
  const lines = content.split('\n');
  const headings: { level: number; title: string; line: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{2,6})\s+(.+)$/);
    if (m) headings.push({ level: m[1].length, title: m[2].trim(), line: i });
  }
  if (headings.length === 0) return [];

  // 文档标题：唯一的最浅层标题（如「## XX产品需求文档」），不作为功能单元
  // v8.3.226+: 唯一最浅标题仅在「存在更深层标题」时才视为文档标题——
  // 单章节文档（只有一个 H2）时它本身就是功能单元，不应被误判为文档标题
  const minLevel = Math.min(...headings.map(h => h.level));
  const shallowest = headings.filter(h => h.level === minLevel);
  const docTitleLine = (shallowest.length === 1 && headings.length > shallowest.length)
    ? shallowest[0].line
    : -1;

  // v8.3.227+: 预计算 hasDeeperCandidate——其后（到下一个同级/更浅标题前）是否存在更深标题
  const hasDeeper: boolean[] = new Array(headings.length).fill(false);
  for (let i = 0; i < headings.length; i++) {
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= headings[i].level) break;
      hasDeeper[i] = true;
      break;
    }
  }

  // 候选功能单元标题（非功能章节过滤 + 子树传播排除）
  const candidates: { level: number; title: string; line: number; parentIsRuleContainer: boolean }[] = [];
  const stack: { level: number; subtreeExcluded: boolean; ruleContainer: boolean }[] = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    while (stack.length > 0 && h.level <= stack[stack.length - 1].level) stack.pop();
    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    const parentExcluded = parent ? parent.subtreeExcluded : false;
    const parentIsRuleContainer = parent ? parent.ruleContainer : false;
    // 「功能需求」类容器章节：自身非单元，但后代是功能单元，不传播排除
    // （负向后行断言排除「非功能需求」——它包含「功能需求」子串但应整体排除子树）
    const isContainer = /(?<!非)功能需求|功能清单|功能列表/.test(h.title);
    const ruleContainer = isRuleContainerHeading(h.title, hasDeeper[i]);
    const nonFunctional = isNonFunctionalSection(h.title, parentIsRuleContainer);
    const subtreeExcluded = parentExcluded || (nonFunctional && !isContainer);
    stack.push({ level: h.level, subtreeExcluded, ruleContainer });
    if (subtreeExcluded || isContainer || nonFunctional || h.line === docTitleLine) continue;
    candidates.push({ ...h, parentIsRuleContainer });
  }

  // 单元 = 候选中的叶子；内容范围到下一个同层级或更浅的标题（含被过滤标题）为止
  const units: ScannedUnit[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    let isLeaf = true;
    for (let j = i + 1; j < candidates.length; j++) {
      if (candidates[j].level <= c.level) break;
      isLeaf = false;
      break;
    }
    if (!isLeaf) continue;
    let endLine = lines.length - 1;
    for (const h of headings) {
      if (h.line > c.line && h.level <= c.level) { endLine = h.line - 1; break; }
    }
    units.push({
      title: c.title,
      level: c.level,
      startLine: c.line,
      endLine,
      sourceSection: c.title,
      unitType: classifyUnitType(c.title, c.parentIsRuleContainer),
    });
  }

  // v8.3.235+: 深度小节提升——H4+ 叶子单元提升到最近祖先候选（修复碎片切分：
  //   端级文档「二、仪表盘(H3)」下的小节模板「2.1 用户场景 / 2.4 业务规则(H4)」
  //   被切成 20+ 独立单元；真正的功能单元是 H3 章节，小节是它的组成部分）
  const finalUnits: ScannedUnit[] = [];
  const promotedKeys = new Set<string>();
  for (const u of units) {
    if (u.level < 4) { finalUnits.push(u); continue; }
    // 找最近祖先候选（line 在 u 之前、层级更浅）
    let parentCand: (typeof candidates)[number] | null = null;
    for (let j = candidates.length - 1; j >= 0; j--) {
      if (candidates[j].line < u.startLine && candidates[j].level < u.level) {
        parentCand = candidates[j];
        break;
      }
    }
    if (!parentCand) { finalUnits.push(u); continue; }
    const key = String(parentCand.line);
    if (promotedKeys.has(key)) continue; // 同一父的多个小节只提升一次
    promotedKeys.add(key);
    let endLine = lines.length - 1;
    for (const h of headings) {
      if (h.line > parentCand.line && h.level <= parentCand.level) { endLine = h.line - 1; break; }
    }
    finalUnits.push({
      title: parentCand.title,
      level: parentCand.level,
      startLine: parentCand.line,
      endLine,
      sourceSection: parentCand.title,
      unitType: classifyUnitType(parentCand.title, parentCand.parentIsRuleContainer),
    });
  }
  return finalUnits;
}

/**
 * 提取指定单元的内容
 */
function extractUnitContent(content: string, unit: ScannedUnit): string {
  const lines = content.split('\n');
  const unitLines = lines.slice(unit.startLine, unit.endLine + 1);

  // 如果单元内容太短（<10行），可能是一个无效单元，返回原始内容
  if (unitLines.length < 10) {
    return unitLines.join('\n');
  }

  // 构建单元文档
  let result = `# ${unit.title}\n\n`;
  result += `> 来源: ${unit.sourceSection}\n> 生成时间: ${new Date().toISOString().split('T')[0]}\n\n`;
  result += unitLines.join('\n');
  return result;
}

/**
 * 清理单元名称，用于目录名
 */
/**
 * v8.3.198+: 剥离章节号前缀，返回干净的功能名。
 * 覆盖「四、」「第3章」「1.」「（一）」等常见编号格式（中文数字/阿拉伯数字/括号）。
 */
function stripSectionPrefix(t: string): string {
  return t
    .replace(/^第[一二三四五六七八九十百\d]+[章节篇部分]+[、.．\s]*/, '')
    .replace(/^[一二三四五六七八九十百]+[、.．\s]+/, '')
    .replace(/^\d+(\.\d+)*[、.．\s]+/, '')
    .replace(/^[A-Za-z]-\d+[、.．\s]+/, '')
    .replace(/^[（(][一二三四五六七八九十百\d]+[）)][、.．\s]*/, '')
    .trim();
}

/**
 * v8.3.334+: 标题过滤——用户指定只切某些标题的章节时，过滤功能单元列表。
 *
 * 匹配语义：归一化（去章节编号前缀/去空白/小写）后双向包含——
 *   「预订管理」命中「3.1 预订管理」「预订管理流程」；「预订管理」与「会议预订管理」也命中。
 * 返回 kept（保留）/ dropped（被过滤的单元标题）/ unmatched（用户指定但未命中的标题名）。
 */
export function filterUnitsByTitles(
  units: ScannedUnit[],
  titles: string[]
): { kept: ScannedUnit[]; dropped: string[]; unmatched: string[] } {
  const norm = (t: string) =>
    stripSectionPrefix(t).toLowerCase().replace(/[\s　·•・]+/g, '');
  const wanted = titles.map((t) => norm(t)).filter(Boolean);
  const kept: ScannedUnit[] = [];
  const dropped: string[] = [];
  for (const u of units) {
    const nt = norm(u.title);
    const hit = nt.length > 0 && wanted.some((w) => w.includes(nt) || nt.includes(w));
    if (hit) kept.push(u);
    else dropped.push(u.title);
  }
  const unmatched = titles.filter((t) => {
    const w = norm(t);
    if (!w) return false;
    return !units.some((u) => {
      const nt = norm(u.title);
      return nt.length > 0 && (w.includes(nt) || nt.includes(w));
    });
  });
  return { kept, dropped, unmatched };
}

function sanitizeUnitName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5\-_]/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'untitled';
}

/**
 * v8.3.271+: 功能单元目录名 ASCII 化——标题转英文 slug（英文/数字保留，中文转全拼）。
 * 中文显示名不丢失：保留在 SOURCE.md 标题与 _matrix.md 的 feature 字段中。
 */
function toEnglishSlug(title: string): string {
  if (!title) {
    return 'unit';
  }
  let out = '';
  let cn = '';
  const flush = () => {
    if (cn) {
      out += pinyin(cn, { toneType: 'none', type: 'array' }).join('');
      cn = '';
    }
  };
  for (const ch of title) {
    if (/[a-zA-Z0-9]/.test(ch)) {
      flush();
      out += ch;
    } else if (/[\u4e00-\u9fff]/.test(ch)) {
      cn += ch;
    } else {
      flush();
      out += '-';
    }
  }
  flush();
  const slug = out.toLowerCase().replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug || 'unit';
}

/**
 * v8.3.272+: 单元标题批量英译——缓存优先，失败/非法结果回落拼音。
 * 翻译映射落盘 010-requirements/.unit-names.json，保证重跑切分目录名稳定（幂等）。
 * v8.3.273+: 支持宿主 AI 接力——host 模式无 LLM 环境时输出 [SPECCORE_PROMPT]
 * 并返回 null（exitCode 已置 10）；宿主 AI 翻译后经 --translate-response 写回缓存续跑。
 * 三级降级：缓存命中 → LLM 翻译（providers 池 → 环境变量 → 本地 Ollama）→ 拼音。
 */
async function translateUnitTitles(
  titles: string[],
  featuresDir: string,
  mode: string,
  translateResponse?: string
): Promise<Map<string, string> | null> {
  const cacheFile = join(dirname(featuresDir), '.unit-names.json');
  const cache: Record<string, string> = {};
  try {
    if (await pathExists(cacheFile)) {
      Object.assign(cache, JSON.parse(await readFile(cacheFile, 'utf-8')));
    }
  } catch { /* 缓存损坏则重建 */ }

  let misses = titles.filter(t => t && !cache[t]);

  // 宿主 AI 接力响应：解析英译 JSON 写入缓存后继续切分
  // v8.3.273: 键约定统一为序号（1~N，与 PROMPT 清单编号及 LLM 直呼路径一致），
  // 中文标题仅作展示——避免重复标题键冲突与两套标识错位；也兼容中文标题作键
  // v8.3.318: 序号键基准从全量 titles 改为待翻译清单（misses）——[SPECCORE_PROMPT]
  // 只列出缓存未命中的标题（增量重切时旧单元已缓存英文名，清单仅剩新单元），
  // 此前按 titles 对齐会把 {"1":"push-preference"} 错位映射到 titles[0]（旧单元
  // 「站内信通知」被污染成 push-preference，新单元反而降级拼音）
  if (translateResponse && misses.length > 0) {
    const parsed = parseTranslationResponse(translateResponse, misses);
    let valid = 0;
    for (const [zh, en] of parsed) {
      if (/^[a-z0-9][a-z0-9-]{0,39}$/i.test(en)) {
        cache[zh] = en.toLowerCase();
        valid++;
      }
    }
    if (valid > 0) {
      await writeFile(cacheFile, JSON.stringify(cache, null, 2));
      logger.info(`📝 已接收宿主 AI 英译 ${valid} 条，写入 010-requirements/.unit-names.json`);
    } else {
      logger.warn('--translate-response 未解析出有效翻译（键须为序号或中文标题），按缓存/拼音继续');
    }
    misses = titles.filter(t => t && !cache[t]);
  }

  if (misses.length === 0) {
    return new Map(Object.entries(cache));
  }

  const providers = await resolveAiProviders('unitize');
  const llmAvailable = providers.length > 0 || !!process.env.SPECCORE_LLM_KEY || !!process.env.OPENAI_API_KEY;

  if (!llmAvailable) {
    // v8.3.289+: auto 模式消费 auto_host_ai——宿主 AI 优先于静默拼音。
    // ai.provider=host 或 auto_host_ai: true 均视为宿主模式（与 task new 导入链路一致）；
    // 显式 --translate-en host 无条件接力（v8.3.273 语义不变）。
    // 已携带 --translate-response 时不再接力（响应无效说明宿主已参与，防接力死循环），回退拼音。
    let hostPreferred = mode === 'host';
    if (!hostPreferred) {
      try {
        const { config } = await loadConfigWithMeta();
        hostPreferred = config.settings?.ai?.provider === 'host' || config.ask?.routing?.auto_host_ai === true;
      } catch { /* 配置读取失败按非宿主处理 */ }
    }
    if (hostPreferred && !translateResponse) {
      // 宿主 AI 接力：输出翻译清单（序号与响应 JSON 键一一对应），exitCode 10 等待 --translate-response 续跑
      logger.info('');
      logger.info('[SPECCORE_PROMPT]');
      logger.info('当前环境未配置 LLM（无 providers 池/环境变量）。请将以下功能单元标题翻译为英文 kebab-case 目录名（小写字母/数字/连字符，2~5 词，禁用拼音），然后执行续跑：');
      logger.info(`  speccore unitize --file <文件> --iter <迭代> --translate-en host --translate-response '<JSON>'`);
      logger.info('');
      logger.info('标题清单（序号即响应 JSON 的键，按序号一一对应，勿改名重排）:');
      for (const [i, t] of misses.entries()) {
        logger.info(`  ${i + 1}. ${t}`);
      }
      logger.info('');
      logger.info('响应 JSON 格式（键=序号，值=英文 slug）:');
      logger.info(JSON.stringify(Object.fromEntries(misses.map((t, i) => [String(i + 1), `feature-${i + 1}`])), null, 2));
      process.exitCode = 10;
      return null;
    }
    // auto 模式且非宿主：无 LLM 环境直接拼音兜底（全自动不中断），但必须提示——
    // 静默降级会让用户误以为「没有英译这一步」
    if (misses.length > 0) {
      logger.warn(`⚙️  未配置 LLM，${misses.length} 个标题英译降级拼音（yibiaopan 而非 dashboard）`);
      logger.info(`   💡 拿英文名两条路：① 配置 SPECCORE_LLM_KEY 后重切  ② --translate-en host 由宿主 AI 翻译接力`);
    }
    return new Map(Object.entries(cache));
  }

  const numbered = misses.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const response = await callLlm(
    '你是软件需求术语翻译专家。将中文功能单元标题翻译为简洁的英文 kebab-case 目录名：小写字母/数字/连字符，2~5 个单词，禁用拼音。',
    `将下列标题逐一翻译为英文 slug（kebab-case），严格只输出 JSON 对象：{"1":"booking-management",...}\n\n${numbered}`,
    providers,
    500
  );
  if (response) {
    const parsed = parseTranslationResponse(response, misses);
    for (const [zh, en] of parsed) {
      if (/^[a-z0-9][a-z0-9-]{0,39}$/i.test(en)) {
        cache[zh] = en.toLowerCase();
      }
    }
    // v8.3.309+: LLM 有响应但 0 条可解析（格式异常）时显式提示，防静默降级拼音
    if (parsed.length === 0) {
      logger.warn('⚙️  LLM 响应格式无法解析（未提取到有效 slug），标题英译降级拼音');
      logger.info(`   响应片段: ${response.replace(/\n/g, ' ').slice(0, 120)}`);
    }
    try {
      await writeFile(cacheFile, JSON.stringify(cache, null, 2));
    } catch { /* 写缓存失败不阻塞，下次重跑再试 */ }
  } else {
    // v8.3.309+: LLM 已配置但调用失败/无有效响应时显式提示（此前静默降级拼音，
    // 用户会误以为「没有英译这一步」或怀疑切分逻辑有 bug）
    logger.warn('⚙️  LLM 调用失败（无有效响应），标题英译降级拼音');
    logger.info('   💡 可重试或改用宿主 AI 接力：--translate-en host 后按提示回传 --translate-response');
  }
  return new Map(Object.entries(cache));
}

/**
 * v8.3.241+: 切分写 SOURCE.md 前重写相对引用。
 *
 * 背景：需求原文在 converted/ 下，功能单元在 features/{单元}/ 下（比 converted 深一层），
 * 原文中的相对引用（「../assets/prototypes/xx.html」「./overview.md」）在 SOURCE.md
 * 语境下全部失效——澄清/分析阶段 AI 按 SOURCE.md 所在目录解析会找不到文件。
 *
 * 策略：以原文档目录（fromDir）为基准解析引用，再计算相对单元目录（toDir）的新路径；
 * 文档互链的目标文件可能被 doc2spec 改名（overview.md → overview-requirements.md），
 * 目标不存在时按「sanitize(原名)-requirements.md / sanitize(原名)requirements.md」
 * 模式在 converted/ 下匹配实际文件。
 *
 * v8.3.267: 返回值改为 { content, broken }——三层匹配都未命中的目标不再静默，
 * 收集进 broken 由调用方告警（此前「保留层级重写」对断链零提示）。
 */
function rewriteUnitLinks(content: string, fromDir: string, toDir: string): { content: string; broken: string[] } {
  const broken: string[] = [];
  const rewritten = content.replace(/\]\(([^)\s]+)\)/g, (m, target: string) => {
    // 跳过绝对 URL / 锚点 / 绝对路径 / data URI
    if (/^(https?:|#|\/|mailto:|data:)/i.test(target)) return m;
    const resolved = resolve(fromDir, target);
    let finalPath = relative(toDir, resolved);
    // 目标文件已被 doc2spec 改名时，按命名模式匹配 converted/ 下的实际文件
    if (!existsSync(resolved)) {
      const base = sanitizeUnitName(basename(resolved, extname(resolved)));
      const dir = dirname(resolved);
      const candidates = [
        join(dir, `${base}-requirements.md`),
        join(dir, `${base}requirements.md`),
        // v8.3.303+: 端文档产物改为与源文档同名（{端名}.md），旧「{端名}requirements」链接回退同名
        join(dir, `${base.replace(/requirements$/i, '')}.md`),
        // v8.3.241+: sources/ 是原始文档只读存档（保留原文件名），互链目标可能只存在那里
        join(dir, '..', 'sources', basename(resolved)),
      ];
      const hit = candidates.find(c => existsSync(c));
      if (hit) finalPath = relative(toDir, hit);
      else broken.push(target); // v8.3.267: 未命中收集，调用方告警（不再静默断链）
    }
    return `](${finalPath})`;
  });
  return { content: rewritten, broken };
}
