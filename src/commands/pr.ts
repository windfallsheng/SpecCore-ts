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
import { isProtectedBranch } from '../core/git-integration';
// v6.86.0+: AGENTS 全阶段扩展
import { resolveAgentsForPhase } from '../core/agents';
import type { AgentContext } from '../core/agents';
// v6.87.0+: COMMANDS 命令模板
import { loadCommandTemplate, renderTemplate } from '../core/command-loader';

import { createInterface } from 'readline';

function promptUser(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(`${q} `, a => { rl.close(); r(a.trim()); }));
}

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
  force?: boolean;      // 非交互自动提交（流水线用）
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

    // v6.87.0+: 尝试加载命令模板
    const projectRoot = process.cwd();
    const template = await loadCommandTemplate('pr-review', projectRoot);

    let prompt: string;
    if (template) {
      // 使用模板 + 变量替换
      prompt = renderTemplate(template.content, {
        changedFiles: changedFiles || '（无变更文件）',
        stagedFiles: stagedFiles || '（无暂存文件）',
        diff: diff ? diff.slice(0, 8000) : '（无差异）',
        analysis: analysis ? analysis.slice(0, 3000) : '（无可用分析文档，跳过对照检查）',
      });
    } else {
      // 回退到硬编码 prompt
      prompt = [
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
    }

    // v6.86.0+: 注入 pr/review 阶段 AGENTS
    let finalPrompt = prompt;
    const agentContext: AgentContext = {
      iteration: iter,
    };
    try {
      const agents = await resolveAgentsForPhase('pr', 'review', agentContext, projectRoot);
      if (agents.length > 0) {
        finalPrompt += '\n\n## 专业角色指引\n\n';
        for (const ra of agents) {
          finalPrompt += ra.definition.rolePrompt;
          finalPrompt += '\n\n';
        }
      }
    } catch {
      // AGENTS 加载失败静默跳过
    }

    process.stdout.write(`[SPECCORE_PROMPT]\n${finalPrompt}\n[/SPECCORE_PROMPT]`);
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
      if (!isProtectedBranch(branch)) {
        execSync(`git push -u origin "${branch}"`, { stdio: 'pipe' });
        logger.success(`✅ 已推送: ${branch}`);
      } else {
        logger.info(`ℹ️ ${branch} 为保护分支，跳过推送（请通过 PR 合并）`);
      }

      // 输出结果
      process.stdout.write(`[SPECCORE_RESULT]\n${JSON.stringify({ committed: true, message: commitMsg, branch, analysisMatch })}\n[/SPECCORE_RESULT]`);

    } catch (e) {
      logger.error(`解析失败: ${e}`);
      process.exitCode = 1;
    }
    return;
  }

  // ── --force: 非交互自动提交（流水线用）──
  if (options.force) {
    const status = execSync('git status --short', { encoding: 'utf-8' }).trim();
    if (!status) {
      logger.info('📋 无待提交变更');
      return;
    }
    const iter = options.iteration || await getDefaultIteration();
    const msg = options.title || `SpecCore auto commit${iter ? ` (${iter})` : ''}`;
    execSync('git add -A', { stdio: 'pipe' });
    try {
      execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });
      logger.success(`✅ 已提交: ${msg}`);
    } catch {
      logger.info('ℹ️ 无变更可提交');
      return;
    }
    const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
    if (!isProtectedBranch(branch)) {
      try {
        execSync(`git push -u origin "${branch}"`, { stdio: 'pipe' });
        logger.success(`✅ 已推送: ${branch}`);
      } catch {
        logger.info(`ℹ️ 推送跳过（远程可能不存在）`);
      }
    } else {
      logger.info(`ℹ️ ${branch} 为保护分支，跳过推送（请通过 PR 合并）`);
    }
    return;
  }

  // ── CLI 默认模式：交互式提交 ──
  const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
  const iter = options.iteration || await getDefaultIteration();

  // 展示变更
  const status = execSync('git status --short', { encoding: 'utf-8' }).trim();
  const diff = execSync('git diff --stat', { encoding: 'utf-8' }).trim();

  logger.info(`🌿 当前分支: ${branch}`);
  if (iter) logger.info(`📂 当前迭代: ${iter}`);
  logger.info('');

  if (!status) {
    logger.info('📋 无待提交变更');
    return;
  }

  logger.info('📋 变更文件:\n' + status);
  logger.info('');

  if (diff) {
    logger.info('📊 变更统计:\n' + diff.split('\n').slice(0, 5).join('\n'));
    logger.info('');
  }

  // 交互式确认
  const addAns = await promptUser('暂存哪些文件？ [a]全部 [s]跳过(已暂存则直接commit) [q]退出: ');

  if (addAns === 'q') { logger.info('已取消'); return; }
  if (addAns === 'a') {
    execSync('git add -A', { stdio: 'pipe' });
    logger.info('✅ 已暂存全部变更');
  }

  const staged = execSync('git diff --cached --name-only', { encoding: 'utf-8' }).trim();
  if (!staged) {
    logger.info('⚠️  无暂存文件，跳过提交');
    return;
  }

  logger.info('\n📦 待提交文件:\n' + staged);
  logger.info('');

  // 输入 commit 信息
  let msg = options.title;
  if (!msg) {
    msg = await promptUser('Commit 信息（留空用 "SpecCore auto commit"）: ');
    if (!msg) msg = 'SpecCore auto commit';
  }

  // 分析关联检查（如果有迭代）
  if (iter) {
    logger.info(`\n🔍 当前分析关联: ${iter}`);
    const checkAns = await promptUser('提交到此分析迭代？ [y]是 [n]切换分支再提交: ');
    if (checkAns !== 'y') {
      const newBranch = await promptUser('输入目标分支名: ');
      if (newBranch) {
        try {
          execSync(`git checkout "${newBranch}"`, { stdio: 'pipe' });
          logger.info(`✅ 已切换到: ${newBranch}`);
        } catch {
          execSync(`git checkout -b "${newBranch}"`, { stdio: 'pipe' });
          logger.info(`✅ 已创建并切换到: ${newBranch}`);
        }
      }
    }
  }

  // 提交
  const pushAns = await promptUser('\n提交并推送？ [y]是 [n]仅提交本地 [q]取消: ');
  if (pushAns === 'q') { logger.info('已取消'); return; }

  try {
    execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });
    logger.success(`✅ 已提交: ${msg}`);

    if (pushAns === 'y') {
      const currentBranch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
      if (!isProtectedBranch(currentBranch)) {
        execSync(`git push -u origin "${currentBranch}"`, { stdio: 'pipe' });
        logger.success(`✅ 已推送: ${currentBranch}`);
      } else {
        logger.info(`ℹ️ ${currentBranch} 为保护分支，跳过推送（请通过 PR 合并）`);
      }
    } else {
      logger.info('📌 仅提交到本地，未推送');
    }
  } catch (error: any) {
    logger.error(`提交失败: ${error.message || error}`);
  }
}
