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
import yaml from 'js-yaml';
import { logger } from '../utils/logger';
import { getProjectRoot } from '../utils/task-utils';

/** 当前系统配置 schema 版本号（.speccore.yml） */
export const CURRENT_SCHEMA_VERSION = 1;

/** 当前项目配置 schema 版本号（.speccore/PROJECT.yaml） */
export const PROJECT_CURRENT_SCHEMA_VERSION = 1;

// ─────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────

/** 单个环境的部署配置 */
export interface DeployEnvConfig {
  /** 部署类型 */
  type: 'docker' | 'static' | 'script' | 'vercel' | 'k8s' | 'ssh' | 'helm' | 'pm2' | 'serverless' | 'sftp';
  /** 构建命令（如 npm run build） */
  build_cmd?: string;
  /** 构建输出目录（static / sftp / ssh 类型用） */
  output_dir?: string;
  /** Dockerfile 路径（docker 类型用，默认 ./Dockerfile） */
  dockerfile?: string;
  /** 镜像仓库地址（docker 类型用） */
  registry?: string;
  /** 镜像名（docker 类型用） */
  image?: string;
  /** 镜像标签（docker 类型用，默认 latest） */
  tag?: string;
  /** 部署目标路径 / CDN 配置 / 服务器地址 / namespace / 函数名 */
  target?: string;
  /** 自定义部署脚本路径或命令（script / k8s / helm 类型用） */
  script?: string;
  /** SSH 服务器地址（ssh 类型用，格式 user@host:port） */
  host?: string;
  /** SSH 私钥路径（ssh / sftp 类型用，默认 ~/.ssh/id_rsa） */
  key?: string;
  /** SSH/SFTP 密码（ssh / sftp 类型用，优先使用密钥认证，密码认证需安装 sshpass） */
  password?: string;
  /** 远程服务器部署目录（ssh / sftp / pm2 类型用） */
  remote_dir?: string;
  /** PM2 配置文件路径（pm2 类型用，默认 ecosystem.config.js） */
  pm2_config?: string;
  /** Serverless 提供商（serverless 类型用: aliyun-fc / aws-lambda / tencent-scf） */
  provider?: string;
  /** 部署前执行的命令 */
  pre_deploy?: string[];
  /** 部署后执行的命令 */
  post_deploy?: string[];
}

export interface PlatformConfig {
  /** 端名/工程标识：全局唯一，用于目录名、命令参数、端识别。如: booking-service, h5-mobile, admin-web */
  name: string;
  /** 工程类型：frontend(前端) | backend(后端) | infra(基础设施) */
  type: 'frontend' | 'backend' | 'infra';
  /** 工程名：人类可读的业务名称。如: 预订订单服务, H5移动端 */
  description?: string;
  /** 项目名称：给人和 AI 看的业务名称（如"食堂后台管理"） */
  project_name?: string;
  /** 项目描述：工程的详细说明，补充信息 */
  project_desc?: string;
  /** 工程源码路径：相对于项目根目录的代码位置。如: ./packages/backend/booking-service */
  code_path?: string;
  /** Git 仓库地址：用于分支管理和 PR 提交 */
  git_repo?: string;
  /** 默认分支：如 main, master, develop */
  default_branch: string;
  /** 涉及需求端/功能单元：用于 AI 分析时自动对标需求文档中的功能模块名 */
  requirement_unit?: string;
  /** 备注：额外信息、特殊说明 */
  notes?: string;
  /** v8.3.104+: 端级 Git 分支前缀（覆盖全局 git.branch_prefix） */
  branch_prefix?: string;
  /** v8.3.104+: 端级受保护分支（覆盖全局 git.protected_branches） */
  protected_branches?: string[];
  /** v8.3.113+: 端级分支类型定义（覆盖全局 git.branch_types）。prefix=任务前前缀, suffix=任务后后缀, 均可选 */
  branch_types?: Record<string, { prefix?: string; suffix?: string; source: string }>;
  /** v8.3.60+: 按环境部署配置 */
  deploy?: {
    /** 测试环境 */
    staging?: DeployEnvConfig;
    /** 生产环境 */
    production?: DeployEnvConfig;
    /** 自定义环境（如 preview, qa） */
    [env: string]: DeployEnvConfig | undefined;
  };
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
  /** v8.3.253+: 本地文件日志开关（写入 .speccore/local/logs/，默认关） */
  logging?: {
    /** true → 所有命令的 logger 输出落盘到本地日志文件 */
    enabled?: boolean;
  };
  quality_gates: {
    enforce_testing: boolean;
    enforce_review: boolean;
    require_pr: boolean;
    /** v8.3.197+: 阻塞级别——standard(默认)=编译+单测+契约阻塞；compile=仅编译阻塞 */
    block_level?: 'compile' | 'standard';
    verify_ui?: {
      enabled: boolean;
      smoke_test: boolean;
      visual_check: boolean;
      threshold: 'strict' | 'normal' | 'loose';
      devices: string[];
      browsers: string[];
      timeout: number;
      /** 有头模式：显示浏览器窗口（调试用，默认 false） */
      headed?: boolean;
      /** 视觉模型配置 */
      visual_model?: {
        /** 提供商: qwen-vl(默认) | openai | anthropic | local */
        provider: 'qwen-vl' | 'openai' | 'anthropic' | 'local';
        /** 模型名称 */
        model?: string;
        /** API Key（可选，默认从环境变量读取） */
        apiKey?: string;
        /** 自定义端点（可选） */
        endpoint?: string;
        /** 请求超时（毫秒，默认 60000） */
        timeout?: number;
      };
    };
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
    /** v8.3.174+: 模式参数收敛 — CLI 模式默认配置 */
    pipeline?: boolean;
    with_code?: boolean;
    /** v8.3.190+: 非必要流水线步骤的三态开关（默认 auto=智能判定 / on=强制 / off=跳过） */
    optional_steps?: {
      clarify?: 'auto' | 'on' | 'off';
      verify?: 'auto' | 'on' | 'off';
      pipeline?: 'auto' | 'on' | 'off';
      pr?: 'auto' | 'on' | 'off';
      done?: 'auto' | 'on' | 'off';
      spec2doc?: 'auto' | 'on' | 'off';
    };
    /** v8.3.190+: 命名流水线（preset + 用户自定义 + 默认） */
    pipelines?: {
      /** 默认流水线名（内置 preset 或 custom 名，默认 full） */
      default?: string;
      /** 用户自定义命名流水线：名称 → 逗号分隔的阶段串（如 "analyze,validate,split,execute"） */
      custom?: Record<string, string>;
    };
    /** v8.3.195+: 流水线 review 闸口模式（A=Spec定稿 / B=代码review / C=部署确认） */
    gates?: {
      /** manual = 三闸口都软停人工确认（默认，最安全）| auto = 三闸口都跳过（含 C 部署） */
      mode?: 'manual' | 'auto';
    };
    /** v8.3.196+: AI 内容生成来源（analyze/taskify/execute 等 AI 步骤） */
    ai?: {
      /** host = 宿主 AI（Qoder SDK / Headless，默认）| llm = 自配 LLM（callLlm）| auto = 宿主优先，失败回退自配 LLM */
      provider?: 'host' | 'llm' | 'auto';
      /** 自配 LLM provider 池（定义一次，各功能按 name 引用；支持 ollama 本地/openai/anthropic/custom） */
      providers?: LlmProviderConfig[];
      /** 各功能的默认 provider name（如 analyze: gpt4o、taskify: local、split: local） */
      defaults?: Record<string, string>;
      /** 兜底 provider name（defaults 未指定或指定不可用时用） */
      fallback?: string;
    };
    /** v8.3.301+: 子 Agent SDK 派单控制（第七层「窗口物理隔离」增强通道） */
    agent_dispatch?: {
      /** auto=Qoder 宿主 + token 可用时走 SDK（默认）| on=强制尝试 SDK（失败回退标记模式）| off=禁用，永远标记模式 */
      mode?: 'auto' | 'on' | 'off';
    };
    /** v8.3.94+: 视觉模型配置（用于 specs 图片理解、UI 验证截图分析） */
    vision?: {
      enabled: boolean;
      provider: 'qwen-vl' | 'openai' | 'anthropic' | 'local';
      model?: string;
      apiKey?: string;
      endpoint?: string;
      timeout?: number;
      /** 每个 prompt 最多处理多少张图片（默认 10） */
      maxImagesPerPrompt?: number;
      /** 图片最大尺寸（KB），超过则跳过（默认 2048） */
      imageMaxSizeKb?: number;
    };
    /** v8.3.217+: 冒烟测试统一配置（三时机开关 + 范围 + 按环境差异化） */
    smoke?: {
      /** 三个冒烟点开关（auto=智能判定 / on=强制 / off=跳过） */
      points?: {
        /** ①本地冒烟：execute 完成后、commit 前（默认 auto） */
        local?: 'auto' | 'on' | 'off';
        /** ②部署前冒烟：pipeline build 后、deploy 前（默认 auto，critical 阻断） */
        'pre-deploy'?: 'auto' | 'on' | 'off';
        /** ③环境冒烟：deploy 后（默认 auto，只报告） */
        'post-deploy'?: 'auto' | 'on' | 'off';
      };
      /** 默认冒烟范围（full=全量 / module=当前功能模块；diff 变更级后续） */
      scope?: 'full' | 'module';
      /** 按环境差异化范围（键为环境名，值同 scope） */
      scope_by_env?: Record<string, 'full' | 'module'>;
    };
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
  /** v8.3.70+: 外部工具自定义路径 */
  tools?: {
    /** pandoc 可执行文件路径（用于 doc2spec / spec2doc） */
    pandoc?: string;
    /** LibreOffice 可执行文件路径（用于 .doc 格式转换） */
    libreoffice?: string;
  };
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
    /** v8.3.113+: 分支类型定义。prefix=任务前前缀, suffix=任务后后缀, 均可选。如 hotfix: { source: 'main', prefix: 'api-', suffix: '-urgent' } */
    branch_types?: Record<string, { prefix?: string; suffix?: string; source: string }>;
  };
  code_scope: string[];
  /** v8.3.58+: 验证相关配置 */
  verify?: {
    /** 显式指定前端路由配置文件路径（覆盖自动发现） */
    router_file?: string;
  };
}

// ─────────────────────────────────────────
// 系统配置默认值（.speccore.yml）
// ─────────────────────────────────────────

export const DEFAULT_CONFIG: SpecConfig = {
  schema_version: CURRENT_SCHEMA_VERSION,
  logging: {
    enabled: false,
  },
  quality_gates: {
    enforce_testing: true,
    enforce_review: true,
    require_pr: true,
    block_level: 'standard',
    verify_ui: {
      enabled: false,
      smoke_test: true,
      visual_check: true,
      headed: false,
      threshold: 'normal',
      devices: ['desktop'],
      browsers: ['chromium'],
      timeout: 30000,
      visual_model: {
        provider: 'qwen-vl',
        model: 'qwen-vl-max',
      },
    },
  },
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
    // v8.3.297: vision 补入 DEFAULT_CONFIG（此前类型/文档有、升级不产出，序列化器漏写）
    vision: {
      enabled: false,
      provider: 'qwen-vl',
      model: 'qwen-vl-plus',
      maxImagesPerPrompt: 10,
      imageMaxSizeKb: 2048,
    },
    pipeline: false,
    with_code: false,
    optional_steps: { clarify: 'auto', verify: 'auto', pipeline: 'auto', pr: 'auto', done: 'auto', spec2doc: 'auto' },
    pipelines: { default: 'develop', custom: {} },
    gates: { mode: 'manual' },
    ai: { provider: 'host', providers: [], defaults: {}, fallback: '' },
    agent_dispatch: { mode: 'auto' },
    smoke: {
      points: { local: 'auto', 'pre-deploy': 'auto', 'post-deploy': 'auto' },
      scope: 'module',
      scope_by_env: {},
    },
  },
  ask: {
    routing: { mode: 'hybrid', high_threshold: 70, low_threshold: 45, auto_host_ai: true, cache_enabled: true, cache_min_hits: 3 },
    rules: { force_host_ai: false },
    llm_providers: [],
  },
  config_history: [],
  tools: { pandoc: '', libreoffice: '' },
};

// ─────────────────────────────────────────
// 项目配置默认值（.speccore/PROJECT.yaml）
// ─────────────────────────────────────────

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  schema_version: CURRENT_SCHEMA_VERSION,
  project: { name: 'my-project' },
  platforms: [],
  git: {
    default_base: 'main',
    branch_prefix: 'feature/',
    protected_branches: ['main', 'master'],
    branch_types: {
      feature: { source: 'develop' },
      bugfix: { source: 'develop' },
      release: { source: 'develop' },
      hotfix: { source: 'main' },
    },
  },
  code_scope: ['src/'],
};

const resolveConfigPath = () => join(getProjectRoot(), '.speccore.yml');
const resolveProjectConfigPath = () => join(getProjectRoot(), '.speccore', 'PROJECT.yaml');

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

  if (!(await pathExists(resolveConfigPath()))) {
    warnings.push('⚠️ .speccore.yml 不存在，使用默认配置');
    return { config: { ...DEFAULT_CONFIG }, warnings, migrated: false };
  }

  try {
    const raw = await readFile(resolveConfigPath(), 'utf-8');
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

/**
 * 读取磁盘上的原始 PROJECT.yaml（不做默认值合并/迁移，环境变量原样保留）
 * v8.3.304+: 供「只认用户显式配置」的场景使用——merge 后的配置无法区分
 * 「用户显式声明」与「DEFAULT_PROJECT_CONFIG 出厂预置」（如 branch_types 预置表），
 * 拉分支等需要严格遵循用户声明语义的消费方应使用本函数。
 */
export async function loadRawProjectConfig(): Promise<ProjectConfig | null> {
  if (!(await pathExists(resolveProjectConfigPath()))) return null;
  try {
    const raw = await readFile(resolveProjectConfigPath(), 'utf-8');
    const parsed = parseYaml(raw) as Record<string, unknown>;
    return parsed as unknown as ProjectConfig;
  } catch {
    return null;
  }
}

/** 获取项目配置 + 元信息 */
export async function loadProjectConfigWithMeta(): Promise<ProjectConfigLoadResult> {
  const warnings: string[] = [];

  if (!(await pathExists(resolveProjectConfigPath()))) {
    warnings.push('⚠️ .speccore/PROJECT.yaml 不存在，使用默认项目配置');
    return { config: { ...DEFAULT_PROJECT_CONFIG }, warnings, migrated: false };
  }

  try {
    const raw = await readFile(resolveProjectConfigPath(), 'utf-8');
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

/**
 * 加载项目配置并叠加环境配置覆盖
 * v8.3.60+: 支持 .speccore/environments/*.yaml 覆盖
 */
export async function loadProjectConfigWithEnv(envFileOrName?: string): Promise<ProjectConfig> {
  const projectConfig = await loadProjectConfig();

  if (!envFileOrName) {
    return projectConfig;
  }

  // 动态导入避免循环依赖
  const { loadEnvironmentByNameOrPath } = await import('./environment-config');
  const envConfig = await loadEnvironmentByNameOrPath(envFileOrName);

  if (!envConfig) {
    return projectConfig;
  }

  // 深拷贝项目配置，避免修改原对象
  const merged = JSON.parse(JSON.stringify(projectConfig)) as ProjectConfig;

  // 叠加环境配置到各端
  for (const platform of merged.platforms) {
    const envPlatform = envConfig.platforms[platform.name];
    if (!envPlatform) continue;

    // 叠加 build_cmd（写入 deploy 配置中对应环境）
    const buildCmd = envPlatform.build_cmd || envConfig.defaults?.build_cmd;
    if (buildCmd) {
      if (!platform.deploy) platform.deploy = {};
      // 为所有已配置的环境添加 build_cmd，或为 staging 创建默认
      for (const envKey of Object.keys(platform.deploy)) {
        const existing = platform.deploy[envKey];
        if (existing) {
          existing.build_cmd = buildCmd;
        }
      }
      // 若没有任何环境配置，默认写入 staging
      if (Object.keys(platform.deploy).length === 0) {
        platform.deploy.staging = { type: 'script', build_cmd: buildCmd };
      }
    }

    // 叠加 deploy 配置（环境文件中的 deploy 覆盖对应 env 的配置）
    if (envPlatform.deploy) {
      if (!platform.deploy) platform.deploy = {};
      const targetEnv = envConfig.env;
      const existing = platform.deploy[targetEnv];
      if (existing) {
        Object.assign(existing, envPlatform.deploy);
      } else {
        platform.deploy[targetEnv] = { ...envPlatform.deploy };
      }
    }
  }

  return merged;
}

/** 别名：getConfig = loadConfig */
export async function getConfig(): Promise<SpecConfig> {
  return loadConfig();
}

// ─────────────────────────────────────────
// 配置保存（自动写入 schema_version）
// ─────────────────────────────────────────

export async function saveConfig(config: SpecConfig): Promise<void> {
  const enriched = { ...config, schema_version: CURRENT_SCHEMA_VERSION };
  const yaml = toYaml(enriched);
  await writeFile(resolveConfigPath(), yaml, 'utf-8');
}

export async function saveProjectConfig(config: ProjectConfig): Promise<void> {
  const enriched = { ...config, schema_version: CURRENT_SCHEMA_VERSION };
  const yaml = toProjectYaml(enriched);
  await ensureDir(join(getProjectRoot(), '.speccore'));
  await writeFile(resolveProjectConfigPath(), yaml, 'utf-8');
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

/** 开放式字典字段：允许用户自定义键（如 git.branch_types 的分支类型名），不检测 removed */
const OPEN_DICT_PATHS = new Set<string>(['git.branch_types']);

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
        // 开放式字典字段：用户自定义键是合法的（如自定义分支类型），不判为 removed
        if (OPEN_DICT_PATHS.has(path)) continue;
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
 * 检测磁盘 .speccore.yml 与默认配置的差异（直接读原始文件，不做深度合并）
 *
 * 背景：loadConfigWithMeta 会 deepMerge 默认值补全缺失字段，导致
 * detectConfigDiff(config, DEFAULT_CONFIG) 永远看不到磁盘文件缺失的新字段。
 * update 需要用本函数才能检测到「升级后配置文件缺了哪些新字段」并补全。
 *
 * 返回 null 表示文件不存在或解析失败。
 */
export async function detectConfigDiffFromFile(): Promise<ConfigDiff | null> {
  if (!(await pathExists(resolveConfigPath()))) return null;
  try {
    const raw = await readFile(resolveConfigPath(), 'utf-8');
    const parsed = parseYaml(raw) as Record<string, unknown>;
    return detectConfigDiff(parsed, DEFAULT_CONFIG);
  } catch {
    return null;
  }
}

/**
 * 检测磁盘 .speccore/PROJECT.yaml 与默认项目配置的差异（直接读原始文件）
 */
export async function detectProjectConfigDiffFromFile(): Promise<ConfigDiff | null> {
  if (!(await pathExists(resolveProjectConfigPath()))) return null;
  try {
    const raw = await readFile(resolveProjectConfigPath(), 'utf-8');
    const parsed = parseYaml(raw) as Record<string, unknown>;
    return detectConfigDiff(parsed, DEFAULT_PROJECT_CONFIG);
  } catch {
    return null;
  }
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

// v8.3.298: 旧版 .speccore.yml 顶层字段白名单（升级时不阻断，自动迁移/丢弃）
// 背景：早期版本 platforms/git/code_scope 等字段存在 .speccore.yml 里，后来归属 PROJECT.yaml；
// 若不豁免，detectConfigDiff 会报 removed → 升级被「需人工确认」截停 → 新字段（logging/verify_ui 等）永远补不上。
const LEGACY_MIGRATE_KEYS = new Set(['project', 'platforms', 'git', 'code_scope']);
const LEGACY_DROP_KEYS = new Set(['tech_stack', 'team', 'conventions', 'error_codes']);
export const LEGACY_MAIN_CONFIG_KEYS = new Set([...LEGACY_MIGRATE_KEYS, ...LEGACY_DROP_KEYS]);

// v8.3.303: 已知废弃的嵌套字段（带点路径）——升级时自动移除，不触发人工确认
// 背景：v8.3.197 用 block_level 取代 quality_gates.compile；旧项目升级时 compile 判 removed
// → requiresUserConfirmation 截停 → 新增字段（verify_ui.devices/browsers/timeout/visual_model 等）永远补不上
export const LEGACY_DROP_PATHS = new Set(['quality_gates.compile']);

/** v8.3.303: 过滤已知废弃/迁移字段，避免旧字段触发人工确认截停升级 */
export function filterLegacyRemoved(diff: ConfigDiff): ConfigDiff {
  return {
    ...diff,
    removed: diff.removed.filter(
      (p) => !LEGACY_MAIN_CONFIG_KEYS.has(p.split('.')[0]) && !LEGACY_DROP_PATHS.has(p)
    ),
  };
}

/** v8.3.303: 按点路径删除嵌套键（路径不存在时静默跳过） */
export function deleteNestedKey(obj: unknown, path: string): void {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (!isPlainObject(next)) return;
    cur = next as Record<string, unknown>;
  }
  delete cur[parts[parts.length - 1]];
}

/**
 * v8.3.298+: 迁移旧版 .speccore.yml 的顶层字段
 * - project/platforms/git/code_scope → 合并进 .speccore/PROJECT.yaml（缺失/空时回填，不覆盖新数据）
 * - tech_stack/team/conventions/error_codes → 已废弃，直接删除
 */
async function migrateLegacyMainConfig(config: SpecConfig): Promise<string[]> {
  const logs: string[] = [];
  const raw = config as unknown as Record<string, unknown>;
  const legacy: Record<string, unknown> = {};
  let hasLegacy = false;

  for (const key of LEGACY_MIGRATE_KEYS) {
    if (key in raw) {
      legacy[key] = raw[key];
      delete raw[key];
      hasLegacy = true;
    }
  }
  for (const key of LEGACY_DROP_KEYS) {
    if (key in raw) {
      delete raw[key];
      hasLegacy = true;
    }
  }
  if (!hasLegacy) return logs;

  try {
    const { config: projectCfg } = await loadProjectConfigWithMeta();
    const merged: Record<string, unknown> = { ...projectCfg } as unknown as Record<string, unknown>;
    const legacyAny = legacy as Record<string, unknown>;
    if (legacyAny.project) {
      merged.project = deepMerge((merged.project as object) || {}, legacyAny.project);
    }
    if (Array.isArray(legacyAny.platforms) && legacyAny.platforms.length > 0
      && (!Array.isArray(merged.platforms) || (merged.platforms as unknown[]).length === 0)) {
      merged.platforms = legacyAny.platforms;
    }
    if (legacyAny.git) {
      merged.git = deepMerge((merged.git as object) || {}, legacyAny.git);
    }
    if (Array.isArray(legacyAny.code_scope) && legacyAny.code_scope.length > 0
      && (!Array.isArray(merged.code_scope) || (merged.code_scope as unknown[]).length === 0)) {
      merged.code_scope = legacyAny.code_scope;
    }
    await saveProjectConfig(merged as unknown as ProjectConfig);
    logs.push('旧版 .speccore.yml 字段（platforms/git/code_scope 等）已迁移至 .speccore/PROJECT.yaml');
  } catch {
    logs.push('旧版字段迁移至 PROJECT.yaml 失败（已从主配置移除，可手动核对 .speccore/PROJECT.yaml）');
  }
  logs.push('废弃字段（tech_stack/team/conventions/error_codes）已移除');
  return logs;
}

export async function upgradeConfig(): Promise<ConfigLoadResult> {
  const { config, warnings } = await loadConfigWithMeta();

  // v8.3.187+: 用磁盘原始文件检测缺失字段（loadConfigWithMeta 深度合并补全后看不到）
  const fileDiff = await detectConfigDiffFromFile();

  if (config.schema_version === CURRENT_SCHEMA_VERSION && warnings.length === 0 && !(fileDiff && fileDiff.added.length > 0)) {
    logger.info(`✅ .speccore.yml 已经是 schema_version=${CURRENT_SCHEMA_VERSION}，无需升级`);
    return { config, warnings: [], migrated: false };
  }

  // 1. 检测配置差异（优先用磁盘原始文件差异，能看到缺失的新字段）
  const diff = fileDiff || detectConfigDiff(config, DEFAULT_CONFIG);
  // v8.3.298: 旧版顶层字段（已归属 PROJECT.yaml 或废弃）不触发「需人工确认」，自动迁移
  // v8.3.303: 已知废弃嵌套字段（quality_gates.compile 等）同样豁免，自动清理
  const effectiveDiff: ConfigDiff = filterLegacyRemoved(diff);
  const needsConfirm = requiresUserConfirmation(effectiveDiff);

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
      const diffPath = join(getProjectRoot(), '.speccore', 'config', 'upgrade-diff.md');
      await ensureDir(join(getProjectRoot(), '.speccore', 'config'));
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

  // v8.3.303: 清理已知废弃字段（被新字段取代），避免写回后残留旧键
  for (const legacyPath of LEGACY_DROP_PATHS) {
    deleteNestedKey(upgraded, legacyPath);
  }

  // v8.3.298+: 旧版顶层字段自动迁移（platforms/git/code_scope → PROJECT.yaml，废弃字段删除）
  const legacyLogs = await migrateLegacyMainConfig(upgraded);

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

  if (legacyLogs.length > 0) {
    logger.info('   旧版字段处理:');
    for (const log of legacyLogs) logger.info(`   ${log}`);
  }

  return { config: upgraded, warnings, migrated: true };
}

// ─────────────────────────────────────────
// 项目配置升级（.speccore/PROJECT.yaml）
// ─────────────────────────────────────────

// v8.3.299: PROJECT.yaml 可选字段白名单（类型/序列化器支持、DEFAULT_PROJECT_CONFIG 未收录的合法字段）
// 背景：早期 init 生成的 PROJECT.yaml 带 project.description/project.version；v8.3.58+ 支持 verify。
// 若判 removed → requiresUserConfirmation 截停 → git/code_scope 等新字段永远补不上。
export const PROJECT_OPTIONAL_PATHS = new Set(['project.description', 'project.version', 'verify']);

export async function upgradeProjectConfig(): Promise<ProjectConfigLoadResult> {
  const { config, warnings } = await loadProjectConfigWithMeta();

  // v8.3.187+: 用磁盘原始文件检测缺失字段（loadProjectConfigWithMeta 补全后看不到）
  const fileDiff = await detectProjectConfigDiffFromFile();

  if (config.schema_version === PROJECT_CURRENT_SCHEMA_VERSION && warnings.length === 0 && !(fileDiff && fileDiff.added.length > 0)) {
    logger.info(`✅ .speccore/PROJECT.yaml 已经是 schema_version=${PROJECT_CURRENT_SCHEMA_VERSION}，无需升级`);
    return { config, warnings: [], migrated: false };
  }

  // 1. 检测配置差异（优先用磁盘原始文件差异，能看到缺失的新字段）
  const diff = fileDiff || detectConfigDiff(config, DEFAULT_PROJECT_CONFIG);
  // v8.3.299: 可选字段白名单过滤 removed——project.description/version、verify 是类型合法可选字段，
  //           DEFAULT_PROJECT_CONFIG 未收录导致误判删除，进而截停升级（git/code_scope 永远补不上）
  const effectiveDiff: ConfigDiff = {
    ...diff,
    removed: diff.removed.filter((p) => !PROJECT_OPTIONAL_PATHS.has(p)),
  };
  const needsConfirm = requiresUserConfirmation(effectiveDiff);

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
      const diffPath = join(getProjectRoot(), '.speccore', 'config', 'upgrade-diff-project.md');
      await ensureDir(join(getProjectRoot(), '.speccore', 'config'));
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
    if (obj.quality_gates.block_level !== undefined && !['compile', 'standard'].includes(obj.quality_gates.block_level as string)) {
      issues.push('quality_gates.block_level 必须是 compile/standard 之一');
    }

    // verify_ui 校验
    if (isObject(obj.quality_gates.verify_ui)) {
      const vui = obj.quality_gates.verify_ui;
      for (const key of ['enabled', 'smoke_test', 'visual_check', 'headed']) {
        if (vui[key] !== undefined && typeof vui[key] !== 'boolean') {
          issues.push(`quality_gates.verify_ui.${key} 必须是布尔值`);
        }
      }
      if (vui.threshold && !['strict', 'normal', 'loose'].includes(vui.threshold as string)) {
        issues.push('quality_gates.verify_ui.threshold 必须是 strict/normal/loose 之一');
      }
      if (vui.devices !== undefined && !Array.isArray(vui.devices)) {
        issues.push('quality_gates.verify_ui.devices 必须是数组');
      }
      if (vui.browsers !== undefined && !Array.isArray(vui.browsers)) {
        issues.push('quality_gates.verify_ui.browsers 必须是数组');
      }
      if (vui.timeout !== undefined && typeof vui.timeout !== 'number') {
        issues.push('quality_gates.verify_ui.timeout 必须是数字');
      }
      // visual_model 校验
      if (vui.visual_model !== undefined) {
        if (!isObject(vui.visual_model)) {
          issues.push('quality_gates.verify_ui.visual_model 必须是对象');
        } else {
          const vm = vui.visual_model;
          const providers = ['qwen-vl', 'openai', 'anthropic', 'local'];
          if (vm.provider && !providers.includes(vm.provider as string)) {
            issues.push(`quality_gates.verify_ui.visual_model.provider 必须是 ${providers.join('/')} 之一`);
          }
          if (vm.timeout !== undefined && typeof vm.timeout !== 'number') {
            issues.push('quality_gates.verify_ui.visual_model.timeout 必须是数字');
          }
        }
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
    if (isObject(s.agent_dispatch) && s.agent_dispatch.mode && !['auto', 'on', 'off'].includes(s.agent_dispatch.mode as string)) {
      issues.push('settings.agent_dispatch.mode 必须是 auto/on/off 之一');
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
      // v8.3.119: type 为工程类型（如 Java服务、H5移动端），不限制枚举值
      if (p.type && typeof p.type !== 'string') {
        issues.push(`platforms[${idx}].type 必须是字符串`);
      }
    }
  }

  // git
  if (isObject(obj.git)) {
    if (typeof obj.git.default_base !== 'string') issues.push('git.default_base 必须是字符串');
    if (typeof obj.git.branch_prefix !== 'string') issues.push('git.branch_prefix 必须是字符串');
    if (!Array.isArray(obj.git.protected_branches)) issues.push('git.protected_branches 必须是数组');
    // v8.3.111+: branch_types 校验
    if (obj.git.branch_types !== undefined) {
      if (!isObject(obj.git.branch_types)) {
        issues.push('git.branch_types 必须是对象');
      } else {
        for (const [typeName, typeDef] of Object.entries(obj.git.branch_types as Record<string, unknown>)) {
          if (!isObject(typeDef)) {
            issues.push(`git.branch_types.${typeName} 必须是对象`);
            continue;
          }
          if (typeDef.prefix !== undefined && typeof typeDef.prefix !== 'string') {
            issues.push(`git.branch_types.${typeName}.prefix 必须是字符串`);
          }
          if (typeDef.suffix !== undefined && typeof typeDef.suffix !== 'string') {
            issues.push(`git.branch_types.${typeName}.suffix 必须是字符串`);
          }
          if (typeof typeDef.source !== 'string') issues.push(`git.branch_types.${typeName}.source 必须是字符串`);
        }
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ─────────────────────────────────────────
// v8.3.104+: 端级 Git 配置覆盖
// ─────────────────────────────────────────

/** 获取生效的 Git 配置（统一配置 + 端级覆盖） */
export interface EffectiveGitConfig {
  default_base: string;
  branch_prefix: string;
  protected_branches: string[];
  /** v8.3.113+: 分支类型定义。prefix=任务前前缀, suffix=任务后后缀 */
  branch_types: Record<string, { prefix?: string; suffix?: string; source: string }>;
}

/**
 * 获取指定端的生效 Git 配置。
 * 优先级：端级配置 > 全局统一配置
 * branch_types 采用合并策略：端级覆盖同名类型，新增类型追加
 */
export async function getEffectiveGitConfig(platformName: string): Promise<EffectiveGitConfig> {
  const projectConfig = await loadProjectConfigWithEnv();
  // v8.3.300: platforms 可能为 null/缺端名，找不到端时回退全局配置而非抛异常
  const platform = (projectConfig.platforms || []).find((p: PlatformConfig) => p.name === platformName);

  const globalTypes = projectConfig.git.branch_types || {};
  const platformTypes = platform?.branch_types || {};
  // v8.3.119: 深度合并 branch_types，端级覆盖同名字段，不丢失全局字段
  const branch_types: Record<string, { prefix?: string; suffix?: string; source: string }> = {};
  for (const typeName of new Set([...Object.keys(globalTypes), ...Object.keys(platformTypes)])) {
    branch_types[typeName] = {
      ...(globalTypes[typeName] || {}),
      ...(platformTypes[typeName] || {}),
    };
  }

  return {
    default_base: platform?.default_branch || projectConfig.git.default_base,
    branch_prefix: platform?.branch_prefix || projectConfig.git.branch_prefix,
    protected_branches: platform?.protected_branches || projectConfig.git.protected_branches,
    branch_types,
  };
}

// ─────────────────────────────────────────
// YAML 解析 / 序列化
// ─────────────────────────────────────────

/**
 * 解析 YAML 配置（v8.3.190+：改用 js-yaml 根治「回读不对称」）
 * 之前的行级手写解析器只认块级数组，不认 flow 写法（[a,b]/[]/{}），
 * 且把「- # 注释」误当元素值，已 3 次踩坑。js-yaml 是标准解析器，彻底根治。
 */
function parseYaml(content: string): unknown {
  try {
    // JSON_SCHEMA: 不做 YAML 特有的日期/二进制推断（避免 date: 2026-09-19 被解析成 Date 对象）
    return yaml.load(content, { schema: yaml.JSON_SCHEMA }) ?? {};
  } catch {
    return {};
  }
}


/**
 * 将字符串数组字段规范化为数组。
 * 兼容历史脏数据：旧版 toYaml 用 flow 写法（如 `['desktop']`）序列化数组，
 * 而自定义 parseYaml 不认识 flow sequence，回读成字符串 `"['desktop']"`。
 * 此函数把这类字符串还原为数组，避免 `vui.devices.map is not a function`。
 */
function normalizeStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.startsWith('[') && s.endsWith(']')) {
      return s.slice(1, -1).split(',')
        .map((x) => x.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }
    if (s) return s.split(',').map((x) => x.trim()).filter(Boolean);
  }
  return [];
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
  yaml += `schema_version: ${config.schema_version}\n`;
  yaml += `# ${new Date().toISOString().split('T')[0]}\n\n`;

  // v8.3.258: logging 段补写（此前手写序列化器漏写，导致配置文件开关失效）
  yaml += '# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += '# 本地文件日志（v8.3.253+）\n';
  yaml += '# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += '# 开关三级优先级：--log 参数 > SPECCORE_LOG=1 环境变量 > logging.enabled\n';
  yaml += '# 开启后所有 logger 输出同步写盘 .speccore/local/logs/speccore-<日期>.log\n';
  yaml += '# 排查问题时可直接把日志文件发给 AI 分析。默认关闭，零开销。\n';
  yaml += 'logging:\n';
  yaml += '  # enabled: 是否启用本地文件日志\n';
  yaml += `  enabled: ${config.logging?.enabled ?? false}\n`;

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
  // v8.3.258: block_level 补写（v8.3.197 新增字段此前未被序列化器输出）
  yaml += '  # block_level: 质量门禁阻塞级别（v8.3.197+）\n';
  yaml += '  #   standard → 编译+单测+契约阻塞（默认）\n';
  yaml += '  #   compile  → 仅编译阻塞\n';
  yaml += `  block_level: ${config.quality_gates.block_level ?? 'standard'}\n`;

  // verify_ui 配置
  const vui = config.quality_gates.verify_ui;
  if (vui) {
    yaml += '\n  # ── UI 验证（v8.3.47+）──\n';
    yaml += '  verify_ui:\n';
    yaml += '    # enabled: 是否启用 UI 验证（冒烟测试 + 视觉检查）\n';
    yaml += `    enabled: ${vui.enabled}\n`;
    yaml += '    # smoke_test: 是否执行冒烟测试\n';
    yaml += `    smoke_test: ${vui.smoke_test}\n`;
    yaml += '    # visual_check: 是否执行视觉检查\n';
    yaml += `    visual_check: ${vui.visual_check}\n`;
    yaml += '    # headed: 是否使用有头浏览器（显示浏览器窗口，便于调试）\n';
    yaml += `    headed: ${vui.headed}\n`;
    yaml += '    # threshold: 检测严格度\n';
    yaml += '    #   strict → 任何微小差异都视为问题\n';
    yaml += '    #   normal → 明显差异视为问题\n';
    yaml += '    #   loose  → 仅严重问题\n';
    yaml += `    threshold: ${vui.threshold}\n`;
    yaml += '    # devices: 测试设备列表\n';
    const devices = normalizeStringArray(vui.devices);
    yaml += devices.length > 0
      ? '    devices:\n' + devices.map((d) => `      - ${d}\n`).join('')
      : '    devices: []\n';
    yaml += '    # browsers: 测试浏览器列表\n';
    const browsers = normalizeStringArray(vui.browsers);
    yaml += browsers.length > 0
      ? '    browsers:\n' + browsers.map((b) => `      - ${b}\n`).join('')
      : '    browsers: []\n';
    yaml += '    # timeout: 单场景超时（毫秒）\n';
    yaml += `    timeout: ${vui.timeout}\n`;
    if (vui.visual_model) {
      yaml += '    # visual_model: 视觉模型配置（v8.3.50+）\n';
      yaml += '    #   provider: qwen-vl(默认) | openai | anthropic | local\n';
      yaml += '    #   model: 模型名称（可选）\n';
      yaml += '    #   apiKey: API Key（可选，默认从环境变量读取）\n';
      yaml += '    #   endpoint: 自定义端点（可选）\n';
      yaml += '    #   timeout: 请求超时（毫秒，可选）\n';
      yaml += '    visual_model:\n';
      yaml += `      provider: ${vui.visual_model.provider}\n`;
      if (vui.visual_model.model) yaml += `      model: ${vui.visual_model.model}\n`;
      if (vui.visual_model.apiKey) yaml += `      apiKey: ${vui.visual_model.apiKey}\n`;
      if (vui.visual_model.endpoint) yaml += `      endpoint: ${vui.visual_model.endpoint}\n`;
      if (vui.visual_model.timeout) yaml += `      timeout: ${vui.visual_model.timeout}\n`;
    }
  }

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
  // v8.3.297: vision 段补写（v8.3.94 新增字段此前未序列化输出，升级假补全）
  const vis = config.settings.vision;
  yaml += '  # ── 视觉模型（Vision，v8.3.94+）──\n';
  yaml += '  #   specs 文档图片理解（PNG/JPG/GIF/WebP 位图自动转文本注入 AI prompt）。默认关闭。\n';
  yaml += '  vision:\n';
  yaml += '    # enabled: 是否启用视觉模型\n';
  yaml += `    enabled: ${vis?.enabled ?? false}\n`;
  yaml += '    # provider: qwen-vl | openai | anthropic | local\n';
  yaml += `    provider: ${vis?.provider ?? 'qwen-vl'}\n`;
  if (vis?.model) yaml += `    model: ${vis.model}\n`;
  if (vis?.apiKey) {
    yaml += '    # apiKey: 支持 ${ENV_VAR} 环境变量引用\n';
    yaml += `    apiKey: ${vis.apiKey}\n`;
  }
  if (vis?.endpoint) yaml += `    endpoint: ${vis.endpoint}\n`;
  if (vis?.timeout) yaml += `    timeout: ${vis.timeout}\n`;
  if (vis?.maxImagesPerPrompt) yaml += `    maxImagesPerPrompt: ${vis.maxImagesPerPrompt}\n`;
  if (vis?.imageMaxSizeKb) yaml += `    imageMaxSizeKb: ${vis.imageMaxSizeKb}\n`;
  yaml += '  # ── 流水线（Pipeline）──\n';
  yaml += '  # pipeline: 是否默认启用 Pipeline 模式\n';
  yaml += `  pipeline: ${config.settings.pipeline}\n`;
  yaml += '  # ── 关联代码（with_code）──\n';
  yaml += '  # with_code: 分析时是否默认关联代码\n';
  yaml += `  with_code: ${config.settings.with_code}\n`;
  yaml += '  # ── 非必要流水线步骤开关（三态）──\n';
  yaml += '  #   auto = 按内置逻辑（默认） | on = 强制执行 | off = 跳过\n';
  yaml += '  optional_steps:\n';
  const os = config.settings.optional_steps;
  yaml += '    # clarify: 需求澄清（auto=按专业度判定）\n';
  yaml += `    clarify: ${os?.clarify ?? 'auto'}\n`;
  yaml += '    # verify: 验证（代码 review + 契约/性能 + UI）\n';
  yaml += `    verify: ${os?.verify ?? 'auto'}\n`;
  yaml += '    # pipeline: 部署（合并→构建→测试→部署）\n';
  yaml += `    pipeline: ${os?.pipeline ?? 'auto'}\n`;
  yaml += '    # pr: 合并请求（本地开发可不 PR）\n';
  yaml += `    pr: ${os?.pr ?? 'auto'}\n`;
  yaml += '    # done: 归档复盘（可延后）\n';
  yaml += `    done: ${os?.done ?? 'auto'}\n`;
  yaml += '    # spec2doc: 导出文档（Word/PDF/HTML）\n';
  yaml += `    spec2doc: ${os?.spec2doc ?? 'auto'}\n`;
  yaml += '  # ── 命名流水线（preset + 自定义 + 默认）──\n';
  yaml += '  pipelines:\n';
  yaml += '    # default: 默认流水线名（内置 full/import/analyze/develop/deliver/deploy/docs 或自定义名）\n';
  yaml += `    default: ${config.settings.pipelines?.default ?? 'full'}\n`;
  yaml += '    # custom: 用户自定义命名流水线（名称: 逗号分隔的阶段串）\n';
  const customs = config.settings.pipelines?.custom || {};
  const customKeys = Object.keys(customs);
  if (customKeys.length > 0) {
    yaml += '    custom:\n';
    for (const k of customKeys) {
      yaml += `      ${k}: ${customs[k]}\n`;
    }
  } else {
    // v8.3.259: 输出实际空键（此前仅注释示例，YAML 解析为 null）
    yaml += '    # custom 示例: my-flow: analyze,validate,split,plan,execute\n';
    yaml += '    custom: {}\n';
  }
  yaml += '  # ── 流水线 review 闸口模式 ──\n';
  yaml += '  #   manual = 闸口 A/B/C 都软停人工确认（默认，最安全）\n';
  yaml += '  #   auto   = 三闸口都跳过（含 C 部署，自动执行，谨慎）\n';
  yaml += '  gates:\n';
  yaml += `    mode: ${config.settings.gates?.mode ?? 'manual'}\n`;
  yaml += '  # ── 冒烟测试统一配置（三时机开关 + 范围 + 按环境差异化）──\n';
  yaml += '  smoke:\n';
  const smokePts = config.settings.smoke?.points || {};
  yaml += `    points:\n`;
  yaml += `      local: ${smokePts.local ?? 'auto'}        # ①本地冒烟（开发完成后、提交前）\n`;
  yaml += `      pre-deploy: ${smokePts['pre-deploy'] ?? 'auto'}  # ②部署前冒烟（critical 阻断）\n`;
  yaml += `      post-deploy: ${smokePts['post-deploy'] ?? 'auto'} # ③环境冒烟（只报告）\n`;
  yaml += `    scope: ${config.settings.smoke?.scope ?? 'module'}    # full=全量 / module=当前功能模块\n`;
  const scopeByEnv = config.settings.smoke?.scope_by_env || {};
  const envKeys = Object.keys(scopeByEnv);
  if (envKeys.length > 0) {
    yaml += '    scope_by_env:\n';
    for (const k of envKeys) {
      yaml += `      ${k}: ${scopeByEnv[k]}\n`;
    }
  } else {
    // v8.3.259: 输出实际空键（此前仅注释示例，导致 upgrade 反复假补全）
    yaml += '    # scope_by_env 示例: dev: module / production: full\n';
    yaml += '    scope_by_env: {}\n';
  }
  yaml += '  # ── AI 内容生成来源 ──\n';
  yaml += '  #   host = 宿主 AI（Qoder SDK / Headless，默认）\n';
  yaml += '  #   llm  = 自配 LLM（走下方 providers 池）\n';
  yaml += '  #   auto = 宿主优先，失败回退自配 LLM\n';
  yaml += '  ai:\n';
  yaml += `    provider: ${config.settings.ai?.provider ?? 'host'}\n`;
  const aiProviders = config.settings.ai?.providers || [];
  if (aiProviders.length > 0) {
    yaml += '    # providers: 自配 LLM 池（定义一次，各功能按 name 引用；支持 ollama/openai/anthropic/custom）\n';
    yaml += '    providers:\n';
    for (const p of aiProviders) {
      yaml += `      - name: ${p.name}\n`;
      yaml += `        enabled: ${p.enabled !== false}\n`;
      yaml += `        type: ${p.type}\n`;
      yaml += `        endpoint: ${p.endpoint}\n`;
      yaml += `        model: ${p.model}\n`;
      if (p.apiKey) yaml += `        apiKey: ${p.apiKey}\n`;
      yaml += `        priority: ${p.priority ?? 1}\n`;
    }
  } else {
    // v8.3.259: 输出实际空键（此前仅注释示例，导致 upgrade 反复假补全）
    yaml += '    # providers 示例: 本地 Ollama + 云端\n';
    yaml += '    #   - name: local\n';
    yaml += '    #     type: ollama\n';
    yaml += '    #     endpoint: http://localhost:11434\n';
    yaml += '    #     model: qwen2.5:7b\n';
    yaml += '    #     priority: 1\n';
    yaml += '    providers: []\n';
  }
  const aiDefaults = config.settings.ai?.defaults || {};
  const aiDefaultKeys = Object.keys(aiDefaults);
  if (aiDefaultKeys.length > 0) {
    yaml += '    # defaults: 各功能的默认 provider name（analyze/taskify/execute/split/ask）\n';
    yaml += '    defaults:\n';
    for (const k of aiDefaultKeys) {
      yaml += `      ${k}: ${aiDefaults[k]}\n`;
    }
  } else {
    // v8.3.259: 输出实际空键（此前仅注释示例，导致 upgrade 反复假补全）
    yaml += '    # defaults 示例: analyze: gpt4o / taskify: local\n';
    yaml += '    defaults: {}\n';
  }
  if (config.settings.ai?.fallback) {
    yaml += `    fallback: ${config.settings.ai.fallback}\n`;
  } else {
    // v8.3.259: 输出实际空键（此前仅注释示例，导致 upgrade 反复假补全）
    yaml += '    # fallback: 兜底 provider name（可选）\n';
    yaml += "    fallback: ''\n";
  }
  yaml += '  # ── 子 Agent SDK 派单（v8.3.301+，第七层「窗口物理隔离」增强通道）──\n';
  yaml += '  #   auto = Qoder 宿主 + token 可用（PAT 环境变量或 CLI 登录态）时启用（默认）\n';
  yaml += '  #   on   = 强制尝试 SDK 派单（token 不可用也尝试，失败回退标记模式）\n';
  yaml += '  #   off  = 禁用 SDK 派单，永远走标记模式（代码内容经主会话窗口）\n';
  yaml += '  agent_dispatch:\n';
  yaml += `    mode: ${config.settings.agent_dispatch?.mode ?? 'auto'}\n`;


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
      yaml += '    # 提供商名称\n';
      yaml += `    - name: ${p.name}\n`;
      yaml += `      # 是否启用\n`;
      yaml += `      enabled: ${p.enabled}\n`;
      yaml += `      # 类型：ollama | openai | anthropic | custom\n`;
      yaml += `      type: ${p.type}\n`;
      yaml += `      # API 端点地址\n`;
      yaml += `      endpoint: ${p.endpoint}\n`;
      yaml += `      # 模型名称\n`;
      yaml += `      model: ${p.model}\n`;
      if (p.apiKey) {
        yaml += `      # API Key（可选，默认从环境变量读取）\n`;
        yaml += `      apiKey: ${p.apiKey}\n`;
      }
      yaml += `      # 优先级（数字越小优先级越高）\n`;
      yaml += `      priority: ${p.priority}\n`;
    }
  } else {
    yaml += '  # ── LLM 提供商（可选，默认空）──\n';
    yaml += '  llm_providers: []\n';
  }

  // tools 配置
  yaml += '\n# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += '# 外部工具路径（v8.3.71+）\n';
  yaml += '# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += '# 当 which/where 命令无法找到 pandoc/libreoffice 时（如非标准安装路径），\n';
  yaml += '# 可在此手动指定可执行文件的绝对路径。\n';
  yaml += '# 配置优先级：配置路径 > 系统 PATH 查找 > 常见安装位置兜底\n';
  yaml += 'tools:\n';
  yaml += '  # pandoc: 用于 doc2spec（Word→Markdown）和 spec2doc（Markdown→Word/PDF）\n';
  yaml += `  pandoc: ${config.tools?.pandoc || '""'}\n`;
  yaml += '  # libreoffice: 用于 .doc 格式转换（可选）\n';
  yaml += `  libreoffice: ${config.tools?.libreoffice || '""'}\n`;

  if (config.config_history.length > 0) {
    yaml += '\n# ── 配置升级历史（自动生成）──\n';
    yaml += 'config_history:\n';
    for (const h of config.config_history) {
      yaml += '  # 升级日期\n';
      yaml += `  - date: ${h.date}\n`;
      yaml += `    # 变更说明\n`;
      yaml += `    change: ${h.change}\n`;
      if (h.changed_by) {
        yaml += `    # 操作人\n`;
        yaml += `    changed_by: ${h.changed_by}\n`;
      }
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
  yaml += `schema_version: ${config.schema_version}\n`;
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
  yaml += '#   description         → 工程名（人类可读的业务名称，如 "预订服务"）\n';
  yaml += '#   project_name        → 项目名称（给人和 AI 看的业务名称，如"食堂后台管理"）\n';
  yaml += '#   project_desc        → 项目描述：工程的详细说明，补充信息\n';
  yaml += '#   code_path           → 工程源码路径（相对于项目根目录）\n';
  yaml += '#   git_repo            → Git 仓库地址（用于分支管理和 PR 提交）\n';
  yaml += '#   branch_prefix       → 端级分支前缀（覆盖全局 git.branch_prefix，可选）\n';
  yaml += '#   protected_branches  → 端级受保护分支（覆盖全局 git.protected_branches，可选）\n';
  yaml += '#   requirement_unit    → 涉及需求端：需求文档名称/标识（如"订单系统PRD"），仅作 AI 参考，不做校验\n';
  yaml += '#   notes               → 备注：额外信息、特殊说明\n';
  if (config.platforms.length === 0) {
    // v8.3.260: 空时输出实际空键（此前 platforms: 后仅注释示例，YAML 解析为 null，会触发假补全）
    yaml += 'platforms: []\n';
    yaml += '# 示例：添加你的第一个工程（替换上面的 [] 为下方内容）\n';
  } else {
    yaml += 'platforms:\n';
  }
  if (config.platforms.length === 0) {
    yaml += '  # - name: api-service\n';
    yaml += '  #   type: backend\n';
    yaml += '  #   description: API 服务\n';
    yaml += '  #   code_path: ./backend/api-service\n';
    yaml += '  #   git_repo: git@github.com:org/repo.git\n';
    yaml += '  #   default_branch: main\n';
    yaml += '  #   # 端级 Git 覆盖（可选，覆盖全局配置）\n';
    yaml += '  #   branch_prefix: feature/api-\n';
    yaml += '  #   protected_branches:\n';
    yaml += '  #     - main\n';
    yaml += '  #     - release/api-\n';
    yaml += '  #   requirement_unit: API 服务\n';
    yaml += '  #   # 部署配置（v8.3.60+）\n';
    yaml += '  #   # 完整示例见 templates/deploy-examples.yaml\n';
    yaml += '  #   deploy:\n';
    yaml += '  #     staging:\n';
    yaml += '  #       type: ssh\n';
    yaml += '  #       build_cmd: mvn clean package -DskipTests\n';
    yaml += '  #       output_dir: target\n';
    yaml += '  #       host: deployer@staging-server.com:22\n';
    yaml += '  #       key: ~/.ssh/id_rsa\n';
    yaml += '  #       remote_dir: /opt/services/api-service\n';
    yaml += '  #       script: sudo systemctl restart api-service\n';
    yaml += '  #     production:\n';
    yaml += '  #       type: docker\n';
    yaml += '  #       dockerfile: ./Dockerfile\n';
    yaml += '  #       registry: registry.example.com\n';
    yaml += '  #       image: my-project/api-service\n';
    yaml += '  #       tag: production\n';
    yaml += '  #       host: deployer@prod-server.com\n';
    yaml += '  #       script: docker pull registry.example.com/my-project/api-service:production && docker stop api-service 2>/dev/null; docker rm api-service 2>/dev/null; docker run -d --name api-service --restart always -p 8080:8080 registry.example.com/my-project/api-service:production\n';
  }
  for (const p of config.platforms) {
    yaml += `  - # 工程标识（全局唯一，用于目录名、命令参数）\n`;
    yaml += `    name: ${p.name}\n`;
    yaml += `    # 工程类型：frontend(前端) | backend(后端) | infra(基础设施)\n`;
    yaml += `    type: ${p.type}\n`;
    if (p.description) {
      yaml += `    # 工程名（人类可读的业务名称）\n`;
      yaml += `    description: ${p.description}\n`;
    }
    if (p.project_name) {
      yaml += `    # 项目名称（给人和 AI 看的业务名称，如"食堂后台管理"）\n`;
      yaml += `    project_name: ${p.project_name}\n`;
    }
    if (p.project_desc) {
      yaml += `    # 项目描述：工程的详细说明，补充信息\n`;
      yaml += `    project_desc: ${p.project_desc}\n`;
    }
    if (p.code_path) {
      yaml += `    # 源码路径（相对于项目根目录）\n`;
      yaml += `    code_path: ${p.code_path}\n`;
    }
    if (p.git_repo) {
      yaml += `    # Git 仓库地址（用于分支管理和 PR 提交）\n`;
      yaml += `    git_repo: ${p.git_repo}\n`;
    }
    // v8.3.299: default_branch 改为条件输出（旧文件缺该字段时不再写盘 "undefined"）
    if (p.default_branch) {
      yaml += `    # 默认分支（如 main, develop）\n`;
      yaml += `    default_branch: ${p.default_branch}\n`;
    }
    if (p.branch_prefix) {
      yaml += `    # 端级分支前缀（覆盖全局 git.branch_prefix）\n`;
      yaml += `    branch_prefix: ${p.branch_prefix}\n`;
    }
    if (p.protected_branches && p.protected_branches.length > 0) {
      yaml += `    # 端级受保护分支（覆盖全局 git.protected_branches）\n`;
      yaml += `    protected_branches:\n`;
      for (const b of p.protected_branches) {
        yaml += `      - ${b}\n`;
      }
    }
    if (p.requirement_unit) {
      yaml += `    # 涉及需求端/功能单元（AI 分析时自动对标）\n`;
      yaml += `    requirement_unit: ${p.requirement_unit}\n`;
    }
    if (p.notes) {
      yaml += `    # 备注：额外信息、特殊说明\n`;
      yaml += `    notes: ${p.notes}\n`;
    }
    // deploy 配置输出
    if (p.deploy && Object.keys(p.deploy).length > 0) {
      yaml += `    # 部署配置（v8.3.60+）\n`;
      yaml += `    # 完整示例见 templates/deploy-examples.yaml\n`;
      yaml += `    deploy:\n`;
      for (const [envName, envConfig] of Object.entries(p.deploy)) {
        if (!envConfig) continue;
        yaml += `      ${envName}:\n`;
        yaml += `        # 部署类型：ssh | sftp | static | script | docker | pm2 | k8s | helm | vercel | serverless\n`;
        yaml += `        type: ${envConfig.type}\n`;
        if (envConfig.build_cmd) {
          yaml += `        # 构建命令（如 npm run build、mvn clean package）\n`;
          yaml += `        build_cmd: ${envConfig.build_cmd}\n`;
        }
        if (envConfig.output_dir) {
          yaml += `        # 构建输出目录（默认 dist，Java 项目通常为 target）\n`;
          yaml += `        output_dir: ${envConfig.output_dir}\n`;
        }
        if (envConfig.dockerfile) {
          yaml += `        # Dockerfile 路径（docker 类型用）\n`;
          yaml += `        dockerfile: ${envConfig.dockerfile}\n`;
        }
        if (envConfig.registry) {
          yaml += `        # 镜像仓库地址（docker 类型用）\n`;
          yaml += `        registry: ${envConfig.registry}\n`;
        }
        if (envConfig.image) {
          yaml += `        # 镜像名（docker 类型用，默认使用端名）\n`;
          yaml += `        image: ${envConfig.image}\n`;
        }
        if (envConfig.tag) {
          yaml += `        # 镜像标签（docker 类型用，默认使用环境名）\n`;
          yaml += `        tag: ${envConfig.tag}\n`;
        }
        if (envConfig.host) {
          yaml += `        # 服务器地址（ssh/sftp/docker 远程部署用，格式 user@host:port）\n`;
          yaml += `        host: ${envConfig.host}\n`;
        }
        if (envConfig.key) {
          yaml += `        # SSH 私钥路径（默认 ~/.ssh/id_rsa）\n`;
          yaml += `        key: ${envConfig.key}\n`;
        }
        if (envConfig.password) {
          yaml += `        # SSH/SFTP 密码（需安装 sshpass，优先使用密钥认证）\n`;
          yaml += `        password: ${envConfig.password}\n`;
        }
        if (envConfig.remote_dir) {
          yaml += `        # 服务器上的部署目录\n`;
          yaml += `        remote_dir: ${envConfig.remote_dir}\n`;
        }
        if (envConfig.script) {
          yaml += `        # 部署后执行的命令或脚本路径\n`;
          yaml += `        script: ${envConfig.script}\n`;
        }
        if (envConfig.target) {
          yaml += `        # 目标路径 / namespace / 函数名（static/k8s/helm/serverless 用）\n`;
          yaml += `        target: ${envConfig.target}\n`;
        }
        if (envConfig.pm2_config) {
          yaml += `        # PM2 配置文件路径（pm2 类型用，默认 ecosystem.config.js）\n`;
          yaml += `        pm2_config: ${envConfig.pm2_config}\n`;
        }
        if (envConfig.provider) {
          yaml += `        # Serverless 提供商（aliyun-fc | aws-lambda | tencent-scf）\n`;
          yaml += `        provider: ${envConfig.provider}\n`;
        }
        if (envConfig.pre_deploy && envConfig.pre_deploy.length > 0) {
          yaml += `        # 部署前执行的命令\n`;
          yaml += `        pre_deploy:\n`;
          for (const cmd of envConfig.pre_deploy) {
            yaml += `          - ${cmd}\n`;
          }
        }
        if (envConfig.post_deploy && envConfig.post_deploy.length > 0) {
          yaml += `        # 部署后执行的命令\n`;
          yaml += `        post_deploy:\n`;
          for (const cmd of envConfig.post_deploy) {
            yaml += `          - ${cmd}\n`;
          }
        }
      }
    }
  }

  yaml += '\n# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += '# Git 配置\n';
  yaml += '# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += '# 说明：\n';
  yaml += '#   - 本段为 Git 配置权威源：任务分支源分支（taskify 落盘子任务 git-config）、\n';
  yaml += '#     PR 目标分支（pr 命令回退）、保护分支（pr/execute 合并判定）均从这里读取\n';
  yaml += '#   - 端级可覆盖：在 platforms[].default_branch / branch_prefix / protected_branches / branch_types\n';
  yaml += '#   - 子任务可覆盖：在 Task-*/{端}/{子任务}/.meta/git-config 中配置\n';
  yaml += 'git:\n';
  yaml += '  # 默认基础分支（PR 合并目标、创建分支的默认源分支）\n';
  yaml += `  default_base: ${config.git.default_base}\n`;
  yaml += '  # 功能分支前缀（旧语义，兼容保留）\n';
  yaml += `  branch_prefix: ${config.git.branch_prefix}\n`;
  yaml += '  # 受保护分支（禁止直接 push，只能通过 PR 合并）\n';
  yaml += '  # 支持通配符：如 release/* 匹配 release/1.0.0\n';
  yaml += '  protected_branches:\n';
  for (const b of config.git.protected_branches) {
    yaml += `    - ${b}\n`;
  }
  // v8.3.115+: 分支类型注释增强
  if (config.git.branch_types && Object.keys(config.git.branch_types).length > 0) {
    yaml += '  # 分支类型定义。分支名格式: {类型}/{前缀}-{任务名}-{后缀}\n';
    yaml += '  #   - prefix: 任务名前的前缀（可选），如 api-、backend-\n';
    yaml += '  #   - suffix: 任务名后的后缀（可选），如 urgent、review\n';
    yaml += '  #   - source: 创建源分支，如 develop、main\n';
    yaml += '  # 示例：hotfix 类型 + prefix=api- + suffix=urgent + 任务名=Task-001\n';
    yaml += '  #       → 分支名: hotfix/api-Task-001-urgent\n';
    yaml += '  branch_types:\n';
    for (const [typeName, typeDef] of Object.entries(config.git.branch_types)) {
      yaml += `    ${typeName}:\n`;
      if (typeDef.prefix) {
        yaml += `      # 任务前前缀（可选）\n`;
        yaml += `      prefix: ${typeDef.prefix}\n`;
      }
      if (typeDef.suffix) {
        yaml += `      # 任务后后缀（可选）\n`;
        yaml += `      suffix: ${typeDef.suffix}\n`;
      }
      yaml += `      # 创建源分支\n`;
      yaml += `      source: ${typeDef.source}\n`;
    }
  }

  yaml += '\n# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += '# 代码扫描范围\n';
  yaml += '# ─────────────────────────────────────────────────────────────────────────────\n';
  yaml += '# AI 全局分析时扫描的源码目录\n';
  yaml += 'code_scope:\n';
  for (const s of config.code_scope) {
    yaml += `  - ${s}\n`;
  }

  // v8.3.299: verify 段补写（v8.3.58+ 字段此前未序列化输出，升级后该配置会丢）
  if (config.verify && config.verify.router_file) {
    yaml += '\n# ─────────────────────────────────────────────────────────────────────────────\n';
    yaml += '# 验证配置（v8.3.58+）\n';
    yaml += '# ─────────────────────────────────────────────────────────────────────────────\n';
    yaml += '# router_file: 显式指定前端路由配置文件路径（覆盖自动发现）\n';
    yaml += 'verify:\n';
    yaml += `  router_file: ${config.verify.router_file}\n`;
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
