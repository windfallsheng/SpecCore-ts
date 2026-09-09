/**
 * config — 配置管理命令
 * v8.3.25+: 统一使用 .speccore.yml，支持 --list / --upgrade
 */
import { pathExists, readFile, writeFile, ensureDir } from 'fs-extra';
import { logger, Spinner } from '../utils/logger';
import {
  loadConfig,
  loadConfigWithMeta,
  upgradeConfig,
  upgradeProjectConfig,
  saveConfig,
  loadProjectConfigWithMeta,
  DEFAULT_CONFIG,
  type SpecConfig,
} from '../core/unified-config';

export interface ConfigOptions {
  get?: string;
  set?: string;
  list?: boolean;
  upgrade?: boolean;
  project?: boolean;
  rule?: string;
  tech?: string;
}

/**
 * Install Git hooks (pre-commit + pre-push)
 * v8.3.88+: 支持 speccore 与工程代码分离，自动读取 PROJECT.yaml code_path
 */
export async function installHooks(): Promise<void> {
  try {
    const { installGitHooks } = require('../core/git-integration');
    const { loadProjectConfig } = require('../core/unified-config');
    const { join, isAbsolute } = require('path');

    let gitCwd = process.cwd();
    try {
      const pc = await loadProjectConfig();
      const firstPlatformWithPath = pc.platforms.find((p: any) => p.code_path);
      if (firstPlatformWithPath?.code_path) {
        gitCwd = isAbsolute(firstPlatformWithPath.code_path)
          ? firstPlatformWithPath.code_path
          : join(process.cwd(), firstPlatformWithPath.code_path);
      } else if (pc.code_scope?.[0]) {
        gitCwd = isAbsolute(pc.code_scope[0])
          ? pc.code_scope[0]
          : join(process.cwd(), pc.code_scope[0]);
      }
    } catch {}

    const result = installGitHooks(gitCwd);
    logger.success('Git hooks installed:');
    if (result.preCommit) logger.info('  .git/hooks/pre-commit  (check @spec annotations)');
    if (result.prePush) logger.info('  .git/hooks/pre-push    (run speccore validate)');
  } catch (error) {
    logger.error('Failed to install Git hooks: ' + error);
  }
}

export async function configCommand(options: ConfigOptions): Promise<void> {
  const spinner = new Spinner('Processing configuration');
  spinner.start();

  try {
    // --upgrade: 升级配置结构
    if (options.upgrade) {
      spinner.stop();
      if (options.project) {
        await upgradeProjectConfig();
      } else {
        await upgradeConfig();
      }
      return;
    }

    // --list: 列出所有配置
    if (options.list) {
      spinner.stop();
      if (options.project) {
        await printProjectConfigList();
      } else {
        await printConfigList();
      }
      return;
    }

    // --get: 读取配置项
    if (options.get) {
      const config = await loadConfig();
      const value = getValueByPath(config, options.get);
      spinner.stop(value !== undefined ? `${options.get} = ${JSON.stringify(value)}` : `${options.get}: Not set`);
      return;
    }

    // --set: 设置配置项
    if (options.set) {
      spinner.stop();
      await handleSet(options.set);
      return;
    }

    // CONSTITUTION.md spec-rule 配置（保留旧功能）
    if (options.rule && options.set) {
      spinner.stop();
      await setSpecRule(options.rule, options.set);
      return;
    }

    // TECH_STACK.md 技术栈配置（保留旧功能）
    if (options.tech && options.set) {
      spinner.stop();
      await setTechStack(options.tech, options.set);
      return;
    }

    // 无参数：显示帮助
    spinner.stop();
    printHelp();
  } catch (error) {
    spinner.fail(`Config operation failed: ${error}`);
    throw error;
  }
}

// ─────────────────────────────────────────
// --list: 列出所有配置项
// ─────────────────────────────────────────

async function printConfigList(): Promise<void> {
  const { config, warnings } = await loadConfigWithMeta();

  logger.info('\n⚙️  .speccore.yml 系统配置列表\n');

  // schema_version
  logger.info(`schema_version: ${config.schema_version}`);

  // quality_gates
  logger.info('quality_gates:');
  logger.info(`  enforce_testing: ${config.quality_gates.enforce_testing}`);
  logger.info(`  enforce_review: ${config.quality_gates.enforce_review}`);
  logger.info(`  require_pr: ${config.quality_gates.require_pr}`);

  // arbitration
  logger.info('arbitration:');
  logger.info(`  enabled: ${config.arbitration.enabled}`);
  logger.info(`  mode: ${config.arbitration.mode}`);

  // settings
  logger.info('settings:');
  logger.info(`  assignee.enabled: ${config.settings.assignee.enabled}`);
  logger.info(`  assignee.mode: ${config.settings.assignee.mode}`);
  logger.info(`  trace.enabled: ${config.settings.trace.enabled}`);
  logger.info(`  patterns.auto_save: ${config.settings.patterns.auto_save}`);
  logger.info(`  plan.parallel_suggest: ${config.settings.plan.parallel_suggest}`);
  logger.info(`  sync.auto_check: ${config.settings.sync.auto_check}`);
  logger.info(`  validation.strict_mode: ${config.settings.validation.strict_mode}`);
  logger.info(`  archive.auto_cleanup: ${config.settings.archive.auto_cleanup}`);
  logger.info(`  review.check_assignee: ${config.settings.review.check_assignee}`);

  // ask
  logger.info('ask.routing.mode: ' + config.ask.routing.mode);
  logger.info(`ask.llm_providers: ${config.ask.llm_providers.length} 个`);

  if (warnings.length > 0) {
    logger.info('\n⚠️  配置警告:');
    for (const w of warnings) logger.info(`  ${w}`);
  }

  logger.info('\n💡 使用 speccore config --get <path> 查看具体值');
  logger.info('💡 使用 speccore config --upgrade 升级系统配置');
  logger.info('💡 使用 speccore config --list --project 查看项目配置');
  logger.info('💡 完整配置参考见 docs/config-reference.md\n');
}

async function printProjectConfigList(): Promise<void> {
  const { config, warnings } = await loadProjectConfigWithMeta();

  logger.info('\n📁 .speccore/PROJECT.yaml 项目配置列表\n');

  // schema_version
  logger.info(`schema_version: ${config.schema_version}`);

  // project
  logger.info(`project.name: ${config.project.name}`);
  if (config.project.description) {
    logger.info(`project.description: ${config.project.description}`);
  }
  if (config.project.version) {
    logger.info(`project.version: ${config.project.version}`);
  }

  // platforms
  if (config.platforms.length > 0) {
    logger.info(`platforms: ${config.platforms.map(p => p.name).join(', ')}`);
  } else {
    logger.info('platforms: (空)');
  }

  // git
  logger.info('git:');
  logger.info(`  default_base: ${config.git.default_base}`);
  logger.info(`  branch_prefix: ${config.git.branch_prefix}`);
  logger.info(`  protected_branches: [${config.git.protected_branches.join(', ')}]`);

  // code_scope
  logger.info(`code_scope: [${config.code_scope.join(', ')}]`);

  if (warnings.length > 0) {
    logger.info('\n⚠️  配置警告:');
    for (const w of warnings) logger.info(`  ${w}`);
  }

  logger.info('\n💡 使用 speccore config --upgrade --project 升级项目配置');
  logger.info('💡 完整配置参考见 docs/config-reference.md\n');
}

// ─────────────────────────────────────────
// --set: 设置配置项
// ─────────────────────────────────────────

async function handleSet(setExpr: string): Promise<void> {
  // 支持两种格式: --set key=value 或 --set key value（由 CLI parser 处理）
  const eqIndex = setExpr.indexOf('=');
  if (eqIndex === -1) {
    logger.error('格式错误。使用: speccore config --set key=value');
    logger.info('  示例: speccore config --set arbitration.mode=l1-only');
    return;
  }

  const key = setExpr.slice(0, eqIndex).trim();
  const rawValue = setExpr.slice(eqIndex + 1).trim();

  const config = await loadConfig();
  const value = parseSetValue(rawValue);

  if (!setValueByPath(config, key, value)) {
    logger.error(`未知配置项: ${key}`);
    logger.info('  使用 speccore config --list 查看所有配置项');
    return;
  }

  await saveConfig(config);
  logger.success(`已设置: ${key} = ${JSON.stringify(value)}`);
}

function parseSetValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  const num = Number(raw);
  if (!isNaN(num) && raw !== '') return num;
  return raw;
}

// ─────────────────────────────────────────
// 路径操作（点号路径）
// ─────────────────────────────────────────

function getValueByPath(obj: object, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setValueByPath(obj: object, path: string, value: unknown): boolean {
  const parts = path.split('.');
  let current: unknown = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current === null || current === undefined) return false;
    if (typeof current !== 'object') return false;
    current = (current as Record<string, unknown>)[part];
  }

  const lastPart = parts[parts.length - 1];
  if (current === null || current === undefined) return false;
  if (typeof current !== 'object') return false;

  // 检查字段是否存在于 DEFAULT_CONFIG 中（防止写入任意字段）
  const defaultValue = getValueByPath(DEFAULT_CONFIG as unknown as object, path);
  if (defaultValue === undefined && !isValidDynamicPath(path)) {
    return false;
  }

  (current as Record<string, unknown>)[lastPart] = value;
  return true;
}

function isValidDynamicPath(path: string): boolean {
  // 允许动态路径，如 platforms[0].name
  return path.startsWith('platforms') || path.startsWith('git');
}

// ─────────────────────────────────────────
// 帮助信息
// ─────────────────────────────────────────

function printHelp(): void {
  logger.info('\n⚙️  speccore config — 配置管理\n');
  logger.info('用法:');
  logger.info('  speccore config --list                    列出系统配置（.speccore.yml）');
  logger.info('  speccore config --list --project          列出项目配置（.speccore/PROJECT.yaml）');
  logger.info('  speccore config --get <path>              读取配置项');
  logger.info('  speccore config --set <path>=<value>      设置配置项');
  logger.info('  speccore config --upgrade                 升级系统配置结构');
  logger.info('  speccore config --upgrade --project       升级项目配置结构');
  logger.info('');
  logger.info('示例:');
  logger.info('  speccore config --get arbitration.mode');
  logger.info('  speccore config --set arbitration.mode=l1-only');
  logger.info('  speccore config --set settings.patterns.auto_save=off');
  logger.info('');
  logger.info('完整配置参考: docs/config-reference.md\n');
}

// ============================================================
// CONSTITUTION.md spec-rule 写入（保留旧功能）
// ============================================================
const CONSTITUTION_PATH = '.speccore/CONSTITUTION.md';

async function setSpecRule(ruleName: string, value: string): Promise<void> {
  if (!(await pathExists(CONSTITUTION_PATH))) {
    logger.error('CONSTITUTION.md 不存在，请先运行 speccore init');
    return;
  }

  let content = await readFile(CONSTITUTION_PATH, 'utf-8');
  const normalized = normalizeRuleValue(ruleName, value);
  const ruleBlock = `<!-- spec-rule: ${ruleName} -->\n- ${normalized}\n<!-- /spec-rule -->`;

  const ruleRegex = new RegExp(`<!--\\s*spec-rule:\\s*${ruleName}\\s*-->[\\s\\S]*?<!--\\s*/spec-rule\\s*-->`, 'i');
  if (ruleRegex.test(content)) {
    content = content.replace(ruleRegex, ruleBlock);
    logger.info(`已更新 spec-rule: ${ruleName}`);
  } else {
    if (content.includes('## 代码规范')) {
      content = content.replace(/(## 代码规范[^\n]*\n)/, `$1${ruleBlock}\n`);
    } else {
      content += `\n\n## 代码规范\n\n${ruleBlock}\n`;
    }
    logger.info(`已新增 spec-rule: ${ruleName}`);
  }

  await writeFile(CONSTITUTION_PATH, content);
  logger.info(`  规则: ${ruleName} → "${normalized}"`);
  logger.info('  💡 下次 speccore execute 将自动应用此规则');
}

function normalizeRuleValue(ruleName: string, value: string): string {
  let v = value.replace(/[了啦啊呢嗯哈哦]$/, '').trim();
  v = v.replace(/^(改成|换成?|用|用的是|统一用|使用)\s*/i, '').trim();

  switch (ruleName) {
    case 'exception-handler':
      return `统一异常: ${v}`;
    case 'response-format':
      return `统一返回: ${v}`;
    case 'orm':
      return `ORM 框架: ${v}`;
    case 'naming':
      return v;
    case 'validation':
      return `参数校验: ${v}`;
    default:
      return v;
  }
}

// ============================================================
// TECH_STACK.md 技术栈写入（保留旧功能）
// ============================================================
const TECH_STACK_PATH_NEW = '.speccore/GLOBAL/overview/TECH_STACK.md';
const TECH_STACK_PATH_LEGACY = '.speccore/GLOBAL/TECH_STACK.md';

async function resolveTechStackPath(): Promise<string | null> {
  if (await pathExists(TECH_STACK_PATH_NEW)) return TECH_STACK_PATH_NEW;
  if (await pathExists(TECH_STACK_PATH_LEGACY)) return TECH_STACK_PATH_LEGACY;
  return null;
}

async function setTechStack(target: string, value: string): Promise<void> {
  const techStackPath = await resolveTechStackPath();
  if (!techStackPath) {
    logger.error('TECH_STACK.md 不存在，请先运行 speccore init');
    return;
  }

  let content = await readFile(techStackPath, 'utf-8');
  const tag = `tech-stack: ${target}`;
  const entry = `<!-- ${tag} -->\n- ${value}\n<!-- /tech-stack -->`;
  const regex = new RegExp(`<!--\\s*${tag}\\s*-->[\\s\\S]*?<!--\\s*/tech-stack\\s*-->`, 'i');

  if (regex.test(content)) {
    content = content.replace(regex, entry);
    logger.info(`已更新技术栈: ${target}`);
  } else {
    logger.warn(`未找到 tech-stack: ${target} 区块，请在 TECH_STACK.md 中手动添加`);
  }

  await writeFile(TECH_STACK_PATH_NEW, content);
  logger.info(`  ${target}: ${value}`);
  logger.info('  💡 下次 speccore execute 将显示此技术栈');
}
