/**
 * deploy-engine — 多策略部署引擎
 *
 * 支持 docker / static / script / vercel / k8s / ssh / helm / pm2 / serverless / sftp
 * 按端、按环境读取 PROJECT.yaml 配置执行部署
 *
 * v8.3.60+ 新增
 */

import { execSync } from 'child_process';
import { pathExists, copySync, emptyDirSync } from 'fs-extra';
import { join, isAbsolute } from 'path';
import { logger, Spinner } from '../../utils/logger';
import type { DeployEnvConfig, PlatformConfig } from '../unified-config';
import { findProjectRoot } from '../../utils/task-utils';

export interface DeployOptions {
  platform: string;      // 端名，如 h5-mobile, api
  env: string;           // 环境，如 staging, production
  dryRun?: boolean;      // 仅预览，不实际执行
  skipBuild?: boolean;   // 跳过构建
}

export interface DeployResult {
  success: boolean;
  platform: string;
  env: string;
  type: string;
  duration: number;
  message: string;
  skipped?: boolean;  // v8.3.97+: 未配置时跳过，非失败
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
    if (options.dryRun) {
      logger.info(`  [DRY-RUN] 将执行 ${deployConfig.type} 部署`);
      await previewDeploy(platform, env, deployConfig);
    } else {
      await executeDeploy(platform, env, deployConfig, options.skipBuild);
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
  skipBuild: boolean = false
): Promise<void> {
  const projectRoot = findProjectRoot() || process.cwd();
  const cwd = platform.code_path
    ? (isAbsolute(platform.code_path) ? platform.code_path : join(projectRoot, platform.code_path))
    : process.cwd();

  switch (config.type) {
    case 'docker':
      await deployDocker(platform, env, config, cwd, skipBuild);
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
      await deploySsh(platform, env, config, cwd, skipBuild);
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
  config: DeployEnvConfig
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
  skipBuild: boolean = false
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
  execSync(`docker build -f ${dockerfile} -t ${fullImage} .`, {
    stdio: 'inherit',
    cwd,
  });

  // 3. 推送到仓库
  if (config.registry) {
    logger.info(`  📤 推送到: ${config.registry}`);
    execSync(`docker push ${fullImage}`, { stdio: 'inherit', cwd });
  }

  // 4. 远程服务器部署
  if (config.host) {
    await deployDockerRemote(config, cwd, fullImage, imageName);
  }
}

/** Docker 远程部署：SSH 执行 pull && run */
async function deployDockerRemote(
  config: DeployEnvConfig,
  cwd: string,
  fullImage: string,
  imageName: string
): Promise<void> {
  if (!config.registry) {
    logger.warn(
      `  ⚠️ 配置了 host 但未配置 registry，远程服务器可能无法获取镜像。\n` +
      `     建议：配置 registry 字段，或使用 docker save + ssh 传输镜像。`
    );
  }

  const host = config.host!;
  const keyOpt = config.key ? `-i ${config.key}` : '';

  // 密码认证支持
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

  // 远程命令：默认 stop → rm → pull → run
  const defaultRemoteCmd =
    `docker pull ${fullImage} && ` +
    `(docker stop ${imageName} 2>/dev/null || true) && ` +
    `(docker rm ${imageName} 2>/dev/null || true) && ` +
    `docker run -d --name ${imageName} --restart always ${fullImage}`;

  const remoteCmd = config.script || defaultRemoteCmd;

  logger.info(`  🔄 远程 Docker 部署: ${host}`);
  execSync(`${passOpt}ssh ${keyOpt} ${host} "${remoteCmd}"`, {
    stdio: 'inherit',
    cwd,
  });
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
    execSync(`aws s3 sync ${outputDir} ${target} --delete`, { stdio: 'inherit', cwd });
  } else if (target.startsWith('rsync://') || target.includes(':')) {
    // rsync 远程部署
    const remote = target.replace(/^rsync:\/\//, '');
    execSync(`rsync -avz --delete ${outputDir}/ ${remote}`, { stdio: 'inherit', cwd });
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

  // 判断是文件路径还是直接命令
  const scriptPath = join(cwd, config.script);
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
  execSync(`npx vercel ${envFlag} --yes`, { stdio: 'inherit', cwd });
}

/** K8s 部署 */
async function deployK8s(
  platform: PlatformConfig,
  env: string,
  config: DeployEnvConfig,
  cwd: string
): Promise<void> {
  const namespace = config.target || 'default';
  const manifest = config.script || 'k8s-deployment.yaml';

  logger.info(`  ☸️  K8s 部署: namespace=${namespace}`);
  execSync(`kubectl apply -f ${manifest} -n ${namespace}`, { stdio: 'inherit', cwd });
}

/** SSH 部署：SCP 上传 + SSH 执行命令 */
async function deploySsh(
  platform: PlatformConfig,
  env: string,
  config: DeployEnvConfig,
  cwd: string,
  skipBuild: boolean
): Promise<void> {
  if (!config.host) {
    throw new Error('ssh 类型部署必须配置 host 字段（格式: user@host:port）');
  }

  const host = config.host;
  const keyOpt = config.key ? `-i ${config.key}` : '';
  const remoteDir = config.remote_dir || `/opt/services/${platform.name}`;

  // 解析 host 格式: user@host:port
  const hostMatch = host.match(/^([^@]+)@([^:]+)(?::(\d+))?$/);
  if (!hostMatch) {
    throw new Error(`host 格式错误: ${host}，应为 user@host:port`);
  }
  const [, user, hostname, port] = hostMatch;
  const portOpt = port ? `-P ${port}` : '';

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

  // 2. SCP 上传
  const outputDir = config.output_dir || 'dist';
  logger.info(`  📤 SCP 上传: ${outputDir} → ${host}:${remoteDir}`);
  execSync(`${passOpt}scp -r ${portOpt} ${keyOpt} ${outputDir}/* ${user}@${hostname}:${remoteDir}/`, {
    stdio: 'inherit',
    cwd,
  });

  // 3. SSH 执行重启命令
  const restartCmd = config.script || `sudo systemctl restart ${platform.name}`;
  logger.info(`  🔄 SSH 执行: ${restartCmd}`);
  execSync(`${passOpt}ssh ${keyOpt} ${portOpt} ${user}@${hostname} "cd ${remoteDir} && ${restartCmd}"`, {
    stdio: 'inherit',
    cwd,
  });
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

  // 检查是否有 values 文件
  const valuesPath = join(cwd, valuesFile);
  const valuesOpt = (await pathExists(valuesPath)) ? `-f ${valuesFile}` : '';

  execSync(
    `helm upgrade --install ${releaseName} ${chart} --namespace ${namespace} --create-namespace ${valuesOpt}`,
    { stdio: 'inherit', cwd }
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

  // 2. 本地 PM2 重启
  logger.info(`  📦 PM2 重启: ${pm2Config}`);
  execSync(`cd ${outputDir} && npx pm2 reload ${pm2Config} --env ${env}`, {
    stdio: 'inherit',
    cwd,
  });

  // 3. 如果有远程服务器，SSH + PM2
  if (config.host) {
    const remoteDir = config.remote_dir || `/opt/services/${platform.name}`;
    const keyOpt = config.key ? `-i ${config.key}` : '';
    logger.info(`  🔄 远程 PM2 重启: ${config.host}`);
    execSync(
      `ssh ${keyOpt} ${config.host} "cd ${remoteDir} && npx pm2 reload ecosystem.config.js --env ${env}"`,
      { stdio: 'inherit', cwd }
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
      execSync(`npx @alicloud/fun deploy --function ${funcName}`, { stdio: 'inherit', cwd });
      break;
    }
    case 'aws-lambda': {
      // AWS Lambda
      const funcName = config.target || platform.name;
      logger.info(`  ⚡ AWS Lambda 部署: ${funcName}`);
      execSync(`npx serverless deploy --stage ${env}`, { stdio: 'inherit', cwd });
      break;
    }
    case 'tencent-scf': {
      // 腾讯云云函数
      const funcName = config.target || platform.name;
      logger.info(`  ⚡ 腾讯云 SCF 部署: ${funcName}`);
      execSync(`npx serverless deploy --target ${funcName}`, { stdio: 'inherit', cwd });
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
