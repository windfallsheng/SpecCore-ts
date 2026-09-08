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
# v8.3.82+: 每个端可单独配置 branch，覆盖全局 branch
#   branch: main   # 该端使用独立分支，pipeline 时优先使用
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
      pm2_config: .speccore/environments/scripts/ecosystem.config.js
      # 如需远程部署，取消注释:
      # host: deploy@server.example.com
      # remote_dir: /opt/services/notification

  # 后端示例：Go 网关 → K8s
  gateway:
    build_cmd: go build -o bin/gateway ./cmd/gateway
    deploy:
      type: k8s
      target: ${t.name}
      script: .speccore/environments/scripts/k8s-deployment.yaml

  # 后端示例：Python 处理 → 脚本部署
  data-processor:
    build_cmd: pip install -r requirements.txt -t dist/
    deploy:
      type: script
      script: .speccore/environments/scripts/deploy.sh

  # 后端示例：用户服务 → Helm
  user-service:
    build_cmd: ./mvnw package -DskipTests -P${t.name}
    deploy:
      type: helm
      target: ${t.name}
      script: ./helm/user-service
      output_dir: .speccore/environments/scripts/values-${t.name}.yaml

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

// ── 部署脚本模板 ──

const SCRIPT_TEMPLATES: { name: string; content: string }[] = [
  {
    name: 'deploy.sh',
    content: `#!/bin/bash
# =============================================================================
# SpecCore 通用部署脚本模板
# =============================================================================
# 用途：自定义部署逻辑（script 类型部署时调用）
# 位置：.speccore/environments/scripts/deploy.sh
# 执行：speccore deploy --env <env> --platform <platform>
#
# 环境变量（由 deploy engine 自动注入）：
#   $PLATFORM    当前端名（如 notification-service）
#   $ENV         当前环境（如 staging, production）
#   $CWD         端代码路径（code_path 或项目根目录）
# =============================================================================

set -e

echo "🚀 开始部署: $PLATFORM → $ENV"
echo "📂 工作目录: $CWD"

# TODO: 在此添加自定义部署逻辑
# 示例：
# cd "$CWD"
# tar -czf dist.tar.gz dist/
# scp dist.tar.gz deploy@server:/opt/services/$PLATFORM/
# ssh deploy@server "cd /opt/services/$PLATFORM && tar -xzf dist.tar.gz && sudo systemctl restart $PLATFORM"

echo "✅ 部署完成: $PLATFORM → $ENV"
`,
  },
  {
    name: 'ecosystem.config.js',
    content: `// =============================================================================
// PM2 生态配置模板
// =============================================================================
// 用途：PM2 进程管理配置（pm2 类型部署时调用）
// 位置：.speccore/environments/scripts/ecosystem.config.js
// 执行：speccore deploy --env <env> --platform <platform>
//
// 请根据实际项目修改 app 名称、脚本路径、环境变量等。
// =============================================================================

module.exports = {
  apps: [
    {
      name: 'notification-service',
      script: './dist/index.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_dev: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_test: {
        NODE_ENV: 'test',
        PORT: 3000,
      },
      env_staging: {
        NODE_ENV: 'staging',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_memory_restart: '500M',
      restart_delay: 3000,
    },
  ],
};
`,
  },
  {
    name: 'k8s-deployment.yaml',
    content: `# =============================================================================
# K8s Deployment + Service 模板
# =============================================================================
# 用途：Kubernetes 部署配置（k8s 类型部署时调用）
# 位置：.speccore/environments/scripts/k8s-deployment.yaml
# 执行：speccore deploy --env <env> --platform <platform>
#
# 请根据实际项目修改镜像名、端口、资源限制等。
# =============================================================================

apiVersion: apps/v1
kind: Deployment
metadata:
  name: gateway
  labels:
    app: gateway
spec:
  replicas: 2
  selector:
    matchLabels:
      app: gateway
  template:
    metadata:
      labels:
        app: gateway
    spec:
      containers:
        - name: gateway
          image: registry.example.com/gateway:latest
          ports:
            - containerPort: 8080
          resources:
            requests:
              memory: '128Mi'
              cpu: '100m'
            limits:
              memory: '512Mi'
              cpu: '500m'
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: gateway
spec:
  selector:
    app: gateway
  ports:
    - protocol: TCP
      port: 80
      targetPort: 8080
  type: ClusterIP
`,
  },
];

function generateHelmValuesContent(envName: string): string {
  return `# =============================================================================
# Helm Values 模板 — ${envName} 环境
# =============================================================================
# 用途：Helm chart 的 values 覆盖文件（helm 类型部署时调用）
# 位置：.speccore/environments/scripts/values-${envName}.yaml
# 执行：speccore deploy --env ${envName} --platform <platform>
#
# 请根据实际项目修改镜像、副本数、资源限制等。
# =============================================================================

replicaCount: 2

image:
  repository: registry.example.com/user-service
  pullPolicy: IfNotPresent
  tag: '${envName}'

service:
  type: ClusterIP
  port: 80

ingress:
  enabled: false

resources:
  limits:
    cpu: 500m
    memory: 512Mi
  requests:
    cpu: 100m
    memory: 128Mi

autoscaling:
  enabled: false
  minReplicas: 1
  maxReplicas: 5
  targetCPUUtilizationPercentage: 80

nodeSelector: {}
tolerations: []
affinity: {}
`;
}

/** update 时初始化环境配置目录 */
export async function initEnvironmentConfigs(projectRoot: string): Promise<string[]> {
  const envDir = join(projectRoot, '.speccore', 'environments');
  await ensureDir(envDir);

  const files = await readdir(envDir);
  const hasYaml = files.some((f: string) => f.endsWith('.yaml') || f.endsWith('.yml'));

  const created: string[] = [];

  // v8.3.69+: 脚本模板和 Helm values 在新建/升级时都创建（已有项目升级时补全缺失的脚本）
  const scriptsDir = join(envDir, 'scripts');
  await ensureDir(scriptsDir);

  // 创建通用脚本模板（缺失才创建）
  for (const st of SCRIPT_TEMPLATES) {
    const scriptPath = join(scriptsDir, st.name);
    if (!(await pathExists(scriptPath))) {
      await writeFile(scriptPath, st.content, 'utf-8');
      created.push(`.speccore/environments/scripts/${st.name}`);
    }
  }

  if (!hasYaml) {
    logger.info('  📦 初始化默认环境配置...');

    for (const t of ENV_TEMPLATES) {
      const filePath = join(envDir, `${t.name}.yaml`);
      await writeFile(filePath, generateEnvContent(t), 'utf-8');
      created.push(`.speccore/environments/${t.name}.yaml`);

      // 为每个环境创建 Helm values 模板
      const valuesPath = join(scriptsDir, `values-${t.name}.yaml`);
      if (!(await pathExists(valuesPath))) {
        await writeFile(valuesPath, generateHelmValuesContent(t.name), 'utf-8');
        created.push(`.speccore/environments/scripts/values-${t.name}.yaml`);
      }
    }
  } else {
    // 已有环境配置，仅更新示例文件 + 补全缺失的 Helm values
    const examplePath = join(envDir, 'staging.yaml.example');
    const exampleContent = generateEnvContent(ENV_TEMPLATES[2]) + '\n# 本文件为示例，可复制为 staging.yaml 后修改使用\n';
    await writeFile(examplePath, exampleContent, 'utf-8');
    created.push('.speccore/environments/staging.yaml.example');

    // v8.3.69+: 已有环境配置时，补全可能缺失的 Helm values 模板
    for (const t of ENV_TEMPLATES) {
      const valuesPath = join(scriptsDir, `values-${t.name}.yaml`);
      if (!(await pathExists(valuesPath))) {
        await writeFile(valuesPath, generateHelmValuesContent(t.name), 'utf-8');
        created.push(`.speccore/environments/scripts/values-${t.name}.yaml`);
      }
    }
  }

  return created;
}

// ── 测试配置模板 ──

const TEST_TEMPLATES: { name: string; content: string }[] = [
  {
    name: 'smoke',
    content: `# 标准冒烟测试配置（v8.3.60+）
# 目标：验证"系统能启动、核心页面能打开、不白屏"
# 适用：每次构建后、部署前快速门禁
# 执行：speccore verify --config .speccore/tests/smoke.yaml --env-file staging

name: 标准冒烟测试

target:
  base_url: https://staging.example.com

# 测试场景：只覆盖核心页面，不做复杂交互
tests:
  - name: 首页-加载检查
    type: smoke
    routes: [/]
    threshold: normal

  - name: 登录页-加载检查
    type: smoke
    routes: [/login]
    threshold: normal

  - name: 核心模块页面
    type: smoke
    routes:
      - /dashboard
      - /orders
      - /products
    threshold: normal

# 视觉模型配置（可选，用于单图质量扫描）
visual_model:
  provider: qwen-vl
  model: qwen-vl-max
  timeout: 30000

# 输出配置
output: ./reports/smoke-test-report.html
`,
  },
  {
    name: 'pr',
    content: `# PR 阶段测试配置（v8.3.60+）
# 目标：验证"代码质量 + 核心功能 + API 契约"
# 适用：合并请求前、Code Review 后
# 执行：speccore verify --config .speccore/tests/pr.yaml --env-file staging

name: PR 阶段测试

target:
  base_url: https://staging.example.com

# 端点映射（会被环境配置中的 base_urls 合并覆盖）
endpoints:
  h5: https://staging.example.com/h5
  admin: https://admin-staging.example.com
  api: https://api-staging.example.com

# 测试场景：关键页面 + API 契约
tests:
  - name: 关键页面冒烟
    type: smoke
    routes:
      - /
      - /login
      - /dashboard
      - /orders
    devices: [desktop, mobile]
    threshold: normal

  - name: 登录流程-视觉检查
    type: visual
    routes: [/login]
    threshold: normal

  - name: API 契约验证
    type: api
    scenarios:
      - 用户登录
      - 获取订单列表
      - 创建订单
    threshold: normal

# 视觉模型配置
visual_model:
  provider: qwen-vl
  model: qwen-vl-max
  timeout: 30000

# 输出配置
output: ./reports/pr-test-report.html
`,
  },
  {
    name: 'release',
    content: `# 发布前全量回归测试配置（v8.3.60+）
# 目标：验证"全量功能 + 视觉一致性 + 性能基线 + API 完整性"
# 适用：发布前、重大重构后、周末全量回归
# 执行：speccore verify --config .speccore/tests/release.yaml --env-file production

name: 发布前全量回归测试

target:
  base_url: https://production.example.com

# 端点映射
endpoints:
  h5: https://example.com/h5
  admin: https://admin.example.com
  api: https://api.example.com

# 全量测试场景
tests:
  - name: 全站页面冒烟
    type: smoke
    routes:
      - /
      - /login
      - /register
      - /dashboard
      - /orders
      - /order/:id
      - /products
      - /product/:id
      - /profile
      - /settings
    devices: [desktop, mobile, tablet]
    browsers: [chromium, firefox, webkit]
    threshold: normal

  - name: 核心业务流-视觉回归
    type: visual
    routes:
      - /login
      - /dashboard
      - /orders
      - /order/confirm
      - /product/123
    devices: [desktop, mobile]
    threshold: strict

  - name: 全量 API 契约验证
    type: api
    scenarios:
      - 用户注册
      - 用户登录
      - 获取用户信息
      - 获取订单列表
      - 创建订单
      - 取消订单
      - 获取商品列表
      - 获取商品详情
    threshold: strict

  - name: 性能基线检查
    type: smoke
    routes:
      - /
      - /dashboard
      - /products
    config:
      perf_check: true
      lcp_budget: 2500
      fid_budget: 100
      cls_budget: 0.1

# 视觉模型配置
visual_model:
  provider: qwen-vl
  model: qwen-vl-max
  timeout: 60000

# 输出配置
output: ./reports/release-test-report.html
`,
  },
];

/** update 时初始化测试配置目录 */
export async function initTestConfigs(projectRoot: string): Promise<string[]> {
  const testsDir = join(projectRoot, '.speccore', 'tests');
  await ensureDir(testsDir);

  const files = await readdir(testsDir);
  const hasYaml = files.some((f: string) => f.endsWith('.yaml') || f.endsWith('.yml'));

  const created: string[] = [];

  if (!hasYaml) {
    logger.info('  📦 初始化默认测试配置...');
    for (const t of TEST_TEMPLATES) {
      const filePath = join(testsDir, `${t.name}.yaml`);
      await writeFile(filePath, t.content, 'utf-8');
      created.push(`.speccore/tests/${t.name}.yaml`);
    }
  }

  return created;
}
