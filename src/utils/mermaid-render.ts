/**
 * mermaid-render — Mermaid 图表渲染工具
 * v7.0.0+: 将 .mmd 文件或 Markdown 中的 Mermaid 代码块渲染为 HTML
 *
 * 用法:
 *   speccore graph render <file.mmd>          渲染单个 .mmd 文件
 *   speccore graph render --all               批量渲染 diagrams/ 目录下所有 .mmd
 *   speccore graph render --extract <file.md> 从 Markdown 提取 Mermaid 并渲染
 */

import { readFile, writeFile, pathExists, readdir } from 'fs-extra';
import { join, basename, extname } from 'path';
import { logger } from './logger';

/** HTML 模板 */
const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{TITLE}}</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #f5f7fa;
      padding: 40px 20px;
      min-height: 100vh;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px 40px;
      border-radius: 12px;
      margin-bottom: 30px;
      box-shadow: 0 4px 20px rgba(102, 126, 234, 0.3);
    }
    .header h1 { font-size: 24px; font-weight: 600; margin-bottom: 8px; }
    .header p { opacity: 0.9; font-size: 14px; }
    .diagram-card {
      background: white;
      border-radius: 12px;
      padding: 30px;
      margin-bottom: 24px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.06);
      border: 1px solid #e8ecf1;
    }
    .diagram-card h2 {
      font-size: 18px;
      color: #1a1a2e;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 2px solid #f0f2f5;
    }
    .mermaid {
      display: flex;
      justify-content: center;
      padding: 20px 0;
    }
    .mermaid svg {
      max-width: 100%;
      height: auto;
    }
    .meta {
      display: flex;
      gap: 20px;
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid #f0f2f5;
      font-size: 12px;
      color: #8898aa;
    }
    .meta span { display: flex; align-items: center; gap: 6px; }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #8898aa;
    }
    .empty-state svg { width: 64px; height: 64px; margin-bottom: 16px; opacity: 0.5; }
    @media print {
      body { background: white; padding: 20px; }
      .header { box-shadow: none; border: 1px solid #e8ecf1; }
      .diagram-card { box-shadow: none; break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>{{TITLE}}</h1>
      <p>{{SUBTITLE}}</p>
    </div>
{{DIAGRAMS}}
  </div>
  <script>
    mermaid.initialize({
      startOnLoad: true,
      theme: 'default',
      securityLevel: 'loose',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
      sequence: { useMaxWidth: true, diagramMarginX: 20, diagramMarginY: 20 },
      graph: { useMaxWidth: true },
    });
  </script>
</body>
</html>`;

/** 单张图表的 HTML 片段 */
const DIAGRAM_CARD_TEMPLATE = `
    <div class="diagram-card">
      <h2>{{NAME}}</h2>
      <div class="mermaid">
{{CODE}}
      </div>
      <div class="meta">
        <span>📄 来源: {{SOURCE}}</span>
        <span>📐 类型: {{TYPE}}</span>
        <span>🕐 生成: {{TIME}}</span>
      </div>
    </div>`;

/** 渲染选项 */
export interface RenderOptions {
  /** 输出目录 */
  outputDir?: string;
  /** 页面标题 */
  title?: string;
}

/**
 * 渲染单个 .mmd 文件为 HTML
 */
export async function renderMmdFile(
  filePath: string,
  options: RenderOptions = {},
): Promise<string | null> {
  if (!await pathExists(filePath)) {
    logger.error(`文件不存在: ${filePath}`);
    return null;
  }

  const content = await readFile(filePath, 'utf-8');
  const fileName = basename(filePath, extname(filePath));
  const title = options.title || fileName;

  return generateHtml(title, [{ name: fileName, code: content, source: filePath, type: 'mmd' }]);
}

/**
 * 从 Markdown 文件提取 Mermaid 代码块并渲染
 */
export async function renderFromMarkdown(
  mdFilePath: string,
  options: RenderOptions = {},
): Promise<string | null> {
  if (!await pathExists(mdFilePath)) {
    logger.error(`文件不存在: ${mdFilePath}`);
    return null;
  }

  const content = await readFile(mdFilePath, 'utf-8');
  const diagrams = extractMermaidFromMarkdown(content, mdFilePath);

  if (diagrams.length === 0) {
    logger.warn(`未在 ${mdFilePath} 中发现 Mermaid 图表`);
    return null;
  }

  const fileName = basename(mdFilePath, extname(mdFilePath));
  const title = options.title || `${fileName} — 图表集`;

  return generateHtml(title, diagrams);
}

/**
 * 批量渲染目录下所有 .mmd 文件
 */
export async function renderAllMmdInDir(
  dirPath: string,
  options: RenderOptions = {},
): Promise<{ file: string; output: string }[]> {
  if (!await pathExists(dirPath)) {
    logger.error(`目录不存在: ${dirPath}`);
    return [];
  }

  const files = (await readdir(dirPath))
    .filter(f => f.endsWith('.mmd'))
    .sort();

  const results: { file: string; output: string }[] = [];

  for (const file of files) {
    const filePath = join(dirPath, file);
    const html = await renderMmdFile(filePath, options);
    if (html) {
      const outputName = file.replace('.mmd', '.html');
      const outputPath = options.outputDir
        ? join(options.outputDir, outputName)
        : join(dirPath, outputName);
      await writeFile(outputPath, html, 'utf-8');
      results.push({ file, output: outputPath });
      logger.info(`  ✓ ${file} → ${outputName}`);
    }
  }

  return results;
}

/**
 * 批量渲染目录下所有 Markdown 文件中的 Mermaid
 */
export async function renderAllMarkdownInDir(
  dirPath: string,
  options: RenderOptions = {},
): Promise<{ file: string; output: string }[]> {
  if (!await pathExists(dirPath)) {
    logger.error(`目录不存在: ${dirPath}`);
    return [];
  }

  const files = (await readdir(dirPath))
    .filter(f => f.endsWith('.md'))
    .sort();

  const results: { file: string; output: string }[] = [];

  for (const file of files) {
    const filePath = join(dirPath, file);
    const html = await renderFromMarkdown(filePath, options);
    if (html) {
      const outputName = file.replace('.md', '-diagrams.html');
      const outputPath = options.outputDir
        ? join(options.outputDir, outputName)
        : join(dirPath, outputName);
      await writeFile(outputPath, html, 'utf-8');
      results.push({ file, output: outputPath });
      logger.info(`  ✓ ${file} → ${outputName}`);
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
// 内部工具
// ═══════════════════════════════════════════════════════════

interface DiagramInfo {
  name: string;
  code: string;
  source: string;
  type: string;
}

/** 从 Markdown 提取 Mermaid 代码块 */
function extractMermaidFromMarkdown(content: string, sourcePath: string): DiagramInfo[] {
  const diagrams: DiagramInfo[] = [];
  // 匹配 ```mermaid ... ``` 代码块
  const pattern = /```mermaid\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(content)) !== null) {
    index++;
    const code = match[1]!.trim();
    // 推断图表类型
    const type = inferDiagramType(code);
    diagrams.push({
      name: `图表 ${index} (${type})`,
      code,
      source: sourcePath,
      type,
    });
  }

  return diagrams;
}

/** 推断 Mermaid 图表类型 */
function inferDiagramType(code: string): string {
  const firstLine = code.split('\n')[0]?.trim().toLowerCase() || '';
  if (firstLine.includes('sequencediagram')) return '时序图';
  if (firstLine.includes('flowchart') || firstLine.includes('graph')) return '流程图/关系图';
  if (firstLine.includes('statediagram')) return '状态图';
  if (firstLine.includes('classdiagram')) return '类图';
  if (firstLine.includes('erdiagram')) return 'ER 图';
  if (firstLine.includes('gantt')) return '甘特图';
  if (firstLine.includes('pie')) return '饼图';
  if (firstLine.includes('journey')) return '用户旅程';
  return '图表';
}

/** 生成完整 HTML */
function generateHtml(title: string, diagrams: DiagramInfo[]): string {
  const now = new Date().toLocaleString('zh-CN');

  const diagramHtml = diagrams.map((d, i) => {
    // 对 Mermaid 代码进行 HTML 转义
    const escapedCode = d.code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return DIAGRAM_CARD_TEMPLATE
      .replace('{{NAME}}', d.name)
      .replace('{{CODE}}', escapedCode)
      .replace('{{SOURCE}}', basename(d.source))
      .replace('{{TYPE}}', d.type)
      .replace('{{TIME}}', now);
  }).join('\n');

  const subtitle = diagrams.length > 0
    ? `共 ${diagrams.length} 张图表 · ${now}`
    : `生成时间: ${now}`;

  return HTML_TEMPLATE
    .replace('{{TITLE}}', title)
    .replace('{{SUBTITLE}}', subtitle)
    .replace('{{DIAGRAMS}}', diagramHtml || `
    <div class="empty-state">
      <p>未找到可渲染的图表</p>
    </div>`);
}
