/**
 * Smoke Test Engine — Playwright 执行引擎
 *
 * 按 VERIFY_SPEC.yaml 执行结构化流程测试
 */

import { chromium, firefox, webkit, Browser, BrowserContext, Page, Frame } from 'playwright';
import { join } from 'path';
import { ensureDir, pathExists } from 'fs-extra';
import { logger } from '../../utils/logger';
import {
  VerifySpec,
  Scenario,
  Action,
  Assertion,
  SmokeResult,
  StepResult,
} from './types';

interface SmokeOptions {
  headless?: boolean;
  browser?: 'chromium' | 'firefox' | 'webkit';
  device?: string;
  timeout?: number;
  screenshotDir: string;
  /** v8.3.95+: 自定义浏览器可执行文件路径（内网环境使用系统 Chrome/Edge） */
  executablePath?: string;
}

export async function runSmokeTest(
  spec: VerifySpec,
  options: SmokeOptions
): Promise<SmokeResult[]> {
  const browserType = options.browser || 'chromium';
  const headless = options.headless !== false;
  const timeout = options.timeout || 30000;

  logger.info(`🎭 启动 ${browserType} (headless=${headless})`);

  const browser = await launchBrowser(browserType, headless, options.executablePath);
  const context = await browser.newContext({
    viewport: getViewport(options.device),
    userAgent: getUserAgent(options.device),
  });

  const results: SmokeResult[] = [];

  try {
    for (const scenario of spec.scenarios) {
      const page = await context.newPage();
      page.setDefaultTimeout(timeout);

      const result = await runScenario(page, scenario, spec, options);
      results.push(result);

      await page.close();
    }
  } finally {
    await context.close();
    await browser.close();
  }

  return results;
}

async function launchBrowser(
  type: string,
  headless: boolean,
  customExecutablePath?: string
): Promise<Browser> {
  const browserType = type === 'firefox' ? firefox : type === 'webkit' ? webkit : chromium;

  // v8.3.95+: 优先使用自定义浏览器路径（内网环境）
  if (customExecutablePath) {
    logger.info(`  🔧 使用自定义浏览器: ${customExecutablePath}`);
    return browserType.launch({ headless, executablePath: customExecutablePath });
  }

  // v8.3.94+: 检测 Playwright 自带浏览器是否已安装
  try {
    browserType.executablePath();
    return browserType.launch({ headless });
  } catch {
    /* Playwright 浏览器未安装，继续尝试系统浏览器 */
  }

  // v8.3.95+: 自动探测本机系统浏览器（Chrome/Edge）
  const systemBrowser = await findSystemBrowser();
  if (systemBrowser) {
    logger.info(`  🔧 Playwright 浏览器未安装，自动使用系统浏览器: ${systemBrowser}`);
    return browserType.launch({ headless, executablePath: systemBrowser });
  }

  const browserName = type === 'firefox' ? 'firefox' : type === 'webkit' ? 'webkit' : 'chromium';
  throw new Error(
    `Playwright 浏览器 "${browserName}" 未安装，且未检测到本机 Chrome/Edge。\n\n` +
    `方案 1 — 在线安装（需外网）：\n` +
    `  npx playwright install ${browserName}\n\n` +
    `方案 2 — 手动指定浏览器路径（内网推荐）：\n` +
    `  设置环境变量 SPECCORE_BROWSER_PATH 指向本地浏览器：\n` +
    `    Windows: set SPECCORE_BROWSER_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"\n` +
    `    macOS: export SPECCORE_BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"\n` +
    `    Linux: export SPECCORE_BROWSER_PATH="/usr/bin/google-chrome"\n\n` +
    `方案 3 — 离线搬运：\n` +
    `  在有外网的机器执行 npx playwright install，\n` +
    `  将缓存目录复制到内网相同位置。`
  );
}

/** 按平台自动探测本机 Chrome/Edge 浏览器路径 */
async function findSystemBrowser(): Promise<string | null> {
  const candidates: string[] = [];
  const platform = process.platform;

  if (platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    );
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    );
  } else {
    // Linux & others
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
    );
  }

  for (const path of candidates) {
    if (await pathExists(path)) {
      return path;
    }
  }
  return null;
}

/** iframe 上下文包装 */
interface FrameContext {
  frame: Frame | null;
}

async function runScenario(
  page: Page,
  scenario: Scenario,
  spec: VerifySpec,
  options: SmokeOptions
): Promise<SmokeResult> {
  const startTime = Date.now();
  const steps: StepResult[] = [];
  let screenshot: string | undefined;
  const ctx: FrameContext = { frame: null };

  logger.info(`  📋 场景: ${scenario.name}`);

  try {
    // 导航到初始 URL
    const fullUrl = spec.baseUrl
      ? new URL(spec.url, spec.baseUrl).toString()
      : spec.url;
    await page.goto(fullUrl, { waitUntil: 'networkidle' });

    // 执行操作序列
    for (const action of scenario.actions) {
      const stepStart = Date.now();
      try {
        await executeAction(page, action, ctx);
        steps.push({
          action,
          passed: true,
          duration: Date.now() - stepStart,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        steps.push({
          action,
          passed: false,
          error: message,
          duration: Date.now() - stepStart,
        });
        // 操作失败，停止当前场景
        break;
      }
    }

    // 执行断言（只在所有操作都成功时）
    const allActionsPassed = steps.every((s) => s.passed);
    if (allActionsPassed) {
      for (const assertion of scenario.assertions) {
        if (assertion.type === 'visual') {
          // 视觉断言在 visual-engine 中处理，这里跳过
          continue;
        }
        const assertStart = Date.now();
        try {
          await executeAssertion(page, assertion, ctx);
          steps.push({
            action: { type: 'wait', selector: assertion.selector },
            passed: true,
            duration: Date.now() - assertStart,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          steps.push({
            action: { type: 'wait', selector: assertion.selector },
            passed: false,
            error: `断言失败: ${message}`,
            duration: Date.now() - assertStart,
          });
        }
      }
    }

    // 截图
    const safeName = scenario.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    screenshot = join(options.screenshotDir, `${safeName}.png`);
    await ensureDir(options.screenshotDir);
    await page.screenshot({ path: screenshot, fullPage: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`  ❌ 场景执行失败: ${message}`);
  }

  const passed = steps.every((s) => s.passed);
  const duration = Date.now() - startTime;

  logger.info(
    `  ${passed ? '✅' : '❌'} ${scenario.name} (${steps.filter((s) => s.passed).length}/${steps.length} 通过, ${duration}ms)`
  );

  return {
    scenarioName: scenario.name,
    passed,
    duration,
    steps,
    screenshot,
  };
}

async function executeAction(page: Page, action: Action, ctx: FrameContext): Promise<void> {
  const target = ctx.frame || page;

  switch (action.type) {
    case 'fill':
      if (!action.selector) throw new Error('fill 需要 selector');
      await target.fill(action.selector, action.value || '');
      break;

    case 'click':
      if (!action.selector) throw new Error('click 需要 selector');
      await target.click(action.selector);
      break;

    case 'select':
      if (!action.selector) throw new Error('select 需要 selector');
      await target.selectOption(action.selector, action.value || '');
      break;

    case 'check':
      if (!action.selector) throw new Error('check 需要 selector');
      await target.check(action.selector);
      break;

    case 'uncheck':
      if (!action.selector) throw new Error('uncheck 需要 selector');
      await target.uncheck(action.selector);
      break;

    case 'hover':
      if (!action.selector) throw new Error('hover 需要 selector');
      await target.hover(action.selector);
      break;

    case 'focus':
      if (!action.selector) throw new Error('focus 需要 selector');
      await target.focus(action.selector);
      break;

    case 'blur':
      if (!action.selector) throw new Error('blur 需要 selector');
      await target.evaluate(`(sel) => {
        const el = document.querySelector(sel);
        if (el && el.blur) el.blur();
      }`, action.selector);
      break;

    case 'press':
      if (!action.key) throw new Error('press 需要 key');
      if (action.selector) {
        await target.press(action.selector, action.key);
      } else {
        if (ctx.frame) throw new Error('iframe 内 press 需要 selector');
        await page.keyboard.press(action.key);
      }
      break;

    case 'wait':
      if (action.selector) {
        await target.waitForSelector(action.selector, {
          timeout: action.timeout || 10000,
        });
      } else if (action.delay) {
        await target.waitForTimeout(action.delay);
      } else {
        await target.waitForTimeout(1000);
      }
      break;

    case 'navigate':
      if (!action.value) throw new Error('navigate 需要 value (URL)');
      await page.goto(action.value, { waitUntil: 'networkidle' });
      break;

    case 'screenshot':
      // 截图在场景级别统一处理，这里只做等待
      await target.waitForTimeout(500);
      break;

    case 'cookie':
      if (!action.selector) throw new Error('cookie 需要 selector (cookie name)');
      await page.context().addCookies([{
        name: action.selector,
        value: action.value || '',
        domain: action.domain || '',
        path: action.path || '/',
        secure: action.secure ?? false,
        httpOnly: action.httpOnly ?? false,
      }]);
      break;

    case 'localStorage':
      if (!action.selector) throw new Error('localStorage 需要 selector (key)');
      await target.evaluate(
        `(${action.selector}, ${JSON.stringify(action.value || '')}) => { window.localStorage.setItem(${JSON.stringify(action.selector)}, ${JSON.stringify(action.value || '')}); }`
      );
      break;

    case 'script':
      if (!action.value) throw new Error('script 需要 value (JS 代码)');
      await target.evaluate((code) => {
        // eslint-disable-next-line no-eval
        return eval(code);
      }, action.value);
      break;

    case 'scroll':
      if (action.selector) {
        await target.evaluate(`(sel) => {
          const el = document.querySelector(sel);
          if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
        }`, action.selector);
      } else if (action.value) {
        // value 作为像素值，如 "500" 或 "bottom"
        if (action.value === 'bottom') {
          await target.evaluate(`() => { window.scrollTo(0, document.body.scrollHeight); }`);
        } else {
          const y = parseInt(action.value, 10) || 0;
          await target.evaluate(`(y) => { window.scrollTo(0, y); }`, y);
        }
      } else {
        await target.evaluate(`() => { window.scrollTo(0, document.body.scrollHeight); }`);
      }
      break;

    case 'upload':
      if (!action.selector) throw new Error('upload 需要 selector (input[type=file])');
      if (!action.value) throw new Error('upload 需要 value (文件路径)');
      await target.locator(action.selector).setInputFiles(action.value);
      break;

    case 'iframe':
      if (action.value === 'main' || action.value === 'parent' || action.selector === 'main') {
        ctx.frame = null;
      } else if (action.selector) {
        const frameElement = await page.locator(action.selector).elementHandle();
        if (!frameElement) throw new Error(`未找到 iframe 元素: ${action.selector}`);
        const newFrame = await frameElement.contentFrame();
        if (!newFrame) throw new Error(`元素不是 iframe: ${action.selector}`);
        ctx.frame = newFrame;
      } else if (action.value) {
        const newFrame = page.frame({ name: action.value! }) || page.frames().find(f => f.url().includes(action.value!));
        if (!newFrame) throw new Error(`未找到 iframe: ${action.value}`);
        ctx.frame = newFrame;
      } else {
        throw new Error('iframe 需要 selector (CSS 选择器) 或 value (frame name/url 片段)');
      }
      break;

    case 'waitForRequest':
      if (!action.value) throw new Error('waitForRequest 需要 value (URL 匹配模式)');
      await page.waitForRequest(action.value, { timeout: action.timeout || 30000 });
      break;

    case 'waitForResponse':
      if (!action.value) throw new Error('waitForResponse 需要 value (URL 匹配模式)');
      await page.waitForResponse(action.value, { timeout: action.timeout || 30000 });
      break;

    case 'drag':
      if (!action.selector) throw new Error('drag 需要 selector (源元素)');
      {
        const targetSelector = action.toSelector || action.value;
        if (!targetSelector) throw new Error('drag 需要 toSelector 或 value (目标元素)');
        const src = target.locator(action.selector);
        const dst = target.locator(targetSelector);
        await src.dragTo(dst);
      }
      break;

    default:
      throw new Error(`未知操作类型: ${action.type}`);
  }

  // 操作后等待
  if (action.waitFor) {
    await target.waitForSelector(action.waitFor, { timeout: action.timeout || 10000 });
  }

  // 操作间隔
  if (action.delay && action.delay > 0) {
    await target.waitForTimeout(action.delay);
  }
}

async function executeAssertion(page: Page, assertion: Assertion, ctx: FrameContext): Promise<void> {
  const target = ctx.frame || page;

  switch (assertion.type) {
    case 'visible':
      if (!assertion.selector) throw new Error('visible 断言需要 selector');
      await target.waitForSelector(assertion.selector, { state: 'visible' });
      break;

    case 'hidden':
      if (!assertion.selector) throw new Error('hidden 断言需要 selector');
      await target.waitForSelector(assertion.selector, { state: 'hidden' });
      break;

    case 'text':
      if (!assertion.selector) throw new Error('text 断言需要 selector');
      const text = await target.textContent(assertion.selector);
      if (assertion.contains && !text?.includes(assertion.contains)) {
        throw new Error(`文本不包含 "${assertion.contains}"，实际: "${text}"`);
      }
      if (assertion.equals && text !== assertion.equals) {
        throw new Error(`文本不匹配，期望: "${assertion.equals}"，实际: "${text}"`);
      }
      break;

    case 'value':
      if (!assertion.selector) throw new Error('value 断言需要 selector');
      const inputValue = await target.inputValue(assertion.selector);
      if (assertion.value && inputValue !== assertion.value) {
        throw new Error(`值不匹配，期望: "${assertion.value}"，实际: "${inputValue}"`);
      }
      break;

    case 'url':
      const url = page.url();
      if (assertion.contains && !url.includes(assertion.contains)) {
        throw new Error(`URL 不包含 "${assertion.contains}"，实际: "${url}"`);
      }
      if (assertion.equals && url !== assertion.equals) {
        throw new Error(`URL 不匹配，期望: "${assertion.equals}"，实际: "${url}"`);
      }
      break;

    case 'count':
      if (!assertion.selector) throw new Error('count 断言需要 selector');
      const count = await target.locator(assertion.selector).count();
      if (assertion.count !== undefined && count !== assertion.count) {
        throw new Error(`元素数量不匹配，期望: ${assertion.count}，实际: ${count}`);
      }
      break;

    case 'attribute':
      if (!assertion.selector || !assertion.attribute) {
        throw new Error('attribute 断言需要 selector 和 attribute');
      }
      const attr = await target.getAttribute(assertion.selector, assertion.attribute);
      if (assertion.value && attr !== assertion.value) {
        throw new Error(`属性 ${assertion.attribute} 不匹配，期望: "${assertion.value}"，实际: "${attr}"`);
      }
      break;

    case 'style':
      if (!assertion.selector || !assertion.style) {
        throw new Error('style 断言需要 selector 和 style (CSS 属性名)');
      }
      const actualStyle = (await target.evaluate(
        `(${JSON.stringify(assertion.selector)}, ${JSON.stringify(assertion.style)}) => {
          const el = document.querySelector(${JSON.stringify(assertion.selector)});
          return el ? window.getComputedStyle(el).getPropertyValue(${JSON.stringify(assertion.style)}) : null;
        }`
      )) as string | null;
      if (assertion.value && actualStyle !== assertion.value) {
        throw new Error(`样式 ${assertion.style} 不匹配，期望: "${assertion.value}"，实际: "${actualStyle}"`);
      }
      if (assertion.contains && !(actualStyle || '').includes(assertion.contains)) {
        throw new Error(`样式 ${assertion.style} 不包含 "${assertion.contains}"，实际: "${actualStyle}"`);
      }
      break;

    default:
      throw new Error(`未知断言类型: ${assertion.type}`);
  }
}

function getViewport(device?: string): { width: number; height: number } {
  switch (device) {
    case 'mobile':
      return { width: 375, height: 812 };
    case 'tablet':
      return { width: 768, height: 1024 };
    default:
      return { width: 1280, height: 720 };
  }
}

function getUserAgent(device?: string): string {
  switch (device) {
    case 'mobile':
      return 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
    case 'tablet':
      return 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
    default:
      return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }
}
