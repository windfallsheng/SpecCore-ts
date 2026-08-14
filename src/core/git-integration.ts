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
import { randomBytes } from 'crypto';

const GIT_MAPPING_PATH = '.speccore/.git-mapping.json';

interface GitMapping {
  [branchName: string]: {
    taskId: string;
    taskName: string;
    createdAt: string;
  };
}

/**
 * Git 配置 — 三级回退：子任务级 > 迭代级 > 全局级 > 默认值
 *
 * 继承链：命令行参数 > 子任务 .meta/git-config > 迭代级 PROJECT_GRAPH.md > 全局 CONSTITUTION.md > 默认值
 */
export interface GitConfig {
  /** 默认基础分支（如 main/master） */
  defaultBranch: string;
  /** 分支类型（feature/bugfix/refactor/research），由任务 type 决定 */
  branchType: string;
  /** 分支前缀（如 2060708），三级回退 */
  branchPrefix: string;
  /** 分支命名格式模板 */
  branchFormat: string;
  /** 创建分支前是否自动 git pull */
  autoPull: boolean;
  /** 远程仓库名称 */
  remoteName: string;
  /** 保护分支列表 */
  protectedBranches: string[];
}

/** 任务类型 → 分支类型映射 */
export const TASK_TYPE_TO_BRANCH_TYPE: Record<string, string> = {
  feature: 'feature',
  bugfix: 'bugfix',
  refactor: 'refactor',
  research: 'research',
};

const DEFAULT_GIT_CONFIG: GitConfig = {
  defaultBranch: 'main',
  branchType: 'feature',
  branchPrefix: '',
  branchFormat: '{type}/{prefix}{name}-{hash4}',
  autoPull: false,
  remoteName: 'origin',
  protectedBranches: ['main', 'master'],
};

/**
 * 为任务创建 Git 分支
 *
 * 分支名按子任务级/迭代级/全局配置生成，支持自定义前缀和格式模板
 * 三级回退：子任务 .meta/git-config > 迭代 PROJECT_GRAPH.md > 全局 CONSTITUTION.md
 */
export function createTaskBranch(
  taskId: string,
  taskName: string,
  baseBranch?: string,
  iteration?: string,
  taskDir?: string,
  taskType?: string,
): string | null {
  try {
    // 读取 Git 配置（子任务级 > 迭代级 > 全局 > 默认）
    const gitConfig = loadGitConfig(iteration, taskDir);

    // 任务类型 → 分支类型
    const branchType = taskType
      ? (TASK_TYPE_TO_BRANCH_TYPE[taskType] || taskType)
      : gitConfig.branchType;

    // 任务名安全处理
    const safeName = taskName.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-');

    // 4 位随机 hex hash
    const hash4 = randomBytes(2).toString('hex');

    // 前缀段：有值时追加连字符，无值时为空
    const prefixSegment = gitConfig.branchPrefix ? `${gitConfig.branchPrefix}-` : '';

    // 按格式模板生成分支名
    const branchName = formatBranchName(gitConfig.branchFormat, {
      type: branchType,
      prefix: prefixSegment,
      taskId,
      name: safeName,
      date: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
      hash4,
    }).substring(0, 250);

    // 确定 base 分支: 显式指定 > 子任务配置 > 迭代配置 > 全局 > git检测
    let effectiveBase = baseBranch;
    if (!effectiveBase) {
      effectiveBase = gitConfig.defaultBranch;
    }

    // 自动拉取（如果配置开启）
    if (gitConfig.autoPull && effectiveBase) {
      try {
        execSync(`git pull ${gitConfig.remoteName} "${effectiveBase}"`, { stdio: 'pipe' });
      } catch {
        // pull 失败不阻断，继续创建分支
      }
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
    if (e.message?.includes('already exists')) {
      const cfg = loadGitConfig(iteration, taskDir);
      const bt = taskType ? (TASK_TYPE_TO_BRANCH_TYPE[taskType] || taskType) : cfg.branchType;
      const ps = cfg.branchPrefix ? `${cfg.branchPrefix}-` : '';
      return formatBranchName(cfg.branchFormat, {
        type: bt,
        prefix: ps,
        taskId,
        name: '',
        date: '',
        hash4: '',
      }).replace(/-{2,}/g, '-').replace(/-$/, '');
    }
    return null;
  }
}

/**
 * 按模板格式化分支名
 *
 * 支持变量: {type}, {prefix}, {taskId}, {name}, {date}, {hash4}
 */
function formatBranchName(
  template: string,
  vars: { type: string; prefix: string; taskId: string; name: string; date: string; hash4: string }
): string {
  return template
    .replace(/\{type\}/g, vars.type)
    .replace(/\{prefix\}/g, vars.prefix)
    .replace(/\{taskId\}/g, vars.taskId)
    .replace(/\{name\}/g, vars.name)
    .replace(/\{date\}/g, vars.date)
    .replace(/\{hash4\}/g, vars.hash4)
    .replace(/-{2,}/g, '-')   // 清理连续连字符
    .replace(/\/$/g, '')       // 清理尾部斜杠
    .replace(/^-|-$/g, '');    // 清理头尾连字符
}

/**
 * 读取子任务级 Git 配置
 *
 * 从任务 .meta/git-config 文件读取，格式（每行 key-value）：
 *   分支前缀: 2060708
 *   源分支: develop
 *   分支格式: {type}/{prefix}{name}-{hash4}
 *   自动拉取: true
 */
export function loadSubtaskGitConfig(taskDir: string): Partial<GitConfig> {
  const config: Partial<GitConfig> = {};
  try {
    const configPath = join(taskDir, '.meta', 'git-config');
    if (!existsSync(configPath)) return config;
    const content = readFileSync(configPath, 'utf-8');

    // 分支前缀
    const prefixMatch = content.match(/分支前缀[：:]\s*(\S+)/);
    if (prefixMatch) config.branchPrefix = prefixMatch[1];

    // 源分支
    const branchMatch = content.match(/源分支[：:]\s*(\S+)/);
    if (branchMatch) config.defaultBranch = branchMatch[1];

    // 分支格式
    const formatMatch = content.match(/分支格式[：:]\s*(.+)/);
    if (formatMatch) config.branchFormat = formatMatch[1].trim();

    // 自动拉取
    const pullMatch = content.match(/自动拉取[：:]\s*(\S+)/);
    if (pullMatch) config.autoPull = pullMatch[1] === 'true' || pullMatch[1] === '开启';

    // 远程名称
    const remoteMatch = content.match(/远程名称[：:]\s*(\S+)/);
    if (remoteMatch) config.remoteName = remoteMatch[1];
  } catch {}
  return config;
}

/**
 * 加载完整 Git 配置 — 子任务级 > 迭代级 > 全局 > 默认值
 *
 * 配置来源优先级：
 * 1. 子任务级 .meta/git-config    任务自身配置
 * 2. 迭代级 PROJECT_GRAPH.md      frontmatter 字段
 * 3. 全局 CONSTITUTION.md          Git 分支策略章节
 * 4. 默认值
 *
 * 每个字段独立回退：子任务只配了 branchPrefix，defaultBranch 仍从迭代/全局继承
 */
export function loadGitConfig(iteration?: string, taskDir?: string): GitConfig {
  const config: Partial<GitConfig> = {};

  // ── 1. 读取全局 CONSTITUTION.md ──
  try {
    const constitutionPath = join('.speccore', 'CONSTITUTION.md');
    if (existsSync(constitutionPath)) {
      const content = readFileSync(constitutionPath, 'utf-8');

      // 默认分支
      const branchMatch = content.match(/默认分支[：:]\s*(\S+)/);
      if (branchMatch) config.defaultBranch = branchMatch[1];

      // 任务分支前缀（从"任务分支: feature/{Task-ID}"提取前缀）
      const taskBranchMatch = content.match(/任务分支[：:]\s*(\S+?)\//);
      if (taskBranchMatch) config.branchPrefix = taskBranchMatch[1];

      // 保护分支
      const protectMatch = content.match(/保护分支[：:]\s*(.+)/);
      if (protectMatch) {
        config.protectedBranches = protectMatch[1]
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);
      }
    }
  } catch {}

  // ── 2. 迭代级 PROJECT_GRAPH.md 覆盖全局 ──
  if (iteration) {
    try {
      const iterGraphPath = join(`Iteration-${iteration}`, '000-overview', 'PROJECT_GRAPH.md');
      if (existsSync(iterGraphPath)) {
        const content = readFileSync(iterGraphPath, 'utf-8');

        // 默认分支
        const branchMatch = content.match(/默认分支[：:]\s*(\S+)/);
        if (branchMatch && branchMatch[1] !== '继承全局配置') {
          config.defaultBranch = branchMatch[1];
        }

        // 分支前缀
        const prefixMatch = content.match(/分支前缀[：:]\s*(\S+)/);
        if (prefixMatch) config.branchPrefix = prefixMatch[1];

        // 分支格式
        const formatMatch = content.match(/分支格式[：:]\s*(.+)/);
        if (formatMatch) config.branchFormat = formatMatch[1].trim();

        // 自动拉取
        const pullMatch = content.match(/自动拉取[：:]\s*(\S+)/);
        if (pullMatch) config.autoPull = pullMatch[1] === 'true' || pullMatch[1] === '开启';

        // 远程名称
        const remoteMatch = content.match(/远程名称[：:]\s*(\S+)/);
        if (remoteMatch) config.remoteName = remoteMatch[1];
      }
    } catch {}
  }

  // ── 3. 子任务级 .meta/git-config 覆盖迭代级（每个字段独立判断） ──
  if (taskDir) {
    const subtaskConfig = loadSubtaskGitConfig(taskDir);
    if (subtaskConfig.branchPrefix !== undefined) config.branchPrefix = subtaskConfig.branchPrefix;
    if (subtaskConfig.defaultBranch !== undefined) config.defaultBranch = subtaskConfig.defaultBranch;
    if (subtaskConfig.branchFormat !== undefined) config.branchFormat = subtaskConfig.branchFormat;
    if (subtaskConfig.autoPull !== undefined) config.autoPull = subtaskConfig.autoPull;
    if (subtaskConfig.remoteName !== undefined) config.remoteName = subtaskConfig.remoteName;
  }

  // ── 4. 合并默认值 ──
  return {
    defaultBranch: config.defaultBranch || DEFAULT_GIT_CONFIG.defaultBranch,
    branchType: config.branchType || DEFAULT_GIT_CONFIG.branchType,
    branchPrefix: config.branchPrefix !== undefined ? config.branchPrefix : DEFAULT_GIT_CONFIG.branchPrefix,
    branchFormat: config.branchFormat || DEFAULT_GIT_CONFIG.branchFormat,
    autoPull: config.autoPull !== undefined ? config.autoPull : DEFAULT_GIT_CONFIG.autoPull,
    remoteName: config.remoteName || DEFAULT_GIT_CONFIG.remoteName,
    protectedBranches: config.protectedBranches || DEFAULT_GIT_CONFIG.protectedBranches,
  };
}

/** 检测默认分支 — 兼容旧接口，内部调用 loadGitConfig */
export function detectDefaultBranch(iteration?: string): string | undefined {
  const cfg = loadGitConfig(iteration);
  if (cfg.defaultBranch) return cfg.defaultBranch;

  // 回退：git remote HEAD
  try {
    const remote = execSync('git remote show origin 2>/dev/null', { encoding: 'utf-8' });
    const headMatch = remote.match(/HEAD branch:\s*(\S+)/);
    if (headMatch) return headMatch[1];
  } catch {}

  // 回退：本地分支
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
