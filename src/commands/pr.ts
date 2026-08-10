/**
 * pr — AI 辅助：总结变更 + 检查分析对齐 + 安全提交
 * 🔒 AI 命令，通过 --prompt/--response 协作
 */
import { readFile, pathExists, writeFile } from 'fs-extra';
import { join } from 'path';
import { execSync } from 'child_process';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
import { buildPrompt, formatPrompt } from '../core/prompt-builder';

export interface PrOptions {
  task?: string;
  iteration?: string;
  base?: string;
  draft?: boolean;
  title?: string;
  interactive?: boolean;
  prompt?: boolean;
  response?: string;
  confirm?: boolean;   // 用户要求确认提交内容
  commit?: boolean;     // 直接提交到本地（不创建远程PR）
}

export async function prCommand(options: PrOptions): Promise<void> {
  // ── Prompt 模式：输出分析 Prompt 给 AI ──
  if (options.prompt) {
    const iter = options.iteration || await getDefaultIteration();
    if (!iter) { logger.error('No active iteration'); process.exit(11); return; }
    const taskId = options.task || 'current';

    // 收集变更信息
    const changedFiles = execSync('git diff --name-only HEAD', { encoding: 'utf-8' }).trim();
    const stagedFiles = execSync('git diff --cached --name-only', { encoding: 'utf-8' }).trim();
    const diff = execSync('git diff HEAD', { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }).trim();

    // 读取分析文档
    let analysis = '';
    if (taskId !== 'current') {
      const iterDir = join(process.cwd(), `Iteration-${iter}`);
      try {
        const fs = require('fs');
        const entries = fs.readdirSync(iterDir, { withFileTypes: true });
        const taskEntry = entries.find((e: any) => e.isDirectory() && e.name.includes(taskId));
        if (taskEntry) {
          const analysisPath = join(iterDir, taskEntry.name, 'ANALYSIS.md');
          if (await pathExists(analysisPath)) {
            analysis = await readFile(analysisPath, 'utf-8');
          }
        }
      } catch {}
    }

    // 构建 Prompt
    const prompt = [
      '# SpecCore PR — 变更分析 + 安全检查',
      '',
      '## 你的任务',
      '1. 分析下面的 git 变更，用中文生成一条简洁的 commit 信息（< 72 字）',
      '2. 对照 ANALYSIS.md 中的需求/分析内容，判断当前变更是否对齐分析范围',
      '3. 返回 JSON 格式结果',
      '',
      '## 变更文件',
      changedFiles || '（无变更文件）',
      '',
      '## 暂存文件',
      stagedFiles || '（无暂存文件）',
      '',
      '## 变更差异 (diff)',
      diff ? `\`\`\`\n${diff.slice(0, 8000)}\n\`\`\`` : '（无差异）',
      '',
      '## 分析文档 (ANALYSIS.md)',
      analysis ? `\`\`\`\n${analysis.slice(0, 3000)}\n\`\`\`` : '（无可用分析文档，跳过对照检查）',
      '',
      '## 输出格式',
      '请返回如下 JSON：',
      '```json',
      '{',
      '  "commitMsg": "提交信息（中文，<72字）",',
      '  "analysisMatch": true|false,',
      '  "mismatchReason": "不匹配原因（仅 analysisMatch=false 时填写）",',
      '  "recommendation": "建议：auto-commit 或 confirm-first"',
      '}',
      '```',
      '',
      '## 规则',
      '- analysisMatch=true：变更内容符合分析范围，可以直接提交',
      '- analysisMatch=false：变更超出分析范围，建议用户先确认',
      '- 若无分析文档，analysisMatch 填 true，但 recommend 填 "confirm-first"',
    ].join('\n');

    process.stdout.write(`[SPECCORE_PROMPT]\n${prompt}\n[/SPECCORE_PROMPT]`);
    process.exitCode = 10;
    return;
  }

  // ── Response 模式：AI 返回结果，CLI 执行提交 ──
  if (options.response) {
    try {
      const result = JSON.parse(options.response);
      const commitMsg = result.commitMsg || 'Auto commit by SpecCore';
      const analysisMatch = result.analysisMatch !== false;
      const userConfirm = options.confirm;

      // 如果分析不匹配且用户未要求确认，提示并返回
      if (!analysisMatch && !userConfirm) {
        process.stdout.write(`[SPECCORE_CONFIRM_NEEDED]\n不匹配原因: ${result.mismatchReason || '未知'}\n建议先确认再提交。使用 --confirm 强制执行。\n[/SPECCORE_CONFIRM_NEEDED]`);
        process.exitCode = 11;
        return;
      }

      // 安全提交
      const staged = execSync('git diff --cached --name-only', { encoding: 'utf-8' }).trim();
      if (!staged) {
        execSync('git add -A', { stdio: 'pipe' });
        logger.info('✅ 已暂存全部变更');
      }

      execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });
      logger.success(`✅ 已提交: ${commitMsg}`);

      // 推送
      const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
      if (branch !== 'main' && branch !== 'master') {
        execSync(`git push -u origin "${branch}"`, { stdio: 'pipe' });
        logger.success(`✅ 已推送: ${branch}`);
      }

      // 输出结果
      process.stdout.write(`[SPECCORE_RESULT]\n${JSON.stringify({ committed: true, message: commitMsg, branch, analysisMatch })}\n[/SPECCORE_RESULT]`);

    } catch (e) {
      logger.error(`解析失败: ${e}`);
      process.exitCode = 1;
    }
    return;
  }

  // ── 默认模式：轻量级直接提交（无分析对照）──
  const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
  const spinner = new Spinner('提交变更...'); spinner.start();

  try {
    execSync('git add -A', { stdio: 'pipe' });
    const msg = options.title || `SpecCore auto commit`;
    execSync(`git commit -m "${msg}"`, { stdio: 'pipe' });
    spinner.stop(`✅ 已提交: ${msg}`);

    if (branch !== 'main' && branch !== 'master') {
      execSync(`git push -u origin "${branch}"`, { stdio: 'pipe' });
      logger.info(`✅ 已推送: ${branch}`);
    }
  } catch (error) {
    spinner.fail('提交失败');
    logger.error(String(error));
  }
}
