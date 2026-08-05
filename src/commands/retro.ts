/**
 * retro — 任务回顾 / 复盘
 * 完成时自动生成 RETRO.md 到任务目录，支持 HTML 页面
 */
import { join } from 'path';
import { pathExists, readFile, writeFile, ensureDir } from 'fs-extra';
import { logger } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { getIssues } from '../core/issue-tracker';

interface RetroOptions {
  task?: string;
  iteration?: string;
  output?: string;
}

interface RetroReport {
  task: string;
  iteration: string;
  completedAt: string;
  summary: string;
  filesChanged: number;
  validationPassed: boolean;
  improvement: string;
  score: number;
  issuesTotal: number;
  issuesUnresolved: number;
}

export async function retroCommand(options: RetroOptions): Promise<void> {
  const iteration = await getDefaultIteration(options.iteration);
  const taskId = options.task || 'Task-001';
  const iterDir = iteration ? `期次-${iteration}` : '';

  const report = await generateReport(taskId, iterDir);

  // 非 TTY → HTML
  if (!process.stdout.isTTY) {
    const html = renderRetroHtml(report);
    const outPath = options.output || join(process.cwd(), `speccore-retro-${taskId}.html`);
    await writeFile(outPath, html);
    logger.info(`✅ 回顾报告: ${outPath}`);
    return;
  }

  // TTY → 终端
  logger.info('');
  logger.info(`📝 任务回顾: ${report.task}`);
  logger.info(`   期次: ${report.iteration || 'N/A'}`);
  logger.info(`   完成时间: ${report.completedAt}`);
  logger.info(`   文件变更: ${report.filesChanged} 个`);
  logger.info(`   验证通过: ${report.validationPassed ? '✅' : '❌'}`);
  logger.info(`   评分: ${'⭐'.repeat(report.score)}${report.score < 5 ? '☆'.repeat(5 - report.score) : ''} (${report.score}/5)`);
  logger.info(`   ${report.summary}`);
  if (report.improvement) logger.info(`   💡 改进: ${report.improvement}`);
}

async function generateReport(taskId: string, iterDir: string): Promise<RetroReport> {
  const taskDir = join(process.cwd(), iterDir, taskId);
  const now = new Date().toISOString().split('T')[0];
  let filesChanged = 0;
  let validationPassed = false;

  if (await pathExists(taskDir)) {
    const { readdir } = await import('fs/promises');
    try {
      const entries = await readdir(taskDir, { recursive: true });
      filesChanged = entries.length;
    } catch {}
  }

  // 检查验证状态
  const analysisFile = join(taskDir, 'ANALYSIS.md');
  if (await pathExists(analysisFile)) {
    const content = await readFile(analysisFile, 'utf-8');
    validationPassed = !content.includes('❌') && !content.includes('FAIL');
  }

  // 检查问题记录
  const issues = await getIssues(join(process.cwd(), iterDir, taskId));

  const report: RetroReport = {
    task: taskId,
    iteration: iterDir.replace('期次-', ''),
    completedAt: now,
    summary: `任务 ${taskId} 已完成，共涉及 ${filesChanged} 个文件变更`,
    filesChanged,
    validationPassed,
    score: validationPassed && issues.unresolved.length === 0 ? 5 : validationPassed ? 4 : issues.unresolved.length > 2 ? 2 : 3,
    improvement: issues.unresolved.length > 0
      ? `有 ${issues.unresolved.length} 个未解决问题需要关注`
      : filesChanged > 10 ? '文件变更较多，建议拆分更细粒度' : '任务粒度合适，质量良好',
    issuesTotal: issues.total,
    issuesUnresolved: issues.unresolved.length,
  };

  // 持久化 RETRO.md 到任务目录
  if (iterDir && await pathExists(join(process.cwd(), iterDir))) {
    const retroDir = join(process.cwd(), iterDir, taskId);
    await ensureDir(retroDir);
    const retroMd = [
      `# 任务回顾 · ${taskId}`,
      '',
      `- 完成时间: ${now}`,
      `- 文件变更: ${filesChanged}`,
      `- 验证通过: ${validationPassed ? '✅' : '❌'}`,
      `- 质量评分: ${'⭐'.repeat(report.score)}${'☆'.repeat(Math.max(0, 5 - report.score))} (${report.score}/5)`,
      '',
      `## 总结`,
      report.summary,
      '',
      `## 改进建议`,
      report.improvement || '无特别建议',
      '',
    ].join('\n');
    await writeFile(join(retroDir, 'RETRO.md'), retroMd);
    logger.info(`📄 已生成: ${join(retroDir, 'RETRO.md')}`);
  }

  return report;
}

export function renderRetroHtml(report: RetroReport): string {
  const ver = require('../../package.json').version;
  const stars = '⭐'.repeat(report.score) + (report.score < 5 ? '<span style="opacity:0.25">☆</span>'.repeat(5 - report.score) : '');
  const vClass = report.validationPassed ? 'pass' : 'fail';
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>SpecCore Retro · ${report.task}</title><style>@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=JetBrains+Mono:wght@400;600;700');body{margin:0;padding:40px 20px;background:#0b1929;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:'JetBrains Mono',monospace}.scanlines{position:fixed;inset:0;pointer-events:none;z-index:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,240,255,.015) 2px,rgba(0,240,255,.015) 4px)}.grid-pattern{position:fixed;inset:0;pointer-events:none;z-index:0;background-image:linear-gradient(rgba(14,165,233,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(14,165,233,.03) 1px,transparent 1px);background-size:60px 60px}.card{max-width:560px;width:100%;background:rgba(13,31,56,.95);border:1px solid rgba(14,165,233,.15);border-radius:16px;padding:32px;position:relative;overflow:hidden;z-index:1}.card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,#0ea5e9,transparent);animation:scanX 3s linear infinite}.card::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,#0ea5e9,transparent);animation:scanX-rev 3s linear infinite}.vline{position:absolute;top:0;width:1px;bottom:0;pointer-events:none}.vline.l{left:0;background:linear-gradient(0deg,transparent,#0ea5e9,transparent);animation:scanY-rev 3s linear infinite}.vline.r{right:0;background:linear-gradient(0deg,transparent,#0ea5e9,transparent);animation:scanY 3s linear infinite}@keyframes scanX{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}@keyframes scanX-rev{0%{transform:translateX(100%)}100%{transform:translateX(-100%)}}@keyframes scanY{0%{transform:translateY(-100%)}100%{transform:translateY(100%)}}@keyframes scanY-rev{0%{transform:translateY(100%)}100%{transform:translateY(-100%)}}h1{font-family:'Orbitron',sans-serif;font-size:22px;font-weight:900;background:linear-gradient(135deg,#0ea5e9,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:2px}.meta{color:#5b7fa5;font-size:11px;margin:8px 0 20px}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}.stat{background:rgba(14,165,233,.06);border:1px solid rgba(14,165,233,.1);border-radius:8px;padding:12px;text-align:center}.stat .val{font-family:'Orbitron',sans-serif;font-size:20px;font-weight:900;color:#0ea5e9}.stat .lbl{font-size:10px;color:#5b7fa5;margin-top:4px}.score{text-align:center;font-size:28px;margin:12px 0}.summary{padding:12px;background:rgba(20,184,166,.06);border:1px solid rgba(20,184,166,.15);border-radius:8px;color:#bae6fd;font-size:12px;line-height:1.6;margin:12px 0}.improve{padding:12px;background:rgba(249,115,22,.06);border:1px solid rgba(249,115,22,.15);border-radius:8px;color:#f97316;font-size:11px}.pass{color:#14b8a6}.fail{color:#f97316}.ft{text-align:center;color:#5b7fa5;font-size:10px;margin-top:24px}</style></head><body><div class="scanlines"></div><div class="grid-pattern"></div><div class="card"><div class="vline l"></div><div class="vline r"></div><h1>RETRO · ${report.task}</h1><div class="meta">${report.iteration ? '期次: ' + report.iteration + ' · ' : ''}${report.completedAt}</div><div class="score">${stars} <span style="font-size:14px;color:#5b7fa5">(${report.score}/5)</span></div><div class="grid2"><div class="stat"><div class="val">${report.filesChanged}</div><div class="lbl">文件变更</div></div><div class="stat"><div class="val ${vClass}">${report.validationPassed ? '✅' : '❌'}</div><div class="lbl">验证</div></div></div><div class="grid2"><div class="stat"><div class="val" style="color:${report.issuesUnresolved > 0 ? '#f97316' : '#14b8a6'}">${report.issuesUnresolved}</div><div class="lbl">未解决问题</div></div><div class="stat"><div class="val" style="color:#5b7fa5">${report.issuesTotal}</div><div class="lbl">问题总数</div></div></div><div class="summary">${report.summary}</div><div class="improve">💡 ${report.improvement || '任务完成，无特别建议'}</div></div><div class="ft">SpecCore Retro v${ver} · ${report.completedAt}</div></body></html>`;
}
