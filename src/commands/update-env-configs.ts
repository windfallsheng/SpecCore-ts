/**
 * update-env-configs — update 时初始化/升级环境配置
 *
 * v8.3.60+
 */
import { join } from 'path';
import { pathExists, ensureDir, writeFile, readdir } from 'fs-extra';
import { logger } from '../utils/logger';

interface EnvTemplate {
  name: string;
  branch: string;
  purpose: string;
  buildCmd: string;
  baseUrl: string;
}

const ENV_TEMPLATES: EnvTemplate[] = [
  {
    name: 'local',
    branch: '',
    purpose: '本地开发调试',
    buildCmd: 'npm run build:dev',
    baseUrl: 'http://localhost:3000',
  },
  {
    name: 'dev',
    branch: 'develop',
    purpose: '开发联调环境',
    buildCmd: 'npm run build:dev',
    baseUrl: 'https://dev.example.com',
  },
  {
    name: 'test',
    branch: 'release/test',
    purpose: '测试环境 / QA / SIT',
    buildCmd: 'npm run build:test',
    baseUrl: 'https://test.example.com',
  },
  {
    name: 'staging',
    branch: 'staging',
    purpose: '预发布 / 准生产环境',
    buildCmd: 'npm run build:staging',
    baseUrl: 'https://staging.example.com',
  },
  {
    name: 'production',
    branch: 'main',
    purpose: '线上生产环境',
    buildCmd: 'npm run build:prod',
    baseUrl: 'https://www.example.com',
  },
];

function generateEnvContent(t: EnvTemplate): string {
  const branchComment = t.branch
    ? `# pipeline 执行时会自动将当前分支合并到此分支，然后 build+deploy`
    : `# 本地通常直接在 feature 分支开发，不指定合并目标`;

  return `# =============================================================================
# SpecCore 环境配置 — ${t.name}（${t.purpose}）
# =============================================================================
# 支持任意数量的环境，复制本文件修改 env 和 branch 即可新建环境。
# 典型工作流：
#   speccore build --env ${t.name} --platform h5
#   speccore deploy --env ${t.name} --platform h5
#   speccore pipeline --env ${t.name} --all
# =============================================================================

env: ${t.name}

# 该环境对应的 Git 目标分支
${branchComment}
${t.branch ? `branch: ${t.branch}` : '# branch: (未配置，pipeline 不会执行 merge)'}

# 全局默认值
defaults:
  build_cmd: ${t.buildCmd}

# 按端覆盖配置
platforms:
  # 前端示例：H5 移动端 → S3/CDN
  h5:
    build_cmd: ${t.buildCmd}
    deploy:
      type: static
      output_dir: dist
      target: s3://mybucket-${t.name}/h5/

  # 前端示例：Admin 管理后台 → Nginx 服务器
  admin-web:
    build_cmd: ${t.buildCmd}
    deploy:
      type: ssh
      output_dir: dist
      host: deploy@${t.name === 'production' ? 'prod' : t.name}-server.example.com:22
      remote_dir: /usr/share/nginx/html/admin/
      key: ~/.ssh/deploy_key
      post_deploy:
        - ssh deploy@${t.name === 'production' ? 'prod' : t.name}-server.example.com "sudo nginx -s reload"

  # 后端示例：Java API 服务 → Docker
  order-api:
    build_cmd: ./mvnw package -DskipTests -P${t.name === 'local' ? 'dev' : t.name}
    deploy:
      type: docker
      registry: registry.example.com/myapp-${t.name === 'production' ? 'prod' : t.name}
      image: order-service
      tag: ${t.name === 'production' ? 'prod' : t.name}

  # 后端示例：Node.js 服务 → PM2
  notification-service:
    build_cmd: npm run build
    deploy:
      type: pm2
      output_dir: .
      pm2_config: ecosystem.config.js
      # 如需远程部署，取消注释:
      # host: deploy@server.example.com
      # remote_dir: /opt/services/notification

  # 后端示例：Go 网关 → K8s
  gateway:
    build_cmd: go build -o bin/gateway ./cmd/gateway
    deploy:
      type: k8s
      target: ${t.name}
      script: k8s/gateway-deployment.yaml

  # 后端示例：Python 处理 → 脚本部署
  data-processor:
    build_cmd: pip install -r requirements.txt -t dist/
    deploy:
      type: script
      script: ./scripts/deploy-processor.sh

  # 后端示例：用户服务 → Helm
  user-service:
    build_cmd: ./mvnw package -DskipTests -P${t.name}
    deploy:
      type: helm
      target: ${t.name}
      script: ./helm/user-service
      output_dir: values-${t.name}.yaml

  # 后端示例：定时任务 → SFTP 到服务器
  scheduler:
    build_cmd: go build -o bin/scheduler ./cmd/scheduler
    deploy:
      type: sftp
      output_dir: bin
      host: deploy@server.example.com
      remote_dir: /opt/services/scheduler/
      key: ~/.ssh/deploy_key

  # 后端示例：WebSocket 服务 → 函数计算
  ws-handler:
    build_cmd: npm run build
    deploy:
      type: serverless
      provider: aliyun-fc
      target: ws-handler-${t.name}

# 测试相关配置（与 verify --config 联动）
tests:
  base_urls:
    h5: ${t.baseUrl}/h5
    admin: ${t.baseUrl}/admin
    order-api: ${t.baseUrl.replace('www.', 'api-').replace('https://', 'https://api-')}

  visual_model:
    provider: qwen-vl
    model: qwen-vl-max
    timeout: 60000

# 分层测试配置（v8.3.60+）
# 与 speccore verify --stage <stage> 联动，不同阶段自动加载对应测试场景。
# 也可直接运行: speccore verify --config .speccore/tests/smoke.yaml --env-file ${t.name}
stages:
  # 开发阶段：编译 + Lint + 单元测试（无需外部服务）
  dev:
    config: null                           # 使用内置代码质量验证
  # PR 阶段：代码质量 + 关键页面冒烟 + API 契约
  pr:
    config: .speccore/tests/pr.yaml
  # 部署阶段：仅冒烟测试（快速门禁）
  deploy:
    config: .speccore/tests/smoke.yaml
  # 发布阶段：全量回归
  release:
    config: .speccore/tests/release.yaml

# Pipeline 测试配置（v8.3.60+）
# 在 build 之后、deploy 之前/之后执行测试，失败按严重程度决定是否阻断部署。
#
# 推荐的分层 Pipeline 测试策略：
#   ┌─────────────────────────────────────────────────────────────┐
#   │  pre-deploy (build 后 deploy 前)                            │
#   │    • build-check: 构建产物检查（快速、必做）                  │
#   │    • smoke:       HTTP 可达性（推荐，验证服务已启动）         │
#   │    • type=smoke + stage=pre-deploy → 部署前快速门禁         │
#   ├─────────────────────────────────────────────────────────────┤
#   │  post-deploy (deploy 后)                                    │
#   │    • visual: 视觉回归（已上线，只报告不阻断）                 │
#   │    • api:    API 契约验证                                   │
#   │    • type=all + stage=post-deploy → 部署后验收              │
#   ├─────────────────────────────────────────────────────────────┤
#   │  both (前后都测)                                            │
#   │    • pre:  build-check + smoke                              │
#   │    • post: visual + api                                     │
#   │    → 最完整的质量闭环，但耗时较长                            │
#   └─────────────────────────────────────────────────────────────┘
#
# 严重程度分级：
#   - critical（严重）: build-check 失败、HTTP 5xx/连接失败 → 必须阻断
#   - warning（警告）: visual 差异、api 契约差异、HTTP 404 → 自动修复模式下先部署后修复
pipeline:
  test:
    # 是否启用 pipeline 内置测试（默认 false）
    enabled: false
    # 测试类型: build-check / smoke / visual / api / all
    type: build-check
    # 测试时机: pre-deploy(部署前,默认) / post-deploy(部署后) / both(前后都测)
    stage: pre-deploy
    # 自定义测试场景配置文件路径（可选）
    # config: ./tests/pipeline-${t.name}.yaml
    # 测试失败是否阻断 deploy（默认 true，仅对 critical 生效）
    fail_on_error: true
    # 测试失败时是否输出 AI 自动修复标记（默认 true）
    auto_fix: true
    # 自动修复最大重试次数
    max_retries: 3
`;
}

/** update 时初始化环境配置目录 */
export async function initEnvironmentConfigs(projectRoot: string): Promise<string[]> {
  const envDir = join(projectRoot, '.speccore', 'environments');
  await ensureDir(envDir);

  const files = await readdir(envDir);
  const hasYaml = files.some((f: string) => f.endsWith('.yaml') || f.endsWith('.yml'));

  const created: string[] = [];

  if (!hasYaml) {
    logger.info('  📦 初始化默认环境配置...');
    for (const t of ENV_TEMPLATES) {
      const filePath = join(envDir, `${t.name}.yaml`);
      await writeFile(filePath, generateEnvContent(t), 'utf-8');
      created.push(`.speccore/environments/${t.name}.yaml`);
    }
  } else {
    // 已有环境配置，仅更新示例文件
    const examplePath = join(envDir, 'staging.yaml.example');
    const exampleContent = generateEnvContent(ENV_TEMPLATES[2]) + '\n# 本文件为示例，可复制为 staging.yaml 后修改使用\n';
    await writeFile(examplePath, exampleContent, 'utf-8');
    created.push('.speccore/environments/staging.yaml.example');
  }

  return created;
}
