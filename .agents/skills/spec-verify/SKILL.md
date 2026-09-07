---
name: spec-verify
description: >
  测试验证专属 Skill。覆盖 verify 命令的测试意图识别与参数提取。
  支持自然语言（"跑一下冒烟测试"）和显式参数（--config ./tests/smoke.yaml --stage deploy）。
  参数缺失时交互式提示，自动发现测试配置文件。支持 --project-dir 测试外部项目。
  不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

# spec-verify — 测试验证（专属逻辑）

> **定位**：`/verify` 快捷入口的专属预处理层
> **覆盖命令**：`speccore verify`
> **原则**：不影响 `speccore ask` 的意图识别能力

---

## 调用方式

```
/verify [自然语言或参数]
/verify 跑一下冒烟测试
/verify --stage pr
/verify --config ./tests/smoke.yaml --env-file test
/verify --project-dir ~/projects/other-app --stage deploy
```

---

## 执行流程

```
用户输入 /verify [输入]
        │
        ▼
┌───────────────────────────────────────┐
│ Step 1: 意图识别                        │
│ 判断测试类型、阶段、目标项目              │
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
│ - 测试配置文件是否存在？                  │
│ - 环境配置是否存在？                     │
│ - 外部项目目录是否有效？                 │
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
/verify 跑冒烟测试
/verify PR 前检查一下
/verify 发布前全量回归
/verify 测试一下 H5
```
AI 从自然语言中提取参数。

**模式 B — 显式参数**：
```
/verify --stage deploy --project-dir ~/my-app
/verify --config ./tests/smoke.yaml --env-file staging
/verify --ui --url https://example.com
```
直接解析参数，不经过自然语言理解。

### 参数定义

| 参数 | 短名 | 长名 | 必填 | 默认值 | 说明 |
|:---|:---|:---|:---|:---|:---|
| stage | -s | --stage | 否 | - | 测试阶段：dev/pr/deploy/release |
| config | -c | --config | 否 | - | 测试场景配置文件路径 |
| env-file | -e | --env-file | 否 | - | 环境配置文件路径或环境名 |
| ui | -u | --ui | 否 | false | 启用 UI 验证 |
| smoke-only | - | --smoke-only | 否 | false | 仅冒烟测试 |
| visual-only | - | --visual-only | 否 | false | 仅视觉检查 |
| api-contract | - | --api-contract | 否 | false | API 契约测试 |
| perf | - | --perf | 否 | false | 性能基线测试 |
| type | -t | --type | 否 | - | 验证类型：compile/lint/test/all |
| url | - | --url | 否 | - | 目标 URL（独立模式） |
| spec | - | --spec | 否 | - | VERIFY_SPEC.yaml 路径 |
| router-file | - | --router-file | 否 | - | 前端路由配置文件路径 |
| project-dir | - | --project-dir | 否 | - | 外部项目目录路径 |

### 意图映射表

| 用户说法 | 推断命令 | 推断参数 |
|:---|:---|:---|
| "跑冒烟测试" | verify | --stage deploy |
| "PR 前检查一下" | verify | --stage pr |
| "发布前全量回归" | verify | --stage release |
| "开发时跑测试" | verify | --stage dev |
| "测试一下 H5" | verify | --ui --config ./tests/smoke.yaml |
| "验证 API 契约" | verify | --api-contract |
| "跑视觉检查" | verify | --ui --visual-only |
| "测试外部项目" | verify | --project-dir {路径} --stage deploy |

### 阶段映射详情

| stage | 自动参数 | 覆盖范围 |
|:---|:---|:---|
| dev | --type all | 编译 + Lint + 单元测试 |
| pr | --type all --ui --smoke-only --api-contract | 代码质量 + 关键页面冒烟 + API 契约 |
| deploy | --ui --smoke-only | 仅 UI 冒烟测试 |
| release | --ui --api-contract --perf | 全量 UI + API + 性能回归 |

---

## Step 2: 参数缺失 → 交互式提示

### 测试阶段缺失

```
🧪 speccore verify — 请选择测试阶段

可用阶段：
  [1] dev      — 开发阶段（编译 + Lint + 单元测试）
  [2] pr       — PR 阶段（代码质量 + 冒烟 + API 契约）
  [3] deploy   — 部署阶段（仅冒烟测试）
  [4] release  — 发布阶段（全量回归）

请回复阶段名或序号（如：deploy 或 3）
```

### 测试配置缺失（--stage 指定但无对应配置）

```
⚠️ 未找到阶段对应的测试配置文件

建议操作：
  1. 运行 speccore update 初始化默认测试配置模板
  2. 手动创建 .speccore/tests/smoke.yaml
  3. 使用 --config 显式指定配置路径
```

---

## Step 3: 前置校验

### 校验项

1. **外部项目目录有效性**（指定 --project-dir 时）
   - 检查目录是否存在
   - 检查是否为 Git 仓库（可选）

2. **测试配置文件存在性**（指定 --config 时）
   - 检查文件是否存在
   - 不存在 → 提示可用配置列表

3. **环境配置存在性**（指定 --env-file 时）
   - 检查 `.speccore/environments/{env}.yaml` 是否存在
   - 不存在 → 提示可用环境列表

---

## 命令组装规则

### verify（默认）
```bash
speccore verify [--stage {stage}] [--config {path}] [--env-file {env}] [--ui] [--smoke-only] [--visual-only] [--api-contract] [--perf] [--type {type}] [--url {url}] [--spec {spec}] [--router-file {path}] [--project-dir {dir}]
```

**意图 → 命令映射**：
- 用户说"冒烟"、"smoke" → `--stage deploy` 或 `--ui --smoke-only`
- 用户说"PR"、"提交前" → `--stage pr`
- 用户说"发布"、"上线前"、"回归" → `--stage release`
- 用户说"编译"、"lint"、"单元测试" → `--stage dev`
- 用户说"视觉"、"截图" → `--ui --visual-only`
- 用户说"API"、"契约" → `--api-contract`
- 用户说"性能" → `--perf`

---

## 外部项目测试

```bash
/verify --project-dir ~/projects/other-app --stage deploy
/verify --project-dir ~/projects/other-app --config ./tests/smoke.yaml
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

## 错误处理

| 场景 | 提示 |
|:---|:---|
| 测试配置不存在 | "未找到测试配置文件，运行 `speccore update` 初始化默认配置" |
| 环境配置不存在 | "环境 {env} 未配置，运行 `speccore update` 初始化默认环境" |
| 外部项目目录无效 | "目录 {path} 不存在，请检查路径" |
| 视觉模型调用失败 | "视觉模型调用失败，检查 DASHSCOPE_API_KEY / OPENAI_API_KEY 环境变量" |
