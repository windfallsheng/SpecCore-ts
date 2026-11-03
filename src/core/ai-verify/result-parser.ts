/**
 * result-parser — 执行结果解析与 HTML 报告生成（v8.3.350+）
 *
 * 宿主 AI 执行完剧本写回 results.json，本模块负责：
 *   1. 结构校验 + 与 plan.json 场景对齐（缺漏场景标未执行）
 *   2. 生成 HTML 报告（复用 ui-verify 报告的视觉风格）
 */

import { join } from 'path';
import { ensureDir, readFile, writeFile } from 'fs-extra';
import type { AiVerifyExecutor, AiVerifyPlan, AiVerifyReportContext, AiVerifyResults } from './types';

/** 执行通道展示名 */
export const EXECUTOR_LABELS: Record<AiVerifyExecutor, string> = {
  'browser-agent': 'Browser 子代理',
  'playwright-mcp': 'Playwright MCP',
  'visual-judge': '视觉模型判定',
  manual: '人工执行',
};

/** 解析 results.json（结构校验，非法返回 null） */
export async function parseAiVerifyResults(resultsPath: string): Promise<AiVerifyResults | null> {
  try {
    const raw = await readFile(resultsPath, 'utf-8');
    const parsed = JSON.parse(raw) as AiVerifyResults;
    if (!parsed || !Array.isArray(parsed.results)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 场景对齐：找出剧本中有而结果中缺失的场景（未执行） */
export function findMissingScenarios(plan: AiVerifyPlan, results: AiVerifyResults): string[] {
  const executed = new Set(results.results.map((r) => r.scenarioId));
  return plan.scenarios.map((s) => s.id).filter((id) => !executed.has(id));
}

/** 组装报告上下文 */
export function buildReportContext(plan: AiVerifyPlan, results: AiVerifyResults): AiVerifyReportContext {
  return { plan, results, missing: findMissingScenarios(plan, results) };
}

/** 摘要统计（通过/失败/跳过/未执行） */
export function summarizeResults(ctx: AiVerifyReportContext): {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  notRun: number;
} {
  const { plan, results, missing } = ctx;
  const byId = new Map(results.results.map((r) => [r.scenarioId, r]));
  const total = plan.scenarios.length;
  const passed = plan.scenarios.filter((s) => byId.get(s.id)?.passed).length;
  const failed = plan.scenarios.filter((s) => {
    const r = byId.get(s.id);
    return r && !r.passed && !r.skipped;
  }).length;
  const skipped = plan.scenarios.filter((s) => byId.get(s.id)?.skipped).length;
  return { total, passed, failed, skipped, notRun: missing.length };
}

/** HTML 转义 */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 按端分组渲染场景卡片（层内复用） */
function renderPlatformSections(
  scenarios: import('./types').AiVerifyScenario[],
  byId: Map<string, import('./types').AiVerifyResult>
): string {
  const byPlatform = new Map<string, typeof scenarios>();
  for (const s of scenarios) {
    const list = byPlatform.get(s.platform) || [];
    list.push(s);
    byPlatform.set(s.platform, list);
  }

  const platformSections: string[] = [];
  for (const [platform, list] of byPlatform) {
    const cards = list
      .map((s) => {
        const r = byId.get(s.id);
        let status: string;
        let badge: string;
        if (!r) {
          status = 'notrun';
          badge = '<span class="badge notrun">未执行</span>';
        } else if (r.skipped) {
          status = 'skip';
          badge = '<span class="badge skip">跳过</span>';
        } else if (r.passed) {
          status = 'pass';
          badge = '<span class="badge pass">通过</span>';
        } else {
          status = 'fail';
          badge = '<span class="badge fail">失败</span>';
        }
        const reason = r ? `<div class="reason">${esc(r.reason)}</div>` : '';
        const executorLabel = r?.executor ? ` · 执行通道: ${esc(EXECUTOR_LABELS[r.executor] || r.executor)}` : '';
        const screenshots = (r?.screenshots || [])
          .map(
            (shot) =>
              `<div class="shot"><img src="${esc(shot)}" onerror="this.style.display='none'" /></div>`
          )
          .join('');
        return `
    <div class="scenario ${status}">
      <div class="scenario-header">
        <strong>${esc(s.title)}</strong>
        ${badge}
      </div>
      <div class="scenario-body">
        <div class="meta">${esc(s.unit)} · ${esc(s.platform)}${executorLabel} · <a href="${esc(s.entry)}" target="_blank">${esc(s.entry)}</a></div>
        ${reason}
        ${screenshots ? `<div class="shots">${screenshots}</div>` : ''}
      </div>
    </div>`;
      })
      .join('');
    platformSections.push(`  <div class="section">
    <h2>${esc(platform)}</h2>
    ${cards}
  </div>`);
  }
  return platformSections.join('\n');
}

/** 生成 HTML 报告并落盘 report.html，返回路径 */
export async function generateAiVerifyReport(ctx: AiVerifyReportContext): Promise<string> {
  const { plan, results } = ctx;
  await ensureDir(plan.outDir);

  const byId = new Map(results.results.map((r) => [r.scenarioId, r]));
  const { total, passed, failed, skipped: skippedCount, notRun } = summarizeResults(ctx);

  // v8.3.351+: 按层渲染（公共能力层 → 模块层）；旧剧本无 groups 时回退按端分组
  let scenarioSections: string;
  if (Array.isArray(plan.groups) && plan.groups.length > 0) {
    scenarioSections = plan.groups
      .map((g) => {
        const layerHead = `  <div class="section layer">
    <h2>${esc(g.label)}${g.enabled ? '' : '（⏭️ 已关闭）'}</h2>${g.note ? `
    <div class="layer-note">${esc(g.note)}</div>` : ''}`;
        const body = g.scenarios.length > 0 ? renderPlatformSections(g.scenarios, byId) : '    <div class="notes">（本层无场景）</div>';
        return `${layerHead}
${body}
  </div>`;
      })
      .join('\n');
  } else {
    scenarioSections = renderPlatformSections(plan.scenarios, byId);
  }

  const skippedNotes = plan.skipped.length
    ? `<div class="notes"><h3>生成期跳过项</h3><ul>${plan.skipped
        .map((s) => `<li>${esc(s.unit)}${s.platform ? '/' + esc(s.platform) : ''}: ${esc(s.reason)}</li>`)
        .join('')}</ul></div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>AI 浏览器验证报告 — ${esc(plan.env)}</title>
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; background: #f5f7fa; color: #1f2937; }
  .container { max-width: 960px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .summary { display: flex; gap: 12px; margin: 16px 0; flex-wrap: wrap; }
  .stat { background: #fff; border-radius: 8px; padding: 12px 20px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .stat .num { font-size: 26px; font-weight: 700; }
  .stat.pass .num { color: #16a34a; }
  .stat.fail .num { color: #dc2626; }
  .stat.skip .num { color: #d97706; }
  .stat.notrun .num { color: #6b7280; }
  .section { background: #fff; border-radius: 10px; padding: 16px 20px; margin: 16px 0; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .section h2 { margin: 0 0 12px; font-size: 17px; }
  .scenario { border: 1px solid #e5e7eb; border-radius: 8px; margin: 10px 0; overflow: hidden; }
  .scenario-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: #fafafa; }
  .scenario-body { padding: 10px 14px; }
  .badge { font-size: 12px; padding: 2px 10px; border-radius: 999px; color: #fff; }
  .badge.pass { background: #16a34a; }
  .badge.fail { background: #dc2626; }
  .badge.skip { background: #d97706; }
  .badge.notrun { background: #6b7280; }
  .meta { font-size: 12px; color: #6b7280; margin-bottom: 6px; }
  .reason { font-size: 13px; margin: 6px 0; white-space: pre-wrap; }
  .scenario.fail .reason { color: #b91c1c; }
  .scenario.pass .reason { color: #15803d; }
  .shots { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  .shot img { max-width: 280px; max-height: 200px; border: 1px solid #e5e7eb; border-radius: 6px; }
  .notes { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 16px; margin: 16px 0; font-size: 13px; }
  .notes ul { margin: 6px 0 0; padding-left: 18px; }
</style>
</head>
<body>
<div class="container">
  <h1>AI 浏览器验证报告</h1>
  <div class="meta">环境: ${esc(plan.env)} · 迭代: ${esc(plan.iteration)} · 执行时间: ${esc(results.executedAt)}</div>
  <div class="summary">
    <div class="stat"><div>总场景</div><div class="num">${total}</div></div>
    <div class="stat pass"><div>通过</div><div class="num">${passed}</div></div>
    <div class="stat fail"><div>失败</div><div class="num">${failed}</div></div>
    <div class="stat skip"><div>跳过</div><div class="num">${skippedCount}</div></div>
    <div class="stat notrun"><div>未执行</div><div class="num">${notRun}</div></div>
  </div>
  ${skippedNotes}
  ${scenarioSections}
</div>
</body>
</html>
`;

  const reportPath = join(plan.outDir, 'report.html');
  await writeFile(reportPath, html, 'utf-8');
  return reportPath;
}
