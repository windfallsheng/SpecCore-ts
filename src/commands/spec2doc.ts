/**
 * spec2doc — SpecCore Markdown → 文档导出
 *
 * doc2spec 的反向操作。将 SpecCore 规范化的 REQUIREMENT.md 等文档，
 * 导出为 Word(.docx) / PDF / HTML / PPTX 等格式。
 *
 * 依赖: pandoc (macOS: brew install pandoc)
 * 可选: LibreOffice (docx→pdf: brew install libreoffice)
 */
import { logger, Spinner } from '../utils/logger';
import { execSync } from 'child_process';
import { pathExists, ensureDir, readdir, stat, writeFile } from 'fs-extra';
import { join, basename, extname } from 'path';
import { validateContent, generateReport } from '../core/doc-validator';

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

export interface Spec2DocOptions {
  iteration?: string;
  task?: string;
  file?: string;         // -f: 直接导出指定 .md 文件
  format?: string;
  output?: string;
  all?: boolean;
  ai?: boolean;
  prompt?: boolean;   // --prompt: 输出文档审计 Prompt
  apply?: string;     // --apply: 接收 AI 优化后的文档
}

/** 支持的输出格式 → pandoc writer */
const WRITER_MAP: Record<string, string> = {
  docx: 'docx',
  pdf: 'pdf',
  html: 'html5',
  pptx: 'pptx',
};

/** 格式 → 推荐参考文档 */
const REF_MAP: Record<string, string> = {
  docx: '--reference-doc',
  pptx: '--reference-doc',
};

export async function spec2docCommand(options: Spec2DocOptions): Promise<void> {
  // ── Prompt 模式 ──
  if (options.prompt) {
    const prompt = await require('../core/prompt-builder').buildPrompt('analyze', { iteration: options.iteration });
    process.stdout.write(require('../core/prompt-builder').formatPrompt(prompt));
    process.exitCode = 10;
    return;
  }
  // ── Apply 模式 ──
  if (options.apply && options.output) {
    const { writeFile, ensureDir } = require('fs-extra');
    const { dirname } = require('path');
    await ensureDir(dirname(options.output));
    await writeFile(options.output, options.apply);
    logger.success(`✅ 已写入: ${options.output}`);
    return;
  }
  // 格式自动识别：优先 --format，其次 -o 后缀
  let format = options.format;
  if (!format && options.output) {
    const ext = options.output.split('.').pop()?.toLowerCase();
    if (ext && WRITER_MAP[ext]) format = ext;
  }
  format = format || 'docx';
  
  if (!WRITER_MAP[format]) {
    logger.error(`不支持的格式: ${format}。支持: docx, pdf, html, pptx`);
    return;
  }

  // ── 定位 SpecCore 目录 ──
  if (!await pathExists('.speccore')) {
    logger.error('未找到 .speccore/，请在 SpecCore 项目根目录运行');
    return;
  }

  // ── 收集源文件 ──
  const sourceFiles: { path: string; label: string }[] = [];
  const iterName = options.iteration;

  // --file: 直接导出指定文件
  if (options.file) {
    if (!await pathExists(options.file)) {
      logger.error(`文件不存在: ${options.file}`);
      return;
    }
    sourceFiles.push({ path: options.file, label: basename(options.file, extname(options.file)) });
  } else if (options.all && iterName) {
    // 全量导出：迭代下所有 .md 文件
    const iterDir = iterName.startsWith('Iteration-') ? iterName : `Iteration-${iterName}`;
    if (!await pathExists(iterDir)) {
      logger.error(`迭代不存在: ${iterDir}`);
      return;
    }
    await collectAllMd(iterDir, sourceFiles);
  } else if (options.task && iterName) {
    // 任务导出
    const iterDir = iterName.startsWith('Iteration-') ? iterName : `Iteration-${iterName}`;
    const taskDir = join(iterDir, '030-tasks', options.task.startsWith('Task-') ? options.task : `Task-${options.task}`);
    if (!await pathExists(taskDir)) {
      logger.error(`任务目录不存在: ${taskDir}`);
      return;
    }
    await collectAllMd(taskDir, sourceFiles);
  } else {
    // 默认：当前迭代的 REQUIREMENT.md
    if (!iterName) {
      logger.error('请指定迭代: --iteration <name>');
      return;
    }
    const iterDir = iterName.startsWith('Iteration-') ? iterName : `Iteration-${iterName}`;
    const reqFile = join(iterDir, '020-specs', 'REQUIREMENT.md');
    if (await pathExists(reqFile)) {
      sourceFiles.push({ path: reqFile, label: '需求文档' });
    }
    // 也检查 ANALYSIS.md
    const anaFile = join(iterDir, '020-specs', 'ANALYSIS.md');
    if (await pathExists(anaFile)) {
      sourceFiles.push({ path: anaFile, label: '分析文档' });
    }
  }

  if (sourceFiles.length === 0) {
    logger.error('未找到可导出的 SpecCore 文档。请指定 --iteration 或 --task');
    return;
  }

  // ── 导出前质量审计 ──
  logger.info(`📋 收集到 ${sourceFiles.length} 个源文件:`);
  for (const sf of sourceFiles) {
    logger.info(`   - ${sf.label}`);
  }
  logger.info('');
  
  // 审计每个源文件
  let totalTodos = 0;
  let totalIssues = 0;
  for (const sf of sourceFiles) {
    const content = await require('fs-extra').readFile(sf.path, 'utf-8');
    const todos = (content.match(/TODO|TBD|FIXME|XXX/g) || []).length;
    const placeholders = (content.match(/待填写|待补充|TBD/g) || []).length;
    totalTodos += todos + placeholders;
  }
  
  if (totalTodos > 0) {
    logger.warn(`⚠️ 发现 ${totalTodos} 个待完成项（TODO/待填写），导出文档可能不完整`);
    logger.info('   建议先补全后再导出，或使用 --force 忽略警告');
    logger.info('');
  }
  
  if (totalTodos === 0) {
    logger.success('✅ 内容审计通过，所有文档无待完成项');
    logger.info('');
  }

  // ── pandoc 检测 ──
  let hasPandoc = true;
  try { execSync('which pandoc', { stdio: 'pipe' }); } catch { hasPandoc = false; }
  if (!hasPandoc) {
    logger.warn(`⚠️ 未检测到 pandoc。安装: ${getInstallCmd('pandoc')}`);
    logger.info('   pandoc 是 spec2doc 的核心依赖（Markdown → 文档转换）');
    return;
  }

  // ── 输出路径 ──
  const outputName = options.output || (iterName || 'speccore-export');
  const outputPath = `${outputName.replace(/\.[^.]+$/, '')}.${format}`;

  const spinner = new Spinner(`导出 SpecCore → ${format.toUpperCase()}`);
  spinner.start();

  try {
    if (sourceFiles.length === 1) {
      // 单文件直接转
      const src = sourceFiles[0];
      const cmd = `LANG=zh_CN.UTF-8 pandoc "${src.path}" -f gfm -t ${WRITER_MAP[format]} --wrap=none -o "${outputPath}"`;
      execSync(cmd, { stdio: 'pipe' });
    } else {
      // 多文件合并：先拼成临时文件
      let merged = '';
      for (const sf of sourceFiles) {
        const content = await require('fs-extra').readFile(sf.path, 'utf-8');
        merged += `\n\n<!-- === ${sf.label}: ${sf.path} === -->\n\n${content}`;
      }
      const tmpPath = join(process.cwd(), '.speccore', '.tmp_export.md');
      await ensureDir(join(process.cwd(), '.speccore'));
      await writeFile(tmpPath, merged);
      const cmd = `LANG=zh_CN.UTF-8 pandoc "${tmpPath}" -f gfm -t ${WRITER_MAP[format]} --wrap=none -o "${outputPath}"`;
      execSync(cmd, { stdio: 'pipe' });
    }

    spinner.stop('导出完成');
    const fileStat = await stat(outputPath);
    logger.success(`输出: ${outputPath} (${(fileStat.size / 1024).toFixed(1)} KB)`);
    logger.info(`包含 ${sourceFiles.length} 个源文件`);
    logger.info('');

    // ── AI 精炼模式提示 ──
    if (options.ai !== false) {
      logger.info('  ⚡ pandoc 快速导出完成（CLI 模式）');
      logger.info(`  🧠 推荐 AI 精炼模式：在 WorkBuddy 中说`);
      logger.info(`     "AI 优化排版 ${outputPath}"`);
      logger.info(`     → AI 将: 封面/目录/Mermaid渲染/中文排版/页眉页脚`);
      logger.info('');
      logger.info('  💡 纯 CLI 导出: speccore spec2doc --no-ai');
    }
  } catch (error: any) {
    spinner.fail(`导出失败: ${error.message || error}`);
    logger.info('💡 常见原因: pandoc 版本过旧, 源文件格式问题');
  }
}

/** 递归收集目录下所有 .md 文件 */
async function collectAllMd(dir: string, list: { path: string; label: string }[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'images') {
      await collectAllMd(full, list);
    } else if (e.isFile() && e.name.endsWith('.md')) {
      list.push({ path: full, label: e.name.replace('.md', '') });
    }
  }
}
