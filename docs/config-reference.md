# SpecCore 配置参考

> v8.3.25+ 配置分为两个文件：系统配置 `.speccore.yml` + 项目配置 `.speccore/PROJECT.yaml`。速查请使用 `speccore config --list` / `speccore config --list --project`。

---

## 目录

1. [为什么分为两个文件](#1-为什么分为两个文件)
2. [系统配置 `.speccore.yml`](#2-系统配置-speccoreyml)
3. [项目配置 `.speccore/PROJECT.yaml`](#3-项目配置-speccoreprojectyaml)
4. [配置项详解](#4-配置项详解)
   - 4.1 [schema_version](#41-schema_version)
   - 4.2 [project](#42-project)
   - 4.3 [platforms](#43-platforms)
   - 4.4 [git](#44-git)
   - 4.5 [code_scope](#45-code_scope)
   - 4.6 [quality_gates](#46-quality_gates)
   - 4.7 [arbitration](#47-arbitration)
   - 4.8 [settings](#48-settings)
   - 4.9 [ask](#49-ask)
   - 4.10 [config_history](#410-config_history)
   - 4.11 [tests](#411-tests)
   - 4.12 [stages](#412-stages)
   - 4.13 [pipeline.test](#413-pipelinetest)
5. [枚举值参考](#5-枚举值参考)
6. [配置升级指南](#6-配置升级指南)
7. [版本变更历史](#7-版本变更历史)
8. [常见问题](#8-常见问题)

---

## 1. 为什么分为两个文件

v8.3.25+ 将配置拆分为**系统配置**和**项目配置**，解决两个独立的需求：

| 文件 | 类型 | 管理的内容 | 变更频率 | 升级触发 |
|------|------|-----------|---------|---------|
| `.speccore.yml` | 系统配置 | CLI 运行时行为、质量门禁、仲裁、Ask 引擎 | 随 CLI 版本 | CLI 升级时 |
| `.speccore/PROJECT.yaml` | 项目配置 | 工程映射、端列表、Git、代码范围 | 随项目演进 | 项目结构变化时 |

**各自独立升级**：CLI 升级可能改 `.speccore.yml` 结构，但不应强迫项目工程配置一起变。两个文件有独立的 `schema_version`，升级时互不影响。

**差异检测独立报告**：
- 系统配置差异 → `.speccore/config/upgrade-diff-system.md`
- 项目配置差异 → `.speccore/config/upgrade-diff-project.md`

在 v8.3.24 之前，配置分散在多个文件中：

| 旧文件 | 内容 | 问题 |
|--------|------|------|
| `.speccore/CONSTITUTION.md` | 端列表、技术栈、命名规范 | Markdown 表格，机器解析脆弱 |
| `.speccore/SETTINGS.md`（已废弃） | 运行时行为配置 | 键值对表格，无结构校验 |
| `.speccore/config/ask.json` | Ask 引擎路由、LLM Provider | JSON 格式，与 CLI 风格不一致 |
| `.speccore.yml`（早期） | 项目信息、Git、质量门禁 | 配置域不完整 |

**v8.3.25+ 双文件结构**：
- 系统配置：CLI 行为开关，随 CLI 版本升级
- 项目配置：工程映射，随项目演进升级
- 两个文件都有 `schema_version`，独立版本化
- 加载时各自自动校验 + 补全默认值

---

## 2. 完整配置示例

```yaml
# SpecCore Configuration
# schema_version: 1
# 2026-08-28

schema_version: 1

project:
  name: my-project
  description: 示例项目
  version: 1.0.0

tech_stack:
  backend: TypeScript / NestJS
  frontend: Vue 3 / Element Plus
  database: PostgreSQL
  cache: Redis
  mq: RabbitMQ

team:
  members:
    - name: alice
      role: lead
      assignee: true
    - name: bob
      role: developer
      assignee: true

platforms:
  - name: app
    type: frontend
    description: 移动端 APP
    code_path: ./packages/app
    git_repo: git@github.com:my-org/app.git
    default_branch: main
  - name: admin
    type: frontend
    description: 后台管理端
    code_path: ./packages/admin
    git_repo: git@github.com:my-org/admin.git
    default_branch: main
  - name: api
    type: backend
    description: 后端 API 服务
    code_path: ./packages/api
    git_repo: git@github.com:my-org/api.git
    default_branch: main

git:
  default_base: main
  branch_prefix: feature/
  protected_branches:
    - main
    - master
    - release/*
    - production

code_scope:
  - src/
  - packages/*/src/

conventions:
  commit: conventional-commits
  naming:
    interface: /api/v1/{module}/{operation}
    error_code: 4-digit-by-module
    database: snake_case
    code: camelCase / PascalCase
  review: true

error_codes:
  - code: 1001
    meaning: 用户不存在
    scenario: 登录时手机号未注册
  - code: 1002
    meaning: 密码错误
    scenario: 登录密码不匹配

quality_gates:
  enforce_testing: true
  enforce_review: true
  require_pr: true

arbitration:
  enabled: true
  mode: full

settings:
  assignee:
    enabled: true
    mode: loose
  trace:
    enabled: true
    auto_annotate: true
  archive:
    auto_cleanup: false
  plan:
    parallel_suggest: true
  validation:
    strict_mode: false
  sync:
    auto_check: true
  patterns:
    auto_save: smart
  review:
    check_assignee: false

ask:
  routing:
    mode: hybrid
    high_threshold: 70
    low_threshold: 45
    auto_host_ai: true
    cache_enabled: true
    cache_min_hits: 3
  rules:
    force_host_ai: false
  llm_providers:
    - name: ollama-local
      enabled: false
      type: ollama
      endpoint: http://localhost:11434
      model: qwen2.5:7b
      priority: 1
    - name: openai-compatible
      enabled: false
      type: openai
      endpoint: https://api.openai.com/v1/chat/completions
      model: gpt-4o-mini
      priority: 2

config_history:
  - date: 2026-08-28
    change: 初始配置
    changed_by: alice
```

---

## 3. 配置项详解

### 3.1 schema_version

**类型**：`number`

**默认值**：`1`

**说明**：配置结构版本号。CLI 内置 `CURRENT_SCHEMA_VERSION` 常量，加载配置时自动比对。

**行为**：
- `< CURRENT_SCHEMA_VERSION`：配置结构已过期，输出警告，建议运行 `speccore config --upgrade`
- `> CURRENT_SCHEMA_VERSION`：CLI 版本可能过旧，建议升级 CLI
- `= CURRENT_SCHEMA_VERSION`：正常

**示例**：
```yaml
schema_version: 1
```

---

### 3.2 project

**类型**：`object`

**说明**：项目元数据，用于报告、仪表盘、文档生成等场景。

| 字段 | 类型 | 必填 | 说明 |
|------|------|:--:|------|
| `name` | `string` | ✅ | 项目名称（影响目录名、报告标题） |
| `description` | `string` | — | 项目描述（≤100 字） |
| `version` | `string` | — | 项目版本号（语义化版本） |

**示例**：
```yaml
project:
  name: ecommerce-platform
  description: 电商平台（含 APP、H5、小程序、后台管理）
  version: 2.3.0
```

---

### 3.3 tech_stack

**类型**：`object`

**说明**：技术栈信息，AI 在分析、生成代码时据此选择技术方案。

| 字段 | 类型 | 说明 |
|------|------|------|
| `backend` | `string` | 后端语言和框架（如 `Java / Spring Boot`、`TypeScript / NestJS`） |
| `frontend` | `string` | 前端框架（如 `Vue 3`、`React 18`、`Angular`） |
| `database` | `string` | 数据库（如 `MySQL`、`PostgreSQL`、`MongoDB`） |
| `cache` | `string` | 缓存（如 `Redis`、`Memcached`） |
| `mq` | `string` | 消息队列（如 `RabbitMQ`、`Kafka`、`RocketMQ`） |

> 所有字段均为可选。未填写时 AI 根据需求文档和代码推断。

**示例**：
```yaml
tech_stack:
  backend: TypeScript / NestJS
  frontend: Vue 3 / Pinia / Element Plus
  database: PostgreSQL
  cache: Redis
  mq: RabbitMQ
```

---

### 3.4 team

**类型**：`object`

**说明**：团队成员信息，用于执行人追踪、任务分配、代码审查。

| 字段 | 类型 | 说明 |
|------|------|------|
| `members` | `array` | 成员列表 |
| `members[].name` | `string` | 成员姓名（与 Git 用户名匹配） |
| `members[].role` | `string` | 角色（`lead`、`developer`、`qa`、`devops` 等） |
| `members[].assignee` | `boolean` | 是否可作为任务执行人 |

**示例**：
```yaml
team:
  members:
    - name: alice
      role: lead
      assignee: true
    - name: bob
      role: developer
      assignee: true
    - name: carol
      role: qa
      assignee: false
```

---

### 3.5 platforms

**类型**：`array`

**说明**：端列表，是 analyze/split/execute 的唯一端名来源。**端名必须全局唯一**。

| 字段 | 类型 | 必填 | 可选值 | 说明 |
|------|------|:--:|:------:|------|
| `name` | `string` | ✅ | — | 端名（全小写、短横线分隔，如 `order-service`） |
| `type` | `string` | — | `frontend` / `backend` / `infra` | 端类型 |
| `description` | `string` | — | — | 端描述 |
| `code_path` | `string` | — | — | 源码相对路径（如 `./packages/app`） |
| `git_repo` | `string` | — | — | Git 仓库地址 |
| `default_branch` | `string` | — | — | 默认分支（默认 `main`） |

**端名规则**：
1. 全小写、无空格、短横线分隔
2. 端名 = 工程名，一一对应
3. 「对应端」列必须引用此列表中已声明的端名
4. 如果一个服务拆成多个工程，应分别声明

**示例**：
```yaml
platforms:
  - name: app
    type: frontend
    description: 移动端 APP
    code_path: ./packages/app
    git_repo: git@github.com:my-org/app.git
    default_branch: main
  - name: api
    type: backend
    description: 后端 API
    code_path: ./packages/api
    git_repo: git@github.com:my-org/api.git
    default_branch: main
  - name: nginx
    type: infra
    description: 网关配置
    code_path: ./infra/nginx
```

---

### 3.6 git

**类型**：`object`

**说明**：Git 相关配置，影响分支策略、PR 流程、保护分支检查。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `default_base` | `string` | `main` | 默认基础分支（`main`、`master`、`develop` 等） |
| `branch_prefix` | `string` | `feature/` | 功能分支前缀 |
| `protected_branches` | `string[]` | `["main", "master"]` | 保护分支列表，支持通配符 `*` |

**示例**：
```yaml
git:
  default_base: develop
  branch_prefix: feature/
  protected_branches:
    - main
    - master
    - release/*
    - production
```

---

### 3.7 code_scope

**类型**：`string[]`

**默认值**：`["src/"]`

**说明**：代码扫描范围，影响 `code-index`、`rag-index`、`code-graph` 等命令。

**示例**：
```yaml
code_scope:
  - src/
  - packages/*/src/
  - lib/
```

---

### 3.8 conventions

**类型**：`object`

**说明**：项目规范，AI 生成代码时据此遵守命名、提交、审查规范。

| 字段 | 类型 | 说明 |
|------|------|------|
| `commit` | `string` | 提交规范（如 `conventional-commits`） |
| `naming` | `string \| object` | 命名规范。字符串或键值对 |
| `review` | `boolean \| string` | 审查规范 |

**naming 为对象时**：
```yaml
conventions:
  naming:
    interface: /api/v1/{module}/{operation}
    error_code: 4-digit-by-module
    database: snake_case
    code: camelCase / PascalCase
    file: kebab-case
```

---

### 3.9 error_codes

**类型**：`array`

**说明**：错误码体系，analyze 时自动注入到 AI 上下文，确保生成代码使用统一错误码。

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | `string \| number` | 错误码 |
| `meaning` | `string` | 含义 |
| `scenario` | `string` | 触发场景 |

**示例**：
```yaml
error_codes:
  - code: 1001
    meaning: 用户不存在
    scenario: 登录时手机号未注册
  - code: 1002
    meaning: 密码错误
    scenario: 登录密码不匹配
  - code: 2001
    meaning: 订单不存在
    scenario: 查询订单时订单号无效
```

---

### 3.10 quality_gates

**类型**：`object`

**说明**：质量门禁配置，控制执行完成后的检查项。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enforce_testing` | `boolean` | `true` | 是否强制要求测试（检查 TEST.md 存在性） |
| `enforce_review` | `boolean` | `true` | 是否强制要求审查（检查 REVIEW.md 存在性） |
| `require_pr` | `boolean` | `true` | 是否要求通过 PR 合并（保护分支检查） |

---

### 3.11 arbitration

**类型**：`object`

**说明**：契约冲突裁决配置（v8.3.24+），替代传统质量门禁，提供 L1/L2/L3 三级裁决。

| 字段 | 类型 | 默认值 | 可选值 | 说明 |
|------|------|--------|--------|------|
| `enabled` | `boolean` | `true` | — | 总开关 |
| `mode` | `enum` | `full` | `full` / `l1-only` / `report-only` | 裁决深度 |

**mode 详解**：

| 档位 | L1 机器契约 | L2 规范契约 | L3 架构契约 | 适用场景 |
|------|:-----------:|:-----------:|:-----------:|----------|
| `full` | 自动裁决 | AI 辅助裁决 | 人工最终裁决 | **默认，完整流程** |
| `l1-only` | 自动裁决 | 仅报告 | 仅报告 | 快速迭代，不信任 AI 裁决时 |
| `report-only` | 仅报告 | 仅报告 | 仅报告 | 完全兼容旧质量门禁行为 |

> 将 `enabled` 设为 `false` 可完全关闭裁决机制，回退到传统质量门禁。

**示例**：
```yaml
arbitration:
  enabled: true
  mode: full
```

---

### 3.12 settings

**类型**：`object`

**说明**：运行时行为配置，控制 CLI 各功能的开关和模式。

#### 3.12.1 assignee

| 字段 | 类型 | 默认值 | 可选值 | 说明 |
|------|------|--------|--------|------|
| `enabled` | `boolean` | `true` | — | 是否启用执行人追踪 |
| `mode` | `enum` | `loose` | `strict` / `loose` / `off` | 强制程度 |

**mode 详解**：

| 模式 | 行为 | 适用场景 |
|------|------|----------|
| `strict` | 校验执行人与 Git 提交者，不一致时阻断命令执行 | 严格合规项目 |
| `loose` | 自动填写 Git 提交者，仅发出警告 | **推荐，大多数项目** |
| `off` | 不读取、不校验、不推荐任何人 | 单人项目 |

#### 3.12.2 trace

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | `boolean` | `true` | 是否启用双向追溯 |
| `auto_annotate` | `boolean` | `true` | 生成代码时是否自动添加 `@spec` 注释 |

#### 3.12.3 archive

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `auto_cleanup` | `boolean` | `false` | 归档时是否自动清理未使用的资源 |

#### 3.12.4 plan

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `parallel_suggest` | `boolean` | `true` | 是否自动推荐并行开发策略 |

#### 3.12.5 validation

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `strict_mode` | `boolean` | `false` | 合规性检查是否为严格模式 |

#### 3.12.6 sync

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `auto_check` | `boolean` | `true` | 开发完成后是否自动检查反向同步 |

#### 3.12.7 patterns

| 字段 | 类型 | 默认值 | 可选值 | 说明 |
|------|------|--------|--------|------|
| `auto_save` | `enum` | `smart` | `off` / `smart` / `aggressive` | 模式自动保存策略 |

**auto_save 详解**：

| 档位 | 行为 | 适用场景 |
|------|------|----------|
| `off` | 仅提示候选列表，不自动写入 | 完全手动控制 |
| `smart` | 高置信度候选自动保存，低置信度仅提示 | **推荐，平衡自动化与准确性** |
| `aggressive` | 所有候选自动保存，标记为 INFERRED 置信度 | 快速积累模式库 |

**高置信度标准**（smart 模式）：
- 跨端共享代码
- 中间件 / 装饰器 / Hook / 拦截器
- JSDoc 完善的模块
- `Base` 开头的组件

#### 3.12.8 review

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `check_assignee` | `boolean` | `false` | 审查时是否检查执行人签名 |

---

### 3.13 ask

**类型**：`object`

**说明**：Ask 引擎配置，控制 `speccore ask` 命令的路由、缓存、LLM Provider。

#### 3.13.1 routing

| 字段 | 类型 | 默认值 | 可选值 | 说明 |
|------|------|--------|--------|------|
| `mode` | `enum` | `hybrid` | `hybrid` / `cli-only` / `host-ai-only` | 路由模式 |
| `high_threshold` | `number` | `70` | — | 高置信度阈值（≥此值直接执行命令） |
| `low_threshold` | `number` | `45` | — | 低置信度阈值（<此值转人工确认） |
| `auto_host_ai` | `boolean` | `true` | — | 是否自动路由到宿主 AI |
| `cache_enabled` | `boolean` | `true` | — | 是否启用意图缓存 |
| `cache_min_hits` | `number` | `3` | — | 缓存最小命中次数 |

**mode 详解**：

| 模式 | 行为 |
|------|------|
| `hybrid` | 混合路由：高置信度直接执行 CLI 命令，中置信度 AI 辅助确认，低置信度转人工 |
| `cli-only` | 仅路由到 CLI 命令，不使用 AI |
| `host-ai-only` | 所有请求都转给宿主 AI |

#### 3.13.2 rules

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `force_host_ai` | `boolean` | `false` | 是否强制所有请求走宿主 AI（覆盖 routing.mode） |

#### 3.13.3 llm_providers

**类型**：`array`

**说明**：LLM Provider 列表，用于 Ask 引擎在需要 AI 辅助时调用。支持多 Provider  failover。

| 字段 | 类型 | 必填 | 可选值 | 说明 |
|------|------|:--:|:------:|------|
| `name` | `string` | ✅ | — | Provider 名称（唯一标识） |
| `enabled` | `boolean` | — | — | 是否启用 |
| `type` | `enum` | ✅ | `ollama` / `openai` / `anthropic` / `custom` | Provider 类型 |
| `endpoint` | `string` | ✅ | — | API 端点 URL |
| `model` | `string` | ✅ | — | 模型名称 |
| `apiKey` | `string` | — | — | API 密钥。支持 `${ENV_VAR}` 语法引用环境变量 |
| `priority` | `number` | — | — | 优先级，数字越小越优先。多个 enabled Provider 时按优先级选择 |

**示例**：
```yaml
ask:
  llm_providers:
    - name: ollama-local
      enabled: true
      type: ollama
      endpoint: http://localhost:11434
      model: qwen2.5:7b
      priority: 1
    - name: openai-backup
      enabled: true
      type: openai
      endpoint: https://api.openai.com/v1/chat/completions
      model: gpt-4o-mini
      apiKey: ${OPENAI_API_KEY}
      priority: 2
```

---

### 3.14 config_history

**类型**：`array`

**说明**：配置变更历史，由 `speccore config --upgrade` 自动维护。

| 字段 | 类型 | 说明 |
|------|------|------|
| `date` | `string` | 变更日期（`YYYY-MM-DD`） |
| `change` | `string` | 变更描述 |
| `changed_by` | `string` | 变更人（可选） |

> 此字段无需手动编辑，运行 `speccore config --upgrade` 时自动追加记录。

---

### 3.15 tests

**类型**：`object`

**说明**：测试基础设施配置，与 `speccore verify` 和 `speccore pipeline` 联动。定义测试基地址和视觉模型参数。

| 字段 | 类型 | 说明 |
|------|------|------|
| `base_urls` | `object` | 各端测试基地址，键为端名，值为 URL |
| `visual_model` | `object` | 视觉模型配置（provider, model, apiKey, endpoint, timeout） |

**示例**：
```yaml
tests:
  base_urls:
    h5: https://staging.example.com/h5
    admin: https://admin-staging.example.com
    api: https://api-staging.example.com
  visual_model:
    provider: qwen-vl
    model: qwen-vl-max
    timeout: 60000
```

---

### 3.16 stages

**类型**：`object`

**说明**：分层测试阶段配置，与 `speccore verify --stage <stage>` 联动。不同阶段自动加载对应的测试场景配置文件。

| 字段 | 类型 | 说明 |
|------|------|------|
| `dev` | `object` | 开发阶段配置 |
| `pr` | `object` | PR 阶段配置 |
| `deploy` | `object` | 部署阶段配置 |
| `release` | `object` | 发布阶段配置 |

每个阶段支持：
| 字段 | 类型 | 说明 |
|------|------|------|
| `config` | `string \| null` | 测试场景配置文件路径，`null` 表示使用内置代码质量验证 |

**示例**：
```yaml
stages:
  dev:
    config: null
  pr:
    config: .speccore/tests/pr.yaml
  deploy:
    config: .speccore/tests/smoke.yaml
  release:
    config: .speccore/tests/release.yaml
```

---

### 3.17 pipeline.test

**类型**：`object`

**说明**：Pipeline 内置测试节点配置。在 build 之后、deploy 之前/之后执行测试，失败按严重程度决定是否阻断部署。

| 字段 | 类型 | 默认值 | 可选值 | 说明 |
|------|------|--------|--------|------|
| `enabled` | `boolean` | `false` | — | 是否启用 Pipeline 内置测试 |
| `type` | `enum` | `build-check` | `build-check` / `smoke` / `visual` / `api` / `all` | 测试类型 |
| `stage` | `enum` | `pre-deploy` | `pre-deploy` / `post-deploy` / `both` | 测试时机 |
| `config` | `string` | — | — | 自定义测试场景配置文件路径 |
| `fail_on_error` | `boolean` | `true` | — | 测试失败是否阻断 deploy |
| `auto_fix` | `boolean` | `true` | — | 测试失败时是否输出 AI 自动修复标记 |
| `max_retries` | `number` | `3` | — | 自动修复最大重试次数 |

**示例**：
```yaml
pipeline:
  test:
    enabled: true
    type: smoke
    stage: pre-deploy
    fail_on_error: true
    auto_fix: true
    max_retries: 3
```

---

## 4. 枚举值参考

### 4.1 platforms[].type

| 值 | 说明 |
|----|------|
| `frontend` | 前端端（APP、H5、小程序、后台管理） |
| `backend` | 后端端（API 服务、微服务） |
| `infra` | 基础设施（网关、配置中心、监控） |

### 4.2 arbitration.mode

| 值 | 说明 |
|----|------|
| `full` | 完整三级裁决 |
| `l1-only` | 仅 L1 自动裁决 |
| `report-only` | 仅生成报告 |

### 4.3 settings.assignee.mode

| 值 | 说明 |
|----|------|
| `strict` | 严格校验，不一致时阻断 |
| `loose` | 自动填写，仅警告 |
| `off` | 不追踪 |

### 4.4 settings.patterns.auto_save

| 值 | 说明 |
|----|------|
| `off` | 仅提示 |
| `smart` | 高置信度自动保存 |
| `aggressive` | 全部自动保存 |

### 4.5 ask.routing.mode

| 值 | 说明 |
|----|------|
| `hybrid` | 混合路由 |
| `cli-only` | 仅 CLI |
| `host-ai-only` | 仅宿主 AI |

### 4.6 ask.llm_providers[].type

| 值 | 说明 |
|----|------|
| `ollama` | Ollama 本地模型 |
| `openai` | OpenAI 兼容 API |
| `anthropic` | Anthropic Claude |
| `custom` | 自定义 Provider |

---

## 5. 配置升级指南

### 5.1 何时需要升级

以下情况出现时，配置需要升级：

1. CLI 升级后，`speccore status` 显示配置版本 ⚠️
2. `speccore doctor` 报告 `schema_version` 不匹配
3. 新功能无法使用（缺少新配置字段）

### 5.2 升级流程

```bash
# 1. 检查配置健康度
speccore doctor

# 2. 升级配置结构
speccore config --upgrade

# 3. 确认升级结果
speccore status
```

### 5.3 升级时自动处理

| 变更类型 | 自动处理行为 |
|----------|-------------|
| **新增字段** | 用 `DEFAULT_CONFIG` 中的默认值自动补全 |
| **删除字段** | 保留在 `.speccore.yml` 中但不再读取（兼容旧配置） |
| **重命名字段** | `upgradeConfig()` 中自动迁移（如 `old_name` → `new_name`） |
| **枚举值变更** | 校验器检测非法值，给出明确错误，用默认值兜底 |
| **schema_version 提升** | 自动更新到 `CURRENT_SCHEMA_VERSION` |

### 5.4 结构性变更的交互式处理

当升级检测到以下结构性变更时，**不会自动执行升级**，而是中止并提示用户手动处理：

| 差异类型 | 说明 | 用户操作 |
|----------|------|----------|
| **删除字段** | 当前配置中有字段，但新版本 schema 中已移除 | 检查该字段是否有自定义值，迁移到新字段 |
| **类型变更** | 字段存在但类型不同（如 `string` → `number`） | 手动修改字段值类型 |
| **枚举值非法** | 字段值不在合法枚举范围内 | 将值改为合法枚举值之一 |
| **结构变更** | 对象↔数组、嵌套结构重组 | 重组配置对象结构 |

**差异报告文件**：

当检测到需用户确认的变更时，CLI 自动生成 `.speccore/config/upgrade-diff.md`，包含：
- 检测到的所有变更详情
- 每项变更的处理建议
- 修改完成后重新运行的命令

**检测入口**：
- `speccore config --upgrade` — 升级时自动检测
- `speccore doctor` — 健康诊断时检测（即使 schema_version 匹配）
- `speccore status` — 状态面板中显示差异警告

### 5.5 升级后手动检查

运行 `speccore config --upgrade` 后，建议检查：

1. **新字段默认值是否符合预期**：如新增的 `settings.xxx.enabled` 默认是 `true` 还是 `false`
2. **端列表是否完整**：`platforms` 是否有新增端需要补充
3. **LLM Provider 是否需要更新**：新 Provider 类型是否已支持

---

## 6. 版本变更历史

### schema_version = 1（v8.3.25+）

**新增配置域**：
- `schema_version` — 配置结构版本号
- `project` — 项目元数据（name, description, version）
- `platforms` — 端列表与工程映射（name, type, code_path, git_repo, default_branch）
- `tech_stack` — 技术栈（backend, frontend, database, cache, mq）
- `team` — 团队成员（members[].name, role, assignee）
- `git` — Git 配置（default_base, branch_prefix, protected_branches）
- `code_scope` — 代码扫描范围
- `conventions` — 规范（commit, naming, review）
- `error_codes` — 错误码体系
- `quality_gates` — 质量门禁（enforce_testing, enforce_review, require_pr）
- `arbitration` — 契约冲突裁决（enabled, mode）
- `settings` — 运行时行为（assignee, trace, archive, plan, validation, sync, patterns, review）
- `ask` — Ask 引擎（routing, rules, llm_providers）
- `config_history` — 配置变更历史

**废弃的旧配置**：
- `.speccore/CONSTITUTION.md` — 端列表和技术栈已迁移到 `.speccore.yml`
- `.speccore/SETTINGS.md`（已废弃）— 运行时配置已迁移到 `.speccore.yml` 的 `settings` 和 `arbitration` 域
- `.speccore/config/ask.json` — Ask 配置已迁移到 `.speccore.yml` 的 `ask` 域

> 旧文件保留作为备份，不再被 CLI 读取。

---

## 7. 常见问题

### Q1: `.speccore.yml` 和旧的 `CONSTITUTION.md` / `SETTINGS.md` 冲突怎么办？

**A**: v8.3.25+ 只读取 `.speccore.yml`。`CONSTITUTION.md` 保留作为人工参考（技术宪法），但端列表和技术栈已迁移到 `.speccore.yml`。`SETTINGS.md` 已废弃删除，其配置已迁移到 `.speccore.yml` 的 `settings` 和 `arbitration` 域。建议运行 `speccore config --upgrade` 确保配置完整。

### Q2: 配置校验失败会怎样？

**A**: 校验失败时：
1. CLI 输出具体的错误信息（字段路径 + 期望类型）
2. 用默认值兜底，尽量继续运行
3. `speccore doctor` 显示配置健康度为失败
4. 建议运行 `speccore config --upgrade` 修复

### Q3: 可以手动编辑 `.speccore.yml` 吗？

**A**: 可以。`.speccore.yml` 是纯文本 YAML，任何编辑器都可以修改。修改后 CLI 在下一次命令时自动生效。建议修改后运行 `speccore doctor` 检查语法和结构。

### Q4: `schema_version` 可以手动修改吗？

**A**: 不建议。`schema_version` 由 CLI 维护，手动修改可能导致版本检测异常。应使用 `speccore config --upgrade` 自动更新。

### Q5: 多工程（monorepo）如何配置？

**A**: 在 `platforms` 中为每个工程声明一个端，指定各自的 `code_path` 和 `git_repo`：

```yaml
platforms:
  - name: app
    type: frontend
    code_path: ./packages/app
    git_repo: git@github.com:my-org/app.git
  - name: api
    type: backend
    code_path: ./packages/api
    git_repo: git@github.com:my-org/api.git
```

### Q6: LLM Provider 的 `apiKey` 如何安全存储？

**A**: 支持环境变量引用语法：

```yaml
ask:
  llm_providers:
    - name: openai
      apiKey: ${OPENAI_API_KEY}
```

CLI 会自动解析 `${OPENAI_API_KEY}` 为对应的环境变量值。

**支持两种语法**：

| 语法 | 说明 | 示例 |
|------|------|------|
| `${VAR}` | 引用环境变量，不存在时保留原样 | `apiKey: ${OPENAI_API_KEY}` |
| `${VAR:-default}` | 引用环境变量，不存在时使用默认值 | `endpoint: ${OLLAMA_ENDPOINT:-http://localhost:11434}` |

**适用范围**：`.speccore.yml` 中所有字符串值字段均可使用环境变量引用，不仅限于 `apiKey`。常见场景：
- `project.name: ${PROJECT_NAME:-my-project}`
- `git.default_base: ${GIT_DEFAULT_BASE:-main}`
- `platforms[0].git_repo: ${API_REPO_URL}`

**安全建议**：
1. API Key、密码等敏感信息**绝不**直接写入 `.speccore.yml`
2. 将敏感信息放入环境变量（`~/.zshrc`、`.env` 文件、CI/CD Secrets）
3. `.speccore.yml` 中只写 `${VAR}` 占位符
4. `.speccore.yml` 可以安全提交到 Git，因为不包含真实密钥

**环境变量未设置时的行为**：
- 加载配置时输出警告：`⚠️ 以下环境变量未设置，配置项保持原样: OPENAI_API_KEY`
- 配置值保持为 `${OPENAI_API_KEY}` 字符串
- 如果该字段是必填项，后续使用时会报错

### Q7: 如何关闭某个功能？

**A**: 找到对应的 `enabled` 字段设为 `false`：

```yaml
# 关闭仲裁
arbitration:
  enabled: false

# 关闭执行人追踪
settings:
  assignee:
    enabled: false

# 关闭模式自动保存
settings:
  patterns:
    auto_save: off
```
