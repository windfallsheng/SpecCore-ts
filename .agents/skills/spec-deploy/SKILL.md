---
name: spec-deploy
description: >
  部署专属 Skill。覆盖 build / deploy / pipeline 命令的意图识别与参数提取。
  支持自然语言（"部署到测试环境"）和显式参数（--env test --all）。
  参数缺失时交互式提示，前置校验环境配置与平台有效性。
  支持 Pipeline 内置测试节点（--test-enabled）和分层测试策略。
  不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

# spec-deploy — 构建与部署（专属逻辑）

> **定位**：`/deploy` 快捷入口的专属预处理层
> **覆盖命令**：`speccore build`、`speccore deploy`、`speccore pipeline`
> **原则**：不影响 `speccore ask` 的意图识别能力

---

## 调用方式

```
/deploy [自然语言或参数]
/deploy 部署到测试环境
/deploy --env test --platforms h5,api
/deploy --env staging --all --dry-run
/build --platform h5 --env local

# 测试外部项目（非当前 SpecCore 项目）
/deploy --project-dir ~/projects/other-app --env staging --all
/verify --project-dir ~/projects/third-party-api --config ./tests/api.yaml --env-file test
```

---

## 外部项目支持（v8.3.60+）

`--project-dir` 是**全局选项**，所有命令自动继承。SpecCore 的能力可以"走出去"，用于任意外部项目，不仅限于当前 SpecCore 管理的项目。

### 原理

```
speccore <任意命令> --project-dir <外部目录>
         │
         ▼
    全局 preAction hook
         │
         ▼
    process.chdir(外部目录)
         │
         ▼
    所有配置从外部目录读取
    所有操作在外部目录执行
```

### 外部项目目录结构

```
~/my-test-projects/
├── company-app/
│   ├── PROJECT.yaml                    # 定义 platforms（可选）
│   ├── .speccore/
│   │   └── environments/
│   │       ├── staging.yaml            # 环境配置 + tests.base_urls
│   │       └── production.yaml
│   ├── tests/
│   │   ├── smoke.yaml                  # 测试场景
│   │   └── api.yaml
│   └── API_CONTRACT.yaml               # API 契约（可选）
│
└── third-party-api/
    ├── .speccore/
    │   └── environments/
    │       └── test.yaml
    └── tests/
        └── quick.yaml
```

### 各命令外部项目示例

```bash
# ===== 测试相关 =====
# Pipeline 测试外部项目
speccore pipeline --project-dir ~/my-test-projects/company-app --env staging --all

# Verify 测试外部项目
speccore verify --project-dir ~/my-test-projects/company-app --config ./tests/smoke.yaml

# 仅做构建检查（无需 PROJECT.yaml）
speccore verify --project-dir ~/my-test-projects/company-app --ui --url https://staging.example.com

# ===== 文档转换（像 doc2spec 一样外用）=====
# 将外部项目的 PRD 转换为 Spec
speccore doc2spec --project-dir ~/my-test-projects/company-app --input ./docs/requirement.docx

# 将外部项目的 Spec 导出为 Word
speccore spec2doc --project-dir ~/my-test-projects/company-app --output ./reports/

# ===== 项目诊断 =====
# 诊断外部项目的健康度
speccore doctor --project-dir ~/my-test-projects/company-app --fix

# ===== 搜索 =====
# 在外部项目中搜索文档
speccore search --project-dir ~/my-test-projects/company-app "登录相关的需求"

# ===== 构建部署 =====
# 构建/部署外部项目
speccore build --project-dir ~/my-test-projects/company-app --env staging --platform h5
speccore deploy --project-dir ~/my-test-projects/company-app --env staging --all
```

### 最小外部项目配置

外部项目可以只有环境配置，无需完整的 SpecCore 项目结构：

```yaml
# ~/my-test-projects/minimal/.speccore/environments/test.yaml
env: test
tests:
  base_urls:
    h5: https://example.com
```

```bash
speccore verify --project-dir ~/my-test-projects/minimal --ui --env-file test
```

---

## 执行流程

```
用户输入 /deploy [输入]
        │
        ▼
┌───────────────────────────────────────┐
│ Step 1: 意图识别                        │
│ 判断是 build / deploy / pipeline        │
│ 从自然语言或显式参数提取参数              │
└───────────────┬───────────────────────┘
                │
        参数缺失？
                │
        是 ──► 输出交互式提示
                │
        否 ──► 继续
                │
                ▼
┌───────────────────────────────────────┐
│ Step 2: 前置校验                        │
│ - 环境配置是否存在？                    │
│ - 指定平台是否在 PROJECT.yaml 中？      │
│ - 当前分支是否能获取？（pipeline 需要）  │
└───────────────┬───────────────────────┘
                │
        校验失败？
                │
        是 ──► 输出问题 + 修复建议
                │
        否 ──► 继续
                │
                ▼
┌───────────────────────────────────────┐
│ Step 3: 执行                            │
│ 直接 execute_command 执行 CLI 命令      │
└───────────────────────────────────────┘
```

---

## Step 1: 意图识别与参数提取

### 双模式支持

**模式 A — 自然语言（默认）**：
```
/deploy 把当前功能部署到测试环境
/deploy 构建一下 H5
/deploy 预览生产环境部署
```
AI 从自然语言中提取参数。

**模式 B — 显式参数**：
```
/deploy --env test --platforms h5,api --dry-run
/build --env local --platform h5
```
直接解析参数，不经过自然语言理解。

### 参数定义

| 参数 | 短名 | 长名 | 必填 | 默认值 | 说明 |
|:---|:---|:---|:---|:---|:---|
| env | -e | --env | 否 | `staging` | 目标环境名（对应 .speccore/environments/{env}.yaml） |
| platforms | -p | --platforms | 否 | - | 逗号分隔端列表（与 --all 互斥） |
| all | -a | --all | 否 | false | 所有端 |
| dry-run | -d | --dry-run | 否 | false | 预览模式，不实际执行 |
| skip-build | -s | --skip-build | 否 | false | 跳过构建（仅 pipeline） |
| env-file | -f | --env-file | 否 | - | 指定环境配置文件路径 |
| project-dir | - | --project-dir | 否 | - | 外部项目目录路径（全局选项） |

### 意图映射表

| 用户说法 | 推断命令 | 推断参数 |
|:---|:---|:---|
| "部署到测试环境" | pipeline | --env test --all |
| "构建 H5" | build | --platform h5 |
| "部署 H5 到测试环境" | pipeline | --env test --platforms h5 |
| "预览生产部署" | pipeline | --env production --all --dry-run |
| "把当前分支合并到 develop 并部署" | pipeline | --env dev --all |
| "只部署不构建" | pipeline | --env staging --all --skip-build |
| "用自定义配置部署" | pipeline | --env-file ./my-env.yaml --all |
| "本地构建验证" | build | --env local --platform h5 |
| "本地部署看看效果" | deploy | --env local --platform h5 |
| "跑冒烟测试" | verify | --stage deploy |
| "PR 前跑测试" | verify | --stage pr |
| "发布前全量回归" | verify | --stage release |

---

## Step 2: 参数缺失 → 交互式提示

### 环境名缺失

```
🚀 speccore deploy — 请选择目标环境

可用环境（从 .speccore/environments/ 读取）：
  [1] local    — 本地开发
  [2] dev      — 开发联调
  [3] test     — 测试环境
  [4] staging  — 预发布
  [5] production — 生产环境

请回复环境名或序号（如：test 或 3）
```

### 平台缺失（且未指定 --all）

```
📦 speccore deploy — 请选择目标平台

可用平台（从 PROJECT.yaml 读取）：
  [1] h5         — H5 移动端
  [2] admin-web  — 管理后台
  [3] order-api  — 订单服务

选项：
  - 回复平台名或序号（如：h5 或 1）
  - 回复 "all" 或 "全部" 部署所有平台
  - 回复逗号分隔多选（如：h5,order-api）
```

---

## Step 3: 前置校验

### 校验项

1. **环境配置存在性**
   - 检查 `.speccore/environments/{env}.yaml` 是否存在
   - 不存在 → 提示："环境 {env} 未配置，运行 `speccore update` 初始化默认环境配置"

2. **平台有效性**
   - 检查指定平台是否在 PROJECT.yaml 的 platforms 列表中
   - 不存在 → 提示可用平台列表

3. **pipeline 分支检查**
   - 检查环境配置中是否配置了 `branch`
   - 未配置 → 提示："环境 {env} 未配置 branch，pipeline 无法执行 merge"

4. **Git 仓库检查（pipeline 需要）**
   - 检查当前目录是否为 Git 仓库
   - 检查当前分支是否能获取

---

## 命令组装规则

### pipeline（默认）
```bash
speccore pipeline --env {env} {--platforms p1,p2 | --all} [--dry-run] [--skip-build] [--env-file path] [--project-dir dir]
```

### build
```bash
speccore build --env {env} {--platform p | --all} [--env-file path] [--project-dir dir]
```

### deploy
```bash
speccore deploy --env {env} {--platform p | --all} [--dry-run] [--skip-build] [--env-file path] [--project-dir dir]
```

**意图 → 命令映射**：
- 用户说"构建"或"build" → `build`
- 用户说"部署"且不带 merge/checkout → `deploy`
- 用户说"流水线"、"合并部署"、"pipeline"或只说"部署"（含 merge 语义）→ `pipeline`

---

## 错误处理

| 场景 | 提示 |
|:---|:---|
| 环境配置不存在 | "环境 {env} 未配置，运行 `speccore update` 初始化默认环境配置" |
| 平台不存在 | "平台 {platform} 不在 PROJECT.yaml 中，可用平台：..." |
| 分支未配置 | "环境 {env} 未配置 branch，pipeline 无法执行 merge" |
| Git 检查失败 | "当前目录不是 Git 仓库，或无法获取当前分支" |
