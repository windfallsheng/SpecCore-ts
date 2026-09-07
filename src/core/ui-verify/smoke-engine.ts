/**
 * Smoke Test Engine — Playwright 执行引擎
 *
 * 按 VERIFY_SPEC.yaml 执行结构化流程测试
 */

import { chromium, firefox, webkit, Browser, BrowserContext, Page } from 'playwright';
import { join } from 'path';
import { ensureDir } from 'fs-extra';
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
}

export async function runSmokeTest(
  spec: VerifySpec,
  options: SmokeOptions
): Promise<SmokeResult[]> {
  const browserType = options.browser || 'chromium';
  const headless = options.headless !== false;
  const timeout = options.timeout || 30000;

  logger.info(`🎭 启动 ${browserType} (headless=${headless})`);

  const browser = await launchBrowser(browserType, headless);
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
  headless: boolean
): Promise<Browser> {
  switch (type) {
    case 'firefox':
      return firefox.launch({ headless });
    case 'webkit':
      return webkit.launch({ headless });
    default:
      return chromium.launch({ headless });
  }
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
        await executeAction(page, action);
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
          await executeAssertion(page, assertion);
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

async function executeAction(page: Page, action: Action): Promise<void> {
  switch (action.type) {
    case 'fill':
      if (!action.selector) throw new Error('fill 需要 selector');
      await page.fill(action.selector, action.value || '');
      break;

    case 'click':
      if (!action.selector) throw new Error('click 需要 selector');
      await page.click(action.selector);
      break;

    case 'select':
      if (!action.selector) throw new Error('select 需要 selector');
      await page.selectOption(action.selector, action.value || '');
      break;

    case 'check':
      if (!action.selector) throw new Error('check 需要 selector');
      await page.check(action.selector);
      break;

    case 'uncheck':
      if (!action.selector) throw new Error('uncheck 需要 selector');
      await page.uncheck(action.selector);
      break;

    case 'hover':
      if (!action.selector) throw new Error('hover 需要 selector');
      await page.hover(action.selector);
      break;

    case 'focus':
      if (!action.selector) throw new Error('focus 需要 selector');
      await page.focus(action.selector);
      break;

    case 'blur':
      if (!action.selector) throw new Error('blur 需要 selector');
      await page.evaluate(`(sel) => {
        const el = document.querySelector(sel);
        if (el && el.blur) el.blur();
      }`, action.selector);
      break;

    case 'press':
      if (!action.key) throw new Error('press 需要 key');
      await page.keyboard.press(action.key);
      break;

    case 'wait':
      if (action.selector) {
        await page.waitForSelector(action.selector, {
          timeout: action.timeout || 10000,
        });
      } else if (action.delay) {
        await page.waitForTimeout(action.delay);
      } else {
        await page.waitForTimeout(1000);
      }
      break;

    case 'navigate':
      if (!action.value) throw new Error('navigate 需要 value (URL)');
      await page.goto(action.value, { waitUntil: 'networkidle' });
      break;

    case 'screenshot':
      // 截图在场景级别统一处理，这里只做等待
      await page.waitForTimeout(500);
      break;

    default:
      throw new Error(`未知操作类型: ${action.type}`);
  }

  // 操作后等待
  if (action.waitFor) {
    await page.waitForSelector(action.waitFor, { timeout: action.timeout || 10000 });
  }

  // 操作间隔
  if (action.delay && action.delay > 0) {
    await page.waitForTimeout(action.delay);
  }
}

async function executeAssertion(page: Page, assertion: Assertion): Promise<void> {
  switch (assertion.type) {
    case 'visible':
      if (!assertion.selector) throw new Error('visible 断言需要 selector');
      await page.waitForSelector(assertion.selector, { state: 'visible' });
      break;

    case 'hidden':
      if (!assertion.selector) throw new Error('hidden 断言需要 selector');
      await page.waitForSelector(assertion.selector, { state: 'hidden' });
      break;

    case 'text':
      if (!assertion.selector) throw new Error('text 断言需要 selector');
      const text = await page.textContent(assertion.selector);
      if (assertion.contains && !text?.includes(assertion.contains)) {
        throw new Error(`文本不包含 "${assertion.contains}"，实际: "${text}"`);
      }
      if (assertion.equals && text !== assertion.equals) {
        throw new Error(`文本不匹配，期望: "${assertion.equals}"，实际: "${text}"`);
      }
      break;

    case 'value':
      if (!assertion.selector) throw new Error('value 断言需要 selector');
      const inputValue = await page.inputValue(assertion.selector);
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
      const count = await page.locator(assertion.selector).count();
      if (assertion.count !== undefined && count !== assertion.count) {
        throw new Error(`元素数量不匹配，期望: ${assertion.count}，实际: ${count}`);
      }
      break;

    case 'attribute':
      if (!assertion.selector || !assertion.attribute) {
        throw new Error('attribute 断言需要 selector 和 attribute');
      }
      const attr = await page.getAttribute(assertion.selector, assertion.attribute);
      if (assertion.value && attr !== assertion.value) {
        throw new Error(`属性 ${assertion.attribute} 不匹配，期望: "${assertion.value}"，实际: "${attr}"`);
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
