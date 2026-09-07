# SpecCore 测试体系指南

> v8.3.60+ 完整测试能力覆盖：代码质量 → UI 冒烟 → 视觉回归 → API 契约 → 性能基线

---

## 目录

1. [测试体系概览](#1-测试体系概览)
2. [分层测试策略](#2-分层测试策略)
3. [测试配置详解](#3-测试配置详解)
4. [测试场景 YAML 配置](#4-测试场景-yaml-配置)
5. [VERIFY_SPEC.yaml 配置](#5-verify_speccyaml-配置)
6. [Pipeline 测试节点](#6-pipeline-测试节点)
7. [外部项目测试](#7-外部项目测试)
8. [常见问题](#8-常见问题)

---

## 1. 测试体系概览

SpecCore 提供从代码到部署的全链路测试能力：

```
开发阶段                PR 阶段                部署阶段                发布阶段
    │                     │                     │                     │
    ▼                     ▼                     ▼                     ▼
┌─────────┐         ┌─────────┐         ┌─────────┐         ┌─────────┐
│ 编译检查 │         │ 代码质量 │         │ 构建检查 │         │ 全量回归 │
│  Lint   │   →    │ 冒烟测试 │   →    │ 冒烟测试 │   →    │ 视觉回归 │
│ 单元测试 │         │ API契约 │         │         │         │ API契约 │
└─────────┘         └─────────┘         └─────────┘         │ 性能基线 │
                                                            └─────────┘
```

### 1.1 测试能力矩阵

| 能力 | 命令 | 说明 | 耗时 |
|:---|:---|:---|:---:|
| **编译检查** | `speccore verify --type compile` | TypeScript/JavaScript 编译 | ~30s |
| **Lint 检查** | `speccore verify --type lint` | ESLint/Prettier 格式检查 | ~20s |
| **单元测试** | `speccore verify --type test` | Jest/Vitest 单元测试 | ~1-2m |
| **UI 冒烟** | `speccore verify --ui --smoke-only` | Playwright 无头浏览器页面可达性 | ~2-5m |
| **视觉回归** | `speccore verify --ui --visual-only` | AI 视觉模型截图对比分析 | ~5-10m |
| **API 契约** | `speccore verify --api-contract` | API_CONTRACT.yaml 结构验证 | ~1m |
| **性能基线** | `speccore verify --perf` | Lighthouse Web Vitals 性能测试 | ~2-3m |

---

## 2. 分层测试策略

### 2.1 四层阶段快捷命令

v8.3.60+ 新增 `--stage` 参数，一键执行对应层级的测试：

```bash
# 开发阶段：编译 + Lint + 单元测试
speccore verify --stage dev

# PR 阶段：代码质量 + 关键页面冒烟 + API 契约
speccore verify --stage pr

# 部署阶段：仅冒烟测试（快速门禁）
speccore verify --stage deploy

# 发布阶段：全量 UI + API + 性能回归
speccore verify --stage release
```

### 2.2 阶段映射详情

| stage | 自动参数 | 覆盖范围 | 推荐耗时 |
|:---|:---|:---|:---:|
| `dev` | `--type all` | 编译 + Lint + 单元测试 | 2-3m |
| `pr` | `--type all --ui --smoke-only --api-contract` | 代码质量 + 关键页面冒烟 + API 契约 | 5-10m |
| `deploy` | `--ui --smoke-only` | 仅 UI 冒烟测试 | 2-5m |
| `release` | `--ui --api-contract --perf` | 全量 UI + API + 性能 | 15-30m |

### 2.3 配置驱动测试（推荐）

除 `--stage` 快捷方式外，还可以使用配置文件精细控制：

```bash
# 使用预设的测试场景配置
speccore verify --config .speccore/tests/smoke.yaml --env-file staging
speccore verify --config .speccore/tests/pr.yaml --env-file staging
speccore verify --config .speccore/tests/release.yaml --env-file production
```

---

## 3. 测试配置详解

### 3.1 环境配置中的测试基础设施

```yaml
# .speccore/environments/staging.yaml
env: staging

# 测试基础设施（所有测试共用）
tests:
  base_urls:
    h5: https://staging.example.com/h5
    admin: https://admin-staging.example.com
    api: https://api-staging.example.com

  visual_model:
    provider: qwen-vl          # qwen-vl / openai / anthropic / local
    model: qwen-vl-max
    timeout: 60000

# 分层测试配置
stages:
  dev:    { config: null }
  pr:     { config: .speccore/tests/pr.yaml }
  deploy: { config: .speccore/tests/smoke.yaml }
  release:{ config: .speccore/tests/release.yaml }

# Pipeline 测试节点
pipeline:
  test:
    enabled: true
    type: smoke               # build-check / smoke / visual / api / all
    stage: pre-deploy         # pre-deploy / post-deploy / both
    fail_on_error: true
    auto_fix: true
    max_retries: 3
```

### 3.2 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|:---|:---|:---|:---|
| `tests.base_urls` | `object` | — | 各端测试基地址 |
| `tests.visual_model` | `object` | — | 视觉模型提供商配置 |
| `stages.{stage}.config` | `string\|null` | — | 阶段对应的测试场景文件路径 |
| `pipeline.test.enabled` | `boolean` | `false` | 是否启用 Pipeline 内置测试 |
| `pipeline.test.type` | `enum` | `build-check` | 测试类型 |
| `pipeline.test.stage` | `enum` | `pre-deploy` | 测试时机 |
| `pipeline.test.fail_on_error` | `boolean` | `true` | 失败是否阻断部署 |
| `pipeline.test.auto_fix` | `boolean` | `true` | 是否触发 AI 自动修复标记 |

---

## 4. 测试场景 YAML 配置

### 4.1 文件结构

```yaml
# .speccore/tests/smoke.yaml
name: 标准冒烟测试

target:
  base_url: https://staging.example.com

# 端点映射（会被环境配置中的 base_urls 合并覆盖）
endpoints:
  h5: https://staging.example.com/h5
  admin: https://admin-staging.example.com

# 测试场景
tests:
  - name: 首页-加载检查
    type: smoke              # smoke / visual / api
    routes: [/]
    threshold: normal        # strict / normal / loose
    devices: [desktop, mobile]
    browsers: [chromium]

  - name: 登录页-视觉检查
    type: visual
    routes: [/login]
    threshold: normal

  - name: API 契约验证
    type: api
    scenarios:
      - 用户登录
      - 获取订单列表

# 视觉模型配置（优先级高于环境配置）
visual_model:
  provider: qwen-vl
  model: qwen-vl-max
  timeout: 30000

output: ./reports/smoke-test-report.html
```

### 4.2 测试场景字段

| 字段 | 类型 | 必填 | 说明 |
|:---|:---|:---:|:---|
| `name` | `string` | ✅ | 场景名称 |
| `type` | `enum` | ✅ | `smoke` / `visual` / `api` |
| `routes` | `array` | — | 测试路由路径列表 |
| `scenarios` | `array` | — | API 测试场景名称列表 |
| `threshold` | `enum` | — | `strict` / `normal` / `loose` |
| `devices` | `array` | — | `desktop` / `mobile` / `tablet` |
| `browsers` | `array` | — | `chromium` / `firefox` / `webkit` |

---

## 5. VERIFY_SPEC.yaml 配置

任务级 UI 测试规格，由 split 阶段自动生成，也可手动维护：

```yaml
# Task-001/h5-mobile/VERIFY_SPEC.yaml
name: 订单模块 UI 验证
platform: h5-mobile
url: https://staging.example.com

scenarios:
  - name: 订单列表页渲染
    actions:
      - type: navigate
      - type: wait
        delay: 1000
      - type: screenshot
    assertions:
      - type: visible
        selector: "[data-testid='order-orderlist-page']"
      - type: visual
        threshold: normal

  - name: 创建订单流程
    actions:
      - type: click
        selector: "[data-testid='create-order']"
      - type: fill
        selector: "[name='customer']"
        value: "测试客户"
      - type: click
        selector: "button[type='submit']"
      - type: wait
        waitFor: ".success-message"
    assertions:
      - type: visible
        selector: ".success-message"
      - type: text
        selector: ".success-message"
        contains: "创建成功"
```

### 5.1 Action 类型

| 类型 | 参数 | 说明 |
|:---|:---|:---|
| `navigate` | `value?: url` | 导航到指定 URL |
| `fill` | `selector`, `value` | 输入文本 |
| `click` | `selector` | 点击元素 |
| `select` | `selector`, `value` | 选择下拉框 |
| `check` / `uncheck` | `selector` | 勾选/取消勾选 |
| `hover` | `selector` | 悬停 |
| `press` | `key` | 键盘按键 |
| `wait` | `delay?` / `selector?` / `waitFor?` | 等待 |
| `screenshot` | — | 截图（场景结束时自动执行） |

### 5.2 Assertion 类型

| 类型 | 参数 | 说明 |
|:---|:---|:---|
| `visible` / `hidden` | `selector` | 元素可见/隐藏 |
| `text` | `selector`, `contains?` / `equals?` | 文本内容匹配 |
| `value` | `selector`, `value?` | 输入框值匹配 |
| `url` | `contains?` / `equals?` | URL 匹配 |
| `count` | `selector`, `count` | 元素数量匹配 |
| `attribute` | `selector`, `attribute`, `value?` | 属性匹配 |
| `visual` | `threshold?` | 触发视觉检查 |

---

## 6. Pipeline 测试节点

### 6.1 测试时机

| stage | 执行时机 | 失败阻断 deploy？ | 适用场景 |
|:---|:---|:---:|:---|
| `pre-deploy`（默认） | build 后、deploy 前 | critical 阻断 | 构建产物检查、基础门禁 |
| `post-deploy` | deploy 后 | ❌ 不阻断，只报告 | 端到端验收、线上监控 |
| `both` | 前后都测 | pre 阻断 / post 不阻断 | 完整质量闭环 |

### 6.2 严重程度分级

| 严重程度 | 条件 | 阻断 deploy？ | 修复标记 |
|:---|:---|:---:|:---|
| **critical** | build-check 失败、HTTP 5xx/连接失败 | ✅ 阻断 | `[SPECCORE_PIPELINE_TEST_FAIL]` |
| **warning** | visual 差异、api 契约差异、HTTP 404 | ❌ 先部署 | `[SPECCORE_PIPELINE_TEST_DEFERRED]` |

### 6.3 推荐配置

```yaml
# 轻量部署门禁
pipeline:
  test:
    enabled: true
    type: smoke
    stage: pre-deploy
    fail_on_error: true
    auto_fix: true

# 完整质量闭环
pipeline:
  test:
    enabled: true
    type: all
    stage: both
    fail_on_error: true
    auto_fix: true
```

---

## 7. 外部项目测试

SpecCore 测试能力可以"走出去"，测试任意项目：

```bash
# 全局 --project-dir 选项，所有命令自动继承
speccore verify --project-dir ~/projects/other-app --config ./tests/smoke.yaml
speccore pipeline --project-dir ~/projects/other-app --env staging --all
```

最小外部项目配置：

```yaml
# ~/my-test-projects/minimal/.speccore/environments/test.yaml
env: test
tests:
  base_urls:
    h5: https://example.com
```

---

## 8. 常见问题

### Q1: 冒烟测试失败但服务实际正常？

**A**: 检查 `tests.base_urls` 是否指向正确的环境地址。如果服务需要预热时间，在 actions 中增加 `wait` 延迟。

### Q2: 视觉模型调用失败？

**A**: 检查：
1. `DASHSCOPE_API_KEY` / `OPENAI_API_KEY` 环境变量是否设置
2. `visual_model.provider` 是否正确
3. 网络是否能访问对应的 API 端点

### Q3: 动态路由如何测试？

**A**: 动态路由（如 `/order/:id`）需要手动配置具体的测试路径：

```yaml
tests:
  - name: 订单详情
    type: smoke
    routes:
      - /order/123    # 使用具体 ID
```

### Q4: 前端 Router 自定义路径怎么配置？

**A**: 三层优先级：
1. `--router-file` 显式指定
2. `PROJECT.yaml` 中 `verify.router_file` 配置
3. 自动扫描标准路径（`src/router/index.ts` 等）

### Q5: Split 时没自动生成 VERIFY_SPEC.yaml？

**A**: 检查：
1. `PROJECT.yaml` 中对应平台是否有 `code_path`
2. 源码路径下是否有可识别的路由配置（Vue Router / React Router）
3. 扫描失败不会阻断 split，只会静默跳过

### Q6: 测试配置中的 `data-testid` selector 不生效？

**A**: 自动生成 VERIFY_SPEC.yaml 时使用 `data-testid` 风格 selector（如 `[data-testid="order-orderlist-page"]`）。前端开发时需确保页面根元素有对应的 `data-testid` 属性。
