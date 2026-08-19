---
name: spec-iteration-create
description: >
  创建迭代专属 Skill。在调用 speccore ask 之前，执行参数提取、
  前置校验（迭代名是否已存在、主题词有效性），
  参数缺失时输出交互式提示。不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

# spec-iteration-create — 创建迭代（专属逻辑）

> **定位**：`/iteration-create` 快捷入口的专属预处理层
> **原则**：不影响 `speccore ask` 的意图识别能力

---

## 调用方式

```
/iteration-create [参数]
/iteration-create -n Q2 --topic meeting-system --owner luzhaosheng
```

---

## 执行流程

```
用户输入 /iteration-create [参数]
        │
        ▼
┌───────────────────────────────────────┐
│ Step 1: 参数提取                        │
│ 从用户输入提取 name/topic/owner 等      │
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
│ owner 缺失 → 读 git config user.name     │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ Step 3: 前置校验                        │
│ - 迭代名是否已存在？                    │
│ - 主题词是否有效？                      │
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
| name | -n | --name | 是 | 迭代名称（如 Q1, V2.0, Sprint-3）|
| topic | - | --topic | 否 | 英文主题词（用于目录命名）|
| owner | -o | --owner | 否 | 迭代负责人 |
| template | -t | --template | 否 | 模板名称（默认 standard）|

---

## Step 2: 参数缺失 → 交互式提示

```
📁 speccore iteration-create — 创建迭代

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📖 可用参数
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  -n, --name <name>         迭代名称（必填）
                            如: Q1, V2.0, Sprint-3, 会议系统
      --topic <topic>       英文主题词（如 meeting-system, payment）
                            用于生成目录名，缺失时 AI 自动提取
  -o, --owner <name>        迭代负责人（默认: git config user.name）
  -t, --template <name>     模板名称（默认: standard）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 使用示例
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /iteration-create -n Q1 --topic meeting-system    # 创建 Q1 迭代
  /iteration-create -n "支付模块"                    # AI 自动提取主题词
  /iteration-create -n V2.0 --owner luzhaosheng     # 指定负责人

请补充 --name 参数后重新调用。
```

---

## Step 3: 前置校验

### 3.1 检查迭代名是否已存在
```bash
# 检查 .speccore/ITERATIONS/ 或项目根目录下是否已有同名迭代
# 如果已存在 → 提示用户是否覆盖或改名
```

### 3.2 提取英文主题词
```bash
# 如果用户未提供 --topic，从 --name 提取英文主题词
# "会议系统" → "meeting-system"
# "Q1" → "q1"
# "支付模块" → "payment"
```

### 3.3 检查 owner
```bash
# 如果未提供 --owner，读取 git config user.name
# 如果 git 未配置 → 提示用户提供
```

---

## Step 4: 调用 speccore ask

```bash
execute_command("speccore ask '创建 Iteration-XXX 迭代...'")
```

> ⚠️ 最终仍然调用 `speccore ask`，不要绕过 ask 引擎。
