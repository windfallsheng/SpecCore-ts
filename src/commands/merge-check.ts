/**
 * merge-check — 合并冲突预测 + 回滚
 */
import { readFile, pathExists } from 'fs-extra';
import { join } from 'path';
import { execSync } from 'child_process';
import { logger } from '../utils/logger';
import { getDefaultIteration } from '../core/context';

export async function mergeCheck(iteration: string): Promise<void> {
  const iterDir = `期次-${iteration}`;
  const fs = require('fs');
  
  // Find all feature branches
  const branches = execSync('git branch', { encoding: 'utf-8' })
    .split('\n')
    .map(b => b.replace(/^\*?\s*/, '').trim())
    .filter(b => b.startsWith(`feature/Task-`) && b !== 'main');

  if (branches.length < 2) {
    logger.info('\n  ✅ 只有一个活跃分支，无合并冲突风险');
    return;
  }

  // Collect file changes per branch
  const branchFiles: Record<string, string[]> = {};
  for (const branch of branches) {
    try {
      const diff = execSync(`git diff main...${branch} --name-only`, { encoding: 'utf-8' });
      branchFiles[branch] = diff.split('\n').filter(Boolean);
    } catch {
      branchFiles[branch] = [];
    }
  }

  // Detect conflicts
  const fileOwners = new Map<string, string[]>();
  for (const [branch, files] of Object.entries(branchFiles)) {
    for (const file of files) {
      if (!fileOwners.has(file)) fileOwners.set(file, []);
      fileOwners.get(file)!.push(branch);
    }
  }

  const conflicts = [...fileOwners.entries()].filter(([_, branches]) => branches.length > 1);

  logger.info(`\n🔍 合并冲突分析 (${iteration}):\n`);
  logger.info(`   活跃分支: ${branches.length}`);
  logger.info(`   冲突文件: ${conflicts.length}\n`);

  if (conflicts.length === 0) {
    logger.info('\n  ✅ 无冲突，可以安全合并\n');
  } else {
    logger.warn('  ⚠️ 以下文件被多个分支修改:\n');
    for (const [file, owners] of conflicts) {
      logger.warn(`    ${file}`);
      logger.warn(`      ← ${owners.join(', ')}`);
    }
    logger.info('\n  💡 建议: 按依赖顺序合并，后合并的负责解决冲突');
  }
}

/**
 * 回滚任务
 */
export async function rollbackTask(taskId: string, iteration: string, reason?: string): Promise<void> {
  const iterDir = `期次-${iteration}`;
  const fs = require('fs');
  
  // Find task directory
  const entries = fs.readdirSync(iterDir, { withFileTypes: true });
  const taskEntry = entries.find((e: any) => e.isDirectory() && e.name.startsWith(taskId));
  
  if (!taskEntry) { logger.error(`Task 未找到: ${taskId}`); return; }

  const taskName = taskEntry.name;
  const branchName = `feature/${taskName}`;

  logger.info(`\n⏪ 回滚 ${taskName}`);

  // 1. Update task status
  const taskMdPath = join(iterDir, taskName, 'backend', 'TASK.md');
  if (await pathExists(taskMdPath)) {
    let content = await readFile(taskMdPath, 'utf-8');
    const now = new Date().toISOString().split('T')[0];
    content = content.replace(/状态: [^\n]+/, '状态: ⏪ 已回滚');
    const rollbackEntry = `| ${now} | ⏪ 回滚${reason ? `: ${reason}` : ''} | rollback |`;
    if (content.includes('## 变更履历')) {
      content += '\n' + rollbackEntry + '\n';
    }
    await require('fs-extra').writeFile(taskMdPath, content);
  }

  // 2. Delete the branch
  try {
    execSync('git checkout main 2>/dev/null', { stdio: 'pipe' });
    execSync(`git branch -D "${branchName}" 2>/dev/null`, { stdio: 'pipe' });
    logger.info(`  🗑️  已删除分支: ${branchName}`);
  } catch {
    logger.info(`  ⚠️ 分支 ${branchName} 可能已删除`);
  }

  // 3. Archive task
  const archiveDir = join(iterDir, '_archived');
  await require('fs-extra').ensureDir(archiveDir);
  const dest = join(archiveDir, taskName);
  if (!(await pathExists(dest))) {
    await require('fs-extra').copy(join(iterDir, taskName), dest);
    await require('fs-extra').remove(join(iterDir, taskName));
  }

  logger.info(`  📦 已归档到 ${iterDir}/_archived/${taskName}`);
  logger.info(`\n  ✅ 回滚完成\n`);
}

/**
 * 架构文档自动更新 — 分析新 API/表/依赖，追加到 ARCHITECTURE.md
 */
export async function updateArchitecture(iteration: string, newApis: string[], newTables: string[]): Promise<void> {
  const archPath = `.speccore/PROJECT/ARCHITECTURE.md`;
  if (!(await pathExists(archPath))) return;

  let arch = await readFile(archPath, 'utf-8');
  const now = new Date().toISOString().split('T')[0];
  let updated = false;

  // Append new APIs
  if (newApis.length > 0) {
    if (!arch.includes('## API 层')) {
      arch += '\n\n## API 层\n\n> 自动更新 | ' + now + '\n';
    }
    for (const api of newApis) {
      if (!arch.includes(api)) {
        arch += `- \`${api}\` ← 期次-${iteration}\n`;
        updated = true;
      }
    }
  }

  // Append new tables
  if (newTables.length > 0) {
    if (!arch.includes('## 数据层')) {
      arch += '\n\n## 数据层\n\n> 自动更新 | ' + now + '\n';
    }
    for (const table of newTables) {
      if (!arch.includes(table)) {
        arch += `- \`${table}\` ← 期次-${iteration}\n`;
        updated = true;
      }
    }
  }

  if (updated) {
    await require('fs-extra').writeFile(archPath, arch);
    logger.info(`  📐 已更新架构文档: ${newApis.length} API + ${newTables.length} 表`);
  }
}
