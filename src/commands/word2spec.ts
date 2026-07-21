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

export interface Word2SpecOptions {
  file: string;
  iteration: string;
  platform?: string;
}

export async function word2specCommand(options: Word2SpecOptions): Promise<void> {
  if (!options.file) {
    logger.error('请指定 Word 文件: speccore word2spec --file=<路径>');
    return;
  }
  if (!options.iteration) {
    logger.error('请指定期次: speccore word2spec --file=<路径> --iteration=<期次>');
    return;
  }

  if (!(await pathExists(options.file))) {
    logger.error(`文件不存在: ${options.file}`);
    return;
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

    // .doc → .docx via LibreOffice
    const ext = sourceFile.split('.').pop()?.toLowerCase();
    if (ext === 'doc') {
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

    // pandoc
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
