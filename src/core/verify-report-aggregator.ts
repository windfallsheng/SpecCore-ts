/**
 * 验证报告聚合器 — 迭代级质量看板
 *
 * 三层视图：全局汇总 → 按功能模块 → 按端 → 任务明细
 * 输出: 000-overview/quality-report.html
 */

import { join } from 'path';
import { pathExists, readFile, ensureDir, writeFile, readdir } from 'fs-extra';
import { logger } from '../utils/logger';

// ─────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────

export interface TaskReport {
  taskId: string;
  feature?: string;
  platforms: string[];
  codeVerify?: { passed: boolean; passRate: number; reportPath: string };
  uiVerify?: { passed: boolean | null; passRate: number; reportPath: string };
  apiVerify?: { passed: boolean; passRate: number; reportPath: string };
  perfVerify?: { passed: boolean; passRate: number; reportPath: string };
}

export interface FeatureGroup {
  feature: string;
  tasks: TaskReport[];
  platforms: Set<string>;
}

export interface PlatformGroup {
  platform: string;
  tasks: TaskReport[];
}

// ─────────────────────────────────────────
// 主入口
// ─────────────────────────────────────────

export async function generateQualityReport(
  iterDir: string,
  taskReports: TaskReport[]
): Promise<string> {
  const overviewDir = join(iterDir, '000-overview');
  await ensureDir(overviewDir);

  const { features, platforms } = groupReports(taskReports);
  const html = buildHtmlReport(taskReports, features, platforms);
  const htmlPath = join(overviewDir, 'quality-report.html');
  await writeFile(htmlPath, html, 'utf-8');

  logger.info(`📊 迭代质量看板: ${htmlPath}`);
  return htmlPath;
}

// ─────────────────────────────────────────
// 分组统计
// ─────────────────────────────────────────

function groupReports(reports: TaskReport[]): { features: FeatureGroup[]; platforms: PlatformGroup[] } {
  // 按功能分组
  const featureMap = new Map<string, FeatureGroup>();
  for (const r of reports) {
    const f = r.feature || '未分类';
    if (!featureMap.has(f)) {
      featureMap.set(f, { feature: f, tasks: [], platforms: new Set() });
    }
    const g = featureMap.get(f)!;
    g.tasks.push(r);
    for (const p of r.platforms) g.platforms.add(p);
  }

  // 按端分组
  const platformMap = new Map<string, PlatformGroup>();
  for (const r of reports) {
    for (const p of r.platforms) {
      if (!platformMap.has(p)) {
        platformMap.set(p, { platform: p, tasks: [] });
      }
      platformMap.get(p)!.tasks.push(r);
    }
  }

  return {
    features: Array.from(featureMap.values()),
    platforms: Array.from(platformMap.values()),
  };
}

// ─────────────────────────────────────────
// 自动收集迭代下所有 Task 的报告
// ─────────────────────────────────────────

export async function collectTaskReports(iterDir: string): Promise<TaskReport[]> {
  const tasksDir = join(iterDir, '030-tasks');
  if (!(await pathExists(tasksDir))) return [];

  const entries = await readdir(tasksDir, { withFileTypes: true });
  const taskDirs = entries.filter((e) => e.isDirectory() && e.name.startsWith('Task-'));

  const reports: TaskReport[] = [];
  for (const d of taskDirs) {
    const taskDir = join(tasksDir, d.name);
    const artifactsDir = join(taskDir, '99-artifacts');

    // 解析功能名: Task-001-login → login
    const feature = parseFeatureFromTaskId(d.name);

    // 扫描端列表
    const platforms = await scanPlatforms(taskDir);

    const report: TaskReport = { taskId: d.name, feature, platforms };

    // 代码验证报告
    const codeReportPath = join(artifactsDir, 'verify-report.json');
    if (await pathExists(codeReportPath)) {
      try {
        const raw = await readFile(codeReportPath, 'utf-8');
        const data = JSON.parse(raw);
        report.codeVerify = {
          passed: data.summary?.failed === 0,
          passRate: data.summary?.total > 0
            ? Math.round((data.summary.passed / data.summary.total) * 100)
            : 0,
          reportPath: codeReportPath,
        };
      } catch { /* 忽略 */ }
    }

    // UI 验证状态
    const uiStatusPath = join(taskDir, '.ui-verify-status.json');
    const uiReportPath = join(artifactsDir, 'ui-verify-report.html');
    if (await pathExists(uiStatusPath)) {
      try {
        const raw = await readFile(uiStatusPath, 'utf-8');
        const data = JSON.parse(raw);
        report.uiVerify = {
          passed: data.passed,
          passRate: data.passed === true ? 100 : data.passed === false ? 0 : 0,
          reportPath: uiReportPath,
        };
      } catch { /* 忽略 */ }
    }

    // API 契约报告
    const apiReportPath = join(artifactsDir, 'api-verify-report.json');
    if (await pathExists(apiReportPath)) {
      try {
        const raw = await readFile(apiReportPath, 'utf-8');
        const data = JSON.parse(raw);
        report.apiVerify = {
          passed: data.summary?.failed === 0,
          passRate: data.summary?.total > 0
            ? Math.round((data.summary.passed / data.summary.total) * 100)
            : 0,
          reportPath: apiReportPath,
        };
      } catch { /* 忽略 */ }
    }

    // 性能基线报告
    const perfReportPath = join(artifactsDir, 'perf-verify-report.json');
    if (await pathExists(perfReportPath)) {
      try {
        const raw = await readFile(perfReportPath, 'utf-8');
        const data = JSON.parse(raw);
        report.perfVerify = {
          passed: data.summary?.failed === 0,
          passRate: data.summary?.total > 0
            ? Math.round((data.summary.passed / data.summary.total) * 100)
            : 0,
          reportPath: perfReportPath,
        };
      } catch { /* 忽略 */ }
    }

    if (report.codeVerify || report.uiVerify || report.apiVerify || report.perfVerify) {
      reports.push(report);
    }
  }

  return reports;
}

// ── 从 Task ID 解析功能名 ──

function parseFeatureFromTaskId(taskId: string): string {
  // Task-001-login → login
  // Task-001-login-page → login-page
  const match = taskId.match(/^Task-\d+-(.+)$/);
  return match ? match[1] : taskId;
}

// ── 扫描 Task 下的端列表 ──

async function scanPlatforms(taskDir: string): Promise<string[]> {
  const platforms: string[] = [];
  // v8.3.121+: 端平铺结构扫描
  const EXCLUDE_DIRS = new Set(['00-specs', '_shared', '99-artifacts', '.meta']);
  try {
    const entries = await readdir(taskDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && !EXCLUDE_DIRS.has(e.name)) {
        platforms.push(e.name);
      }
    }
  } catch { /* 忽略 */ }

  // 如果没有端目录，标记为通用
  if (platforms.length === 0) platforms.push('general');

  return platforms;
}

// ─────────────────────────────────────────
// HTML 生成
// ─────────────────────────────────────────

function buildHtmlReport(
  reports: TaskReport[],
  features: FeatureGroup[],
  platforms: PlatformGroup[]
): string {
  const total = reports.length;
  const codePass = reports.filter((r) => r.codeVerify?.passed).length;
  const uiPass = reports.filter((r) => r.uiVerify?.passed === true).length;
  const apiPass = reports.filter((r) => r.apiVerify?.passed).length;
  const perfPass = reports.filter((r) => r.perfVerify?.passed).length;

  // 按端统计卡片
  const platformCards = platforms.map((p) => {
    const pCodePass = p.tasks.filter((t) => t.codeVerify?.passed).length;
    const pUiPass = p.tasks.filter((t) => t.uiVerify?.passed === true).length;
    const pApiPass = p.tasks.filter((t) => t.apiVerify?.passed).length;
    return `
      <div class="card small">
        <h3>${platformLabel(p.platform)}</h3>
        <div class="value">${p.tasks.length}</div>
        <div class="detail">任务数 | 代码 ${pCodePass}/${p.tasks.length} | UI ${pUiPass}/${p.tasks.length} | API ${pApiPass}/${p.tasks.length}</div>
      </div>
    `;
  }).join('');

  // 按功能模块表格
  const featureRows = features.map((f) => {
    const platCells = Array.from(f.platforms).map((plat) => {
      const tasks = f.tasks.filter((t) => t.platforms.includes(plat));
      const allPassed = tasks.every((t) =>
        (!t.codeVerify || t.codeVerify.passed) &&
        (!t.uiVerify || t.uiVerify.passed === true) &&
        (!t.apiVerify || t.apiVerify.passed) &&
        (!t.perfVerify || t.perfVerify.passed)
      );
      return `<span class="plat-tag ${allPassed ? 'pass' : 'fail'}">${platLabel(plat)} ${allPassed ? '✅' : '❌'}</span>`;
    }).join(' ');

    const taskList = f.tasks.map((t) => {
      const icon = taskOverallStatus(t) === 'pass' ? '✅' : taskOverallStatus(t) === 'fail' ? '❌' : '⏭️';
      return `<span class="task-tag">${icon} ${t.taskId}</span>`;
    }).join(' ');

    return `
      <tr>
        <td><strong>${f.feature}</strong></td>
        <td>${platCells}</td>
        <td>${taskList}</td>
      </tr>
    `;
  }).join('');

  // 任务明细表格
  const taskRows = reports.map((r) => {
    const code = renderStatus(r.codeVerify?.passed, r.codeVerify?.passRate);
    const ui = renderStatus(r.uiVerify?.passed, r.uiVerify?.passRate);
    const api = renderStatus(r.apiVerify?.passed, r.apiVerify?.passRate);
    const perf = renderStatus(r.perfVerify?.passed, r.perfVerify?.passRate);
    const plats = r.platforms.map((p) => `<span class="plat-badge">${platLabel(p)}</span>`).join('');

    return `
      <tr>
        <td><strong>${r.taskId}</strong><div class="plat-list">${plats}</div></td>
        <td>${code}</td>
        <td>${ui}</td>
        <td>${api}</td>
        <td>${perf}</td>
      </tr>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>迭代质量看板</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 40px; }
  .container { max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 28px; margin-bottom: 8px; color: #1a1a1a; }
  h2 { font-size: 20px; margin: 32px 0 16px; color: #1a1a1a; }
  .subtitle { color: #666; margin-bottom: 32px; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
  .card { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .card.small { padding: 16px; }
  .card h3 { font-size: 13px; color: #666; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
  .card .value { font-size: 32px; font-weight: 700; color: #1a1a1a; }
  .card.small .value { font-size: 24px; }
  .card .detail { font-size: 12px; color: #999; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); margin-bottom: 24px; }
  th { background: #fafafa; padding: 14px 20px; text-align: left; font-size: 13px; color: #666; font-weight: 500; border-bottom: 1px solid #eee; }
  td { padding: 14px 20px; border-bottom: 1px solid #f0f0f0; font-size: 14px; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .pass { color: #16a34a; }
  .fail { color: #dc2626; }
  .warn { color: #ca8a04; }
  .skip { color: #9ca3af; }
  .plat-tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-right: 6px; background: #f0f0f0; }
  .plat-tag.pass { background: #dcfce7; }
  .plat-tag.fail { background: #fee2e2; }
  .task-tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-right: 6px; background: #f5f5f5; color: #666; }
  .plat-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; background: #e5e7eb; color: #6b7280; margin-right: 4px; margin-top: 4px; }
  .plat-list { margin-top: 4px; }
  .section { margin-bottom: 40px; }
  .footer { margin-top: 24px; text-align: center; color: #999; font-size: 12px; }
</style>
</head>
<body>
<div class="container">
  <h1>迭代质量看板</h1>
  <p class="subtitle">生成时间: ${new Date().toLocaleString('zh-CN')}</p>

  <!-- 全局汇总 -->
  <div class="summary">
    <div class="card">
      <h3>代码验证</h3>
      <div class="value">${codePass}/${total}</div>
      <div class="detail">通过任务数</div>
    </div>
    <div class="card">
      <h3>UI 验证</h3>
      <div class="value">${uiPass}/${total}</div>
      <div class="detail">通过任务数</div>
    </div>
    <div class="card">
      <h3>API 契约</h3>
      <div class="value">${apiPass}/${total}</div>
      <div class="detail">通过任务数</div>
    </div>
    <div class="card">
      <h3>性能基线</h3>
      <div class="value">${perfPass}/${total}</div>
      <div class="detail">通过任务数</div>
    </div>
  </div>

  <!-- 按端统计 -->
  <div class="section">
    <h2>按端统计</h2>
    <div class="summary">
      ${platformCards || '<div class="card small"><h3>暂无数据</h3><div class="value">—</div></div>'}
    </div>
  </div>

  <!-- 按功能模块 -->
  <div class="section">
    <h2>按功能模块</h2>
    <table>
      <thead>
        <tr>
          <th>功能模块</th>
          <th>各端状态</th>
          <th>关联任务</th>
        </tr>
      </thead>
      <tbody>
        ${featureRows || '<tr><td colspan="3" style="text-align:center;color:#999;padding:40px;">暂无功能模块数据</td></tr>'}
      </tbody>
    </table>
  </div>

  <!-- 任务明细 -->
  <div class="section">
    <h2>任务明细</h2>
    <table>
      <thead>
        <tr>
          <th>任务</th>
          <th>代码验证</th>
          <th>UI 验证</th>
          <th>API 契约</th>
          <th>性能基线</th>
        </tr>
      </thead>
      <tbody>
        ${taskRows || '<tr><td colspan="5" style="text-align:center;color:#999;padding:40px;">暂无测试数据</td></tr>'}
      </tbody>
    </table>
  </div>

  <p class="footer">SpecCore Quality Dashboard</p>
</div>
</body>
</html>`;
}

// ─────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────

function renderStatus(passed: boolean | null | undefined, passRate?: number): string {
  if (passed === undefined || passed === null) return '<span class="skip">—</span>';
  const icon = passed ? '✅' : '❌';
  const cls = passed ? 'pass' : 'fail';
  const rate = passRate !== undefined ? ` ${passRate}%` : '';
  return `<span class="${cls}">${icon}${rate}</span>`;
}

function taskOverallStatus(t: TaskReport): 'pass' | 'fail' | 'pending' {
  if (t.codeVerify?.passed === false) return 'fail';
  if (t.uiVerify?.passed === false) return 'fail';
  if (t.apiVerify?.passed === false) return 'fail';
  if (t.perfVerify?.passed === false) return 'fail';
  if (t.codeVerify?.passed || t.uiVerify?.passed === true || t.apiVerify?.passed || t.perfVerify?.passed) return 'pass';
  return 'pending';
}

function platformLabel(p: string): string {
  const map: Record<string, string> = {
    api: '⚙️ 后端 API',
    h5: '📱 H5',
    admin: '🖥️ 管理后台',
    pc: '💻 PC 端',
    app: '📲 App',
    miniapp: '小程序',
    general: '📦 通用',
  };
  return map[p] || p;
}

function platLabel(p: string): string {
  const map: Record<string, string> = {
    api: 'API',
    h5: 'H5',
    admin: 'Admin',
    pc: 'PC',
    app: 'App',
    miniapp: '小程序',
    general: '通用',
  };
  return map[p] || p;
}
