/**
 * deploy — 部署端到指定环境
 *
 * 封装 deploy-engine，提供 CLI 入口，支持单端/全量部署。
 */
import { execSync } from 'child_process';
import { join, isAbsolute } from 'path';
import { ensureDir, writeFile } from 'fs-extra';
import { logger, Spinner } from '../utils/logger';
import { loadProjectConfigWithEnv } from '../core/unified-config';
import { loadEnvironmentByNameOrPath } from '../core/environment-config';
import { resolvePlatformBranchDetailed } from '../core/deploy/branch-resolver';
import type { ResolvedBranch } from '../core/deploy/branch-resolver';
import { deployPlatform, rollbackPlatform, listBackups } from '../core/deploy/engine';
import type { DeployOptions as EngineDeployOptions, DeployResult } from '../core/deploy/engine';
import type { DeployEnvConfig, PlatformConfig } from '../core/unified-config';
import { appendDeployLedger } from '../core/deploy-ledger';
import { findProjectRoot } from '../utils/task-utils';

export interface DeployCliOptions {
  platform?: string;
  env?: string;
  dryRun?: boolean;
  skipBuild?: boolean;
  all?: boolean;
  envFile?: string;
  branch?: string;
  /** v8.3.348+: 部署前备份远端旧包（--backup / --no-backup，不传时用配置 backup 字段，默认开启） */
  backup?: boolean;
  /** v8.3.348+: 本次不备份的端名列表（逗号分隔，--skip-backup-for），优先级高于 --backup 与配置 backup 字段 */
  skipBackupFor?: string;
  /** v8.3.352+: 回滚到部署前备份（--rollback，配合 --backup-name 指定，默认最近一份） */
  rollback?: boolean;
  /** v8.3.352+: 列出远端备份清单（--list-backups，不执行任何变更） */
  listBackups?: boolean;
  /** v8.3.352+: 指定回滚的备份名（配合 --rollback；docker 传 .bak-* tag 名，k8s/helm 传 revision 号，ssh 传文件名） */
  backupName?: string;
}

/**
 * 计算某端本次的最终备份开关（v8.3.348+）。
 * 优先级：--skip-backup-for 端级排除 > --backup/--no-backup 全局开关 > 配置 backup 字段 > 默认开启。
 * 注：commander 对 --no- 前缀有取反特殊语义，端级排除参数刻意命名 skip-backup-for 避开。
 */
function resolveBackupFor(
  platformName: string,
  deployCfg: DeployEnvConfig | undefined,
  options: DeployCliOptions
): boolean {
  const excluded = (options.skipBackupFor || '')
    .split(/[,，、\s]+/)
    .map((n) => n.trim())
    .filter(Boolean);
  if (excluded.includes(platformName)) return false;
  return options.backup ?? deployCfg?.backup ?? true;
}

/** 部署配置 → 人类可读描述（计划面板用） */
function describeDeploy(deployCfg?: DeployEnvConfig): string {
  if (!deployCfg) return '未配置（跳过部署）';
  switch (deployCfg.type) {
    case 'docker': {
      const img = [deployCfg.registry, deployCfg.image].filter(Boolean).join('/') || '<端名>';
      const ref = `${img}:${deployCfg.tag || 'latest'}`;
      return deployCfg.host ? `docker ${ref} → ${deployCfg.host}` : `docker ${ref}`;
    }
    case 'static':
      return `static → ${deployCfg.target || deployCfg.output_dir || '（未配置目标）'}`;
    case 'ssh':
    case 'sftp':
      return `${deployCfg.type} → ${deployCfg.host || '?'}:${deployCfg.remote_dir || '?'}`;
    case 'script':
      return `script: ${deployCfg.script || '.speccore/environments/scripts/deploy.sh'}`;
    case 'vercel':
      return 'vercel（托管平台部署）';
    case 'k8s':
      return `k8s（namespace: ${deployCfg.target || 'default'}）`;
    case 'helm':
      return 'helm（chart 部署）';
    case 'pm2':
      return `pm2（${deployCfg.remote_dir ? `远程: ${deployCfg.remote_dir}` : deployCfg.pm2_config || 'ecosystem'}）`;
    case 'serverless':
      return `serverless（${deployCfg.provider || '默认提供商'}）`;
    default:
      return String(deployCfg.type);
  }
}

/** 透明执行 git 步骤（v8.3.348+）：checkout/pull 的实际反馈直接透出给用户 */
function runGitStep(cwd: string, cmd: string, label: string, dryRun: boolean): boolean {
  if (dryRun) {
    logger.info(`  [DRY-RUN] ${label}: ${cmd}`);
    return true;
  }
  try {
    logger.info(`  🌿 ${label}: ${cmd}`);
    execSync(cmd, { stdio: 'inherit', cwd });
    return true;
  } catch {
    logger.error(`  ❌ ${label}失败: ${cmd}`);
    return false;
  }
}

/**
 * 部署清单落盘（v8.3.350+）：部署成功后写 .speccore/local/deploy-manifest.json，
 * 供 verify --ai --scope deployed 筛出本次部署涉及的功能单元。
 */
async function writeDeployManifest(
  env: string,
  results: DeployResult[],
  targets: PlatformConfig[],
  dryRun: boolean
): Promise<void> {
  if (dryRun) return;
  const succeeded = results.filter((r) => r.success && !r.skipped);
  if (succeeded.length === 0) return;

  const projectRoot = findProjectRoot() || process.cwd();
  const platforms = [];
  for (const r of succeeded) {
    const target = targets.find((t) => t.name === r.platform);
    const cwd = target?.code_path
      ? (isAbsolute(target.code_path) ? target.code_path : join(projectRoot, target.code_path))
      : process.cwd();
    let commit: string | undefined;
    try {
      commit = execSync('git rev-parse --short HEAD', { cwd, stdio: 'pipe' }).toString().trim() || undefined;
    } catch { /* 非 git 目录静默 */ }
    platforms.push({ name: r.platform, type: r.type, git: { branch: r.branch, commit } });
  }

  const manifest = { env, time: new Date().toISOString(), platforms };
  const localDir = join(projectRoot, '.speccore', 'local');
  await ensureDir(localDir);
  await writeFile(join(localDir, 'deploy-manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  logger.info(`📋 部署清单已更新: .speccore/local/deploy-manifest.json（${platforms.length} 端，env: ${env}）`);
}

/**
 * 部署计划面板（v8.3.348+）：动手前把「端 → 分支 → 构建 → 部署目标」完整展示给用户。
 * 全部信息来自本次发起的实时配置读取（无缓存、不依赖记忆），用户临时改动当次生效。
 */
function printDeployPlan(
  targets: PlatformConfig[],
  env: string,
  branchMap: Map<string, ResolvedBranch | null>,
  options: DeployCliOptions
): void {
  logger.info('');
  logger.info('┌──────────────────────────────────────────────────────────────┐');
  logger.info('│  部署计划（实时配置快照，每次发起都会重新读取，不依赖记忆）      │');
  logger.info('├──────────────────────────────────────────────────────────────┤');
  targets.forEach((p, i) => {
    const resolved = branchMap.get(p.name);
    const branchText = resolved ? resolved.branch : '（未解析，使用当前工作区代码）';
    const sourceText = resolved ? `（来源: ${resolved.source}）` : '';
    const deployCfg = p.deploy?.[env];
    const buildCmd = deployCfg?.build_cmd || '（未配置）';
    logger.info(`│  ${i + 1}. ${p.name}`);
    logger.info(`│      分支 : ${branchText}${sourceText}`);
    logger.info(`│      构建 : ${buildCmd}${options.skipBuild ? '（--skip-build 跳过）' : ''}`);
    // 备份状态（仅远程覆盖型部署类型展示；sftp 无远端 shell 权限暂不支持）
    if (deployCfg && (deployCfg.type === 'ssh' || deployCfg.type === 'docker')) {
      const backupOn = resolveBackupFor(p.name, deployCfg, options);
      logger.info(`│      备份 : ${backupOn ? `开启（保留最近 ${deployCfg.backup_keep ?? 5} 份）` : '关闭（--no-backup 或配置 backup: false）'}`);
    }
    logger.info(`│      部署 : ${describeDeploy(deployCfg)}${options.dryRun ? '（--dry-run 预演）' : ''}`);
  });
  logger.info('└──────────────────────────────────────────────────────────────┘');
  logger.info('');
}

export async function deployCommand(options: DeployCliOptions): Promise<void> {
  // v8.3.352+: 回滚/备份清单子命令（只读/回退操作，不走部署主流程）
  if (options.listBackups) {
    await listBackupsCommand(options);
    return;
  }
  if (options.rollback) {
    await rollbackCommand(options);
    return;
  }

  // 纪律（v8.3.348+）：每次发起部署都实时读磁盘配置——PROJECT.yaml 与
  // .speccore/environments/{env}.yaml 当场重读，不做任何缓存、不依赖上一次
  // 执行或记忆中的旧值，用户临时改动的 branch / build_cmd / host 当次生效。
  const envConfig = await loadEnvironmentByNameOrPath(options.envFile || options.env || 'staging');
  const env = envConfig?.env || options.env || 'staging';
  const envInput = options.envFile || env;
  const config = await loadProjectConfigWithEnv(envInput);

  if (!config.platforms || config.platforms.length === 0) {
    logger.warn('⚠️ PROJECT.yaml 中未配置任何平台，请先添加 platforms 配置');
    return;
  }

  let targets: PlatformConfig[];

  if (options.platform) {
    const found = config.platforms.find((p) => p.name === options.platform);
    if (!found) {
      logger.error(`❌ 未找到平台: "${options.platform}"`);
      logger.info(`   可用平台: ${config.platforms.map((p) => p.name).join(', ')}`);
      process.exitCode = 1;
      return;
    }
    targets = [found];
  } else if (options.all) {
    targets = config.platforms;
  } else {
    logger.info('💡 请指定要部署的平台:');
    logger.info(`   speccore deploy --platform <平台名> --env <环境>`);
    logger.info(`   speccore deploy --all --env <环境>`);
    logger.info(`   可用平台: ${config.platforms.map((p) => p.name).join(', ')}`);
    return;
  }

  // 分支解析：每个端实时解析目标分支（显式 --branch 优先）
  const branchMap = new Map<string, ResolvedBranch | null>();
  for (const t of targets) {
    if (options.branch) {
      branchMap.set(t.name, { branch: options.branch, source: '--branch 显式指定' });
    } else {
      branchMap.set(t.name, resolvePlatformBranchDetailed(t, envConfig));
    }
  }

  // 计划面板：动手前完整展示「端 → 分支 → 构建 → 部署目标」
  printDeployPlan(targets, env, branchMap, options);

  const results: DeployResult[] = [];

  for (const platform of targets) {
    const projectRoot = findProjectRoot() || process.cwd();
    const cwd = platform.code_path
      ? (isAbsolute(platform.code_path) ? platform.code_path : join(projectRoot, platform.code_path))
      : process.cwd();

    const resolved = branchMap.get(platform.name);

    // 分支切换 + 拉取最新代码（git 反馈透明输出）
    if (resolved?.branch) {
      const checkoutOk = runGitStep(
        cwd,
        `git checkout "${resolved.branch}"`,
        `[${platform.name}] 切换分支 ${resolved.branch}`,
        !!options.dryRun
      );
      if (!checkoutOk) {
        results.push({
          success: false,
          platform: platform.name,
          env,
          type: 'none',
          duration: 0,
          message: `切换分支 ${resolved.branch} 失败`,
          branch: resolved.branch,
        });
        continue;
      }
      // 拉取该分支最新代码（失败不阻断：本地代码仍可构建）
      runGitStep(cwd, 'git pull', `[${platform.name}] 拉取最新代码`, !!options.dryRun);
    } else if (!options.dryRun) {
      logger.info(`  ⚠️  [${platform.name}] 未解析到目标分支，使用当前工作区代码`);
    }

    const spinner = new Spinner(`🚀 准备部署 ${platform.name} → ${env}...`);
    spinner.start();

    const engineOptions: EngineDeployOptions = {
      platform: platform.name,
      env,
      dryRun: options.dryRun || false,
      skipBuild: options.skipBuild || false,
      // 端级计算好的最终值（--no-backup-for > --backup/--no-backup > 配置 backup 字段），
      // 不传 undefined，避免引擎再走一遍配置回退逻辑
      backup: resolveBackupFor(platform.name, platform.deploy?.[env], options),
    };

    try {
      const result = await deployPlatform(platform, env, engineOptions);
      spinner.stop();
      result.branch = resolved?.branch; // 汇总报告展示实际分支
      results.push(result);

      if (result.skipped) {
        logger.info(`⏭️  [${result.platform}] ${result.message}`);
      } else if (result.success) {
        logger.success(`✅ [${result.platform}] ${result.message}`);
      } else {
        logger.error(`❌ [${result.platform}] ${result.message}`);
      }
    } catch (e: any) {
      spinner.stop();
      logger.error(`❌ [${platform.name}] 部署异常: ${e.message || e}`);
      results.push({
        success: false,
        platform: platform.name,
        env,
        type: 'unknown',
        duration: 0,
        message: `部署异常: ${e.message || e}`,
        branch: resolved?.branch,
      });
    }
  }

  // 汇总报告
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.length - successCount;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  logger.info('');
  logger.info('┌──────────────────────────────────────────┐');
  logger.info('│              部署汇总报告                │');
  logger.info('├──────────────────────────────────────────┤');
  for (const r of results) {
    const icon = r.success ? '✅' : '❌';
    const time = `(${(r.duration / 1000).toFixed(1)}s)`;
    const type = `[${r.type}]`;
    const branch = r.branch || '-';
    logger.info(`│ ${icon} ${r.platform.padEnd(12)} ${type.padEnd(10)} ${time.padEnd(10)} 分支: ${branch} │`);
  }
  logger.info('├──────────────────────────────────────────┤');
  logger.info(`│ 成功: ${String(successCount).padEnd(3)}  失败: ${String(failCount).padEnd(3)}  总计: ${String(results.length).padEnd(3)} │`);
  logger.info(`│ 总耗时: ${((totalDuration) / 1000).toFixed(1)}s`.padEnd(39) + '│');
  logger.info('└──────────────────────────────────────────┘');

  // v8.3.350+: 部署成功后落盘部署清单（支撑 verify --ai --scope deployed）
  await writeDeployManifest(env, results, targets, !!options.dryRun);

  // v8.3.352+: 部署后健康检查结果汇总展示（失败告警不阻断部署，但醒目提醒 + 写入问题账本）
  const unhealthy = results.filter((r) => r.health && !r.health.ok);
  if (unhealthy.length > 0) {
    logger.warn('');
    logger.warn('💔 部署后健康检查失败（服务已上线，请尽快处理）：');
    for (const r of unhealthy) {
      logger.warn(`   - [${r.platform}] ${r.health!.message}`);
      try {
        await appendDeployLedger({
          kind: 'health-check',
          platform: r.platform,
          env,
          type: r.type,
          message: r.health!.message,
        });
      } catch { /* 账本写入失败不阻断主流程 */ }
    }
    logger.warn(`📝 已写入部署问题账本: .speccore/local/deploy-ledger.md`);
  }

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

// ═══════════════════════════════════════════════════════════
// v8.3.352+ 回滚 / 备份清单子命令
// ═══════════════════════════════════════════════════════════

/** 解析目标端列表（与部署主流程同规则：--platform 单端 / --all 全端） */
async function resolveRollbackTargets(options: DeployCliOptions): Promise<PlatformConfig[]> {
  const envConfig = await loadEnvironmentByNameOrPath(options.envFile || options.env || 'staging');
  const envInput = options.envFile || envConfig?.env || options.env || 'staging';
  const config = await loadProjectConfigWithEnv(envInput);
  if (!config.platforms || config.platforms.length === 0) {
    throw new Error('PROJECT.yaml 中未配置任何平台');
  }
  if (options.platform) {
    const found = config.platforms.find((p) => p.name === options.platform);
    if (!found) {
      throw new Error(`未找到平台: "${options.platform}"，可用: ${config.platforms.map((p) => p.name).join(', ')}`);
    }
    return [found];
  }
  if (options.all) return config.platforms;
  throw new Error('请指定目标平台: --platform <端名> 或 --all');
}

/** 列出远端备份清单（docker .bak-* tag / ssh .bak-*.tar.gz / k8s rollout history / helm release history） */
async function listBackupsCommand(options: DeployCliOptions): Promise<void> {
  const env = options.env || 'staging';
  let targets: PlatformConfig[];
  try {
    targets = await resolveRollbackTargets(options);
  } catch (e: any) {
    logger.error(`❌ ${e.message || e}`);
    process.exitCode = 1;
    return;
  }

  let anyFailed = false;
  for (const platform of targets) {
    logger.info(`\n📋 [${platform.name}] ${env} 环境备份清单:`);
    try {
      const { type, backups } = await listBackups(platform, env);
      if (backups.length === 0) {
        logger.warn(`   （${type}）无备份记录——部署时若未开启备份（--no-backup），此处为空属正常`);
      } else {
        for (const b of backups) {
          logger.info(`   • ${b}`);
        }
      }
    } catch (e: any) {
      anyFailed = true;
      logger.error(`   ❌ ${e.message || e}`);
    }
  }
  if (anyFailed) process.exitCode = 1;
}

/** 回滚到部署前备份（默认最近一份，--backup-name 指定） */
async function rollbackCommand(options: DeployCliOptions): Promise<void> {
  const env = options.env || 'staging';
  let targets: PlatformConfig[];
  try {
    targets = await resolveRollbackTargets(options);
  } catch (e: any) {
    logger.error(`❌ ${e.message || e}`);
    process.exitCode = 1;
    return;
  }

  logger.info('\n⚠️  回滚操作将把远端恢复到部署前的备份版本，请确认:');
  logger.info(`   环境: ${env} | 目标端: ${targets.map((t) => t.name).join(', ')}${options.backupName ? ` | 指定备份: ${options.backupName}` : ' | 备份: 最近一份'}`);
  logger.info('');

  let anyFailed = false;
  for (const platform of targets) {
    const result = await rollbackPlatform(platform, env, {
      platform: platform.name,
      env,
      backupName: options.backupName,
      dryRun: !!options.dryRun,
    });
    if (result.success) {
      logger.success(`✅ [${result.platform}] ${result.message}`);
    } else {
      anyFailed = true;
      logger.error(`❌ [${result.platform}] ${result.message}`);
    }
  }
  if (anyFailed) process.exitCode = 1;
}
