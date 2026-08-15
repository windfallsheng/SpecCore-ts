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
 * 可选: LibreOffice (处理 .doc 旧格式: brew install libreoffice)
 */
import { logger, Spinner } from '../utils/logger';
import { execSync } from 'child_process';
import { pathExists, ensureDir, readFile, writeFile, readdir, stat, unlink, copy } from 'fs-extra';
import { join, basename } from 'path';
import { backupWithTimestamp } from '../utils/task-utils';
import { nextTaskId } from '../core/global-counters';

import { showNextSteps } from '../core/next-steps';
import { validateContent, generateReport } from '../core/doc-validator';
import { buildPrompt, formatPrompt } from '../core/prompt-builder';
function findCommand(cmd: string): string | null {
  try {
    return execSync(`which ${cmd}`, { stdio: 'pipe', encoding: 'utf-8' }).trim();
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
    const eq = pair.lastIndexOf('=');
    if (eq < 0) return null;
    return [pair.substring(0, eq).trim(), pair.substring(eq + 1).trim()] as [string, string];
  }).filter(Boolean) as [string, string][];
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

  // pandoc 前置检测
  const pandocBin = findCommand('pandoc');
  if (!pandocBin) {
    const installCmd = getInstallCmd('pandoc');
    logger.warn('⚠️  未检测到 pandoc。doc2spec 依赖 pandoc 进行 Word → Markdown 转换。');
    logger.info('');
    logger.info(`   📦 安装命令: ${installCmd}`);
    logger.info('   💡 替代方案: AI 对话中可用 word2md 技能（无需 pandoc）');
    logger.info('   📄 备选方案: 在 Word 中用"另存为" → 选择 .md 格式');
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
    const platform = options.platform || '';
    const outputPath = join(targetDir, platform ? `${platform}requirements.md` : 'requirements.md');

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
      // 修正 pandoc 风格的图片路径（如果有 media/ 引用）
      converted = converted.replace(/\]\(media\//g, '](../../assets/extracted/');
      await writeFile(outputPath, converted);
      spinner.stop('📝 .md 直接导入');
    } else if (ext === 'doc') {
      // .doc 旧格式 → LibreOffice 转 .docx
      try {
        execSync(`soffice --headless --convert-to docx "${sourceFile}" --outdir /tmp/`, { stdio: 'pipe' });
        const name = basename(sourceFile, '.doc');
        sourceFile = `/tmp/${name}.docx`;
        if (!(await pathExists(sourceFile))) {
          throw new Error('LibreOffice conversion failed');
        }
        cleanupFile = sourceFile;
        spinner.stop('📄 .doc → .docx');
      } catch {
        spinner.fail('需要 LibreOffice 来处理 .doc 旧格式。请安装: brew install libreoffice');
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
          `LANG=zh_CN.UTF-8 "${pandocBin}" "${sourceFile}" -f ${inputFormat} -t gfm --wrap=none --extract-media="${imageDir}" -o "${outputPath}"`,
          { stdio: 'pipe', encoding: 'utf-8' }
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
    content = content.replace(/^## /gm, '### ');
    content = content.replace(/^# /gm, '## ');

    // 2. 空行清理
    content = content.replace(/\n{3,}/g, '\n\n');

    // 3. 图片路径修正（pandoc 提取到 assets/extracted/media/，MD 引用 media/xxx.png）
    //    根据 MD 文件所在的目录深度计算相对于 assets/extracted/ 的正确路径
    const mdDir = require('path').dirname(outputPath);
    const relAssets = require('path').relative(mdDir, join(iterDir, '010-requirements', 'assets', 'extracted'));
    content = content.replace(/\]\(media\//g, '](' + relAssets + '/');

    // 4. 接口表格检测 + 提示
    const hasInterfaceTable = /\|\s*方法\s*\|/i.test(content) || /\|\s*METHOD\s*\|/i.test(content);
    if (!hasInterfaceTable) {
      content += `\n---\n> ⚠️ Word 自动转换，请在下方补充接口定义表格后运行 speccore execute：\n\n| 方法 | 路径 | 说明 |\n| :--- | :--- | :--- |\n| | | |\n`;
    }

    // 5. 图片引用注释（告知 Task 如何引用这些图）
    content = content.replace(
      /^#/,
      `# ${platform || '通用'}需求\n\n<!-- \n  原型图片路径: 010-requirements/assets/extracted/\n  Task 引用方式: ![原型](../assets/extracted/xxx.png)\n  所有 Task 共享此目录，无需重复存放。\n-->\n\n#`
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
    const outputFilename = platform ? `${platform}requirements.md` : 'requirements.md';
    if (!indexContent.includes(`| ${platformLabel} |`)) {
      const entry = `| ${platformLabel} | ${outputFilename} | ${new Date().toISOString().split('T')[0]} | ${basename(options.file)} |`;
      indexContent += entry + '\n';
    }
    await writeFile(indexPath, indexContent);

    // ── 自动合并到 REQUIREMENT.md（汇总各端需求，供 iteration split 使用）──
    await mergeToRequirement(iterDir, targetDir, platformLabel);

    // ── 检测多端文档，提示智能合成 ──
    const convDir = join(iterDir, '010-requirements', 'converted');
    if (await pathExists(convDir)) {
      const convFiles = (await readdir(convDir)).filter(f => f.endsWith('requirements.md'));
      if (convFiles.length >= 2) {
        logger.info('');
        logger.info(`🧩 检测到 ${convFiles.length} 份端需求文档，建议智能合成:`);
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
      logger.info(`  3. speccore iteration split`);
      logger.info(`  4. speccore execute --task=Task-001 --force`);
    }
  } catch (error) {
    spinner.fail(`转换失败: ${error}`);
    throw error;
  }
}

/**
 * 将各端需求文档自动合并到统一的 REQUIREMENT.md
 * 格式: ## {端名}需求（取自 {端名}requirements.md 的 ## 接口定义 表格）
 */
async function mergeToRequirement(iterDir: string, targetDir: string, platform: string): Promise<void> {
  const reqFilename = (platform === '通用' || !platform) ? 'requirements.md' : `${platform}requirements.md`;
  const reqPath = join(targetDir, reqFilename);
  const globalReqPath = join(targetDir, 'REQUIREMENT.md');

  if (!(await pathExists(reqPath))) return;

  const platformContent = await readFile(reqPath, 'utf-8');

  // 提取接口表格
  const tableMatch = platformContent.match(/\| 方法 \|.*\n(?:\|[: -]+\|.*\n)+(?:\|.*\|.*\n)+/);
  const apiSection = tableMatch ? `\n\n### ${platform}端接口\n\n${tableMatch[0]}` : '';

  // 提取需求描述（跳过 HTML 注释和接口表格）
  const descContent = platformContent
    .replace(/^<!--[\s\S]*?-->\n/gm, '')
    .replace(/\| 方法 \|.*(\n\|.*)*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // 检查是否已有此端的内容
  let globalContent = '';
  if (await pathExists(globalReqPath)) {
    globalContent = await readFile(globalReqPath, 'utf-8');
  } else {
    globalContent = `# 本期需求文档\n\n> 由 doc2spec 自动合并各端需求\n\n`;
  }

  const sectionLabel = platform.endsWith('端') ? platform + 'requirements' : platform + '端需求';
  const platformSection = `\n## ${sectionLabel}\n\n${descContent.slice(0, 500)}${apiSection}\n`;
  
  // 去重：如果已有同端内容，替换
  const sectionRegex = new RegExp(`\\n## ${platform.replace(/端$/, '')}端?需求[\\s\\S]*?(?=\\n## |$)`, 'g');
  if (globalContent.match(sectionRegex)) {
    globalContent = globalContent.replace(sectionRegex, platformSection);
  } else {
    globalContent += platformSection;
  }

  // 清理模板占位符（避免 split 时拆出无意义章节）
  globalContent = globalContent
    .replace(/#{1,3}\s+\d+\.\s*(需求概述|功能需求|非功能需求|验收标准|附录)[\s\S]*?(?=#{1,3}\s|$)/g, '');

  await writeFile(globalReqPath, globalContent);
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
      const pandocBin = findCommand('pandoc');
      if (pandocBin && ext && PANDOC_FORMAT_MAP[ext]) {
        try {
          const tmpOut = join(sourcesDir, `.${entry.name}.tmp.md`);
          execSync(
            `LANG=zh_CN.UTF-8 "${pandocBin}" "${filePath}" -f ${PANDOC_FORMAT_MAP[ext]} -t gfm --wrap=none -o "${tmpOut}"`,
            { stdio: 'pipe', encoding: 'utf-8' }
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
    const lines = csv.trim().split('\n');
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
      logger.info(`   📦 旧版已备份: ${bk.split('/').pop()}`);
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
