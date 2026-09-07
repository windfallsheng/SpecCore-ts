/**
 * UI Verify Report Generator — HTML 报告生成器
 */

import { join } from 'path';
import { writeFile, ensureDir } from 'fs-extra';
import { UIVerifyReport } from './types';

export async function generateHtmlReport(
  report: UIVerifyReport,
  outputDir: string
): Promise<string> {
  await ensureDir(outputDir);

  const timestamp = new Date(report.timestamp).toLocaleString('zh-CN');
  const passRate = report.summary.total > 0
    ? Math.round((report.summary.passed / report.summary.total) * 100)
    : 0;

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UI 验证报告 — ${report.taskId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      color: #333;
      line-height: 1.6;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 12px;
      margin-bottom: 24px;
    }
    .header h1 { font-size: 24px; margin-bottom: 8px; }
    .header .meta { opacity: 0.9; font-size: 14px; }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .card .label { font-size: 12px; color: #666; text-transform: uppercase; }
    .card .value { font-size: 28px; font-weight: bold; margin-top: 4px; }
    .card.success { border-left: 4px solid #22c55e; }
    .card.fail { border-left: 4px solid #ef4444; }
    .card.warn { border-left: 4px solid #f59e0b; }
    .section { background: white; border-radius: 8px; padding: 24px; margin-bottom: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .section h2 { font-size: 18px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
    .scenario { border: 1px solid #e5e5e5; border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
    .scenario-header {
      padding: 12px 16px;
      background: #fafafa;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .scenario-header.pass { border-left: 4px solid #22c55e; }
    .scenario-header.fail { border-left: 4px solid #ef4444; }
    .scenario-body { padding: 16px; }
    .screenshot-comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px; }
    .screenshot-box { text-align: center; }
    .screenshot-box img { max-width: 100%; border-radius: 4px; border: 1px solid #ddd; }
    .screenshot-box .label { font-size: 12px; color: #666; margin-top: 4px; }
    .steps { margin-top: 12px; }
    .step { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 14px; }
    .step.pass { color: #22c55e; }
    .step.fail { color: #ef4444; }
    .issues { margin-top: 12px; }
    .issue { padding: 8px 12px; border-radius: 4px; margin-bottom: 8px; font-size: 14px; }
    .issue.error { background: #fef2f2; color: #991b1b; }
    .issue.warning { background: #fffbeb; color: #92400e; }
    .issue.info { background: #eff6ff; color: #1e40af; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
    }
    .badge.pass { background: #dcfce7; color: #166534; }
    .badge.fail { background: #fee2e2; color: #991b1b; }
    .badge.warn { background: #fef3c7; color: #92400e; }
    .status-bar {
      height: 8px;
      background: #e5e5e5;
      border-radius: 4px;
      overflow: hidden;
      margin-top: 8px;
    }
    .status-bar .fill {
      height: 100%;
      background: linear-gradient(90deg, #22c55e 0%, #22c55e var(--pass-rate), #ef4444 var(--pass-rate), #ef4444 100%);
      transition: width 0.3s ease;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>UI 验证报告</h1>
      <div class="meta">
        任务: ${report.taskId} | 平台: ${report.platform} | 时间: ${timestamp} | 耗时: ${(report.summary.duration / 1000).toFixed(1)}s
      </div>
    </div>

    <div class="summary">
      <div class="card ${report.summary.failed === 0 ? 'success' : 'fail'}">
        <div class="label">通过率</div>
        <div class="value">${passRate}%</div>
        <div class="status-bar"><div class="fill" style="--pass-rate: ${passRate}%; width: 100%;"></div></div>
      </div>
      <div class="card success">
        <div class="label">通过</div>
        <div class="value">${report.summary.passed}</div>
      </div>
      <div class="card ${report.summary.failed > 0 ? 'fail' : 'success'}">
        <div class="label">失败</div>
        <div class="value">${report.summary.failed}</div>
      </div>
      <div class="card">
        <div class="label">场景总数</div>
        <div class="value">${report.summary.total}</div>
      </div>
    </div>

    ${report.smokeEnabled ? generateSmokeSection(report) : ''}
    ${report.visualEnabled ? generateVisualSection(report) : ''}
  </div>
</body>
</html>`;

  const reportPath = join(outputDir, `ui-verify-${report.taskId}.html`);
  await writeFile(reportPath, html, 'utf-8');
  return reportPath;
}

function generateSmokeSection(report: UIVerifyReport): string {
  if (report.smokeResults.length === 0) return '';

  const scenarios = report.smokeResults.map((r) => {
    const steps = r.steps.map((s) => {
      const icon = s.passed ? '✅' : '❌';
      const actionDesc = s.action.selector
        ? `${s.action.type}(${s.action.selector})`
        : s.action.type;
      const error = s.error ? `<div style="color:#ef4444;font-size:12px;margin-left:24px;">${s.error}</div>` : '';
      return `<div class="step ${s.passed ? 'pass' : 'fail'}">${icon} ${actionDesc} (${s.duration}ms)</div>${error}`;
    }).join('');

    return `
    <div class="scenario">
      <div class="scenario-header ${r.passed ? 'pass' : 'fail'}">
        <strong>${r.scenarioName}</strong>
        <span class="badge ${r.passed ? 'pass' : 'fail'}">${r.passed ? '通过' : '失败'}</span>
      </div>
      <div class="scenario-body">
        <div class="steps">${steps}</div>
        ${r.screenshot ? `<div style="margin-top:12px;"><img src="${r.screenshot}" style="max-width:100%;border-radius:4px;border:1px solid #ddd;" /></div>` : ''}
      </div>
    </div>`;
  }).join('');

  return `
  <div class="section">
    <h2>🔥 冒烟测试结果</h2>
    ${scenarios}
  </div>`;
}

function generateVisualSection(report: UIVerifyReport): string {
  if (report.visualResults.length === 0) return '';

  const scenarios = report.visualResults.map((r) => {
    const issues = r.issues.map((i) =>
      `<div class="issue ${i.severity}">${i.severity.toUpperCase()}: ${i.description}</div>`
    ).join('');

    const comparison = r.baselinePath ? `
    <div class="screenshot-comparison">
      <div class="screenshot-box">
        <img src="${r.baselinePath}" alt="基准图" />
        <div class="label">基准图</div>
      </div>
      <div class="screenshot-box">
        <img src="${r.currentPath}" alt="当前截图" />
        <div class="label">当前截图</div>
      </div>
    </div>` : '';

    return `
    <div class="scenario">
      <div class="scenario-header ${r.passed ? 'pass' : 'warn'}">
        <strong>${r.scenarioName}</strong>
        <span class="badge ${r.passed ? 'pass' : 'warn'}">${r.passed ? '通过' : '警告'}</span>
      </div>
      <div class="scenario-body">
        <p style="font-size:14px;color:#666;margin-bottom:12px;">${r.analysis}</p>
        ${comparison}
        ${issues ? `<div class="issues">${issues}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  return `
  <div class="section">
    <h2>👁️ 视觉检查结果</h2>
    ${scenarios}
  </div>`;
}
