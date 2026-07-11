/**
 * template-add - 添加代码生成模板命令
 * 将现有代码提取为可复用的模板，保存到 .speccore/PATTERNS/TEMPLATES/
 */

import { logger, Spinner } from '../utils/logger';
import { ensureDir, copy, pathExists, writeFile, readFile } from 'fs-extra';
import { FileTransaction } from '../core/transaction';
import { join, basename } from 'path';

export interface TemplateAddOptions {
  name?: string;
  type?: string;
  files?: string;
  desc?: string;
}

export async function templateAddCommand(options: TemplateAddOptions): Promise<void> {
  if (!options.name) {
    logger.error('请提供模板名称。用法: speccore template-add --name "<模板名>" --type=<类型> --files=<文件路径>');
    return;
  }

  if (!options.files) {
    logger.error('请提供代码文件路径。用法: speccore template-add --files=<文件路径>');
    return;
  }

  const spinner = new Spinner('正在添加代码模板...');
  spinner.start();

  try {
    const templateType = options.type || 'crud';
    const templateDir = join(process.cwd(), '.speccore', 'PATTERNS', 'TEMPLATES', templateType, options.name);

    await ensureDir(templateDir);

    // 复制代码文件
    const filePaths = options.files.split(',').map((f) => f.trim());
    for (const filePath of filePaths) {
      const fileName = basename(filePath);
      await copy(filePath, join(templateDir, fileName));
      logger.info(`✅ 已复制: ${fileName}`);
    }

    // 创建模板描述文件
    await writeFile(
      join(templateDir, 'README.md'),
      `# ${options.name} 模板\n\n` +
      `- **类型**: ${templateType}\n` +
      `- **描述**: ${options.desc || '请补充模板描述'}\n` +
      `- **创建日期**: ${new Date().toISOString().split('T')[0]}\n` +
      `- **文件列表**:\n${filePaths.map((f) => `  - ${basename(f)}`).join('\n')}\n`
    );

    // 更新 PATTERNS/README.md 索引
    const patternsReadme = join(process.cwd(), '.speccore', 'PATTERNS', 'README.md');
    if (await pathExists(patternsReadme)) {
      let content = await readFile(patternsReadme, 'utf-8');
      const entry = `| ${options.name} | ${templateType} | ${options.desc || '-'} | ${new Date().toISOString().split('T')[0]} |\n`;
      if (!content.includes(options.name)) {
        content += entry;
        await writeFile(patternsReadme, content);
      }
    }

    spinner.stop(`模板 "${options.name}" 已添加`);
    logger.info('');
    logger.info(`📄 模板详情:`);
    logger.info(`   名称: ${options.name}`);
    logger.info(`   类型: ${templateType}`);
    logger.info(`   位置: .speccore/PATTERNS/TEMPLATES/${templateType}/${options.name}/`);
    logger.info(`   文件数: ${filePaths.length}`);
    if (options.desc) {
      logger.info(`   描述: ${options.desc}`);
    }
  } catch (error) {
    spinner.fail(`添加模板失败: ${error}`);
    throw error;
  }
}
