/**
 * word2spec — Word 需求文档 → SpecCore Markdown
 *
 * 将 .docx/.doc 格式的 PRD 需求文档转换为 SpecCore 兼容的 Markdown，
 * 自动放入对应期次的 00-需求文档/ 目录。
 *
 * 图片路径设计:
 *   提取到 → 期次-xxx/00-需求文档/images/
 *   Task 引用 → ../../00-需求文档/images/xxx.png
 *   这样所有 Task 共享同一份原型图，不需要重复存放。
 *
 * 依赖: pandoc (macOS: brew install pandoc)
 * 可选: LibreOffice (处理 .doc 旧格式: brew install libreoffice)
 */
import { logger, Spinner } from '../utils/logger';
import { execSync } from 'child_process';
import { pathExists, ensureDir, readFile, writeFile, readdir, stat, unlink } from 'fs-extra';
import { join, basename } from 'path';

import { showNextSteps } from '../core/next-steps';
function findCommand(cmd: string): string | null {
  try {
    return execSync(`which ${cmd}`, { stdio: 'pipe', encoding: 'utf-8' }).trim();
  } catch {
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

export interface Word2SpecOptions {
  file: string;
  iteration: string;
  platform?: string;
  files?: string;  // batch: "path1.docx=平台1,path2.docx=平台2"
}

export async function word2specCommand(options: Word2SpecOptions): Promise<void> {
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
    logger.error('请指定 Word 文件: speccore word2spec --file=<路径> 或 --files');
    return;
  }
  await processSingle(options);
}

async function processSingle(options: Word2SpecOptions): Promise<void> {
  if (!options.iteration) {
    logger.error('请指定期次: speccore word2spec --iteration=<期次>');
    return;
  }

  if (!(await pathExists(options.file))) {
    logger.error(`文件不存在: ${options.file}`);
    return;
  }

  // pandoc 前置检测
  if (!findCommand('pandoc')) {
    const installCmd = getInstallCmd('pandoc');
    logger.warn('⚠️  未检测到 pandoc。word2spec 依赖 pandoc 进行 Word → Markdown 转换。');
    logger.info('');
    logger.info(`   📦 安装命令: ${installCmd}`);
    logger.info('   💡 替代方案: AI 对话中可用 word2md 技能（无需 pandoc）');
    logger.info('   📄 备选方案: 在 Word 中用"另存为" → 选择 .md 格式');
    logger.info('');

    const answer = await promptUser('是否要自动安装 pandoc？');
    if (answer) {
      logger.info(`正在安装 pandoc: ${installCmd}`);
      try {
        execSync(installCmd, { stdio: 'inherit' });
        logger.success('pandoc 安装成功！继续转换...\n');
      } catch {
        logger.error('自动安装失败，请手动执行: ' + installCmd);
        return;
      }
    } else {
      logger.info('跳过安装。你可以：');
      logger.info(`  1. 手动执行: ${installCmd}`);
      logger.info('  2. 使用 word2md 技能（对话中可用）');
      logger.info('  3. 在 Word 中另存为 .md 后手动放到 00-需求文档/');
      return;
    }
  }

  const spinner = new Spinner('正在转换 Word → Markdown...');
  spinner.start();

  try {
    const iterName = options.iteration.replace(/^期次-/, '');
    const iterDir = `期次-${iterName}`;
    const targetDir = join(iterDir, '00-需求文档');
    const imageDir = join(targetDir, 'images');
    const platform = options.platform || '需求';
    const outputPath = join(targetDir, `${platform}需求.md`);

    await ensureDir(targetDir);
    await ensureDir(imageDir);

    let sourceFile = options.file;
    let cleanupFile: string | null = null;
    const ext = sourceFile.split('.').pop()?.toLowerCase();

    // .md 文件直接导入，不需要 pandoc
    if (ext === 'md') {
      const converted = await readFile(sourceFile, 'utf-8');
      await writeFile(outputPath, converted);
      logger.info('   📝 .md 直接导入（跳过 pandoc）');
    } else if (ext === 'doc') {
      try {
        execSync(`soffice --headless --convert-to docx "${sourceFile}" --outdir /tmp/`, { stdio: 'pipe' });
        const name = basename(sourceFile, '.doc');
        sourceFile = `/tmp/${name}.docx`;
        if (!(await pathExists(sourceFile))) {
          throw new Error('LibreOffice conversion failed');
        }
        cleanupFile = sourceFile;
        logger.info('   📄 .doc → .docx (via LibreOffice)');
      } catch {
        spinner.fail('需要 LibreOffice 来处理 .doc 格式。请安装: brew install libreoffice');
        return;
      }
    }

    if (ext !== 'md') {
      // pandoc conversion for .docx/.doc
      try {
        execSync(
          `LANG=zh_CN.UTF-8 pandoc "${sourceFile}" -f docx -t gfm --wrap=none --extract-media="${imageDir}" -o "${outputPath}"`,
          { stdio: 'pipe', encoding: 'utf-8' }
        );
      } catch (e: any) {
        spinner.fail(`pandoc 转换失败: ${e.message}`);
        logger.info('请确保已安装 pandoc: brew install pandoc');
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

    // 3. 图片路径修正（pandoc extra media/ subfolder）
    const escapedImageDir = imageDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    content = content.replace(new RegExp(`\\]\\(${escapedImageDir}/media/`, 'g'), '](images/');

    // 4. 接口表格检测 + 提示
    const hasInterfaceTable = /\|\s*方法\s*\|/i.test(content) || /\|\s*METHOD\s*\|/i.test(content);
    if (!hasInterfaceTable) {
      content += `\n---\n> ⚠️ Word 自动转换，请在下方补充接口定义表格后运行 speccore execute：\n\n| 方法 | 路径 | 说明 |\n| :--- | :--- | :--- |\n| | | |\n`;
    }

    // 5. 图片引用注释（告知 Task 如何引用这些图）
    content = content.replace(
      /^#/,
      `# ${platform}需求\n\n<!-- \n  原型图片路径: images/\n  Task 引用方式: ![原型](../../00-需求文档/images/xxx.png)\n  所有 Task 共享此目录，无需重复存放。\n-->\n\n#`
    );

    await writeFile(outputPath, content);

    // ── 更新 INDEX.md ──
    const indexPath = join(targetDir, 'INDEX.md');
    let indexContent = '';
    if (await pathExists(indexPath)) {
      indexContent = await readFile(indexPath, 'utf-8');
    } else {
      indexContent = '# 本期需求文档索引\n\n> word2spec 自动生成\n\n| 端 | 文件 | 转换时间 | 来源 |\n| :--- | :--- | :--- | :--- |\n';
    }
    if (!indexContent.includes(`| ${platform} |`)) {
      const entry = `| ${platform} | ${platform}需求.md | ${new Date().toISOString().split('T')[0]} | ${basename(options.file)} |`;
      indexContent += entry + '\n';
    }
    await writeFile(indexPath, indexContent);

    // ── 自动合并到 REQUIREMENT.md（汇总各端需求，供 iteration split 使用）──
    await mergeToRequirement(iterDir, targetDir, platform);

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
    logger.info(`接口表: ${hasInterfaceTable ? '✅' : '⚠️ 缺失（已追加提示）'}`);
    logger.info('');
    logger.info('📋 下一步:');
    logger.info(`  1. 检查自动转换的标题层级`);
    logger.info(`  2. 补充接口定义表格`);
    logger.info(`  3. speccore iteration split`);
    logger.info(`  4. speccore execute --task=Task-001 --force`);
  } catch (error) {
    spinner.fail(`转换失败: ${error}`);
    throw error;
  }
}

/**
 * 将各端需求文档自动合并到统一的 REQUIREMENT.md
 * 格式: ## {端名}需求（取自 {端名}需求.md 的 ## 接口定义 表格）
 */
async function mergeToRequirement(iterDir: string, targetDir: string, platform: string): Promise<void> {
  const reqPath = join(targetDir, `${platform}需求.md`);
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
    globalContent = `# 本期需求文档\n\n> 由 word2spec 自动合并各端需求\n\n`;
  }

  const sectionLabel = platform.endsWith('端') ? platform + '需求' : platform + '端需求';
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
