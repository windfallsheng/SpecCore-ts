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
  format?: string;      // docx | pdf | html | pptx
  output?: string;
  all?: boolean;         // 导出期次全部文档（合并）
  ai?: boolean;          // --ai (default true): 提示 AI 精炼
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
  const format = options.format || 'docx';
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

  if (options.all && iterName) {
    // 全量导出：期次下所有 .md 文件
    const iterDir = iterName.startsWith('期次-') ? iterName : `期次-${iterName}`;
    if (!await pathExists(iterDir)) {
      logger.error(`期次不存在: ${iterDir}`);
      return;
    }
    await collectAllMd(iterDir, sourceFiles);
  } else if (options.task && iterName) {
    // 任务导出
    const iterDir = iterName.startsWith('期次-') ? iterName : `期次-${iterName}`;
    const taskDir = join(iterDir, options.task.startsWith('Task-') ? options.task : `Task-${options.task}`);
    if (!await pathExists(taskDir)) {
      logger.error(`任务目录不存在: ${taskDir}`);
      return;
    }
    await collectAllMd(taskDir, sourceFiles);
  } else {
    // 默认：当前期次的 REQUIREMENT.md
    if (!iterName) {
      logger.error('请指定期次: --iteration <name>');
      return;
    }
    const iterDir = iterName.startsWith('期次-') ? iterName : `期次-${iterName}`;
    const reqFile = join(iterDir, '00-需求文档', 'REQUIREMENT.md');
    if (await pathExists(reqFile)) {
      sourceFiles.push({ path: reqFile, label: '需求文档' });
    }
    // 也检查 ANALYSIS.md
    const anaFile = join(iterDir, '00-需求文档', 'ANALYSIS.md');
    if (await pathExists(anaFile)) {
      sourceFiles.push({ path: anaFile, label: '分析文档' });
    }
  }

  if (sourceFiles.length === 0) {
    logger.error('未找到可导出的 SpecCore 文档。请指定 --iteration 或 --task');
    return;
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
      logger.info('  🔬 双路验证模式：');
      logger.info(`     pandoc 已完成基础导出 → ${outputPath}`);
      logger.info(`     📌 如需 AI 优化排版/样式/图表：`);
      logger.info(`        在 WorkBuddy 中说: 优化排版 ${outputPath}`);
      logger.info('');
      logger.info('  💡 纯 pandoc 导出: speccore spec2doc --no-ai');
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
