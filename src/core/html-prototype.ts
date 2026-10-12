/**
 * html-prototype.ts — HTML 原型渲染（Playwright 截图 + aria snapshot）
 *
 * 目的：把 HTML 原型变成「视觉产物」+「语义结构」两条产物，替代 extractHtmlText 纯文本。
 *   - 截图 PNG        → 多模态宿主直看（CSS 样式、空间布局都在）
 *   - aria snapshot   → 纯文本宿主读（YAML 格式的 ARIA 树：role + name + 层级）
 *
 * 失败兜底：Playwright 浏览器未安装 / 渲染异常时返回 null，调用方降级 extractHtmlText。
 */

import { chromium, Browser } from 'playwright';
import { pathToFileURL } from 'url';
import { join, basename } from 'path';
import { getProjectRoot } from '../utils/task-utils';
import { ensureDir, pathExists } from 'fs-extra';
import { existsSync } from 'fs';

export interface HtmlPrototype {
  /** 截图 PNG 绝对路径（多模态用） */
  screenshotPath: string | null;
  /** ARIA 树文本（YAML，纯文本用） */
  accessibilityTree: string | null;
}

/**
 * 渲染 HTML 原型：截图 + aria snapshot。
 * @param htmlPath 本地 HTML 文件路径
 * @param outputDir 截图输出目录（默认 .speccore/cache/prototypes/）
 */
export async function renderHtmlPrototype(
  htmlPath: string,
  outputDir?: string,
): Promise<HtmlPrototype | null> {
  if (!(await pathExists(htmlPath))) return null;

  const dir = outputDir || join(getProjectRoot(), '.speccore', 'cache', 'prototypes');
  await ensureDir(dir);

  let browser: Browser | null = null;
  try {
    browser = await launchChromium();
    if (!browser) return null;

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(pathToFileURL(htmlPath).toString(), { waitUntil: 'load' });

    // 截图（全页）
    const shotPath = join(dir, `${basename(htmlPath).replace(/\.html?$/i, '')}.png`);
    await page.screenshot({ path: shotPath, fullPage: true });

    // ARIA 树（YAML 字符串：role + name + 层级）
    let tree: string | null = null;
    try {
      const snapshot = await page.locator('html').ariaSnapshot();
      tree = snapshot || null;
    } catch {
      tree = null;
    }

    await context.close();
    return { screenshotPath: shotPath, accessibilityTree: tree };
  } catch {
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/** 启动 chromium（Playwright 自带 → 环境变量 → 系统浏览器 → null） */
async function launchChromium(): Promise<Browser | null> {
  // 1. Playwright 自带浏览器
  try {
    chromium.executablePath();
    return await chromium.launch({ headless: true });
  } catch { /* 未安装，继续 */ }

  // 2. 环境变量指定路径
  const envPath = process.env.SPECCORE_BROWSER_PATH;
  if (envPath) {
    try {
      return await chromium.launch({ headless: true, executablePath: envPath });
    } catch { /* 继续 */ }
  }

  // 3. 系统浏览器（Chrome/Edge）
  const system = findSystemBrowser();
  if (system) {
    try {
      return await chromium.launch({ headless: true, executablePath: system });
    } catch { /* 继续 */ }
  }

  return null;
}

/** 探测本机系统浏览器路径 */
function findSystemBrowser(): string | null {
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
    );
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}
