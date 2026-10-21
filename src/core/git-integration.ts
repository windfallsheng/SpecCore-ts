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
import { loadRawProjectConfig, parseYaml } from './unified-config';
import { toPinyinInitials } from './pinyin-initials';
import { parseStaffingTable } from './unit-staffing';
import { getProjectRoot } from '../utils/task-utils';

const gitMappingPath = () => join(getProjectRoot(), '.speccore', '.git-mapping.json');

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
 * 继承链：命令行参数 > 子任务 .meta/git-config > 迭代级 PROJECT_GRAPH.md
 *   > 全局 PROJECT.yaml git 段（机器事实源，v8.3.322+）> CONSTITUTION.md（AI 契约回退）> 默认值
 */
export interface GitConfig {
  /** 默认基础分支（如 main/master） */
  defaultBranch: string;
  /** 分支类型（feature/bugfix/hotfix/release），由任务 type 决定或子任务覆盖 */
  branchType: string;
  /** 分支前缀（如 2060708），三级回退 */
  branchPrefix: string;
  /** v8.3.114+: 任务名前的前缀（如 api-、backend-），可选 */
  taskPrefix?: string;
  /** v8.3.114+: 任务名后的后缀（如 urgent、review），可选 */
  taskSuffix?: string;
  /** 分支命名格式模板 */
  branchFormat: string;
  /** 创建分支前是否自动 git pull */
  autoPull: boolean;
  /** 远程仓库名称 */
  remoteName: string;
  /** 保护分支列表 */
  protectedBranches: string[];
  /** 依赖分支合并策略：auto=自动合并 / manual=交互确认 / off=不合并 */
  mergeDependencies: 'auto' | 'manual' | 'off';
  /** 只合并白名单中的依赖分支（任务 ID，空数组表示不限） */
  mergeWhitelist: string[];
  /** 排除黑名单中的依赖分支（任务 ID） */
  mergeBlacklist: string[];
}

/** 任务类型 → 分支类型映射 */
export const TASK_TYPE_TO_BRANCH_TYPE: Record<string, string> = {
  feature: 'feature',
  bugfix: 'bugfix',
  refactor: 'refactor',
  research: 'research',
};

/** 标准分支类型名集合（v8.3.306: 用于区分「任务分支: X/」中 X 是类型段还是自定义前缀） */
export const STANDARD_BRANCH_TYPES = new Set([
  'feature', 'bugfix', 'hotfix', 'release', 'support', 'refactor', 'research',
]);

/**
 * 从分支名第一段提取分支类型（feature/xxx → feature），非任务分支（无类型段）返回 undefined。
 * v8.3.339+: PR 目标分支按类型区分的前提——从哪类分支发起 PR，就查该类分支的 pr_target。
 * v8.3.341+: 从 pr.ts 提升至此统一（纯函数，便于测试与多处复用）。
 */
export function extractBranchTypeFromBranchName(branch: string): string | undefined {
  const name = branch.trim();
  const seg = name.split('/')[0];
  return seg && seg !== name ? seg : undefined;
}

const DEFAULT_GIT_CONFIG: GitConfig = {
  defaultBranch: 'main',
  branchType: 'feature',
  branchPrefix: '',
  // v8.3.9+: 默认用 taskId 作为分支名主体（全局唯一，可读，无需随机 hash）
  branchFormat: '{type}/{prefix}{taskId}',
  autoPull: false,
  remoteName: 'origin',
  protectedBranches: ['main', 'master'],
  mergeDependencies: 'auto',
  mergeWhitelist: [],
  mergeBlacklist: [],
};

/**
 * 同步读取 PROJECT.yaml 的 Git 配置（v8.3.322+）
 *
 * Git 配置单向收敛：PROJECT.yaml 是机器事实源，CONSTITUTION.md 是 AI 阅读契约与兼容回退。
 * 只认用户显式声明的字段（不合并 DEFAULT_PROJECT_CONFIG 默认值），未声明返回 undefined，
 * 由调用方按字段独立回退 CONSTITUTION / 默认值。
 *
 * 与 resolveTaskBaseBranch 的 loadRawProjectConfig 同源同语义，但本函数是同步版——
 * loadGitConfig / getProtectedBranches 是同步接口，不能 await。
 */
function loadRawProjectGitSync(): {
  defaultBase?: string;
  protectedBranches?: string[];
  /** v8.3.323: 用户是否显式声明了 protected_branches（含显式清空 []）——声明即准，不再回退 CONSTITUTION */
  declaredProtected?: boolean;
  /** v8.3.336+: 分支名格式模板（全局兜底） */
  branchFormat?: string;
  /** v8.3.336+: 分支类型定义（全局兜底，按任务分支类型取 prefix/suffix） */
  branchTypes?: Record<string, { prefix?: string; suffix?: string; source?: string }>;
} | null {
  try {
    const projectPath = join(getProjectRoot(), '.speccore', 'PROJECT.yaml');
    if (!existsSync(projectPath)) return null;
    const raw = parseYaml(readFileSync(projectPath, 'utf-8')) as {
      git?: { default_base?: unknown; protected_branches?: unknown; branch_format?: unknown; branch_types?: unknown };
      platforms?: Array<{ protected_branches?: unknown }>;
    };
    if (!raw?.git) return null;
    const result: {
      defaultBase?: string;
      protectedBranches?: string[];
      declaredProtected?: boolean;
      branchFormat?: string;
      branchTypes?: Record<string, { prefix?: string; suffix?: string; source?: string }>;
    } = {};
    if (typeof raw.git.default_base === 'string' && raw.git.default_base.trim()) {
      result.defaultBase = raw.git.default_base.trim();
    }
    // v8.3.336+: 分支名格式模板（全局兜底，用户显式声明才生效）
    if (typeof raw.git.branch_format === 'string' && raw.git.branch_format.trim()) {
      result.branchFormat = raw.git.branch_format.trim();
    }
    // v8.3.336+: 分支类型定义（全局兜底，prefix/suffix 按任务分支类型取）
    if (raw.git.branch_types && typeof raw.git.branch_types === 'object' && !Array.isArray(raw.git.branch_types)) {
      const types: Record<string, { prefix?: string; suffix?: string; source?: string }> = {};
      for (const [name, def] of Object.entries(raw.git.branch_types as Record<string, unknown>)) {
        if (def && typeof def === 'object' && !Array.isArray(def)) {
          const d = def as { prefix?: unknown; suffix?: unknown; source?: unknown };
          const entry: { prefix?: string; suffix?: string; source?: string } = {};
          if (typeof d.prefix === 'string') entry.prefix = d.prefix;
          if (typeof d.suffix === 'string') entry.suffix = d.suffix;
          if (typeof d.source === 'string') entry.source = d.source;
          if (entry.prefix !== undefined || entry.suffix !== undefined || entry.source !== undefined) {
            types[name] = entry;
          }
        }
      }
      if (Object.keys(types).length > 0) result.branchTypes = types;
    }
    // 全局 + 端级 protected_branches 合并；「声明」= git 段键存在 或 任一端声明
    const declared = raw.git.protected_branches !== undefined && raw.git.protected_branches !== null
      || (raw.platforms || []).some((p) => p?.protected_branches !== undefined && p?.protected_branches !== null);
    if (declared) result.declaredProtected = true;
    const merged = new Set<string>();
    for (const b of (raw.git.protected_branches as string[]) || []) {
      if (b != null) merged.add(String(b).trim());
    }
    for (const p of raw.platforms || []) {
      for (const b of (p?.protected_branches as string[]) || []) {
        if (b != null) merged.add(String(b).trim());
      }
    }
    if (merged.size > 0) result.protectedBranches = [...merged];
    return result;
  } catch {
    return null;
  }
}

/** Git 源不一致告警标记文件（指纹去重，避免每个任务刷屏） */
const gitSourceWarnPath = () => join(getProjectRoot(), '.speccore', 'local', '.git-source-warn.json');

/**
 * Git 配置双源不一致告警（v8.3.323）
 *
 * 存量项目升级后，PROJECT.yaml 与 CONSTITUTION 可能残留两份不一致的 Git 配置。
 * 机器已切到「PROJECT.yaml 声明即准」，此处把不一致摆到明面上，按指纹只告警一次：
 * 同一不一致不重复刷屏；用户修平后标记清除，未来再不一致可再次告警。
 */
function warnGitSourceMismatch(): void {
  try {
    const constitutionPath = join(getProjectRoot(), '.speccore', 'CONSTITUTION.md');
    if (!existsSync(constitutionPath)) return;
    const content = readFileSync(constitutionPath, 'utf-8');
    const cnDefault = content.match(/^[-•]\s*\**默认分支\**\s*[：:]\s*([A-Za-z0-9._\/-]+)/m)?.[1] ?? null;
    const cnProtectRaw = content.match(/^[-•]\s*\**保护分支\**\s*[：:]\s*(.+)$/m)?.[1] ?? null;
    const cnProtect = cnProtectRaw ? cnProtectRaw.split(',').map((s: string) => s.trim()).filter(Boolean) : null;

    const projectGit = loadRawProjectGitSync();
    const mismatches: string[] = [];
    if (projectGit?.defaultBase && cnDefault && projectGit.defaultBase !== cnDefault) {
      mismatches.push(`默认分支：PROJECT.yaml=${projectGit.defaultBase}，CONSTITUTION=${cnDefault}`);
    }
    if (projectGit?.declaredProtected && cnProtect) {
      const py = [...(projectGit.protectedBranches || [])].sort().join(',');
      const cn = [...cnProtect].sort().join(',');
      if (py !== cn) mismatches.push(`保护分支：PROJECT.yaml=[${py}]，CONSTITUTION=[${cn}]`);
    }

    const markerPath = gitSourceWarnPath();
    const fingerprint = mismatches.join(' || ');
    let warned = '';
    try { warned = readFileSync(markerPath, 'utf-8').trim(); } catch {}

    if (mismatches.length === 0) {
      if (warned) { try { writeFileSync(markerPath, ''); } catch {} } // 已修平，清除标记
      return;
    }
    if (warned === fingerprint) return; // 同一不一致已告警过
    try { ensureFileSync(markerPath); writeFileSync(markerPath, fingerprint); } catch {}
    for (const m of mismatches) {
      console.warn(`⚠️ SpecCore: Git 配置两处不一致（机器以 PROJECT.yaml 为准）— ${m}`);
    }
    console.warn('   请修正 CONSTITUTION.md「Git 分支策略」或 PROJECT.yaml git 段，使两处一致');
  } catch {}
}

/**
 * 为任务创建 Git 分支
 *
 * 分支名按子任务级/迭代级/全局配置生成，支持自定义前缀和格式模板
 * 三级回退：子任务 .meta/git-config > 迭代 PROJECT_GRAPH.md > 全局 PROJECT.yaml > CONSTITUTION 回退
 *
 * v8.3.87+: 增加 cwd 参数，支持 speccore 与工程代码分离的目录结构
 */
/**
 * 检测分支是否已存在（本地或远端引用，v8.3.337+）
 * 用于多端同模块子任务同名分支的冲突兜底。
 */
function branchExists(branchName: string, cwd: string): boolean {
  try {
    execSync(`git rev-parse --verify "${branchName}"`, { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * owner → 分支后缀代号（v8.3.337+）
 * 1. 成员表声明的「分支代号」优先（TEAM.md 基座 + 迭代 STAFFING.md，解决重名拼音碰撞）
 * 2. 姓名拼音首字母兜底（张三 → zs）
 */
function resolveOwnerBranchInitials(owner: string, iteration?: string): string {
  try {
    const root = getProjectRoot();
    const teamPath = join(root, '.speccore', 'PROJECT', 'TEAM.md');
    if (existsSync(teamPath)) {
      const members = parseStaffingTable(readFileSync(teamPath, 'utf-8'));
      if (iteration) {
        const staffingPath = join(root, `Iteration-${iteration}`, 'STAFFING.md');
        if (existsSync(staffingPath)) {
          members.push(...parseStaffingTable(readFileSync(staffingPath, 'utf-8')));
        }
      }
      const member = members.find((m) => m.name === owner);
      if (member?.initials && /^[a-z0-9]+$/i.test(member.initials)) {
        return member.initials.toLowerCase();
      }
    }
  } catch { /* 成员表读取失败回退拼音 */ }
  return toPinyinInitials(owner);
}

export function createTaskBranch(
  taskId: string,
  taskName: string,
  baseBranch?: string,
  iteration?: string,
  taskDir?: string,
  taskType?: string,
  cwd?: string,
): string | null {
  const gitCwd = cwd || process.cwd();
  try {
    // 任务类型 → 分支类型（taskType 存在时直接映射，无需先读配置）
    let branchType: string | undefined;
    if (taskType) branchType = TASK_TYPE_TO_BRANCH_TYPE[taskType] || taskType;

    // 读取 Git 配置（子任务级 > 迭代级 > 全局 > 默认）
    // v8.3.336+: 传入 branchType，供全局 branch_types 的 prefix/suffix 兜底查表
    const gitConfig = loadGitConfig(iteration, taskDir, branchType);
    if (!branchType) branchType = gitConfig.branchType;

    // 任务名安全处理（保留 {name} 格式模板变量使用）
    const safeName = taskName.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '-');

    // v8.3.306: 拼接逻辑抽取为 composeBranchName（主流程与 already-exists 重建端共用，
    // 消除重复实现并锁定「分支名主体 = taskId」的一致性）
    const branchName = composeBranchName(gitConfig, branchType, taskId, safeName);

    // 确定 base 分支: 显式指定 > 子任务配置 > 迭代配置 > 全局 > git检测
    let effectiveBase = baseBranch;
    if (!effectiveBase) {
      effectiveBase = gitConfig.defaultBranch;
    }

    // 自动拉取（如果配置开启）
    if (gitConfig.autoPull && effectiveBase) {
      try {
        execSync(`git pull ${gitConfig.remoteName} "${effectiveBase}"`, { cwd: gitCwd, stdio: 'pipe' });
      } catch {
        // pull 失败不阻断，继续创建分支
      }
    }

    if (effectiveBase) {
      execSync(`git checkout "${effectiveBase}"`, { cwd: gitCwd, stdio: 'pipe' });
    }

    // v8.3.337+: 分支重名兜底——子任务名不再拼端名后，多端同模块子任务的分支名相同，
    // 已存在的同名分支若属于当前任务（重跑）则复用，否则拼 -hash4 区分（最多 3 次）。
    let finalBranchName = branchName;
    if (branchExists(branchName, gitCwd)) {
      const existing = findBranchByTaskId(taskId, gitCwd);
      if (existing) return existing;
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidate = `${branchName}-${randomBytes(2).toString('hex')}`;
        if (!branchExists(candidate, gitCwd)) {
          finalBranchName = candidate;
          break;
        }
      }
    }

    execSync(`git checkout -b "${finalBranchName}"`, { cwd: gitCwd, stdio: 'pipe' });

    // 记录关联
    const mapping = loadMapping();
    mapping[finalBranchName] = { taskId, taskName: taskName, createdAt: new Date().toISOString() };
    saveMapping(mapping);

    return finalBranchName;
  } catch (e: any) {
    // v8.3.6+: 分支创建失败时输出错误信息，不要静默吞掉
    if (e.message?.includes('already exists')) {
      const existing = findBranchByTaskId(taskId, gitCwd);
      if (existing) return existing;
      const cfg = loadGitConfig(iteration, taskDir, taskType ? (TASK_TYPE_TO_BRANCH_TYPE[taskType] || taskType) : undefined);
      const bt = taskType ? (TASK_TYPE_TO_BRANCH_TYPE[taskType] || taskType) : cfg.branchType;
      // v8.3.306: 与主流程共用 composeBranchName，拼接规则一致
      return composeBranchName(cfg, bt, taskId, '');
    }
    // 输出具体错误，帮助用户定位问题（如不在 git 仓库中、base 分支不存在等）
    console.error(`[speccore] Git 分支创建失败: ${e.message || e}`);
    if (e.stderr) console.error(`[speccore] stderr: ${e.stderr.toString()}`);
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
 * 按配置组装分支名（纯函数，v8.3.306 抽取自 createTaskBranch）
 *
 * v8.3.120+: 用户完全控制 prefix/suffix（包含分隔符），代码只负责拼接
 * v8.3.293+: 分支名主体统一为 taskId（子任务全局唯一 ID，与 git-config 文档示例
 * 「前缀=api- → hotfix/api-Task-001-urgent」一致）；此前用中文任务名会导致
 * findBranchByTaskId 的 taskId 正则匹配失联、CI 平台对中文分支名兼容性差。
 * 示例: prefix='api-' suffix='-urgent' → hotfix/api-Task-001-urgent
 *       prefix='api_' suffix='_urgent' → hotfix/api_Task-001_urgent
 */
export function composeBranchName(
  gitConfig: GitConfig,
  branchType: string,
  taskId: string,
  safeName: string,
): string {
  if (gitConfig.taskPrefix !== undefined || gitConfig.taskSuffix !== undefined) {
    const prefix = gitConfig.taskPrefix || '';
    const suffix = gitConfig.taskSuffix || '';
    return `${branchType}/${prefix}${taskId}${suffix}`.substring(0, 250);
  }
  // 4 位随机 hex hash
  const hash4 = randomBytes(2).toString('hex');
  // 前缀段：有值时追加连字符，无值时为空
  // v8.3.306: branchPrefix 与类型段相同（如 CONSTITUTION「任务分支: feature/」被旧版
  // 误解析为 branchPrefix=feature）时视为类型段——{type} 已承载，不再重复拼入 {prefix}，
  // 修复分支名 feature/feature-Task-XXX 与子任务 ID 不一致的问题
  const effectivePrefix = gitConfig.branchPrefix && gitConfig.branchPrefix !== branchType
    ? gitConfig.branchPrefix
    : '';
  const prefixSegment = effectivePrefix ? `${effectivePrefix}-` : '';
  // 按格式模板生成分支名（兜底）
  return formatBranchName(gitConfig.branchFormat, {
    type: branchType,
    prefix: prefixSegment,
    taskId,
    name: safeName,
    date: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    hash4,
  }).substring(0, 250);
}

/**
 * 读取子任务级 Git 配置
 *
 * 从任务 .meta/git-config 文件读取，格式（每行 key-value）：
 *   分支前缀: 2060708
 *   源分支: develop
 *   分支格式: {type}/{prefix}{taskId}（v8.3.10+ 默认，支持 {name}/{hash4} 自定义）
 *   自动拉取: true
 */
export function loadSubtaskGitConfig(taskDir: string): Partial<GitConfig> {
  const config: Partial<GitConfig> = {};
  try {
    const configPath = join(taskDir, '.meta', 'git-config');
    if (!existsSync(configPath)) return config;
    const rawContent = readFileSync(configPath, 'utf-8');
    // 过滤注释行和空行，只保留有效配置行
    const content = rawContent.split(/\r?\n/)
      .filter(line => !line.trim().startsWith('#') && line.trim().length > 0)
      .join('\n');

    // v8.3.293+: 修复提取正则无行首锚定导致「前缀」误匹配「分支前缀: xxx」行的 bug
    // （此前全局未配 branch_types.prefix 时，生成的 git-config「前缀:」为注释行、
    // 「分支前缀:」为真实值，taskPrefix 会被误读为分支前缀的值，分支名拼接错误）。
    // 锚定行首（^ + m）后，各配置键只匹配以该键开头的行。
    const extractValue = (key: string): string | null => {
      const match = content.match(new RegExp(`^${key}[：:]\\s*(\\S+)`, 'm'));
      if (!match) return null;
      const val = match[1].trim();
      // 过滤占位符和无效值
      const INVALID_VALUES = new Set(['继承迭代配置', '继承全局配置', '(空)', '无', '—', '-', 'undefined', 'null', '']);
      if (INVALID_VALUES.has(val)) return null;
      return val;
    };

    // v8.3.114+: 分支类型（覆盖默认 feature）
    const branchType = extractValue('分支类型');
    if (branchType) config.branchType = branchType;

    // v8.3.114+: 任务名前的前缀（如 api-）
    const taskPrefix = extractValue('前缀');
    if (taskPrefix) config.taskPrefix = taskPrefix;

    // v8.3.114+: 任务名后的后缀（如 urgent）
    const taskSuffix = extractValue('后缀');
    if (taskSuffix) config.taskSuffix = taskSuffix;

    // 分支前缀（如日期编号 2060708）
    const branchPrefix = extractValue('分支前缀');
    if (branchPrefix) config.branchPrefix = branchPrefix;

    // 源分支
    const defaultBranch = extractValue('源分支');
    if (defaultBranch) config.defaultBranch = defaultBranch;

    // 分支格式（行首锚定 + 无效值过滤）
    const formatMatch = content.match(/^分支格式[：:]\s*(.+)$/m);
    if (formatMatch) {
      const val = formatMatch[1].trim();
      const INVALID_VALUES = new Set(['继承迭代配置', '继承全局配置', '(空)', '无', '—', '-', 'undefined', 'null', '']);
      if (!INVALID_VALUES.has(val)) config.branchFormat = val;
    }

    // 自动拉取
    const autoPull = extractValue('自动拉取');
    if (autoPull) config.autoPull = autoPull === 'true' || autoPull === '开启';

    // 远程名称
    const remoteName = extractValue('远程名称');
    if (remoteName) config.remoteName = remoteName;

    // 依赖分支合并策略（auto/manual/off）
    const mergeDep = extractValue('依赖合并策略');
    if (mergeDep && ['auto', 'manual', 'off'].includes(mergeDep)) config.mergeDependencies = mergeDep as 'auto' | 'manual' | 'off';

    // 合并白名单 / 黑名单（逗号分隔的任务 ID）
    const mergeWhitelist = extractValue('合并白名单');
    if (mergeWhitelist) config.mergeWhitelist = mergeWhitelist.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    const mergeBlacklist = extractValue('合并黑名单');
    if (mergeBlacklist) config.mergeBlacklist = mergeBlacklist.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  } catch {}
  return config;
}

/**
 * 加载完整 Git 配置 — 子任务级 > 迭代级 > 全局 > 默认值
 *
 * 配置来源优先级：
 * 1. 子任务级 .meta/git-config    任务自身配置
 * 2. 迭代级 PROJECT_GRAPH.md      frontmatter 字段
 * 3. 全局 PROJECT.yaml git 段     机器事实源（v8.3.322+）
 * 4. 全局 CONSTITUTION.md         「Git 分支策略」章节（AI 契约回退）
 * 5. 默认值
 *
 * 每个字段独立回退：子任务只配了 branchPrefix，defaultBranch 仍从迭代/全局继承
 */
export function loadGitConfig(iteration?: string, taskDir?: string, branchType?: string): GitConfig {
  const config: Partial<GitConfig> = {};

  // v8.3.323: 双源不一致告警（指纹去重，仅在 PROJECT.yaml 与 CONSTITUTION 值冲突时提示一次）
  warnGitSourceMismatch();

  // ── 1. 全局层：PROJECT.yaml git 段（机器事实源）> CONSTITUTION.md「Git 分支策略」（AI 契约回退） ──
  // v8.3.322: Git 配置单向收敛——PROJECT.yaml 是唯一机器事实源；CONSTITUTION 保留为
  // AI 阅读契约与兼容回退，同一字段仅在 PROJECT.yaml 未显式声明时才从 CONSTITUTION 取值。

  // 1a. PROJECT.yaml（同步读原始文件；branch_prefix 是旧语义兼容字段，其现代语义
  //     已由 getEffectiveGitConfig 端级路径消费，此处不注入以免与 branchType 双拼）
  const projectGit = loadRawProjectGitSync();
  if (projectGit) {
    if (projectGit.defaultBase) config.defaultBranch = projectGit.defaultBase;
    // v8.3.323: 声明即准（含显式清空 [] = 无保护分支）
    if (projectGit.declaredProtected) config.protectedBranches = projectGit.protectedBranches || [];
    // v8.3.336+: 分支名格式模板全局兜底——迭代 PROJECT_GRAPH / 子任务 git-config
    //     未配置时从这里取（全自动执行 / 未 taskify 场景的分支命名兜底）
    if (projectGit.branchFormat) config.branchFormat = projectGit.branchFormat;
    // v8.3.336+: 分支类型 prefix/suffix 全局兜底——按任务分支类型查表（如 feature 类型
    //     配了 prefix: api- → 全自动建分支时自动产出 feature/api-Task-XXX），
    //     迭代/子任务未配置时生效
    if (projectGit.branchTypes && branchType) {
      const typeDef = projectGit.branchTypes[branchType];
      if (typeDef?.prefix !== undefined) config.taskPrefix = typeDef.prefix;
      if (typeDef?.suffix !== undefined) config.taskSuffix = typeDef.suffix;
    }
  }

  // 1b. CONSTITUTION.md 回退（每字段独立：仅当上面未取到值）
  try {
    const constitutionPath = join(getProjectRoot(), '.speccore', 'CONSTITUTION.md');
    if (existsSync(constitutionPath)) {
      const content = readFileSync(constitutionPath, 'utf-8');

      // 默认分支（v8.3.300: 行首锚定 + 兼容「**默认分支**」双侧加粗格式，避开「> - **默认分支**：如 main...」字段说明行误匹配）
      if (!config.defaultBranch) {
        const branchMatch = content.match(/^[-•]\s*\**默认分支\**\s*[：:]\s*([A-Za-z0-9._\/-]+)/m);
        if (branchMatch) config.defaultBranch = branchMatch[1];
      }

      // 任务分支类型段（从"任务分支: feature/{Task-ID}"提取，兼容加粗格式）
      // v8.3.306: 语义矫正——「任务分支」的 X/ 段是分支类型而非前缀；此前误存
      // branchPrefix，与 {type} 段重复拼出 feature/feature-Task-XXX，导致分支名与
      // 子任务 ID 不一致。标准类型名写入 branchType，自定义值（兼容保留）仍入 branchPrefix。
      if (!config.branchType) {
        const taskBranchMatch = content.match(/^[-•]\s*\**任务分支\**\s*[：:]\s*(\S+?)\//m);
        if (taskBranchMatch) {
          const extracted = taskBranchMatch[1];
          // v8.3.293+: 模板变量（如 {type}）不是真实值，忽略以免污染分支命名
          if (!extracted.includes('{') && !extracted.includes('}')) {
            if (STANDARD_BRANCH_TYPES.has(extracted)) {
              config.branchType = extracted;
            } else if (config.branchPrefix === undefined) {
              config.branchPrefix = extracted;
            }
          }
        }
      }

      // 保护分支（行首锚定，兼容「**保护分支**」双侧加粗格式，避开字段说明行）
      if (!config.protectedBranches) {
        const protectMatch = content.match(/^[-•]\s*\**保护分支\**\s*[：:]\s*(.+)$/m);
        if (protectMatch) {
          config.protectedBranches = protectMatch[1]
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
        }
      }

      // v8.3.209+: 依赖合并策略（auto/manual/off）+ 黑白名单
      const mergeDepMatch = content.match(/依赖合并策略[：:]\s*(\S+)/);
      if (mergeDepMatch && ['auto', 'manual', 'off'].includes(mergeDepMatch[1])) {
        config.mergeDependencies = mergeDepMatch[1] as 'auto' | 'manual' | 'off';
      }
      const mergeWlMatch = content.match(/合并白名单[：:]\s*(.+)/);
      if (mergeWlMatch) config.mergeWhitelist = mergeWlMatch[1].split(/[,，]/).map((s: string) => s.trim()).filter(Boolean);
      const mergeBlMatch = content.match(/合并黑名单[：:]\s*(.+)/);
      if (mergeBlMatch) config.mergeBlacklist = mergeBlMatch[1].split(/[,，]/).map((s: string) => s.trim()).filter(Boolean);
    }
  } catch {}

  // ── 2. 迭代级 PROJECT_GRAPH.md 覆盖全局 ──
  if (iteration) {
    try {
      const iterGraphPath = join(getProjectRoot(), `Iteration-${iteration}`, '000-overview', 'PROJECT_GRAPH.md');
      if (existsSync(iterGraphPath)) {
        const content = readFileSync(iterGraphPath, 'utf-8');

        // 辅助函数：从表格或冒号格式提取值
        const extractValue = (key: string): string | null => {
          // 表格格式: | 配置项 | 值 | 说明 |
          const tableMatch = content.match(new RegExp(`\\|\\s*${key}\\s*\\|\\s*([^|]+)\\s*\\|`));
          if (tableMatch) {
            const val = tableMatch[1].trim();
            if (val && val !== '继承全局配置' && val !== '-' && val !== '') return val;
          }
          // 冒号格式: 配置项: 值
          const colonMatch = content.match(new RegExp(`${key}[：:]\\s*(\\S+)`));
          if (colonMatch && colonMatch[1] !== '继承全局配置') return colonMatch[1];
          return null;
        };

        // 默认分支
        const defaultBranch = extractValue('默认分支');
        if (defaultBranch) config.defaultBranch = defaultBranch;

        // 分支前缀
        const branchPrefix = extractValue('分支前缀');
        if (branchPrefix) config.branchPrefix = branchPrefix;

        // 分支格式
        const branchFormat = extractValue('分支格式');
        if (branchFormat) config.branchFormat = branchFormat;

        // 自动拉取
        const autoPull = extractValue('自动拉取');
        if (autoPull) config.autoPull = autoPull === 'true' || autoPull === '开启';

        // 远程名称
        const remoteName = extractValue('远程名称');
        if (remoteName) config.remoteName = remoteName;

        // v8.3.209+: 依赖合并策略 + 黑白名单
        const mergeDep = extractValue('依赖合并策略');
        if (mergeDep && ['auto', 'manual', 'off'].includes(mergeDep)) config.mergeDependencies = mergeDep as 'auto' | 'manual' | 'off';
        const mergeWl = extractValue('合并白名单');
        if (mergeWl) config.mergeWhitelist = mergeWl.split(/[,，]/).map((s: string) => s.trim()).filter(Boolean);
        const mergeBl = extractValue('合并黑名单');
        if (mergeBl) config.mergeBlacklist = mergeBl.split(/[,，]/).map((s: string) => s.trim()).filter(Boolean);
      }
    } catch {}
  }

  // ── 3. 子任务级 .meta/git-config 覆盖迭代级（每个字段独立判断） ──
  if (taskDir) {
    const subtaskConfig = loadSubtaskGitConfig(taskDir);
    if (subtaskConfig.branchType !== undefined) config.branchType = subtaskConfig.branchType;
    if (subtaskConfig.taskPrefix !== undefined) config.taskPrefix = subtaskConfig.taskPrefix;
    if (subtaskConfig.taskSuffix !== undefined) config.taskSuffix = subtaskConfig.taskSuffix;
    if (subtaskConfig.branchPrefix !== undefined) config.branchPrefix = subtaskConfig.branchPrefix;
    if (subtaskConfig.defaultBranch !== undefined) config.defaultBranch = subtaskConfig.defaultBranch;
    if (subtaskConfig.branchFormat !== undefined) config.branchFormat = subtaskConfig.branchFormat;
    if (subtaskConfig.autoPull !== undefined) config.autoPull = subtaskConfig.autoPull;
    if (subtaskConfig.remoteName !== undefined) config.remoteName = subtaskConfig.remoteName;
    if (subtaskConfig.mergeDependencies !== undefined) config.mergeDependencies = subtaskConfig.mergeDependencies;
    if (subtaskConfig.mergeWhitelist !== undefined) config.mergeWhitelist = subtaskConfig.mergeWhitelist;
    if (subtaskConfig.mergeBlacklist !== undefined) config.mergeBlacklist = subtaskConfig.mergeBlacklist;
  }

  // ── 3.5 v8.3.337+: 后缀 owner 拼音首字母兜底 ──
  // 显式 taskSuffix / 全局 branch_types suffix 均未配置时，读 .meta/owner：
  // 成员表声明的「分支代号」优先，否则姓名拼音首字母（张三 → -zs）；
  // owner 为「未分配」/缺失 → 不拼后缀，分支名保持干净。
  if (config.taskSuffix === undefined && taskDir) {
    try {
      const ownerPath = join(taskDir, '.meta', 'owner');
      if (existsSync(ownerPath)) {
        const owner = readFileSync(ownerPath, 'utf-8').trim();
        if (owner && owner !== '未分配') {
          const initials = resolveOwnerBranchInitials(owner, iteration);
          if (initials) config.taskSuffix = `-${initials}`;
        }
      }
    } catch { /* owner 读取失败静默降级（不阻断分支创建） */ }
  }

  // ── 4. 合并默认值 ──
  return {
    defaultBranch: config.defaultBranch || DEFAULT_GIT_CONFIG.defaultBranch,
    branchType: config.branchType || DEFAULT_GIT_CONFIG.branchType,
    branchPrefix: config.branchPrefix !== undefined ? config.branchPrefix : DEFAULT_GIT_CONFIG.branchPrefix,
    taskPrefix: config.taskPrefix,
    taskSuffix: config.taskSuffix,
    branchFormat: config.branchFormat || DEFAULT_GIT_CONFIG.branchFormat,
    autoPull: config.autoPull !== undefined ? config.autoPull : DEFAULT_GIT_CONFIG.autoPull,
    remoteName: config.remoteName || DEFAULT_GIT_CONFIG.remoteName,
    protectedBranches: config.protectedBranches || DEFAULT_GIT_CONFIG.protectedBranches,
    mergeDependencies: config.mergeDependencies || DEFAULT_GIT_CONFIG.mergeDependencies,
    mergeWhitelist: config.mergeWhitelist || DEFAULT_GIT_CONFIG.mergeWhitelist,
    mergeBlacklist: config.mergeBlacklist || DEFAULT_GIT_CONFIG.mergeBlacklist,
  };
}

/** 检测默认分支 — 内部调用 loadGitConfig
 * v8.3.87+: 增加 cwd 参数，支持 speccore 与工程代码分离
 */
export function detectDefaultBranch(iteration?: string, cwd?: string): string | undefined {
  const cfg = loadGitConfig(iteration);
  if (cfg.defaultBranch) return cfg.defaultBranch;

  const gitCwd = cwd || process.cwd();

  // 回退：git remote HEAD
  try {
    const remote = execSync('git remote show origin', { cwd: gitCwd, encoding: 'utf-8', stdio: 'pipe' });
    const headMatch = remote.match(/HEAD branch:\s*(\S+)/);
    if (headMatch) return headMatch[1];
  } catch {}

  // 回退：本地分支
  try {
    const branches = execSync('git branch', { cwd: gitCwd, encoding: 'utf-8' });
    if (branches.includes('main') || branches.includes(' main')) return 'main';
    if (branches.includes('master') || branches.includes(' master')) return 'master';
  } catch {}

  return undefined;
}

/**
 * 解析任务分支的创建源分支（v8.3.304+）
 *
 * 优先级：任务级 .meta/git-config「源分支」 > 迭代级 PROJECT_GRAPH「默认分支」
 *   > PROJECT.yaml branch_types[{taskType}].source > PROJECT.yaml git.default_base
 *   > 回退 detectDefaultBranch（CONSTITUTION「默认分支」/ 默认 main / git remote HEAD / 本地分支）
 *
 * 背景：此前 execute 拉分支只走 loadGitConfig（CONSTITUTION/任务级 git-config），
 * PROJECT.yaml 的 git.default_base 与 branch_types[].source 从未参与判定，
 * 用户在主配置里声明的 source 不生效。
 */
export async function resolveTaskBaseBranch(
  taskType?: string,
  iteration?: string,
  taskDir?: string,
  cwd?: string,
): Promise<string | undefined> {
  // 1. 任务级 .meta/git-config「源分支」（最局部，最高优先级）
  if (taskDir) {
    const sub = loadSubtaskGitConfig(taskDir);
    if (sub.defaultBranch) return sub.defaultBranch;
  }

  // 2. 迭代级 PROJECT_GRAPH.md「默认分支」
  if (iteration) {
    try {
      const iterGraphPath = join(getProjectRoot(), `Iteration-${iteration}`, '000-overview', 'PROJECT_GRAPH.md');
      if (existsSync(iterGraphPath)) {
        const content = readFileSync(iterGraphPath, 'utf-8');
        const tableMatch = content.match(/\|\s*默认分支\s*\|\s*([^|]+)\s*\|/);
        if (tableMatch) {
          const val = tableMatch[1].trim();
          if (val && val !== '继承全局配置' && val !== '-' && val !== '') return val;
        }
      }
    } catch {}
  }

  // 3. PROJECT.yaml 主配置（读原始文件，只认用户显式声明）:
  //    branch_types[{taskType}].source 优先，git.default_base 兜底
  //    不用 loadProjectConfig：其返回的 merge 后配置含 DEFAULT_PROJECT_CONFIG
  //    预置 branch_types 表，会把「用户没配 release」误判为「显式 source=develop」
  try {
    const raw = await loadRawProjectConfig();
    if (raw) {
      if (taskType) {
        const source = raw.git?.branch_types?.[taskType]?.source;
        if (source) return source;
      }
      if (raw.git?.default_base) return raw.git.default_base;
    }
  } catch {}

  // 4. 回退：CONSTITUTION「默认分支」/ 默认 main / git remote HEAD / 本地分支
  return detectDefaultBranch(iteration, cwd);
}

/**
 * 获取当前分支关联的任务
 * v8.3.88+: 支持 cwd 参数，工程目录分离场景下使用正确的 git 仓库
 */
export function getCurrentTaskMapping(cwd?: string): { taskId: string; taskName: string } | null {
  const gitCwd = cwd || process.cwd();
  try {
    const branch = execSync('git branch --show-current', { cwd: gitCwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
    const mapping = loadMapping();
    return mapping[branch] || null;
  } catch {
    return null;
  }
}

/**
 * 生成 Commit 消息
 * v8.3.88+: 支持 cwd 参数
 * v8.3.293+: 增加 taskType 参数，按任务类型生成符合语义的提交前缀（feature→feat/bugfix→fix/refactor→refactor/research→chore）
 */
export function generateCommitMessage(taskId: string, taskName: string, specs?: string[], cwd?: string, taskType?: string): string {
  const typePrefix: Record<string, string> = { feature: 'feat', bugfix: 'fix', refactor: 'refactor', research: 'chore' };
  const commitType = typePrefix[taskType || 'feature'] || 'feat';
  const lines = [`${commitType}(${taskId}): ${taskName}`, ''];

  const changed = getChangedFiles(cwd);
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
 * v8.3.88+: 支持 cwd 参数
 */
export function generatePRDescription(taskId: string, taskName: string, cwd?: string): string {
  const lines = [
    `## 关联任务`,
    `- ${taskId} ${taskName}`,
    '',
    '## 变更内容',
    ...getChangedFiles(cwd).map((f) => `- [ ] ${f}`),
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
 * 读取保护分支列表
 * v8.3.323: 严格收敛——PROJECT.yaml 声明了（含显式清空 []）就以其为准；
 * 未声明则回退 CONSTITUTION「保护分支」；两处都无则兜底默认 main/master。
 */
export function getProtectedBranches(): string[] {
  const projectGit = loadRawProjectGitSync();
  if (projectGit?.declaredProtected) {
    // 声明即准：显式清空 = 无保护分支，尊重用户意图，不回退 CONSTITUTION
    return projectGit.protectedBranches || [];
  }
  // 2. CONSTITUTION.md「保护分支」（AI 契约回退）
  const merged = new Set<string>();
  try {
    const constitutionPath = join(getProjectRoot(), '.speccore', 'CONSTITUTION.md');
    if (existsSync(constitutionPath)) {
      const content = readFileSync(constitutionPath, 'utf-8');
      // v8.3.300: 行首锚定 + 兼容「**保护分支**」双侧加粗格式（此前匹配不到导致保护分支检查失效）
      const match = content.match(/^[-•]\s*\**保护分支\**\s*[：:]\s*(.+)$/m);
      if (match) {
        for (const s of match[1].split(',')) {
          const v = s.trim();
          if (v) merged.add(v);
        }
      }
    }
  } catch {}
  const list = [...merged];
  return list.length > 0 ? list : DEFAULT_GIT_CONFIG.protectedBranches;
}

/** 单个保护分支规则匹配（精确匹配 + 通配符如 release/*） */
function matchesProtectedPattern(branchName: string, pattern: string): boolean {
  if (pattern.includes('*')) {
    // 通配符匹配: release/* → release/1.0.0
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(branchName);
  }
  return branchName === pattern;
}

/**
 * 检查分支是否为保护分支
 * 支持精确匹配和通配符（如 release/*）
 * 数据源：CONSTITUTION.md 的「保护分支」字段（AI 契约文件）
 */
export function isProtectedBranch(branchName: string): boolean {
  const protected_ = getProtectedBranches();
  for (const pattern of protected_) {
    if (matchesProtectedPattern(branchName, pattern)) return true;
  }
  return false;
}

/**
 * 获取拦截用保护分支（v8.3.323: 严格收敛，与同步版 getProtectedBranches 同口径）
 * PROJECT.yaml 声明即准（含显式清空）；未声明回退 CONSTITUTION；两处都无兜底默认。
 * 此前为「CONSTITUTION + PROJECT.yaml 合并」——PROJECT.yaml 已声明时残留的
 * CONSTITUTION 旧值仍会拦截，用户删改 PROJECT.yaml 无法解除保护，与唯一事实源矛盾。
 */
export async function getProtectedBranchesMerged(): Promise<string[]> {
  warnGitSourceMismatch();
  return getProtectedBranches();
}

/** isProtectedBranch 的异步合并版（含 PROJECT.yaml 全局/端级配置） */
export async function isProtectedBranchAsync(branchName: string): Promise<boolean> {
  const protected_ = await getProtectedBranchesMerged();
  for (const pattern of protected_) {
    if (matchesProtectedPattern(branchName, pattern)) return true;
  }
  return false;
}

/**
 * 安装 Git Hooks
 * v8.3.88+: 支持 cwd 参数，工程目录分离场景下在正确的 git 仓库安装
 */
export function installGitHooks(cwd?: string): { preCommit: boolean; prePush: boolean } {
  const gitCwd = cwd || process.cwd();
  const gitDir = join(gitCwd, '.git');
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
  # v8.3.322: PROJECT.yaml（git 段 + 端级）protected_branches 一并纳入（机器事实源）
  if [ -f ".speccore/PROJECT.yaml" ]; then
    PY_PROTECTED=$(sed -n '/^[[:space:]]*protected_branches:/,/^[[:space:]]*[a-zA-Z_][a-zA-Z0-9_]*:/p' .speccore/PROJECT.yaml | grep '^[[:space:]]*- ' | sed 's/^[[:space:]]*- //; s/[[:space:]]*#.*$//; s/[[:space:]]*$//')
    PROTECTED="$PROTECTED $PY_PROTECTED"
  fi
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
  # v8.3.322: PROJECT.yaml（git 段 + 端级）protected_branches 一并纳入（机器事实源）
  if [ -f ".speccore/PROJECT.yaml" ]; then
    PY_PROTECTED=$(sed -n '/^[[:space:]]*protected_branches:/,/^[[:space:]]*[a-zA-Z_][a-zA-Z0-9_]*:/p' .speccore/PROJECT.yaml | grep '^[[:space:]]*- ' | sed 's/^[[:space:]]*- //; s/[[:space:]]*#.*$//; s/[[:space:]]*$//')
    PROTECTED="$PROTECTED $PY_PROTECTED"
  fi
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
    if (existsSync(gitMappingPath())) {
      return JSON.parse(readFileSync(gitMappingPath(), 'utf-8'));
    }
  } catch {}
  return {};
}

function saveMapping(mapping: GitMapping): void {
  ensureFileSync(gitMappingPath());
  writeFileSync(gitMappingPath(), JSON.stringify(mapping, null, 2));
}

/**
 * v8.3.7+: 根据 taskId 查找已创建的分支名
 * 查找顺序：1. git-mapping.json  2. git branch 列表
 * v8.3.88+: 支持 cwd 参数，工程目录分离场景下使用正确的 git 仓库
 */
export function findBranchByTaskId(taskId: string, cwd?: string): string | null {
  const gitCwd = cwd || process.cwd();
  // 1. 从 git-mapping.json 查找
  const mapping = loadMapping();
  for (const [branch, info] of Object.entries(mapping)) {
    if (info.taskId === taskId) return branch;
    // v8.3.291: 依赖可能以父任务 ID 引用（TASK.md「依赖任务」存父任务 ID），
    // 父任务 ID 是子任务 ID 前缀（如 Task-002-f1-booking → Task-002-f1-booking-booking-service）
    if (info.taskId && info.taskId.startsWith(`${taskId}-`)) return branch;
  }

  // 2. 从 git branch 列表查找（匹配 feature/{taskId}-* 或 */{taskId}-*）
  try {
    const branches = execSync('git branch -a', { cwd: gitCwd, encoding: 'utf-8', stdio: 'pipe' });
    for (const line of branches.split(/\r?\n/)) {
      const b = line.trim().replace(/^\*?\s*/, '');
      // 匹配本地分支：feature/Task-001-xxx / bugfix/Task-001-xxx
      if (new RegExp(`(?:^|/)${taskId}[-_]`).test(b)) {
        return b;
      }
    }
  } catch {}

  return null;
}

/**
 * v8.3.207+: 根据功能模块名（feature）查找对应任务分支
 * bugfix 任务关联功能模块时，从其开发分支拉取
 * 查找顺序：1. git-mapping.json（taskName/taskId 含 feature 名）  2. git branch 列表（feature/ 分支名含 feature）
 */
export function findBranchByFeature(feature: string, cwd?: string): string | null {
  const gitCwd = cwd || process.cwd();
  const kw = feature.trim();
  if (!kw) return null;

  // 1. git-mapping.json
  const mapping = loadMapping();
  for (const [branch, info] of Object.entries(mapping)) {
    if ((info.taskName && info.taskName.includes(kw)) || (info.taskId && info.taskId.includes(kw))) {
      return branch;
    }
  }

  // 2. git branch 列表（feature/ 分支名含 feature）
  try {
    const branches = execSync('git branch -a', { cwd: gitCwd, encoding: 'utf-8', stdio: 'pipe' });
    for (const line of branches.split(/\r?\n/)) {
      const b = line.trim().replace(/^\*?\s*/, '').replace(/^remotes\/[^/]+\//, '');
      if (b.includes('feature/') && b.includes(kw)) {
        return b;
      }
    }
  } catch {}

  return null;
}

function getChangedFiles(cwd?: string): string[] {
  const gitCwd = cwd || process.cwd();
  try {
    const output = execSync('git diff --name-only HEAD', { cwd: gitCwd, encoding: 'utf-8', stdio: 'pipe' });
    return output.trim().split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

/** 清理过期代码索引缓存（超过24小时自动清理） */
export function cleanStaleCache(): boolean {
  try {
    const cacheFile = join(getProjectRoot(), '.speccore', 'cache', 'code-structure.json');
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
