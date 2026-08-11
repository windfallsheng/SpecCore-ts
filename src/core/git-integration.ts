/**
 * Git Integration — 任务与 Git 工作流深度整合
 *
 * 功能：
 *  - 任务 ↔ 分支关联
 *  - Commit 消息自动生成
 *  - PR 描述自动生成
 *  - Git Hook 安装
 *  - 保护分支拦截
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
export function createTaskBranch(taskId: string, taskName: string, baseBranch?: string, iteration?: string): string | null {
  try {
    // 分支名 = taskId + 任务名精简（确保和目录名一致）
    const safeName = taskName.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-');
    const branchName = `feature/${taskId}-${safeName}`.substring(0, 250);

    // 确定 base 分支: 显式指定 > 依赖分支 > 迭代配置 > CONSTITUTION > git检测
    let effectiveBase = baseBranch;
    if (!effectiveBase) {
      effectiveBase = detectDefaultBranch(iteration);
    }

    if (effectiveBase) {
      execSync(`git checkout "${effectiveBase}"`, { stdio: 'pipe' });
    }

    execSync(`git checkout -b "${branchName}"`, { stdio: 'pipe' });

    // 记录关联
    const mapping = loadMapping();
    mapping[branchName] = { taskId, taskName: taskName, createdAt: new Date().toISOString() };
    saveMapping(mapping);

    return branchName;
  } catch (e: any) {
    // 分支已存在等非致命错误
    if (e.message?.includes('already exists')) return `feature/${taskId}`;
    return null;
  }
}

/** 检测默认分支: 迭代配置 > CONSTITUTION > git remote > 本地 */
export function detectDefaultBranch(iteration?: string): string | undefined {
  // 1. 迭代级配置 (PROJECT_GRAPH.md 中 默认分支 字段)
  if (iteration) {
    try {
      const iterGraphPath = join(`Iteration-${iteration}`, '000-overview', 'PROJECT_GRAPH.md');
      if (require('fs').existsSync(iterGraphPath)) {
        const content = require('fs').readFileSync(iterGraphPath, 'utf-8');
        const match = content.match(/默认分支[：:]\s*(\S+)/);
        if (match) return match[1];
      }
    } catch {}
  }

  // 2. 全局 CONSTITUTION.md
  try {
    const constitutionPath = join('.speccore', 'CONSTITUTION.md');
    if (require('fs').existsSync(constitutionPath)) {
      const content = require('fs').readFileSync(constitutionPath, 'utf-8');
      const match = content.match(/默认分支[：:]\s*(\S+)/);
      if (match) return match[1];
    }
  } catch {}

  // 3. git remote HEAD
  try {
    const remote = execSync('git remote show origin 2>/dev/null', { encoding: 'utf-8' });
    const headMatch = remote.match(/HEAD branch:\s*(\S+)/);
    if (headMatch) return headMatch[1];
  } catch {}

  // 4. 本地分支
  try {
    const branches = execSync('git branch', { encoding: 'utf-8' });
    if (branches.includes('main') || branches.includes(' main')) return 'main';
    if (branches.includes('master') || branches.includes(' master')) return 'master';
  } catch {}

  return undefined;
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
 * 从 CONSTITUTION.md 读取保护分支列表
 */
export function getProtectedBranches(): string[] {
  try {
    const constitutionPath = join('.speccore', 'CONSTITUTION.md');
    if (!existsSync(constitutionPath)) return [];
    const content = readFileSync(constitutionPath, 'utf-8');
    const match = content.match(/保护分支[：:]\s*(.+)/);
    if (!match) return [];
    return match[1]
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 检查分支是否为保护分支
 * 支持精确匹配和通配符（如 release/*）
 */
export function isProtectedBranch(branchName: string): boolean {
  const protected_ = getProtectedBranches();
  for (const pattern of protected_) {
    if (pattern.includes('*')) {
      // 通配符匹配: release/* → release/1.0.0
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      if (regex.test(branchName)) return true;
    } else {
      // 精确匹配
      if (branchName === pattern) return true;
    }
  }
  return false;
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

  // pre-commit: 保护分支检查 + spec annotations 检查
  const preCommitContent = `#!/bin/sh
# SpecCore pre-commit hook

# ── 1. 保护分支检查 ──
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)
if [ -n "$CURRENT_BRANCH" ] && [ -f ".speccore/CONSTITUTION.md" ]; then
  PROTECTED=$(grep '保护分支' .speccore/CONSTITUTION.md | sed 's/.*[：:]\\s*//' | tr ',' '\\n' | sed 's/^[ \\t]*//')
  for PATTERN in $PROTECTED; do
    # 精确匹配
    if [ "$CURRENT_BRANCH" = "$PATTERN" ]; then
      echo "❌ SpecCore: 保护分支 '$CURRENT_BRANCH' 禁止直接 commit"
      echo "   请切换到 feature/ 分支或使用 PR 合并"
      exit 1
    fi
    # 通配符匹配 (release/* → release/xxx)
    case "$PATTERN" in
      *"*"*)
        REGEX=$(echo "$PATTERN" | sed 's/\\*/.*/')
        if echo "$CURRENT_BRANCH" | grep -qE "^\${REGEX}$"; then
          echo "❌ SpecCore: 保护分支 '$CURRENT_BRANCH' 匹配保护规则 '$PATTERN'，禁止直接 commit"
          echo "   请切换到 feature/ 分支或使用 PR 合并"
          exit 1
        fi
        ;;
    esac
  done
fi

# ── 2. Spec annotations 检查 ──
echo "🔍 SpecCore: Checking @spec annotations..."
git diff --cached --name-only | grep -q "@spec" && echo "✅ Spec annotations found" || true
`;
  writeFileSync(join(hooksDir, 'pre-commit'), preCommitContent, { mode: 0o755 });

  // pre-push: 保护分支检查 + validate
  const prePushContent = `#!/bin/sh
# SpecCore pre-push hook

# ── 1. 保护分支检查 ──
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)
if [ -n "$CURRENT_BRANCH" ] && [ -f ".speccore/CONSTITUTION.md" ]; then
  PROTECTED=$(grep '保护分支' .speccore/CONSTITUTION.md | sed 's/.*[：:]\\s*//' | tr ',' '\\n' | sed 's/^[ \\t]*//')
  for PATTERN in $PROTECTED; do
    if [ "$CURRENT_BRANCH" = "$PATTERN" ]; then
      echo "❌ SpecCore: 保护分支 '$CURRENT_BRANCH' 禁止 push"
      echo "   请通过 PR 合并代码"
      exit 1
    fi
    case "$PATTERN" in
      *"*"*)
        REGEX=$(echo "$PATTERN" | sed 's/\\*/.*/')
        if echo "$CURRENT_BRANCH" | grep -qE "^\${REGEX}$"; then
          echo "❌ SpecCore: 保护分支 '$CURRENT_BRANCH' 匹配保护规则 '$PATTERN'，禁止 push"
          echo "   请通过 PR 合并代码"
          exit 1
        fi
        ;;
    esac
  done
fi

# ── 2. Spec 验证 ──
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

/** 清理过期代码索引缓存（超过24小时自动清理） */
export function cleanStaleCache(): boolean {
  try {
    const cacheFile = '.speccore/cache/code-structure.json';
    const fs = require('fs');
    if (!fs.existsSync(cacheFile)) return false;
    const stat = fs.statSync(cacheFile);
    const hoursAgo = (Date.now() - stat.mtimeMs) / 3600000;
    if (hoursAgo > 24) {
      fs.unlinkSync(cacheFile);
      return true;
    }
  } catch {}
  return false;
}
