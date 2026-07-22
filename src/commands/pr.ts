/**
 * pr — 自动创建 Pull Request + 链接 Task
 */
import { readFile, pathExists } from 'fs-extra';
import { join } from 'path';
import { execSync } from 'child_process';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration } from '../core/context';

export interface PrOptions {
  task?: string;
  iteration?: string;
  base?: string;
  draft?: boolean;
  title?: string;
}

export async function prCommand(options: PrOptions): Promise<void> {
  const iteration = await getDefaultIteration(options.iteration);
  if (!iteration) { logger.error('No active iteration'); return; }

  const iterDir = `期次-${iteration}`;
  
  // Find task
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
  const spinner = new Spinner(`创建 PR: ${taskName}`); spinner.start();

  try {
    // Push current branch
    const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
    execSync(`git push -u origin "${branch}" 2>/dev/null`, { stdio: 'pipe' });

    // Build PR title + body
    const title = options.title || taskName;
    const body = await buildPrBody(backendDir, taskName, iteration);

    // Detect base branch
    const base = options.base || 'main';

    // Create PR via gh CLI
    const draftFlag = options.draft ? ' --draft' : '';
    const result = execSync(
      `gh pr create --base "${base}" --head "${branch}" --title "${title}" --body "${body}"${draftFlag}`,
      { encoding: 'utf-8', stdio: 'pipe' }
    ).trim();

    spinner.stop(`✅ PR 已创建: ${result}`);

    // Update TASK.md with PR link
    const taskMdPath = join(backendDir, 'TASK.md');
    if (await pathExists(taskMdPath)) {
      let taskMd = await readFile(taskMdPath, 'utf-8');
      if (!taskMd.includes('## PR')) {
        taskMd += `\n\n## PR\n\n| URL | 状态 |\n| :--- | :--- |\n| ${result} | 🔄 待审查 |\n`;
      } else {
        taskMd = taskMd.replace('| :--- | :--- |\n', `| :--- | :--- |\n| ${result} | 🔄 待审查 |\n`);
      }
      await require('fs-extra').writeFile(taskMdPath, taskMd);
    }

    logger.info(`\n   📄 ${result}`);
    logger.info('   💡 审查通过后: speccore lifecycle --task=' + taskId + ' --status=done');
    logger.info('');

  } catch (error) {
    spinner.fail(`PR 创建失败: ${error}`);
    logger.info('   💡 请确保已安装 gh CLI: brew install gh && gh auth login');
  }
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
