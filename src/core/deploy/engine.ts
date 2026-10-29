/**
 * deploy-engine — 多策略部署引擎
 *
 * 支持 docker / static / script / vercel / k8s / ssh / helm / pm2 / serverless / sftp
 * 按端、按环境读取 PROJECT.yaml 配置执行部署
 *
 * v8.3.60+ 新增
 */

import { execSync, execFileSync } from 'child_process';
import { globSync } from 'glob';
import { pathExists, copySync, emptyDirSync } from 'fs-extra';
import { join, isAbsolute } from 'path';
import { logger, Spinner } from '../../utils/logger';
import type { DeployEnvConfig, PlatformConfig } from '../unified-config';
import { findProjectRoot } from '../../utils/task-utils';

/**
 * 参数数组化执行（v8.3.341+）：不带 shell 解释的命令一律走 execFileSync，
 * 配置值作为独立参数传递，杜绝「配置即命令」的注入面。
 * 仅用户显式书写的 shell 命令（build_cmd / script / pre_deploy 等）保留 execSync。
 */
const runFile = (file: string, args: string[], cwd: string): void => {
  execFileSync(file, args, { stdio: 'inherit', cwd });
};

export interface DeployOptions {
  platform: string;      // 端名，如 h5-mobile, api
  env: string;           // 环境，如 staging, production
  dryRun?: boolean;      // 仅预览，不实际执行
  skipBuild?: boolean;   // 跳过构建
  backup?: boolean;      // v8.3.348+: 部署前备份远端旧包（覆盖配置 backup 字段）
}

export interface DeployResult {
  success: boolean;
  platform: string;
  env: string;
  type: string;
  duration: number;
  message: string;
  skipped?: boolean;  // v8.3.97+: 未配置时跳过，非失败
  branch?: string;    // v8.3.348+: 实际使用的目标分支（由调用方赋值，汇总报告展示）
}

/**
 * 配置路径双基准解析（v8.3.296+）
 *
 * 部署配置中的 script / pm2_config / manifest / values 路径有两种写法：
 *   1. 端工程内相对路径（如 ./scripts/deploy.sh）→ 基准 cwd（端 code_path）
 *   2. 项目根相对路径（如 .speccore/environments/scripts/deploy.sh）→ 基准 projectRoot
 *
 * 优先 cwd（端内脚本优先），回退 projectRoot（.speccore 资产），
 * 都找不到时返回 cwd 基准路径（由调用方兜底为命令/默认名语义）。
 */
export async function resolveConfigPath(configPath: string, cwd: string): Promise<string> {
  if (isAbsolute(configPath)) return configPath;
  const inCwd = join(cwd, configPath);
  if (await pathExists(inCwd)) return inCwd;
  const projectRoot = findProjectRoot();
  if (projectRoot && projectRoot !== cwd) {
    const inRoot = join(projectRoot, configPath);
    if (await pathExists(inRoot)) return inRoot;
  }
  return inCwd;
}

// ── 主入口 ──
export async function deployPlatform(
  platform: PlatformConfig,
  env: string,
  options: DeployOptions
): Promise<DeployResult> {
  const start = Date.now();
  const deployConfig = platform.deploy?.[env];

  if (!deployConfig) {
    return {
      success: true,
      platform: platform.name,
      env,
      type: 'none',
      duration: 0,
      message: `端 "${platform.name}" 未配置 ${env} 环境的部署参数，已跳过`,
      skipped: true,
    };
  }

  const spinner = new Spinner(
    `正在部署 ${platform.name} → ${env} (${deployConfig.type})...`
  );
  spinner.start();

  try {
    // 1. 前置命令
    if (deployConfig.pre_deploy && !options.dryRun) {
      for (const cmd of deployConfig.pre_deploy) {
        logger.info(`  ▸ pre: ${cmd}`);
        const projectRoot = findProjectRoot() || process.cwd();
        const codePath = platform.code_path
          ? (isAbsolute(platform.code_path) ? platform.code_path : join(projectRoot, platform.code_path))
          : process.cwd();
        execSync(cmd, { stdio: 'pipe', cwd: codePath });
      }
    }

    // 2. 按类型执行
    // 备份开关优先级：CLI 参数（--backup/--no-backup）> 部署配置 backup 字段 > 默认开启
    const backupEnabled = options.backup ?? deployConfig.backup ?? true;
    if (options.dryRun) {
      logger.info(`  [DRY-RUN] 将执行 ${deployConfig.type} 部署`);
      await previewDeploy(platform, env, deployConfig, backupEnabled);
    } else {
      await executeDeploy(platform, env, deployConfig, options.skipBuild, backupEnabled);
    }

    // 3. 后置命令
    if (deployConfig.post_deploy && !options.dryRun) {
      for (const cmd of deployConfig.post_deploy) {
        logger.info(`  ▸ post: ${cmd}`);
        const projectRoot = findProjectRoot() || process.cwd();
        const codePath = platform.code_path
          ? (isAbsolute(platform.code_path) ? platform.code_path : join(projectRoot, platform.code_path))
          : process.cwd();
        execSync(cmd, { stdio: 'pipe', cwd: codePath });
      }
    }

    spinner.stop();
    const duration = Date.now() - start;
    return {
      success: true,
      platform: platform.name,
      env,
      type: deployConfig.type,
      duration,
      message: `部署成功 (${(duration / 1000).toFixed(1)}s)`,
    };
  } catch (e: any) {
    spinner.stop();
    const duration = Date.now() - start;
    return {
      success: false,
      platform: platform.name,
      env,
      type: deployConfig.type,
      duration,
      message: `部署失败: ${e.message || e}`,
    };
  }
}

// ── 执行部署 ──
async function executeDeploy(
  platform: PlatformConfig,
  env: string,
  config: DeployEnvConfig,
  skipBuild: boolean = false,
  backup: boolean = true
): Promise<void> {
  const projectRoot = findProjectRoot() || process.cwd();
  const cwd = platform.code_path
    ? (isAbsolute(platform.code_path) ? platform.code_path : join(projectRoot, platform.code_path))
    : process.cwd();

  switch (config.type) {
    case 'docker':
      await deployDocker(platform, env, config, cwd, skipBuild, backup);
      break;
    case 'static':
      await deployStatic(platform, env, config, cwd, skipBuild);
      break;
    case 'script':
      await deployScript(platform, env, config, cwd);
      break;
    case 'vercel':
      await deployVercel(platform, env, config, cwd);
      break;
    case 'k8s':
      await deployK8s(platform, env, config, cwd);
      break;
    case 'ssh':
      await deploySsh(platform, env, config, cwd, skipBuild, backup);
      break;
    case 'helm':
      await deployHelm(platform, env, config, cwd);
      break;
    case 'pm2':
      await deployPm2(platform, env, config, cwd, skipBuild);
      break;
    case 'serverless':
      await deployServerless(platform, env, config, cwd);
      break;
    case 'sftp':
      await deploySftp(platform, env, config, cwd, skipBuild);
      break;
    default:
      throw new Error(`不支持的部署类型: ${config.type}`);
  }
}

// ── 预览模式 ──
async function previewDeploy(
  platform: PlatformConfig,
  env: string,
  config: DeployEnvConfig,
  backupEnabled: boolean
): Promise<void> {
  logger.info(`  端: ${platform.name}`);
  logger.info(`  环境: ${env}`);
  logger.info(`  类型: ${config.type}`);
  if (config.build_cmd) logger.info(`  构建: ${config.build_cmd}`);
  if (config.output_dir) logger.info(`  输出: ${config.output_dir}`);
  if (config.registry) logger.info(`  仓库: ${config.registry}`);
  if (config.image) logger.info(`  镜像: ${config.image}:${config.tag || 'latest'}`);
  if (config.target) logger.info(`  目标: ${config.target}`);
  if (config.script) logger.info(`  脚本: ${config.script}`);
  if (config.host) logger.info(`  主机: ${config.host}`);
  if (config.key) logger.info(`  密钥: ${config.key}`);
  if (config.remote_dir) logger.info(`  远程目录: ${config.remote_dir}`);
  if (config.pm2_config) logger.info(`  PM2配置: ${config.pm2_config}`);
  if (config.provider) logger.info(`  提供商: ${config.provider}`);
  if (config.pre_deploy) logger.info(`  前置: ${config.pre_deploy.join(', ')}`);
  if (config.post_deploy) logger.info(`  后置: ${config.post_deploy.join(', ')}`);
  if ((config.type === 'ssh' || config.type === 'docker')) {
    logger.info(`  备份: ${backupEnabled ? `开启（保留最近 ${config.backup_keep ?? 5} 份）` : '关闭（--no-backup 或配置 backup: false）'}`);
  }
}

// ═══════════════════════════════════════════════════════════
// 各策略实现
// ═══════════════════════════════════════════════════════════

/** Docker 部署 */
async function deployDocker(
  platform: PlatformConfig,
  env: string,
  config: DeployEnvConfig,
  cwd: string,
  skipBuild: boolean = false,
  backup: boolean = true
): Promise<void> {
  const imageName = config.image || platform.name;
  const tag = config.tag || env;
  const dockerfile = config.dockerfile || './Dockerfile';
  const fullImage = config.registry
    ? `${config.registry}/${imageName}:${tag}`
    : `${imageName}:${tag}`;

  // 1. 前置构建（如生成配置文件、编译静态资源）
  if (!skipBuild && config.build_cmd) {
    logger.info(`  🔨 前置构建: ${config.build_cmd}`);
    execSync(config.build_cmd, { stdio: 'inherit', cwd });
  }

  // 2. Docker 构建
  logger.info(`  🐳 构建镜像: ${fullImage}`);
  runFile('docker', ['build', '-f', dockerfile, '-t', fullImage, '.'], cwd);

  // 3. 推送到仓库
  if (config.registry) {
    logger.info(`  📤 推送到: ${config.registry}`);
    runFile('docker', ['push', fullImage], cwd);
  }

  // 4. 远程服务器部署
  if (config.host) {
    await deployDockerRemote(config, cwd, fullImage, imageName, backup, tag);
  }
}

/** Docker 远程部署：SSH 执行 pull && run（备份在 pull 之前：pull 会覆盖同名 tag） */
async function deployDockerRemote(
  config: DeployEnvConfig,
  cwd: string,
  fullImage: string,
  imageName: string,
  backup: boolean = true,
  tag: string = 'latest'
): Promise<void> {
  if (!config.registry) {
    logger.warn(
      `  ⚠️ 配置了 host 但未配置 registry，远程服务器可能无法获取镜像。\n` +
      `     建议：配置 registry 字段，或使用 docker save + ssh 传输镜像。`
    );
  }

  const host = config.host!;
  const keyArgs = config.key ? ['-i', config.key] : [];

  // 密码认证支持（v8.3.341+: sshpass 改参数数组，密码不经过 shell 引号拼接）
  let sshpass = '';
  if (config.password) {
    try {
      execSync('sshpass -V', { stdio: 'pipe' });
      sshpass = config.password;
    } catch {
      throw new Error(
        '密码认证需要安装 sshpass\n' +
        '  macOS: brew install sshpass\n' +
        '  Ubuntu/Debian: apt-get install sshpass\n' +
        '  或使用密钥认证：配置 key 字段指向私钥路径'
      );
    }
  }

  // 远程命令：默认 stop → rm → pull → run
  const defaultRemoteCmd =
    `docker pull ${fullImage} && ` +
    `(docker stop ${imageName} 2>/dev/null || true) && ` +
    `(docker rm ${imageName} 2>/dev/null || true) && ` +
    `docker run -d --name ${imageName} --restart always ${fullImage}`;

  const remoteCmd = config.script || defaultRemoteCmd;

  // 3.5 部署前备份远端旧镜像 tag（v8.3.348+）：tag 零成本（镜像层共享），
  // 必须在 pull 之前执行——pull 会把同名 tag 指向新镜像，旧镜像靠备份 tag 保命。
  if (backup) {
    const keep = config.backup_keep ?? 5;
    const backupCmd =
      `(docker inspect '${fullImage}' >/dev/null 2>&1 && docker tag '${fullImage}' '${fullImage}.bak-$(date +%Y-%m-%d_%H-%M-%S)' || true) && ` +
      `(docker images '${imageName}' --format '{{.Tag}}' | grep -F '${tag}.bak-' | sort | head -n -${keep} | xargs -r -I{} docker rmi '${imageName}:{}' || true)`;
    logger.info(`  💾 备份远端旧镜像 tag（保留最近 ${keep} 份）`);
    if (sshpass) {
      runFile('sshpass', ['-p', sshpass, 'ssh', ...keyArgs, host, backupCmd], cwd);
    } else {
      runFile('ssh', [...keyArgs, host, backupCmd], cwd);
    }
  }

  logger.info(`  🔄 远程 Docker 部署: ${host}`);
  if (sshpass) {
    runFile('sshpass', ['-p', sshpass, 'ssh', ...keyArgs, host, remoteCmd], cwd);
  } else {
    runFile('ssh', [...keyArgs, host, remoteCmd], cwd);
  }
}

/** 静态资源部署 */
async function deployStatic(
  platform: PlatformConfig,
  env: string,
  config: DeployEnvConfig,
  cwd: string,
  skipBuild: boolean
): Promise<void> {
  // 1. 构建
  if (!skipBuild && config.build_cmd) {
    logger.info(`  🔨 构建: ${config.build_cmd}`);
    execSync(config.build_cmd, { stdio: 'inherit', cwd });
  }

  // 2. 复制到目标
  const outputDir = config.output_dir || 'dist';
  const target = config.target;

  if (!target) {
    logger.warn(`  ⚠️ 未配置 target，仅完成构建，跳过部署`);
    return;
  }

  logger.info(`  📦 部署静态资源: ${outputDir} → ${target}`);

  // 支持多种 target 格式
  if (target.startsWith('s3://')) {
    runFile('aws', ['s3', 'sync', outputDir, target, '--delete'], cwd);
  } else if (target.startsWith('rsync://') || target.includes(':')) {
    // rsync 远程部署
    const remote = target.replace(/^rsync:\/\//, '');
    runFile('rsync', ['-avz', '--delete', `${outputDir}/`, remote], cwd);
  } else {
    // 本地路径复制（v8.3.105+: 跨平台，使用 fs-extra 替代 cp -r）
    const targetPath = isAbsolute(target) ? target : join(cwd, target);
    emptyDirSync(targetPath);
    copySync(join(cwd, outputDir), targetPath);
  }
}

/** 脚本部署 */
async function deployScript(
  platform: PlatformConfig,
  env: string,
  config: DeployEnvConfig,
  cwd: string
): Promise<void> {
  if (!config.script) {
    throw new Error('script 类型部署必须配置 script 字段');
  }

  logger.info(`  📜 执行脚本: ${config.script}`);

  // 判断是文件路径还是直接命令（v8.3.296+: 双基准解析，兼容端内/项目根两种写法）
  const scriptPath = await resolveConfigPath(config.script, cwd);
  if (await pathExists(scriptPath)) {
    // v8.3.105+: 跨平台执行脚本（Windows 直接用 execSync 执行文件）
    execSync(scriptPath, { stdio: 'inherit', cwd });
  } else {
    execSync(config.script, { stdio: 'inherit', cwd });
  }
}

/** Vercel 部署 */
async function deployVercel(
  platform: PlatformConfig,
  env: string,
  config: DeployEnvConfig,
  cwd: string
): Promise<void> {
  const envFlag = env === 'production' ? '--prod' : '';
  logger.info(`  🚀 Vercel 部署: ${envFlag || 'preview'}`);
  runFile('npx', ['vercel', ...(envFlag ? [envFlag] : []), '--yes'], cwd);
}

/** K8s 部署 */
async function deployK8s(
  platform: PlatformConfig,
  env: string,
  config: DeployEnvConfig,
  cwd: string
): Promise<void> {
  const namespace = config.target || 'default';
  // v8.3.296+: 双基准解析 manifest 路径（兼容 .speccore/environments/scripts/ 项目根写法）
  const manifest = await resolveConfigPath(config.script || 'k8s-deployment.yaml', cwd);

  logger.info(`  ☸️  K8s 部署: namespace=${namespace}`);
  runFile('kubectl', ['apply', '-f', manifest, '-n', namespace], cwd);
}

/** SSH 部署：SCP 上传 + SSH 执行命令 */
async function deploySsh(
  platform: PlatformConfig,
  env: string,
  config: DeployEnvConfig,
  cwd: string,
  skipBuild: boolean,
  backup: boolean = true
): Promise<void> {
  if (!config.host) {
    throw new Error('ssh 类型部署必须配置 host 字段（格式: user@host:port）');
  }

  const host = config.host;
  const keyArgs = config.key ? ['-i', config.key] : [];
  const remoteDir = config.remote_dir || `/opt/services/${platform.name}`;

  // 解析 host 格式: user@host:port
  const hostMatch = host.match(/^([^@]+)@([^:]+)(?::(\d+))?$/);
  if (!hostMatch) {
    throw new Error(`host 格式错误: ${host}，应为 user@host:port`);
  }
  const [, user, hostname, port] = hostMatch;
  const portArgs = port ? ['-P', port] : [];

  // 密码认证支持：检测 sshpass 是否可用（v8.3.341+: 参数数组，不经过 shell 拼接）
  let sshpass = '';
  if (config.password) {
    try {
      execSync('sshpass -V', { stdio: 'pipe' });
      sshpass = config.password;
    } catch {
      throw new Error(
        '密码认证需要安装 sshpass\n' +
        '  macOS: brew install sshpass\n' +
        '  Ubuntu/Debian: apt-get install sshpass\n' +
        '  或使用密钥认证：配置 key 字段指向私钥路径'
      );
    }
  }

  // 1. 构建
  if (!skipBuild && config.build_cmd) {
    logger.info(`  🔨 构建: ${config.build_cmd}`);
    execSync(config.build_cmd, { stdio: 'inherit', cwd });
  }

  // 1.5 部署前备份远端旧包（v8.3.348+）：SCP 覆盖前远端 tar 打包 + 清理超出保留份数的旧备份
  if (backup) {
    const keep = config.backup_keep ?? 5;
    const ts = 'bak-$(date +%Y-%m-%d_%H-%M-%S)';
    const backupCmd =
      `if [ -d '${remoteDir}' ]; then ` +
      `tar -czf '${remoteDir}.${ts}.tar.gz' -C "$(dirname '${remoteDir}')" "$(basename '${remoteDir}')" && ` +
      `ls -1t '${remoteDir}'.bak-*.tar.gz 2>/dev/null | tail -n +${keep + 1} | xargs rm -f; fi`;
    logger.info(`  💾 备份远端旧包: ${remoteDir}（保留最近 ${keep} 份）`);
    if (sshpass) {
      runFile('sshpass', ['-p', sshpass, 'ssh', ...keyArgs, ...portArgs, `${user}@${hostname}`, backupCmd], cwd);
    } else {
      runFile('ssh', [...keyArgs, ...portArgs, `${user}@${hostname}`, backupCmd], cwd);
    }
  }

  // 2. SCP 上传（v8.3.341+: 通配符改用 glob 展开，不再依赖 shell）
  const outputDir = config.output_dir || 'dist';
  logger.info(`  📤 SCP 上传: ${outputDir} → ${host}:${remoteDir}`);
  const srcFiles = globSync(`${outputDir}/*`);
  if (srcFiles.length === 0) srcFiles.push(`${outputDir}/*`); // 空目录保留字面量，由 scp 报错提示
  const sshBase = ['-r', ...portArgs, ...keyArgs, ...srcFiles, `${user}@${hostname}:${remoteDir}/`];
  if (sshpass) {
    runFile('sshpass', ['-p', sshpass, 'scp', ...sshBase], cwd);
  } else {
    runFile('scp', sshBase, cwd);
  }

  // 3. SSH 执行重启命令（远端 shell 字符串作为单参数，语义不变）
  const restartCmd = config.script || `sudo systemctl restart ${platform.name}`;
  logger.info(`  🔄 SSH 执行: ${restartCmd}`);
  const sshArgs = [...keyArgs, ...portArgs, `${user}@${hostname}`, `cd ${remoteDir} && ${restartCmd}`];
  if (sshpass) {
    runFile('sshpass', ['-p', sshpass, 'ssh', ...sshArgs], cwd);
  } else {
    runFile('ssh', sshArgs, cwd);
  }
}

/** Helm 部署 */
async function deployHelm(
  platform: PlatformConfig,
  env: string,
  config: DeployEnvConfig,
  cwd: string
): Promise<void> {
  const namespace = config.target || env;
  const chart = config.script || `./helm/${platform.name}`;
  const releaseName = platform.name;
  const valuesFile = config.output_dir || `values-${env}.yaml`;

  logger.info(`  ⎈ Helm 部署: release=${releaseName}, namespace=${namespace}`);

  // 检查是否有 values 文件（v8.3.296+: 双基准解析，避免端 code_path 下静默丢失 -f）
  const valuesPath = await resolveConfigPath(valuesFile, cwd);
  const valuesOpt = (await pathExists(valuesPath)) ? ['-f', valuesPath] : [];

  runFile(
    'helm',
    ['upgrade', '--install', releaseName, chart, '--namespace', namespace, '--create-namespace', ...valuesOpt],
    cwd
  );
}

/** PM2 部署：Node.js 进程管理 */
async function deployPm2(
  platform: PlatformConfig,
  env: string,
  config: DeployEnvConfig,
  cwd: string,
  skipBuild: boolean
): Promise<void> {
  // 1. 构建
  if (!skipBuild && config.build_cmd) {
    logger.info(`  🔨 构建: ${config.build_cmd}`);
    execSync(config.build_cmd, { stdio: 'inherit', cwd });
  }

  const pm2Config = config.pm2_config || 'ecosystem.config.js';
  const outputDir = config.output_dir || '.';
  // v8.3.296+: 双基准解析 pm2 配置路径（兼容 .speccore/environments/scripts/ 项目根写法）
  const pm2ConfigPath = await resolveConfigPath(pm2Config, cwd);

  // 2. 本地 PM2 重启（v8.3.341+: cd X && cmd 等价变换为 cwd=X 参数数组执行）
  logger.info(`  📦 PM2 重启: ${pm2Config}`);
  runFile('npx', ['pm2', 'reload', pm2ConfigPath, '--env', env], join(cwd, outputDir));

  // 3. 如果有远程服务器，SSH + PM2
  if (config.host) {
    const remoteDir = config.remote_dir || `/opt/services/${platform.name}`;
    const keyArgs = config.key ? ['-i', config.key] : [];
    logger.info(`  🔄 远程 PM2 重启: ${config.host}`);
    runFile(
      'ssh',
      [...keyArgs, config.host, `cd ${remoteDir} && npx pm2 reload ecosystem.config.js --env ${env}`],
      cwd
    );
  }
}

/** Serverless 部署：函数计算 */
async function deployServerless(
  platform: PlatformConfig,
  env: string,
  config: DeployEnvConfig,
  cwd: string
): Promise<void> {
  const provider = config.provider || 'aliyun-fc';

  switch (provider) {
    case 'aliyun-fc': {
      // 阿里云函数计算
      const funcName = config.target || platform.name;
      logger.info(`  ⚡ 阿里云 FC 部署: ${funcName}`);
      runFile('npx', ['@alicloud/fun', 'deploy', '--function', funcName], cwd);
      break;
    }
    case 'aws-lambda': {
      // AWS Lambda
      const funcName = config.target || platform.name;
      logger.info(`  ⚡ AWS Lambda 部署: ${funcName}`);
      runFile('npx', ['serverless', 'deploy', '--stage', env], cwd);
      break;
    }
    case 'tencent-scf': {
      // 腾讯云云函数
      const funcName = config.target || platform.name;
      logger.info(`  ⚡ 腾讯云 SCF 部署: ${funcName}`);
      runFile('npx', ['serverless', 'deploy', '--target', funcName], cwd);
      break;
    }
    default:
      throw new Error(`不支持的 Serverless 提供商: ${provider}`);
  }
}

/** SFTP 部署 */
async function deploySftp(
  platform: PlatformConfig,
  env: string,
  config: DeployEnvConfig,
  cwd: string,
  skipBuild: boolean
): Promise<void> {
  if (!config.host) {
    throw new Error('sftp 类型部署必须配置 host 字段');
  }
  if (!config.remote_dir) {
    throw new Error('sftp 类型部署必须配置 remote_dir 字段');
  }

  const host = config.host;
  const keyOpt = config.key ? `-i ${config.key}` : '';
  const remoteDir = config.remote_dir;

  // 密码认证支持：检测 sshpass 是否可用
  let passOpt = '';
  if (config.password) {
    try {
      execSync('sshpass -V', { stdio: 'pipe' });
      passOpt = `sshpass -p '${config.password.replace(/'/g, "'\"'\"'")}' `;
    } catch {
      throw new Error(
        '密码认证需要安装 sshpass\n' +
        '  macOS: brew install sshpass\n' +
        '  Ubuntu/Debian: apt-get install sshpass\n' +
        '  或使用密钥认证：配置 key 字段指向私钥路径'
      );
    }
  }

  // 1. 构建
  if (!skipBuild && config.build_cmd) {
    logger.info(`  🔨 构建: ${config.build_cmd}`);
    execSync(config.build_cmd, { stdio: 'inherit', cwd });
  }

  const outputDir = config.output_dir || 'dist';

  // 2. SFTP 上传（使用 sftp 命令）
  logger.info(`  📤 SFTP 上传: ${outputDir} → ${host}:${remoteDir}`);
  const sftpScript = `put -r ${outputDir}/* ${remoteDir}/`;
  execSync(`${passOpt}echo "${sftpScript}" | sftp ${keyOpt} ${host}`, { stdio: 'inherit', cwd });
}
