/**
 * unified-config — .speccore.yml 统一配置入口
 *
 * v8.3.25+: 配置版本化 + 结构校验 + 自动升级
 * - schema_version: 配置结构版本号（CLI 升级时检测）
 * - 运行时校验：加载时自动校验结构完整性
 * - 自动补全：缺失字段自动填充默认值
 * - 升级提示：schema_version < CURRENT_SCHEMA_VERSION 时警告
 */
import { readFile, writeFile, pathExists, ensureDir } from 'fs-extra';
import { join } from 'path';
import { logger } from '../utils/logger';

/** 当前系统配置 schema 版本号（.speccore.yml） */
export const CURRENT_SCHEMA_VERSION = 1;

/** 当前项目配置 schema 版本号（.speccore/PROJECT.yaml） */
export const PROJECT_CURRENT_SCHEMA_VERSION = 1;

// ─────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────

export interface PlatformConfig {
  /** 端名/工程标识：全局唯一，用于目录名、命令参数、端识别。如: booking-service, h5-mobile, admin-web */
  name: string;
  /** 工程类型：frontend(前端) | backend(后端) | infra(基础设施) */
  type: 'frontend' | 'backend' | 'infra';
  /** 工程描述/工程名：人类可读名称。如: 预订订单服务, H5移动端 */
  description?: string;
  /** 源码路径：相对于项目根目录的代码位置。如: ./packages/backend/booking-service */
  code_path?: string;
  /** Git 仓库地址：用于分支管理和 PR 提交 */
  git_repo?: string;
  /** 默认分支：如 main, master, develop */
  default_branch: string;
  /** 对应需求端/功能单元：用于 AI 分析时自动对标需求文档中的功能模块名。如: 预订订单服务, 会议室管理 */
  requirement_unit?: string;
}

export interface LlmProviderConfig {
  name: string;
  enabled: boolean;
  type: 'ollama' | 'openai' | 'anthropic' | 'custom';
  endpoint: string;
  model: string;
  apiKey?: string;
  priority: number;
}

/** 系统配置 — .speccore.yml（CLI 运行时行为开关） */
export interface SpecConfig {
  schema_version: number;
  quality_gates: {
    enforce_testing: boolean;
    enforce_review: boolean;
    require_pr: boolean;
  };
  arbitration: {
    enabled: boolean;
    mode: 'full' | 'l1-only' | 'report-only';
  };
  settings: {
    assignee: { enabled: boolean; mode: 'strict' | 'loose' | 'off' };
    trace: { enabled: boolean; auto_annotate: boolean };
    archive: { auto_cleanup: boolean };
    plan: { parallel_suggest: boolean };
    validation: { strict_mode: boolean };
    sync: { auto_check: boolean };
    patterns: { auto_save: 'off' | 'smart' | 'aggressive' };
    review: { check_assignee: boolean };
  };
  ask: {
    routing: {
      mode: 'hybrid' | 'cli-only' | 'host-ai-only';
      high_threshold: number;
      low_threshold: number;
      auto_host_ai: boolean;
      cache_enabled: boolean;
      cache_min_hits: number;
    };
    rules: { force_host_ai: boolean };
    llm_providers: LlmProviderConfig[];
  };
  config_history: { date: string; change: string; changed_by?: string }[];
}

/** 项目配置 — .speccore/PROJECT.yaml（工程映射） */
export interface ProjectConfig {
  schema_version: number;
  project: {
    name: string;
    description?: string;
    version?: string;
  };
  platforms: PlatformConfig[];
  git: {
    default_base: string;
    branch_prefix: string;
    protected_branches: string[];
  };
  code_scope: string[];
}

// ─────────────────────────────────────────
// 系统配置默认值（.speccore.yml）
// ─────────────────────────────────────────

export const DEFAULT_CONFIG: SpecConfig = {
  schema_version: CURRENT_SCHEMA_VERSION,
  quality_gates: { enforce_testing: true, enforce_review: true, require_pr: true },
  arbitration: { enabled: true, mode: 'full' },
  settings: {
    assignee: { enabled: true, mode: 'loose' },
    trace: { enabled: true, auto_annotate: true },
    archive: { auto_cleanup: false },
    plan: { parallel_suggest: true },
    validation: { strict_mode: false },
    sync: { auto_check: true },
    patterns: { auto_save: 'smart' },
    review: { check_assignee: false },
  },
  ask: {
    routing: { mode: 'hybrid', high_threshold: 70, low_threshold: 45, auto_host_ai: true, cache_enabled: true, cache_min_hits: 3 },
    rules: { force_host_ai: false },
    llm_providers: [],
  },
  config_history: [],
};

// ─────────────────────────────────────────
// 项目配置默认值（.speccore/PROJECT.yaml）
// ─────────────────────────────────────────

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  schema_version: CURRENT_SCHEMA_VERSION,
  project: { name: 'my-project' },
  platforms: [],
  git: { default_base: 'main', branch_prefix: 'feature/', protected_branches: ['main', 'master'] },
  code_scope: ['src/'],
};

const CONFIG_PATH = join('.speccore.yml');
const PROJECT_CONFIG_PATH = join('.speccore', 'PROJECT.yaml');

// ─────────────────────────────────────────
// 系统配置加载（含校验 + 自动补全 + 版本检测）
// ─────────────────────────────────────────

export interface ConfigLoadResult {
  config: SpecConfig;
  warnings: string[];
  migrated: boolean;
}

export interface ProjectConfigLoadResult {
  config: ProjectConfig;
  warnings: string[];
  migrated: boolean;
}

export async function loadConfig(): Promise<SpecConfig> {
  const { config, warnings } = await loadConfigWithMeta();
  if (warnings.length > 0) {
    for (const w of warnings) logger.warn(w);
  }
  return config;
}

/** 获取配置 + 元信息（warnings、是否迁移过） */
export async function loadConfigWithMeta(): Promise<ConfigLoadResult> {
  const warnings: string[] = [];

  if (!(await pathExists(CONFIG_PATH))) {
    warnings.push('⚠️ .speccore.yml 不存在，使用默认配置');
    return { config: { ...DEFAULT_CONFIG }, warnings, migrated: false };
  }

  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    const parsed = parseYaml(raw) as Record<string, unknown>;

    // v8.3.25+: 解析环境变量引用（如 apiKey: ${SPECCORE_LLM_KEY}）
    const envResult = resolveEnvVars(parsed);
    if (envResult.unresolved.length > 0) {
      warnings.push(`⚠️ 以下环境变量未设置，配置项保持原样: ${envResult.unresolved.join(', ')}`);
    }

    // 1. 结构校验 + 自动补全
    const validation = validateConfig(parsed);
    if (!validation.valid) {
      warnings.push(`⚠️ .speccore.yml 结构校验失败：`);
      for (const issue of validation.issues.slice(0, 5)) {
        warnings.push(`  - ${issue}`);
      }
      if (validation.issues.length > 5) {
        warnings.push(`  ... 还有 ${validation.issues.length - 5} 项`);
      }
    }

    // 用默认值深度合并（补全缺失字段）
    const merged = deepMerge(DEFAULT_CONFIG, parsed as Partial<SpecConfig>);
    const config = merged as SpecConfig;

    // 2. 版本检测
    if (config.schema_version < CURRENT_SCHEMA_VERSION) {
      warnings.push(
        `⚠️ .speccore.yml schema_version=${config.schema_version} < ${CURRENT_SCHEMA_VERSION}，` +
        `配置结构已过期。建议运行: speccore config --upgrade`
      );
    } else if (config.schema_version > CURRENT_SCHEMA_VERSION) {
      warnings.push(
        `⚠️ .speccore.yml schema_version=${config.schema_version} > ${CURRENT_SCHEMA_VERSION}，` +
        `CLI 版本可能过旧，建议升级 CLI`
      );
    }

    const migrated = config.schema_version !== CURRENT_SCHEMA_VERSION || !validation.valid;
    return { config, warnings, migrated };
  } catch (e: any) {
    warnings.push(`⚠️ .speccore.yml 解析失败: ${e.message}，使用默认配置`);
    return { config: { ...DEFAULT_CONFIG }, warnings, migrated: false };
  }
}

/** 加载项目配置（简化版） */
export async function loadProjectConfig(): Promise<ProjectConfig> {
  const { config, warnings } = await loadProjectConfigWithMeta();
  if (warnings.length > 0) {
    for (const w of warnings) logger.warn(w);
  }
  return config;
}

/** 获取项目配置 + 元信息 */
export async function loadProjectConfigWithMeta(): Promise<ProjectConfigLoadResult> {
  const warnings: string[] = [];

  if (!(await pathExists(PROJECT_CONFIG_PATH))) {
    warnings.push('⚠️ .speccore/PROJECT.yaml 不存在，使用默认项目配置');
    return { config: { ...DEFAULT_PROJECT_CONFIG }, warnings, migrated: false };
  }

  try {
    const raw = await readFile(PROJECT_CONFIG_PATH, 'utf-8');
    const parsed = parseYaml(raw) as Record<string, unknown>;

    // 解析环境变量
    const envResult = resolveEnvVars(parsed);
    if (envResult.unresolved.length > 0) {
      warnings.push(`⚠️ 以下环境变量未设置，配置项保持原样: ${envResult.unresolved.join(', ')}`);
    }

    // 1. 结构校验
    const validation = validateProjectConfig(parsed);
    if (!validation.valid) {
      warnings.push(`⚠️ .speccore/PROJECT.yaml 结构校验失败：`);
      for (const issue of validation.issues.slice(0, 5)) {
        warnings.push(`  - ${issue}`);
      }
      if (validation.issues.length > 5) {
        warnings.push(`  ... 还有 ${validation.issues.length - 5} 项`);
      }
    }

    // 用默认值深度合并
    const merged = deepMerge(DEFAULT_PROJECT_CONFIG, parsed as Partial<ProjectConfig>);
    const config = merged as ProjectConfig;

    // 2. 版本检测
    if (config.schema_version < PROJECT_CURRENT_SCHEMA_VERSION) {
      warnings.push(
        `⚠️ .speccore/PROJECT.yaml schema_version=${config.schema_version} < ${PROJECT_CURRENT_SCHEMA_VERSION}，` +
        `配置结构已过期。建议运行: speccore config --upgrade --project`
      );
    } else if (config.schema_version > PROJECT_CURRENT_SCHEMA_VERSION) {
      warnings.push(
        `⚠️ .speccore/PROJECT.yaml schema_version=${config.schema_version} > ${PROJECT_CURRENT_SCHEMA_VERSION}，` +
        `CLI 版本可能过旧，建议升级 CLI`
      );
    }

    const migrated = config.schema_version !== PROJECT_CURRENT_SCHEMA_VERSION || !validation.valid;
    return { config, warnings, migrated };
  } catch (e: any) {
    warnings.push(`⚠️ .speccore/PROJECT.yaml 解析失败: ${e.message}，使用默认配置`);
    return { config: { ...DEFAULT_PROJECT_CONFIG }, warnings, migrated: false };
  }
}

/** 兼容旧代码：getConfig = loadConfig */
export async function getConfig(): Promise<SpecConfig> {
  return loadConfig();
}

// ─────────────────────────────────────────
// 配置保存（自动写入 schema_version）
// ─────────────────────────────────────────

export async function saveConfig(config: SpecConfig): Promise<void> {
  const enriched = { ...config, schema_version: CURRENT_SCHEMA_VERSION };
  const yaml = toYaml(enriched);
  await writeFile(CONFIG_PATH, yaml, 'utf-8');
}

export async function saveProjectConfig(config: ProjectConfig): Promise<void> {
  const enriched = { ...config, schema_version: CURRENT_SCHEMA_VERSION };
  const yaml = toProjectYaml(enriched);
  await ensureDir(join('.speccore'));
  await writeFile(PROJECT_CONFIG_PATH, yaml, 'utf-8');
}

/**
 * 初始化时生成 .speccore.yml（系统配置）
 */
export async function initConfig(): Promise<void> {
  await saveConfig({ ...DEFAULT_CONFIG });
  logger.info(`  📄 .speccore.yml 已生成 (schema_version=${CURRENT_SCHEMA_VERSION})`);
}

/**
 * 初始化时生成 .speccore/PROJECT.yaml（项目配置）
 */
export async function initProjectConfig(projectName?: string): Promise<void> {
  const config: ProjectConfig = {
    ...DEFAULT_PROJECT_CONFIG,
    project: { ...DEFAULT_PROJECT_CONFIG.project, name: projectName || 'my-project' },
  };
  await saveProjectConfig(config);
  logger.info(`  📄 .speccore/PROJECT.yaml 已生成 (schema_version=${CURRENT_SCHEMA_VERSION})`);
}

// ─────────────────────────────────────────
// 配置迁移框架（支持跨版本字段 rename/add/remove）
// ─────────────────────────────────────────

/** 迁移步骤类型 */
type MigrationType = 'rename' | 'add' | 'remove' | 'transform';

interface MigrationStep<T extends { schema_version: number }> {
  type: MigrationType;
  /** 人类可读的迁移描述 */
  description: string;
  /** 执行迁移的函数，返回是否实际发生了迁移 */
  migrate: (config: T) => boolean;
}

/**
 * 系统配置版本迁移注册表（.speccore.yml）
 * 键 = 目标 schema_version，值 = 从上一版本升级到该版本需要执行的迁移步骤。
 */
const MIGRATIONS: Record<number, MigrationStep<SpecConfig>[]> = {
  // schema_version 1 是初始版本，无迁移步骤
  1: [],
  // 未来版本示例（预留）：
  // 2: [
  //   {
  //     type: 'rename',
  //     description: 'settings.assignee.mode: strict_mode → strict',
  //     migrate: (cfg) => {
  //       const old = (cfg as any).settings?.assignee?.strict_mode;
  //       if (old !== undefined) {
  //         (cfg.settings.assignee as any).mode = old ? 'strict' : 'loose';
  //         delete (cfg.settings.assignee as any).strict_mode;
  //         return true;
  //       }
  //       return false;
  //     },
  //   },
  // ],
};

/**
 * 项目配置版本迁移注册表（.speccore/PROJECT.yaml）
 */
const PROJECT_MIGRATIONS: Record<number, MigrationStep<ProjectConfig>[]> = {
  1: [],
};

/**
 * 执行从当前 config.schema_version 到目标版本的所有迁移步骤。
 * 返回迁移过程中产生的日志信息。
 */
function runMigrations<T extends { schema_version: number }>(
  config: T,
  migrations: Record<number, MigrationStep<T>[]>,
  currentVersion: number
): string[] {
  const logs: string[] = [];
  const startVersion = config.schema_version;

  for (let v = startVersion + 1; v <= currentVersion; v++) {
    const steps = migrations[v];
    if (!steps || steps.length === 0) continue;

    for (const step of steps) {
      try {
        const changed = step.migrate(config);
        if (changed) {
          logs.push(`  [v${v}] ${step.description}`);
        }
      } catch (e: any) {
        logs.push(`  [v${v}] ⚠️ 迁移失败: ${step.description} — ${e.message}`);
      }
    }
  }

  return logs;
}

// ─────────────────────────────────────────
// 枚举约束定义（字段路径 → 合法值列表）
// ─────────────────────────────────────────

/** 支持通配符 * 的路径模式 */
const ENUM_CONSTRAINTS: Record<string, string[]> = {
  'platforms.*.type': ['frontend', 'backend', 'infra'],
  'arbitration.mode': ['full', 'l1-only', 'report-only'],
  'settings.assignee.mode': ['strict', 'loose', 'off'],
  'settings.patterns.auto_save': ['off', 'smart', 'aggressive'],
  'ask.routing.mode': ['hybrid', 'cli-only', 'host-ai-only'],
  'ask.llm_providers.*.type': ['ollama', 'openai', 'anthropic', 'custom'],
};

/**
 * 按通配符路径模式遍历对象，获取所有匹配的值
 * 示例: 'platforms.*.type' → [{path:'platforms.0.type', value:'frontend'}, ...]
 */
function getValuesAtPath(obj: unknown, pathPattern: string): { path: string; value: unknown }[] {
  const parts = pathPattern.split('.');
  const results: { path: string; value: unknown }[] = [];

  function traverse(current: unknown, currentPath: string[], idx: number) {
    if (idx >= parts.length) {
      results.push({ path: currentPath.join('.'), value: current });
      return;
    }

    const part = parts[idx];
    if (part === '*') {
      if (Array.isArray(current)) {
        for (let i = 0; i < current.length; i++) {
          traverse(current[i], [...currentPath, String(i)], idx + 1);
        }
      } else if (isPlainObject(current)) {
        for (const key of Object.keys(current)) {
          traverse((current as Record<string, unknown>)[key], [...currentPath, key], idx + 1);
        }
      }
    } else if (isPlainObject(current) && part in (current as Record<string, unknown>)) {
      traverse((current as Record<string, unknown>)[part], [...currentPath, part], idx + 1);
    }
  }

  traverse(obj, [], 0);
  return results;
}

/**
 * 检测配置中的枚举值是否超出合法范围
 */
function checkEnumConstraints(config: unknown): ConfigDiff['enumChanged'] {
  const changes: ConfigDiff['enumChanged'] = [];

  for (const [pattern, allowedValues] of Object.entries(ENUM_CONSTRAINTS)) {
    const matches = getValuesAtPath(config, pattern);
    for (const { path, value } of matches) {
      if (typeof value === 'string' && !allowedValues.includes(value)) {
        changes.push({
          path,
          current: [value],
          expected: allowedValues,
        });
      }
    }
  }

  return changes;
}

// ─────────────────────────────────────────
// 配置差异检测（检测结构性变化，需用户确认）
// ─────────────────────────────────────────

export interface ConfigDiff {
  /** 新增字段路径列表 */
  added: string[];
  /** 删除字段路径列表 */
  removed: string[];
  /** 类型变更：字段存在但类型不同 */
  typeChanged: { path: string; current: string; expected: string }[];
  /** 枚举值变更：合法值集合变化 */
  enumChanged: { path: string; current: string[]; expected: string[] }[];
  /** 结构变更：对象↔数组、嵌套结构变化等 */
  structureChanged: { path: string; description: string }[];
}

/**
 * 递归比较当前配置与目标配置（DEFAULT_CONFIG），检测所有差异
 */
export function detectConfigDiff(current: unknown, target: unknown, path = ''): ConfigDiff {
  const diff: ConfigDiff = { added: [], removed: [], typeChanged: [], enumChanged: [], structureChanged: [] };

  // 根节点类型不同（极少发生，如整体从对象变成数组）
  if (typeof current !== typeof target) {
    if (path === '') {
      diff.structureChanged.push({ path: '(root)', description: `根节点类型从 ${typeof current} 变为 ${typeof target}` });
    }
    return diff;
  }

  // 两者都是对象（非数组）
  if (isPlainObject(current) && isPlainObject(target)) {
    const currentKeys = Object.keys(current);
    const targetKeys = Object.keys(target);

    // 检测删除的字段（当前有，目标没有）
    for (const key of currentKeys) {
      if (!targetKeys.includes(key)) {
        diff.removed.push(path ? `${path}.${key}` : key);
      }
    }

    // 检测新增和变更的字段
    for (const key of targetKeys) {
      const currentVal = (current as Record<string, unknown>)[key];
      const targetVal = (target as Record<string, unknown>)[key];
      const childPath = path ? `${path}.${key}` : key;

      if (!(key in current)) {
        // 新增字段
        diff.added.push(childPath);
        continue;
      }

      // 两者都存在，递归比较
      const childDiff = detectConfigDiff(currentVal, targetVal, childPath);
      diff.added.push(...childDiff.added);
      diff.removed.push(...childDiff.removed);
      diff.typeChanged.push(...childDiff.typeChanged);
      diff.enumChanged.push(...childDiff.enumChanged);
      diff.structureChanged.push(...childDiff.structureChanged);
    }

    return diff;
  }

  // 两者都是数组
  if (Array.isArray(current) && Array.isArray(target)) {
    // 如果数组元素类型不同（如 string[] → object[]）
    const currentElemType = current.length > 0 ? typeof current[0] : 'empty';
    const targetElemType = target.length > 0 ? typeof target[0] : 'empty';
    if (currentElemType !== targetElemType && currentElemType !== 'empty' && targetElemType !== 'empty') {
      diff.structureChanged.push({
        path: path || '(array)',
        description: `数组元素类型从 ${currentElemType} 变为 ${targetElemType}`,
      });
    }
    return diff;
  }

  // 一个是数组，一个不是
  if (Array.isArray(current) !== Array.isArray(target)) {
    diff.structureChanged.push({
      path: path || '(value)',
      description: `类型从 ${Array.isArray(current) ? 'array' : typeof current} 变为 ${Array.isArray(target) ? 'array' : typeof target}`,
    });
    return diff;
  }

  // 基本类型值不同（不算结构变更，只是值不同）
  // 但可能涉及枚举值非法
  const enumChanges = checkEnumConstraints(current);
  diff.enumChanged.push(...enumChanges);
  return diff;
}

/**
 * 判断差异是否需要用户确认（新增字段除外，可自动处理）
 */
export function requiresUserConfirmation(diff: ConfigDiff): boolean {
  return diff.removed.length > 0
    || diff.typeChanged.length > 0
    || diff.enumChanged.length > 0
    || diff.structureChanged.length > 0;
}

/**
 * 格式化差异为可读文本
 */
export function formatConfigDiff(diff: ConfigDiff): string[] {
  const lines: string[] = [];

  if (diff.added.length > 0) {
    lines.push(`📌 新增字段（${diff.added.length} 项，将使用默认值）:`);
    for (const p of diff.added) lines.push(`   + ${p}`);
  }

  if (diff.removed.length > 0) {
    lines.push(`⚠️  删除字段（${diff.removed.length} 项，配置已过时）:`);
    for (const p of diff.removed) lines.push(`   - ${p}`);
  }

  if (diff.typeChanged.length > 0) {
    lines.push(`🔧 类型变更（${diff.typeChanged.length} 项，需人工确认）:`);
    for (const t of diff.typeChanged) lines.push(`   ~ ${t.path}: ${t.current} → ${t.expected}`);
  }

  if (diff.enumChanged.length > 0) {
    lines.push(`📝 枚举值变更（${diff.enumChanged.length} 项，需人工确认）:`);
    for (const e of diff.enumChanged) {
      lines.push(`   ~ ${e.path}:`);
      lines.push(`     当前: [${e.current.join(', ')}]`);
      lines.push(`     目标: [${e.expected.join(', ')}]`);
    }
  }

  if (diff.structureChanged.length > 0) {
    lines.push(`🏗️  结构变更（${diff.structureChanged.length} 项，需人工确认）:`);
    for (const s of diff.structureChanged) lines.push(`   ~ ${s.path}: ${s.description}`);
  }

  return lines;
}

// ─────────────────────────────────────────
// 配置升级（补全缺失字段 + 执行迁移 + 更新版本号）
// ─────────────────────────────────────────

export async function upgradeConfig(): Promise<ConfigLoadResult> {
  const { config, warnings } = await loadConfigWithMeta();

  if (config.schema_version === CURRENT_SCHEMA_VERSION && warnings.length === 0) {
    logger.info(`✅ .speccore.yml 已经是 schema_version=${CURRENT_SCHEMA_VERSION}，无需升级`);
    return { config, warnings: [], migrated: false };
  }

  // 1. 检测配置差异（当前配置 vs 目标配置）
  const diff = detectConfigDiff(config, DEFAULT_CONFIG);
  const needsConfirm = requiresUserConfirmation(diff);

  if (needsConfirm) {
    // 生成差异报告文件
    const reportLines = [
      '# .speccore.yml 升级差异报告',
      '',
      `生成时间: ${new Date().toLocaleString('zh-CN')}`,
      `当前 schema_version: ${config.schema_version}`,
      `目标 schema_version: ${CURRENT_SCHEMA_VERSION}`,
      '',
      '## 检测到的变更',
      '',
      ...formatConfigDiff(diff),
      '',
      '## 处理建议',
      '',
      '1. **删除字段**: 检查这些字段是否在你的项目中有自定义值，如果有，需要迁移到新字段',
      '2. **类型变更**: 手动修改字段值类型，确保与新版 schema 一致',
      '3. **枚举值变更**: 将字段值改为合法枚举值之一',
      '4. **结构变更**: 重组配置对象结构，确保嵌套关系正确',
      '',
      '修改完成后，重新运行: speccore config --upgrade',
    ];

    try {
      const diffPath = join('.speccore', 'config', 'upgrade-diff.md');
      await ensureDir(join('.speccore', 'config'));
      await writeFile(diffPath, reportLines.join('\n'), 'utf-8');
      logger.info(`\n📝 差异报告已保存: ${diffPath}`);
    } catch { /* 静默失败 */ }

    logger.info('\n⚠️  检测到配置结构性变更，需要确认:\n');
    for (const line of formatConfigDiff(diff)) {
      logger.info(line);
    }
    logger.info('\n💡 建议操作:');
    logger.info('   1. 检查上述变更是否影响现有配置');
    logger.info('   2. 手动调整 .speccore.yml 中的相关字段');
    logger.info('   3. 确认无误后重新运行 speccore config --upgrade');
    logger.info('');
    // 不执行升级，返回当前配置和差异信息
    return { config, warnings: [...warnings, '配置存在结构性变更，需人工确认后重新升级'], migrated: false };
  }

  // 2. 用默认值深度合并（补全缺失字段）
  const upgraded = deepMerge(DEFAULT_CONFIG, config);

  // 3. 执行跨版本迁移（rename / add / remove / transform）
  const migrationLogs = runMigrations(upgraded, MIGRATIONS, CURRENT_SCHEMA_VERSION);

  // 4. 更新 schema_version
  upgraded.schema_version = CURRENT_SCHEMA_VERSION;

  // 5. 记录升级历史
  const changeParts = [`升级到 schema_version=${CURRENT_SCHEMA_VERSION}`];
  if (migrationLogs.length > 0) {
    changeParts.push(`包含 ${migrationLogs.length} 项迁移`);
  }
  if (diff.added.length > 0) {
    changeParts.push(`自动补全 ${diff.added.length} 个新字段`);
  }

  upgraded.config_history = [
    ...(upgraded.config_history || []),
    {
      date: new Date().toISOString().split('T')[0],
      change: changeParts.join('，'),
    },
  ];

  await saveConfig(upgraded);
  logger.info(`✅ .speccore.yml 已升级到 schema_version=${CURRENT_SCHEMA_VERSION}`);

  if (diff.added.length > 0) {
    logger.info(`   自动补全 ${diff.added.length} 个新字段（使用默认值）`);
  }

  if (warnings.length > 0) {
    logger.info('   修复了以下问题:');
    for (const w of warnings) logger.info(`   ${w}`);
  }

  if (migrationLogs.length > 0) {
    logger.info('   执行了以下迁移:');
    for (const log of migrationLogs) logger.info(`   ${log}`);
  }

  return { config: upgraded, warnings, migrated: true };
}

// ─────────────────────────────────────────
// 项目配置升级（.speccore/PROJECT.yaml）
// ─────────────────────────────────────────

export async function upgradeProjectConfig(): Promise<ProjectConfigLoadResult> {
  const { config, warnings } = await loadProjectConfigWithMeta();

  if (config.schema_version === PROJECT_CURRENT_SCHEMA_VERSION && warnings.length === 0) {
    logger.info(`✅ .speccore/PROJECT.yaml 已经是 schema_version=${PROJECT_CURRENT_SCHEMA_VERSION}，无需升级`);
    return { config, warnings: [], migrated: false };
  }

  // 1. 检测配置差异（当前配置 vs 目标配置）
  const diff = detectConfigDiff(config, DEFAULT_PROJECT_CONFIG);
  const needsConfirm = requiresUserConfirmation(diff);

  if (needsConfirm) {
    // 生成差异报告文件
    const reportLines = [
      '# .speccore/PROJECT.yaml 升级差异报告',
      '',
      `生成时间: ${new Date().toLocaleString('zh-CN')}`,
      `当前 schema_version: ${config.schema_version}`,
      `目标 schema_version: ${PROJECT_CURRENT_SCHEMA_VERSION}`,
      '',
      '## 检测到的变更',
      '',
      ...formatConfigDiff(diff),
      '',
      '## 处理建议',
      '',
      '1. **删除字段**: 检查这些字段是否在你的项目中有自定义值，如果有，需要迁移到新字段',
      '2. **类型变更**: 手动修改字段值类型，确保与新版 schema 一致',
      '3. **枚举值变更**: 将字段值改为合法枚举值之一',
      '4. **结构变更**: 重组配置对象结构，确保嵌套关系正确',
      '',
      '修改完成后，重新运行: speccore config --upgrade --project',
    ];

    try {
      const diffPath = join('.speccore', 'config', 'upgrade-diff-project.md');
      await ensureDir(join('.speccore', 'config'));
      await writeFile(diffPath, reportLines.join('\n'), 'utf-8');
      logger.info(`\n📝 差异报告已保存: ${diffPath}`);
    } catch { /* 静默失败 */ }

    logger.info('\n⚠️  检测到项目配置结构性变更，需要确认:\n');
    for (const line of formatConfigDiff(diff)) {
      logger.info(line);
    }
    logger.info('\n💡 建议操作:');
    logger.info('   1. 检查上述变更是否影响现有配置');
    logger.info('   2. 手动调整 .speccore/PROJECT.yaml 中的相关字段');
    logger.info('   3. 确认无误后重新运行 speccore config --upgrade --project');
    logger.info('');
    return { config, warnings: [...warnings, '项目配置存在结构性变更，需人工确认后重新升级'], migrated: false };
  }

  // 2. 用默认值深度合并（补全缺失字段）
  const upgraded = deepMerge(DEFAULT_PROJECT_CONFIG, config);

  // 3. 执行跨版本迁移
  const migrationLogs = runMigrations(upgraded, PROJECT_MIGRATIONS, PROJECT_CURRENT_SCHEMA_VERSION);

  // 4. 更新 schema_version
  upgraded.schema_version = PROJECT_CURRENT_SCHEMA_VERSION;

  await saveProjectConfig(upgraded);
  logger.info(`✅ .speccore/PROJECT.yaml 已升级到 schema_version=${PROJECT_CURRENT_SCHEMA_VERSION}`);

  if (diff.added.length > 0) {
    logger.info(`   自动补全 ${diff.added.length} 个新字段（使用默认值）`);
  }

  if (warnings.length > 0) {
    logger.info('   修复了以下问题:');
    for (const w of warnings) logger.info(`   ${w}`);
  }

  if (migrationLogs.length > 0) {
    logger.info('   执行了以下迁移:');
    for (const log of migrationLogs) logger.info(`   ${log}`);
  }

  return { config: upgraded, warnings, migrated: true };
}

// ─────────────────────────────────────────
// 自定义结构校验器
// ─────────────────────────────────────────

interface ValidationResult {
  valid: boolean;
  issues: string[];
}

function validateConfig(obj: Record<string, unknown>): ValidationResult {
  const issues: string[] = [];

  // schema_version
  if (typeof obj.schema_version !== 'number') {
    issues.push('schema_version 必须是数字');
  }

  // quality_gates
  if (isObject(obj.quality_gates)) {
    for (const key of ['enforce_testing', 'enforce_review', 'require_pr']) {
      if (obj.quality_gates[key] !== undefined && typeof obj.quality_gates[key] !== 'boolean') {
        issues.push(`quality_gates.${key} 必须是布尔值`);
      }
    }
  }

  // arbitration
  if (isObject(obj.arbitration)) {
    if (obj.arbitration.enabled !== undefined && typeof obj.arbitration.enabled !== 'boolean') {
      issues.push('arbitration.enabled 必须是布尔值');
    }
    if (obj.arbitration.mode && !['full', 'l1-only', 'report-only'].includes(obj.arbitration.mode as string)) {
      issues.push('arbitration.mode 必须是 full/l1-only/report-only 之一');
    }
  }

  // settings
  if (isObject(obj.settings)) {
    const s = obj.settings;
    if (isObject(s.assignee) && s.assignee.mode && !['strict', 'loose', 'off'].includes(s.assignee.mode as string)) {
      issues.push('settings.assignee.mode 必须是 strict/loose/off 之一');
    }
    if (isObject(s.patterns) && s.patterns.auto_save && !['off', 'smart', 'aggressive'].includes(s.patterns.auto_save as string)) {
      issues.push('settings.patterns.auto_save 必须是 off/smart/aggressive 之一');
    }
  }

  return { valid: issues.length === 0, issues };
}

function validateProjectConfig(obj: Record<string, unknown>): ValidationResult {
  const issues: string[] = [];

  // schema_version
  if (typeof obj.schema_version !== 'number') {
    issues.push('schema_version 必须是数字');
  }

  // project
  if (!isObject(obj.project)) {
    issues.push('project 必须是对象');
  } else {
    if (typeof obj.project.name !== 'string') issues.push('project.name 必须是字符串');
  }

  // platforms
  if (Array.isArray(obj.platforms)) {
    for (let idx = 0; idx < obj.platforms.length; idx++) {
      const p = obj.platforms[idx];
      if (!isObject(p)) {
        issues.push(`platforms[${idx}] 必须是对象`);
        continue;
      }
      if (typeof p.name !== 'string') issues.push(`platforms[${idx}].name 必须是字符串`);
      if (p.type && !['frontend', 'backend', 'infra'].includes(p.type as string)) {
        issues.push(`platforms[${idx}].type 必须是 frontend/backend/infra 之一`);
      }
    }
  }

  // git
  if (isObject(obj.git)) {
    if (typeof obj.git.default_base !== 'string') issues.push('git.default_base 必须是字符串');
    if (typeof obj.git.branch_prefix !== 'string') issues.push('git.branch_prefix 必须是字符串');
    if (!Array.isArray(obj.git.protected_branches)) issues.push('git.protected_branches 必须是数组');
  }

  return { valid: issues.length === 0, issues };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ─────────────────────────────────────────
// YAML 解析 / 序列化
// ─────────────────────────────────────────

function parseYaml(content: string): unknown {
  const result: any = {};
  const lines = content.split('\n');
  let stack: { obj: any; indent: number }[] = [{ obj: result, indent: -1 }];

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;
    // 回退到正确层级
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const trimmed = line.trim();
    const parent = stack[stack.length - 1].obj;

    if (trimmed.startsWith('- ')) {
      const value = trimmed.slice(2).trim();
      if (!Array.isArray(parent)) continue;
      if (value.includes(':')) {
        const obj: any = {};
        const [k, ...rest] = value.split(':');
        const v = rest.join(':').trim();
        if (v) obj[k.trim()] = autoType(v);
        parent.push(obj);
        stack.push({ obj, indent });
      } else {
        parent.push(autoType(value));
      }
    } else if (trimmed.endsWith(':')) {
      const key = trimmed.slice(0, -1).trim();
      if (Array.isArray(parent)) {
        const last = parent[parent.length - 1];
        if (last && typeof last === 'object' && !Array.isArray(last)) {
          last[key] = {};
          stack.push({ obj: last[key], indent });
        }
      } else {
        if (!parent[key]) parent[key] = {};
        stack.push({ obj: parent[key], indent });
      }
    } else if (trimmed.includes(':')) {
      const [k, ...rest] = trimmed.split(':');
      const v = rest.join(':').trim();
      if (Array.isArray(parent)) {
        const last = parent[parent.length - 1];
        if (last && typeof last === 'object') {
          last[k.trim()] = autoType(v);
        }
      } else {
        parent[k.trim()] = autoType(v);
      }
    }
  }

  return result;
}

/** 自动推断简单值的类型 */
function autoType(v: string): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
  return v;
}

function toYaml(config: SpecConfig): string {
  let yaml = '# =============================================================================\n';
  yaml += '# SpecCore 系统配置 (.speccore.yml)\n';
  yaml += '# =============================================================================\n';
  yaml += '# 本文件控制 CLI 的运行时行为与质量门禁策略。\n';
  yaml += '# 与 .speccore/PROJECT.yaml 的区别：\n';
  yaml += '#   - .speccore.yml      → 系统级（质量门禁、AI 路由、自动化策略）\n';
  yaml += '#   - .speccore/PROJECT.yaml → 项目级（工程列表、Git 配置、源码路径）\n';
  yaml += '# =============================================================================\n';
  yaml += `# schema_version: ${config.schema_version}\n`;
  yaml += `# ${new Date().toISOString().split('T')[0]}\n\n`;

  yaml += '# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += '# 质量门禁（Quality Gates）\n';
  yaml += '# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += 'quality_gates:\n';
  yaml += '  # enforce_testing: 是否强制要求每个任务包含测试用例\n';
  yaml += '  #   true  → execute 前检查 TEST.md，缺失则阻断\n';
  yaml += '  #   false → 仅警告，不阻断\n';
  yaml += `  enforce_testing: ${config.quality_gates.enforce_testing}\n`;
  yaml += '  # enforce_review: 是否强制代码审查\n';
  yaml += '  #   true  → 执行完自动进入 review 流程\n';
  yaml += `  enforce_review: ${config.quality_gates.enforce_review}\n`;
  yaml += '  # require_pr: 是否强制通过 PR 合并代码\n';
  yaml += '  #   true  → 禁止直接 push 到保护分支，必须通过 speccore pr 提交\n';
  yaml += `  require_pr: ${config.quality_gates.require_pr}\n`;

  yaml += '\n# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += '# 契约冲突裁决（Arbitration）\n';
  yaml += '# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += 'arbitration:\n';
  yaml += '  # enabled: 是否启用三级冲突裁决机制\n';
  yaml += '  #   true  → analyze/split/execute 各阶段自动检测并裁决契约冲突\n';
  yaml += `  enabled: ${config.arbitration.enabled}\n`;
  yaml += '  # mode: 裁决模式\n';
  yaml += '  #   full    → 完整三级裁决（Spec 层 → 代码层 → 运行时层）\n';
  yaml += '  #   simple  → 仅 Spec 层冲突检测\n';
  yaml += `  mode: ${config.arbitration.mode}\n`;

  yaml += '\n# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += '# 通用设置（Settings）\n';
  yaml += '# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += 'settings:\n';
  yaml += '  # ── 指派策略 ──\n';
  yaml += '  assignee:\n';
  yaml += '    # enabled: 是否启用自动指派\n';
  yaml += `    enabled: ${config.settings.assignee.enabled}\n`;
  yaml += '    # mode: 指派严格度\n';
  yaml += '    #   strict → 每个子任务必须指定 owner\n';
  yaml += '    #   loose  → 仅任务级指定 owner，子任务可共享\n';
  yaml += `    mode: ${config.settings.assignee.mode}\n`;
  yaml += '  # ── 追踪（Trace）──\n';
  yaml += '  trace:\n';
  yaml += '    # enabled: 是否启用全链路追踪\n';
  yaml += `    enabled: ${config.settings.trace.enabled}\n`;
  yaml += '    # auto_annotate: 是否自动在代码中插入追踪注解\n';
  yaml += `    auto_annotate: ${config.settings.trace.auto_annotate}\n`;
  yaml += '  # ── 归档（Archive）──\n';
  yaml += '  archive:\n';
  yaml += '    # auto_cleanup: 迭代完成后是否自动清理临时文件\n';
  yaml += `    auto_cleanup: ${config.settings.archive.auto_cleanup}\n`;
  yaml += '  # ── 计划（Plan）──\n';
  yaml += '  plan:\n';
  yaml += '    # parallel_suggest: 是否建议并行执行无依赖任务\n';
  yaml += `    parallel_suggest: ${config.settings.plan.parallel_suggest}\n`;
  yaml += '  # ── 校验（Validation）──\n';
  yaml += '  validation:\n';
  yaml += '    # strict_mode: 是否启用严格校验模式\n';
  yaml += '    #   true  → 任何格式错误都阻断执行\n';
  yaml += '    #   false → 仅记录警告，尽量继续\n';
  yaml += `    strict_mode: ${config.settings.validation.strict_mode}\n`;
  yaml += '  # ── 同步（Sync）──\n';
  yaml += '  sync:\n';
  yaml += '    # auto_check: 执行前是否自动检查配置/规范库是否为最新\n';
  yaml += `    auto_check: ${config.settings.sync.auto_check}\n`;
  yaml += '  # ── 模式沉淀（Patterns）──\n';
  yaml += '  patterns:\n';
  yaml += '    # auto_save: 是否自动将分析过程中发现的模式保存到 .speccore/PATTERNS/\n';
  yaml += '    #   smart  → 仅在置信度高时自动保存\n';
  yaml += '    #   always → 全部自动保存\n';
  yaml += '    #   false  → 不自动保存，仅手动\n';
  yaml += `    auto_save: ${config.settings.patterns.auto_save}\n`;
  yaml += '  # ── 审查（Review）──\n';
  yaml += '  review:\n';
  yaml += '    # check_assignee: 审查时是否检查指派人与执行人一致\n';
  yaml += `    check_assignee: ${config.settings.review.check_assignee}\n`;

  yaml += '\n# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += '# Ask 引擎路由配置（控制 speccore ask 的行为）\n';
  yaml += '# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += 'ask:\n';
  yaml += '  # ── 路由策略 ──\n';
  yaml += '  routing:\n';
  yaml += '    # mode: 意图识别路由模式\n';
  yaml += '    #   hybrid → 混合路由（本地规则 + LLM 兜底）\n';
  yaml += '    #   local  → 仅本地规则匹配\n';
  yaml += '    #   llm    → 仅 LLM 识别\n';
  yaml += `    mode: ${config.ask.routing.mode}\n`;
  yaml += '    # high_threshold: 高置信度阈值（≥此值直接执行，不询问确认）\n';
  yaml += `    high_threshold: ${config.ask.routing.high_threshold}\n`;
  yaml += '    # low_threshold: 低置信度阈值（<此值进入模糊拦截，询问用户）\n';
  yaml += `    low_threshold: ${config.ask.routing.low_threshold}\n`;
  yaml += '    # auto_host_ai: 是否在无法识别时自动调用宿主 AI（Qoder/Cursor 等）\n';
  yaml += `    auto_host_ai: ${config.ask.routing.auto_host_ai}\n`;
  yaml += '    # cache_enabled: 是否缓存意图识别结果\n';
  yaml += `    cache_enabled: ${config.ask.routing.cache_enabled}\n`;
  yaml += '    # cache_min_hits: 缓存生效最小命中次数（命中 ≥N 次后才走缓存）\n';
  yaml += `    cache_min_hits: ${config.ask.routing.cache_min_hits}\n`;
  yaml += '  # ── 规则覆盖 ──\n';
  yaml += '  rules:\n';
  yaml += '    # force_host_ai: 是否强制所有请求都走宿主 AI（绕过 CLI 本地处理）\n';
  yaml += `    force_host_ai: ${config.ask.rules.force_host_ai}\n`;
  if (config.ask.llm_providers.length > 0) {
    yaml += '  # ── LLM 提供商（可选）──\n';
    yaml += '  llm_providers:\n';
    for (const p of config.ask.llm_providers) {
      yaml += `    - name: ${p.name}\n      enabled: ${p.enabled}\n      type: ${p.type}\n      endpoint: ${p.endpoint}\n      model: ${p.model}\n`;
      if (p.apiKey) yaml += `      apiKey: ${p.apiKey}\n`;
      yaml += `      priority: ${p.priority}\n`;
    }
  }

  if (config.config_history.length > 0) {
    yaml += '\nconfig_history:\n';
    for (const h of config.config_history) {
      yaml += `  - date: ${h.date}\n    change: ${h.change}\n`;
      if (h.changed_by) yaml += `    changed_by: ${h.changed_by}\n`;
    }
  }

  return yaml;
}

function toProjectYaml(config: ProjectConfig): string {
  let yaml = '# =============================================================================\n';
  yaml += '# SpecCore 项目配置 (.speccore/PROJECT.yaml)\n';
  yaml += '# =============================================================================\n';
  yaml += '# 本文件定义工程列表、源码路径、Git 配置等「项目级」信息。\n';
  yaml += '# 与 .speccore.yml 的区别：\n';
  yaml += '#   - .speccore/PROJECT.yaml → 项目级（工程列表、Git 配置、源码路径）\n';
  yaml += '#   - .speccore.yml          → 系统级（质量门禁、AI 路由、自动化策略）\n';
  yaml += '# =============================================================================\n';
  yaml += `# schema_version: ${config.schema_version}\n`;
  yaml += `# ${new Date().toISOString().split('T')[0]}\n\n`;

  yaml += 'project:\n';
  yaml += '  # 项目标识名（用于 dashboard、报告文件名等）\n';
  yaml += `  name: ${config.project.name}\n`;
  if (config.project.description) {
    yaml += '  # 项目描述（可选）\n';
    yaml += `  description: ${config.project.description}\n`;
  }
  if (config.project.version) {
    yaml += '  # 项目版本（可选）\n';
    yaml += `  version: ${config.project.version}\n`;
  }

  yaml += '\n# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += '# 工程列表（Platforms）\n';
  yaml += '# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += '# 每个工程对应一个可独立部署的端（后端服务 / 前端应用）。\n';
  yaml += '# AI 分析时会根据 `requirement_unit` 自动对标需求文档中的功能模块。\n';
  yaml += '#\n';
  yaml += '# 必填字段：\n';
  yaml += '#   name              → 工程标识（全局唯一，用于目录名、命令参数）\n';
  yaml += '#   type              → frontend(前端) | backend(后端) | infra(基础设施)\n';
  yaml += '#   default_branch    → 默认分支（如 main, develop）\n';
  yaml += '#\n';
  yaml += '# 可选字段：\n';
  yaml += '#   description       → 工程描述（人类可读名称）\n';
  yaml += '#   code_path         → 源码路径（相对于项目根目录）\n';
  yaml += '#   git_repo          → Git 仓库地址（用于分支管理和 PR 提交）\n';
  yaml += '#   requirement_unit  → 对应需求端/功能单元（AI 分析时自动对标）\n';
  yaml += 'platforms:\n';
  if (config.platforms.length === 0) {
    yaml += '  # 示例：添加你的第一个工程（复制后修改）\n';
    yaml += '  # - name: api-service\n';
    yaml += '  #   type: backend\n';
    yaml += '  #   description: API 服务\n';
    yaml += '  #   code_path: ./backend/api-service\n';
    yaml += '  #   git_repo: git@github.com:org/repo.git\n';
    yaml += '  #   default_branch: main\n';
    yaml += '  #   requirement_unit: API 服务\n';
  }
  for (const p of config.platforms) {
    yaml += `  - name: ${p.name}\n`;
    yaml += `    type: ${p.type}\n`;
    if (p.description) yaml += `    description: ${p.description}\n`;
    if (p.code_path) yaml += `    code_path: ${p.code_path}\n`;
    if (p.git_repo) yaml += `    git_repo: ${p.git_repo}\n`;
    yaml += `    default_branch: ${p.default_branch}\n`;
    if (p.requirement_unit) yaml += `    requirement_unit: ${p.requirement_unit}\n`;
  }

  yaml += '\n# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += '# Git 配置\n';
  yaml += '# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += 'git:\n';
  yaml += '  # 默认基础分支（PR 合并目标）\n';
  yaml += `  default_base: ${config.git.default_base}\n`;
  yaml += '  # 功能分支前缀\n';
  yaml += `  branch_prefix: ${config.git.branch_prefix}\n`;
  yaml += '  # 受保护分支（禁止直接 push，只能通过 PR 合并）\n';
  yaml += '  protected_branches:\n';
  for (const b of config.git.protected_branches) {
    yaml += `    - ${b}\n`;
  }

  yaml += '\n# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += '# 代码扫描范围\n';
  yaml += '# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += '# AI 全局分析时扫描的源码目录\n';
  yaml += 'code_scope:\n';
  for (const s of config.code_scope) {
    yaml += `  - ${s}\n`;
  }

  return yaml;
}

// ─────────────────────────────────────────
// 深度合并（用于自动补全缺失字段）
// ─────────────────────────────────────────

function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const sVal = source[key];
    const tVal = target[key];
    if (sVal === undefined) continue;
    if (isPlainObject(tVal) && isPlainObject(sVal)) {
      (result as any)[key] = deepMerge(tVal, sVal as any);
    } else {
      (result as any)[key] = sVal;
    }
  }
  return result;
}

// ─────────────────────────────────────────
// 环境变量解析（支持 ${VAR} 和 ${VAR:-default}）
// ─────────────────────────────────────────

export interface EnvResolutionResult {
  value: unknown;
  /** 成功解析的环境变量名 */
  resolved: string[];
  /** 未找到的环境变量名 */
  unresolved: string[];
}

/**
 * 递归遍历对象/数组，将所有字符串中的 ${ENV_VAR} 替换为环境变量值。
 * 支持默认值语法: ${VAR:-default}
 */
export function resolveEnvVars(obj: unknown): EnvResolutionResult {
  const resolved: string[] = [];
  const unresolved: string[] = [];

  function traverse(current: unknown): unknown {
    if (typeof current === 'string') {
      return resolveEnvVar(current, resolved, unresolved);
    }
    if (Array.isArray(current)) {
      return current.map((item) => traverse(item));
    }
    if (isPlainObject(current)) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(current)) {
        result[key] = traverse(value);
      }
      return result;
    }
    return current;
  }

  const value = traverse(obj);
  return { value, resolved, unresolved };
}

/** 解析单个字符串中的 ${VAR} 和 ${VAR:-default} */
function resolveEnvVar(str: string, resolved: string[], unresolved: string[]): string {
  return str.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (match, varName, defaultValue) => {
    const envValue = process.env[varName];
    if (envValue !== undefined && envValue !== '') {
      if (!resolved.includes(varName)) resolved.push(varName);
      return envValue;
    }
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    if (!unresolved.includes(varName)) unresolved.push(varName);
    return match; // 保留原样，环境变量不存在
  });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
