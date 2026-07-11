/**
 * Git Integration — 任务与 Git 工作流深度整合
 *
 * 功能：
 *  - 任务 ↔ 分支关联
 *  - Commit 消息自动生成
 *  - PR 描述自动生成
 *  - Git Hook 安装
 */

import { existsSync, readFileSync, writeFileSync, ensureFileSync } from 'fs-extra';
import { join } from 'path';
import { execSync } from 'child_process';

const GIT_MAPPING_PATH = '.speccore/.git-mapping.json';

interface GitMapping {
  [branchName: string]: {
    taskId: string;
    taskName: string;
    createdAt: string;
  };
}

/**
 * 为任务创建 Git 分支
 */
export function createTaskBranch(taskId: string, taskName: string): string | null {
  try {
    const safeName = taskName.replace(/[^\w\u4e00-\u9fa5-]/g, '-').replace(/-+/g, '-');
    const branchName = `feature/${taskId}-${safeName}`.substring(0, 100);

    execSync(`git checkout -b "${branchName}"`, { stdio: 'pipe' });

    // 记录关联
    const mapping = loadMapping();
    mapping[branchName] = { taskId, taskName: taskName, createdAt: new Date().toISOString() };
    saveMapping(mapping);

    return branchName;
  } catch {
    return null;
  }
}

/**
 * 获取当前分支关联的任务
 */
export function getCurrentTaskMapping(): { taskId: string; taskName: string } | null {
  try {
    const branch = execSync('git branch --show-current', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    const mapping = loadMapping();
    return mapping[branch] || null;
  } catch {
    return null;
  }
}

/**
 * 生成 Commit 消息
 */
export function generateCommitMessage(taskId: string, taskName: string, specs?: string[]): string {
  const lines = [`feat(${taskId}): ${taskName}`, ''];

  const changed = getChangedFiles();
  if (changed.length > 0) {
    lines.push('变更文件:');
    for (const f of changed.slice(0, 10)) {
      lines.push(`  - ${f}`);
    }
    lines.push('');
  }

  lines.push(`关联 Spec: ${taskId}`);
  return lines.join('\n');
}

/**
 * 生成 PR 描述
 */
export function generatePRDescription(taskId: string, taskName: string): string {
  const taskDir = join(process.cwd(), `.speccore`);
  const lines = [
    `## 关联任务`,
    `- ${taskId} ${taskName}`,
    '',
    '## 变更内容',
    ...getChangedFiles().map((f) => `- [ ] ${f}`),
    '',
    '## 验收标准',
    '- [ ] AC-01: 功能正常',
    '- [ ] AC-02: 边界处理',
    '',
    '## 测试',
    '- 通过 `speccore validate` 校验',
    '',
    `关联 Spec: ${taskId}`,
  ];
  return lines.join('\n');
}

/**
 * 安装 Git Hooks
 */
export function installGitHooks(): { preCommit: boolean; prePush: boolean } {
  const gitDir = join(process.cwd(), '.git');
  if (!existsSync(gitDir)) {
    throw new Error('Not a Git repository');
  }

  const hooksDir = join(gitDir, 'hooks');

  // pre-commit: check spec annotations
  const preCommitContent = `#!/bin/sh
# SpecCore pre-commit hook
echo "🔍 SpecCore: Checking @spec annotations..."
git diff --cached --name-only | grep -q "@spec" && echo "✅ Spec annotations found" || true
`;
  writeFileSync(join(hooksDir, 'pre-commit'), preCommitContent, { mode: 0o755 });

  // pre-push: run validate
  const prePushContent = `#!/bin/sh
# SpecCore pre-push hook
echo "🔍 SpecCore: Validating specs..."
speccore validate --warn-only
`;
  writeFileSync(join(hooksDir, 'pre-push'), prePushContent, { mode: 0o755 });

  return { preCommit: true, prePush: true };
}

// === Helpers ===

function loadMapping(): GitMapping {
  try {
    if (existsSync(GIT_MAPPING_PATH)) {
      return JSON.parse(readFileSync(GIT_MAPPING_PATH, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveMapping(mapping: GitMapping): void {
  ensureFileSync(GIT_MAPPING_PATH);
  writeFileSync(GIT_MAPPING_PATH, JSON.stringify(mapping, null, 2));
}

function getChangedFiles(): string[] {
  try {
    const output = execSync('git diff --name-only HEAD', { encoding: 'utf-8', stdio: 'pipe' });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
