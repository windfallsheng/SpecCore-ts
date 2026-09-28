// 临时脚本：将专利附图 SVG 渲染为高清 PNG（渲染后即删除）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'patent-figs');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  for (const name of ['fig1', 'fig2', 'fig3', 'fig4']) {
    const svg = fs.readFileSync(path.join(DIR, `${name}.svg`), 'utf8');
    const html = `<html><body style="margin:0;background:white">${svg}</body></html>`;
    await page.setContent(html);
    // 读取 SVG viewBox 尺寸
    const vw = await page.evaluate(() => {
      const s = document.querySelector('svg');
      return { w: s.viewBox.baseVal.width, h: s.viewBox.baseVal.height };
    });
    await page.setViewportSize({ width: Math.ceil(vw.w), height: Math.ceil(vw.h) });
    await page.screenshot({ path: path.join(DIR, `${name}.png`), fullPage: false });
    console.log(`${name}.png 完成 (${vw.w}x${vw.h})`);
  }
  await browser.close();
})();
