---
name: spec-spec2doc
description: >
  规格转文档专属 Skill。在调用 speccore ask 之前，执行参数提取、
  前置校验（迭代/Task 存在性），参数缺失时输出交互式提示。
  不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

# spec-spec2doc — 规格转文档（专属逻辑）

> **定位**：`/spec2doc` 快捷入口的专属预处理层
> **原则**：不影响 `speccore ask` 的意图识别能力

---

## 调用方式

```
/spec2doc [参数]
/spec2doc -I Iteration-001 --task Task-001
/spec2doc -I Iteration-001 --all
```

---

## 执行流程

```
用户输入 /spec2doc [参数]
        │
        ▼
┌───────────────────────────────────────┐
│ Step 1: 参数提取                        │
│ 从用户输入提取 iteration/task/format 等 │
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
│ - 迭代是否存在？                        │
│ - Task 是否存在？                       │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ Step 3: 调用 speccore ask               │
└───────────────────────────────────────┘
```

---

## Step 1: 参数提取

| 参数 | 短名 | 长名 | 必填 | 说明 |
|:---|:---|:---|:---|:---|
| iteration | -i | --iteration | 否 | 目标迭代名 |
| task | -t | --task | 否 | 指定 Task（与 --all 互斥）|
| all | -a | --all | 否 | 全部 Task |
| format | -f | --format | 否 | 输出格式（md/pdf/html，默认 md）|
| output | -o | --output | 否 | 输出文件路径 |

---

## Step 2: 参数缺失 → 交互式提示

```
📄 speccore spec2doc — 规格转文档

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 当前环境
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
迭代: Iteration-001-meeting-system（从 context.json 读取）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📖 可用参数
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  -I, --iteration <name>    目标迭代（默认: 当前迭代）
  -t, --task <id>           指定 Task（如 Task-001）
  -a, --all                 全部 Task
  -f, --format <format>     输出格式: md | pdf | html（默认 md）
  -o, --output <path>       输出文件路径

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 使用示例
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /spec2doc -t Task-001                     # 导出单个 Task
  /spec2doc --all                           # 导出全部 Task
  /spec2doc --all -f pdf                    # 导出为 PDF
  /spec2doc -t Task-001 -o ./output.md      # 指定输出路径

请补充参数后重新调用。
```

---

## Step 3: 前置校验

### 3.1 检查迭代是否存在
```bash
# 检查迭代目录是否存在
# 如果不存在 → 提示用户
```

### 3.2 检查 Task 是否存在
```bash
# 如果指定了 -t，检查 Task 目录是否存在
# 如果不存在 → 列出可用 Task
```

### 3.3 检查输出格式
```bash
# 支持的格式: md, pdf, html
# 如果格式不支持 → 提示可用格式
```

---

## Step 4: 调用 speccore ask

```bash
execute_command("speccore ask '将规格转为文档...'")
```

> ⚠️ 最终仍然调用 `speccore ask`，不要绕过 ask 引擎。
