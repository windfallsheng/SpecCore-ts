/**
 * pr — AI 辅助：总结变更 + 检查分析对齐 + 安全提交
 * 🔒 AI 命令，通过 --prompt/--response 协作
 */
import { readFile, pathExists, writeFile } from 'fs-extra';
import { join } from 'path';
import { execSync } from 'child_process';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, getIterationDir } from '../core/context';
import { buildPrompt, formatPrompt } from '../core/prompt-builder';
import { isProtectedBranch } from '../core/git-integration';
import { loadConfig } from '../core/unified-config';
import { loadTaskQualityGate, mergeQualityGate, shouldRunUIVerify } from '../core/quality-gate';
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
  createPr?: boolean;   // 推送后自动创建 Pull Request
  merge?: boolean;      // 合并当前 PR 到 base 分支
  autoMerge?: boolean;  // 创建 PR 后自动合并
}

// ── UI 验证状态检查（v8.3.48+）──
interface UIVerifyStatus {
  enabled: boolean;
  passed: boolean | null;
  threshold: string;
  timestamp: string;
  error?: string;
}

async function checkUIVerifyStatus(taskId?: string, iteration?: string | null): Promise<{ block: boolean; message: string }> {
  const config = await loadConfig();

  // 无任务时，仅检查项目级配置
  if (!taskId || !iteration) {
    if (config.quality_gates?.verify_ui?.enabled) {
      return { block: false, message: '项目级 UI 验证已启用，但未绑定任务，跳过检查' };
    }
    return { block: false, message: '' };
  }

  const iterDir = await getIterationDir(iteration);
  const taskDirCandidates = [
    join(iterDir, '030-tasks', taskId),
    join(iterDir, taskId),
  ];
  let taskDir: string | null = null;
  for (const c of taskDirCandidates) {
    if (await pathExists(c)) { taskDir = c; break; }
  }
  if (!taskDir) {
    return { block: false, message: `未找到任务目录: ${taskId}` };
  }

  // 读取任务级 quality gate
  const taskQG = await loadTaskQualityGate(taskDir);
  const resolvedQG = mergeQualityGate({
    projectLevel: config.quality_gates?.verify_ui,
    taskLevel: taskQG?.verify_ui,
  });

  if (!shouldRunUIVerify(resolvedQG)) {
    return { block: false, message: '' };
  }

  // 读取 UI 验证状态文件
  const statusPath = join(taskDir, '.ui-verify-status.json');
  if (!(await pathExists(statusPath))) {
    if (resolvedQG.verify_ui.threshold === 'strict') {
      return { block: true, message: `❌ UI 验证未执行（strict 模式），请先运行: speccore execute --task=${taskId}` };
    }
    return { block: false, message: '⚠️ UI 验证未执行，但 threshold 非 strict，允许提交' };
  }

  try {
    const raw = await readFile(statusPath, 'utf-8');
    const status: UIVerifyStatus = JSON.parse(raw);

    if (status.passed === true) {
      return { block: false, message: `✅ UI 验证已通过（${status.timestamp}）` };
    }
    if (status.passed === false) {
      if (resolvedQG.verify_ui.threshold === 'strict') {
        return { block: true, message: `❌ UI 验证未通过（strict 模式），请修复后重新执行: speccore execute --task=${taskId}` };
      }
      return { block: false, message: '⚠️ UI 验证未通过，但 threshold 非 strict，允许提交' };
    }
    // passed === null（执行失败）
    if (resolvedQG.verify_ui.threshold === 'strict') {
      return { block: true, message: `❌ UI 验证执行失败（strict 模式），请检查 VERIFY_SPEC.yaml 后重试` };
    }
    return { block: false, message: '⚠️ UI 验证执行失败，但 threshold 非 strict，允许提交' };
  } catch {
    return { block: false, message: '⚠️ UI 验证状态文件读取失败，跳过检查' };
  }
}

// ── Git 平台 CLI 检测 ──
type GitPlatform = 'github' | 'gitlab' | null;

function detectGitPlatformCLI(): { platform: GitPlatform; cli: string | null } {
  try {
    execSync('gh --version', { stdio: 'pipe' });
    return { platform: 'github', cli: 'gh' };
  } catch {
    // gh 未安装
  }
  try {
    execSync('glab --version', { stdio: 'pipe' });
    return { platform: 'gitlab', cli: 'glab' };
  } catch {
    // glab 未安装
  }
  return { platform: null, cli: null };
}

/** 从 git remote url 判断平台 */
function detectPlatformFromRemote(): GitPlatform {
  try {
    const remote = execSync('git remote get-url origin', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    if (remote.includes('github.com')) return 'github';
    if (remote.includes('gitlab')) return 'gitlab';
    if (remote.includes('gitee.com')) return 'github'; // gitee 兼容 gh 的部分操作
  } catch {
    // ignore
  }
  return null;
}

/** 创建 Pull Request */
async function createPullRequest(base: string, title: string, draft?: boolean): Promise<{ success: boolean; url?: string; message: string }> {
  const { platform, cli } = detectGitPlatformCLI();
  const detected = platform || detectPlatformFromRemote();

  if (!cli) {
    return {
      success: false,
      message: `未检测到 GitHub CLI (gh) 或 GitLab CLI (glab)。\n   请安装对应 CLI 以自动创建 PR：\n   • GitHub: https://cli.github.com/\n   • GitLab: https://gitlab.com/gitlab-org/cli`,
    };
  }

  try {
    if (detected === 'github' || cli === 'gh') {
      const args = [
        'pr', 'create',
        '--base', base,
        '--title', title,
        '--body', 'Auto PR by SpecCore',
        '--fill',
      ];
      if (draft) args.push('--draft');
      const result = execSync(`gh ${args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      // gh pr create 会在 stdout 输出 PR URL
      const urlMatch = result.match(/https:\/\/github\.com\/[^\s]+/);
      return { success: true, url: urlMatch ? urlMatch[0] : undefined, message: 'PR 创建成功' };
    }

    if (detected === 'gitlab' || cli === 'glab') {
      const args = [
        'mr', 'create',
        '--target-branch', base,
        '--title', title,
        '--description', 'Auto MR by SpecCore',
      ];
      if (draft) args.push('--draft');
      const result = execSync(`glab ${args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      const urlMatch = result.match(/https:\/\/[^\s]+\/merge_requests\/\d+/);
      return { success: true, url: urlMatch ? urlMatch[0] : undefined, message: 'MR 创建成功' };
    }

    return { success: false, message: '无法识别 Git 平台类型' };
  } catch (e: any) {
    return { success: false, message: `创建 PR 失败: ${e.message || e}` };
  }
}

/** 合并 Pull Request */
async function mergePullRequest(auto?: boolean): Promise<{ success: boolean; message: string }> {
  const { platform, cli } = detectGitPlatformCLI();

  if (!cli) {
    return {
      success: false,
      message: '未检测到 gh 或 glab CLI，无法自动合并',
    };
  }

  try {
    if (cli === 'gh') {
      const args = ['pr', 'merge', '--squash', '--delete-branch'];
      if (auto) args.push('--auto');
      execSync(`gh ${args.join(' ')}`, { stdio: 'pipe' });
      return { success: true, message: auto ? '已启用自动合并' : 'PR 已合并' };
    }

    if (cli === 'glab') {
      execSync('glab mr merge --squash --remove-source-branch', { stdio: 'pipe' });
      return { success: true, message: 'MR 已合并' };
    }

    return { success: false, message: '无法识别 Git 平台类型' };
  } catch (e: any) {
    return { success: false, message: `合并失败: ${e.message || e}` };
  }
}

export async function prCommand(options: PrOptions): Promise<void> {
  // ── 独立合并模式 ──
  if (options.merge && !options.force && !options.response && !options.prompt) {
    const result = await mergePullRequest(options.autoMerge);
    if (result.success) {
      logger.success(`✅ ${result.message}`);
    } else {
      logger.error(`❌ ${result.message}`);
      process.exitCode = 1;
    }
    return;
  }

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

      // UI 验证检查（v8.3.48+）
      const iter = options.iteration || await getDefaultIteration();
      const uiCheck = await checkUIVerifyStatus(options.task, iter);
      if (uiCheck.message) logger.info(uiCheck.message);
      if (uiCheck.block) {
        process.stdout.write(`[SPECCORE_CONFIRM_NEEDED]\n${uiCheck.message}\n使用 --confirm 强制执行，或先修复 UI 验证问题。\n[/SPECCORE_CONFIRM_NEEDED]`);
        process.exitCode = 12;
        return;
      }

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
      let pushed = false;
      if (!isProtectedBranch(branch)) {
        execSync(`git push -u origin "${branch}"`, { stdio: 'pipe' });
        logger.success(`✅ 已推送: ${branch}`);
        pushed = true;
      } else {
        logger.info(`ℹ️ ${branch} 为保护分支，跳过推送（请通过 PR 合并）`);
      }

      // 自动创建 PR
      if ((options.createPr || options.autoMerge) && pushed) {
        const prResult = await createPullRequest(options.base || 'main', options.title || commitMsg, options.draft);
        if (prResult.success) {
          logger.success(`✅ ${prResult.message}${prResult.url ? ': ' + prResult.url : ''}`);
          if (options.autoMerge) {
            const mergeResult = await mergePullRequest(true);
            if (mergeResult.success) {
              logger.success(`✅ ${mergeResult.message}`);
            } else {
              logger.warn(`⚠️ ${mergeResult.message}`);
            }
          }
        } else {
          logger.warn(`⚠️ ${prResult.message}`);
        }
      }

      // 独立合并（仅 merge，不创建 PR）
      if (options.merge && !options.createPr && !options.autoMerge) {
        const mergeResult = await mergePullRequest(false);
        if (mergeResult.success) {
          logger.success(`✅ ${mergeResult.message}`);
        } else {
          logger.warn(`⚠️ ${mergeResult.message}`);
        }
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

    // UI 验证检查（v8.3.48+）
    const uiCheck = await checkUIVerifyStatus(options.task, iter);
    if (uiCheck.message) logger.info(uiCheck.message);
    if (uiCheck.block) {
      logger.error(uiCheck.message);
      process.exitCode = 12;
      return;
    }

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
    let pushed = false;
    if (!isProtectedBranch(branch)) {
      try {
        execSync(`git push -u origin "${branch}"`, { stdio: 'pipe' });
        logger.success(`✅ 已推送: ${branch}`);
        pushed = true;
      } catch {
        logger.info(`ℹ️ 推送跳过（远程可能不存在）`);
      }
    } else {
      logger.info(`ℹ️ ${branch} 为保护分支，跳过推送（请通过 PR 合并）`);
    }

    // 自动创建 PR / 合并
    if ((options.createPr || options.autoMerge) && pushed) {
      const base = options.base || 'main';
      const title = options.title || msg;
      const prResult = await createPullRequest(base, title, options.draft);
      if (prResult.success) {
        logger.success(`✅ ${prResult.message}${prResult.url ? ': ' + prResult.url : ''}`);
        if (options.autoMerge) {
          const mergeResult = await mergePullRequest(true);
          if (mergeResult.success) {
            logger.success(`✅ ${mergeResult.message}`);
          } else {
            logger.warn(`⚠️ ${mergeResult.message}`);
          }
        }
      } else {
        logger.warn(`⚠️ ${prResult.message}`);
      }
    }

    if (options.merge && !options.createPr && !options.autoMerge) {
      const mergeResult = await mergePullRequest(false);
      if (mergeResult.success) {
        logger.success(`✅ ${mergeResult.message}`);
      } else {
        logger.warn(`⚠️ ${mergeResult.message}`);
      }
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

  // UI 验证检查（v8.3.48+）
  const uiCheck = await checkUIVerifyStatus(options.task, iter);
  if (uiCheck.message) logger.info(uiCheck.message);
  if (uiCheck.block) {
    const forceAns = await promptUser('UI 验证未通过，是否强制提交？ [y]是 [n]否: ');
    if (forceAns !== 'y') { logger.info('已取消'); return; }
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
      let pushed = false;
      if (!isProtectedBranch(currentBranch)) {
        execSync(`git push -u origin "${currentBranch}"`, { stdio: 'pipe' });
        logger.success(`✅ 已推送: ${currentBranch}`);
        pushed = true;
      } else {
        logger.info(`ℹ️ ${currentBranch} 为保护分支，跳过推送（请通过 PR 合并）`);
      }

      // 自动创建 PR / 合并
      if ((options.createPr || options.autoMerge) && pushed) {
        const base = options.base || 'main';
        const title = options.title || msg;
        const prResult = await createPullRequest(base, title, options.draft);
        if (prResult.success) {
          logger.success(`✅ ${prResult.message}${prResult.url ? ': ' + prResult.url : ''}`);
          if (options.autoMerge) {
            const mergeResult = await mergePullRequest(true);
            if (mergeResult.success) {
              logger.success(`✅ ${mergeResult.message}`);
            } else {
              logger.warn(`⚠️ ${mergeResult.message}`);
            }
          }
        } else {
          logger.warn(`⚠️ ${prResult.message}`);
        }
      }

      if (options.merge && !options.createPr && !options.autoMerge) {
        const mergeResult = await mergePullRequest(false);
        if (mergeResult.success) {
          logger.success(`✅ ${mergeResult.message}`);
        } else {
          logger.warn(`⚠️ ${mergeResult.message}`);
        }
      }
    } else {
      logger.info('📌 仅提交到本地，未推送');
    }
  } catch (error: any) {
    logger.error(`提交失败: ${error.message || error}`);
  }
}
