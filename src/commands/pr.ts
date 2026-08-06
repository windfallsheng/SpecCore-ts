/**
 * pr — 自动创建 Pull Request + 链接 Task
 */
import { readFile, pathExists } from 'fs-extra';
import { join } from 'path';
import { execSync } from 'child_process';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';
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
}

export async function prCommand(options: PrOptions): Promise<void> {
  const iteration = await getDefaultIteration(options.iteration);
  if (!iteration) { logger.error('No active iteration'); return; }

  const iterDir = `Iteration-${iteration}`;
  
  let taskId = options.task;
  if (!taskId) {
    const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
    const match = branch.match(/feature\/(Task-\d+)/);
    if (match) taskId = match[1];
  }
  if (!taskId) { logger.error('请用 --task 指定任务'); return; }

  const fs = require('fs');
  const entries = fs.readdirSync(iterDir, { withFileTypes: true });
  const taskEntry = entries.find((e: any) => e.isDirectory() && e.name.startsWith(taskId));
  if (!taskEntry) { logger.error(`Task 未找到: ${taskId}`); return; }

  const taskName = taskEntry.name;
  const backendDir = join(iterDir, taskName, 'backend');

  try {
    const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();

    // ── Interactive mode ──
    if (options.interactive) {
      await interactivePrFlow(branch, backendDir, taskName, iteration, options);
      return;
    }

    // ── Auto mode ──
    const spinner = new Spinner(`创建 PR: ${taskName}`); spinner.start();

    execSync(`git push -u origin "${branch}" 2>/dev/null`, { stdio: 'pipe' });
    const title = options.title || taskName;
    const body = await buildPrBody(backendDir, taskName, iteration);
    const base = options.base || 'main';
    const draftFlag = options.draft ? ' --draft' : '';
    const result = execSync(
      `gh pr create --base "${base}" --head "${branch}" --title "${title}" --body "${body}"${draftFlag}`,
      { encoding: 'utf-8', stdio: 'pipe' }
    ).trim();

    spinner.stop(`✅ PR 已创建: ${result}`);
    await updateTaskMd(backendDir, result);
    logger.info(`\n   📄 ${result}`);
    logger.info('   💡 审查通过后: speccore lifecycle --task=' + taskId + ' --status=done\n');

  } catch (error) {
    logger.error(`PR 创建失败: ${error}`);
    logger.info('   💡 请确保已安装 gh CLI: brew install gh && gh auth login');
  }
}

// ── 分步交互 ──
async function interactivePrFlow(
  branch: string, backendDir: string, taskName: string, iteration: string, options: PrOptions
): Promise<void> {
  // 1. 预览变更
  logger.info('📋 当前变更:');
  logger.info('');
  const status = execSync('git status --short', { encoding: 'utf-8' }).trim();
  if (!status) { logger.info('   (无变更)'); return; }
  logger.info(status);
  logger.info('');

  // 2. 选文件 → add
  const addAns = await promptUser(`提交哪些文件？ [a]全部 [p]挑选 [s]跳过提交: `);
  if (addAns === 's') {
    logger.info('跳过提交，直接推送已有 commit...');
  } else if (addAns === 'p') {
    const files = await promptUser('输入文件路径（空格分隔）: ');
    const selected = files.split(/\s+/).filter(Boolean);
    if (selected.length > 0) {
      execSync(`git add ${selected.join(' ')}`, { stdio: 'pipe' });
      logger.info(`✅ 已添加 ${selected.length} 个文件`);
    }
  } else {
    execSync('git add .', { stdio: 'pipe' });
    logger.info('✅ 已添加全部文件');
  }

  // 3. commit（如果有 staged 文件）
  const staged = execSync('git diff --cached --name-only', { encoding: 'utf-8' }).trim();
  if (staged) {
    logger.info(`\n📦 待提交:\n${staged}\n`);
    const commitAns = await promptUser('是否 commit？ [y/n]: ');
    if (commitAns === 'y') {
      const msg = await promptUser(`Commit 信息（默认: ${taskName}）: `);
      execSync(`git commit -m "${msg || taskName}"`, { stdio: 'pipe' });
      logger.info('✅ 已 commit');
    }
  }

  // 4. 推送
  const pushAns = await promptUser('\n推送到 origin？ [y/n]: ');
  if (pushAns !== 'y') { logger.info('已取消推送'); return; }
  execSync(`git push -u origin "${branch}"`, { stdio: 'pipe' });
  logger.info(`✅ 已推送 ${branch}`);

  // 5. 创建 PR
  const prAns = await promptUser('\n创建 PR？ [y/n]: ');
  if (prAns !== 'y') { logger.info('已跳过 PR 创建'); return; }

  const spinner = new Spinner('创建 PR'); spinner.start();
  const title = options.title || taskName;
  const body = await buildPrBody(backendDir, taskName, iteration);
  const base = options.base || 'main';
  const draftFlag = options.draft ? ' --draft' : '';
  const result = execSync(
    `gh pr create --base "${base}" --head "${branch}" --title "${title}" --body "${body}"${draftFlag}`,
    { encoding: 'utf-8', stdio: 'pipe' }
  ).trim();

  spinner.stop(`✅ PR 已创建: ${result}`);
  await updateTaskMd(backendDir, result);
  logger.info(`\n   📄 ${result}\n`);
}

async function updateTaskMd(backendDir: string, prUrl: string): Promise<void> {
  const taskMdPath = join(backendDir, 'TASK.md');
  if (!(await pathExists(taskMdPath))) return;
  let md = await readFile(taskMdPath, 'utf-8');
  if (!md.includes('## PR')) {
    md += `\n\n## PR\n\n| URL | 状态 |\n| :--- | :--- |\n| ${prUrl} | 🔄 待审查 |\n`;
  } else {
    md = md.replace('| :--- | :--- |\n', `| :--- | :--- |\n| ${prUrl} | 🔄 待审查 |\n`);
  }
  await require('fs-extra').writeFile(taskMdPath, md);
}

async function buildPrBody(backendDir: string, taskName: string, iteration: string): Promise<string> {
  let body = `## ${taskName}\n\n`;

  // Add REQ summary
  const reqPath = join(backendDir, 'REQ.md');
  if (await pathExists(reqPath)) {
    const req = await readFile(reqPath, 'utf-8');
    const desc = req.match(/## 需求描述\n([\s\S]*?)(?=\n##|\n\|\|$)/);
    if (desc) body += `### 📋 需求\n${desc[1].trim()}\n\n`;
  }

  // Add test status
  const testPath = join(backendDir, 'TEST.md');
  if (await pathExists(testPath)) {
    const test = await readFile(testPath, 'utf-8');
    const total = (test.match(/\[[ x]\]/g) || []).length;
    const checked = (test.match(/\[x\]/gi) || []).length;
    body += `### 🧪 测试\n${checked}/${total} 项完成\n\n`;
  }

  body += `---\n> 由 SpecCore 自动生成 | 期次: ${iteration}`;
  return body;
}
