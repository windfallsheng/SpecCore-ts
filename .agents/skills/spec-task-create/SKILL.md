---
name: spec-task-create
description: >
  创建开发任务专属 Skill。在调用 speccore ask 之前，执行参数提取、
  前置校验（迭代存在性、主题词有效性、命名冲突检测），
  参数缺失时输出交互式提示。不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

# spec-task-create — 创建开发任务（专属逻辑）

> **定位**：`/task-create` 快捷入口的专属预处理层
> **原则**：不影响 `speccore ask` 的意图识别能力

---

## 调用方式

```
/task-create [参数]
/task-create -n "用户登录" --topic user-login -i Q1 -t feature
/task-create --batch "登录页,注册页,首页" -i Q1 -t feature
```

---

## 执行流程

```
用户输入 /task-create [参数]
        │
        ▼
┌───────────────────────────────────────┐
│ Step 1: 参数提取                        │
│ 从用户输入提取 name/topic/iteration/type │
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
│ Step 2: 参数补全                        │
│ topic 缺失 → AI 从中文名提取英文主题词     │
│ iteration 缺失 → 读 context.json         │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ Step 3: 前置校验                        │
│ - 迭代是否存在？                        │
│ - 主题词是否有效？                      │
│ - 是否命名冲突？                        │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ Step 4: 调用 speccore ask               │
└───────────────────────────────────────┘
```

---

## Step 1: 参数提取

| 参数 | 短名 | 长名 | 必填 | 说明 |
|:---|:---|:---|:---|:---|
| name | -n | --name | 是 | 任务中文名称 |
| topic | - | --topic | 否 | 英文主题词（用于目录命名）|
| iteration | -i | --iteration | 否 | 目标迭代名 |
| type | -t | --type | 否 | 任务类型: feature / bugfix / research / refactor |
| batch | -b | --batch | 否 | 批量创建（逗号分隔的名称列表）|
| owner | -o | --owner | 否 | 任务负责人 |

---

## Step 2: 参数缺失 → 交互式提示

```
📋 speccore task-create — 创建开发任务

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 当前环境
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
迭代: Iteration-001-meeting-system（从 context.json 读取）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📖 可用参数
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  -n, --name <name>         任务中文名称（必填）
      --topic <topic>       英文主题词（如 user-login, payment）
                            用于生成目录名，缺失时 AI 自动提取
  -i, --iteration <name>    目标迭代（默认: 当前迭代）
  -t, --type <type>         任务类型: feature | bugfix | research | refactor
                            默认: feature
  -b, --batch <names>       批量创建（逗号分隔，如 "登录,注册,首页"）
  -o, --owner <name>        任务负责人

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 使用示例
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /task-create -n "用户登录" --topic user-login    # 创建单个任务
  /task-create -n "支付接口" -t feature            # AI 自动提取主题词
  /task-create --batch "登录页,注册页,首页"        # 批量创建 3 个任务
  /task-create -n "订单退款" -i Q1 -t bugfix       # 指定迭代和类型

请补充 --name 参数后重新调用。
```

---

## Step 3: 前置校验

### 3.1 检查迭代是否存在
```bash
# 检查迭代目录是否存在
# 如果不存在 → 提示用户先创建迭代
```

### 3.2 提取英文主题词
```bash
# 如果用户未提供 --topic，从 --name 提取英文主题词
# "用户登录" → "user-login"
# "支付接口修复" → "payment-fix"
# "批量创建"时不单独提取，每个名称各自提取
```

### 3.3 检查命名冲突
```bash
# 检查 030-tasks/ 下是否已有同名 Task
# 如果冲突 → 提示用户是否覆盖或改名
```

### 3.4 检查任务类型
```bash
# 有效类型: feature, bugfix, research, refactor
# 如果无效 → 提示可用类型
```

---

## Step 4: 调用 speccore ask

```bash
execute_command("speccore ask '创建 Task-XXX 任务...'")
```

> ⚠️ 最终仍然调用 `speccore ask`，不要绕过 ask 引擎。

---

## 批量创建模式

当使用 `--batch` 时：
1. 解析逗号分隔的名称列表
2. 为每个名称提取英文主题词
3. 逐个创建 Task 目录
4. 输出批量创建结果汇总
