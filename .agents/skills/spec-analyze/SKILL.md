---
name: spec-analyze
description: >
  需求分析专属 Skill。在调用 speccore ask 之前，执行参数提取、
  前置校验（迭代存在性、需求文档检测、专业度评估、端列表读取），
  参数缺失时输出交互式提示。不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

# spec-analyze — 需求分析（专属逻辑）

> **定位**：`/analyze` 快捷入口的专属预处理层
> **原则**：不影响 `speccore ask` 的意图识别能力

---

## 调用方式

```
/analyze [参数]
/analyze -I Iteration-001 --auto
/analyze -I Iteration-001 --scope global --with-code
/analyze -I Iteration-001 --clarify
```

---

## 执行流程

```
用户输入 /analyze [参数]
        │
        ▼
┌───────────────────────────────────────┐
│ Step 1: 参数提取                        │
│ 从用户输入提取 iteration/scope/auto 等   │
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
│ iteration 缺失 → 读 context.json         │
│ scope 缺失 → 根据上下文推断              │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ Step 3: 前置校验                        │
│ - 迭代是否存在？                        │
│ - 需求文档是否存在？                    │
│ - 需求专业度评估（clarify）             │
│ - CONSTITUTION 端列表读取               │
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
| iteration | -i | --iteration | 否 | 目标迭代名 |
| scope | -s | --scope | 否 | 分析范围: global / iteration / task |
| auto | -a | --auto | 否 | 全自动模式（不交互）|
| with-code | -c | --with-code | 否 | 结合源码分析 |
| full | -f | --full | 否 | 全自动三阶段合成（原 synthesize）|
| phase | -p | --phase | 否 | 单阶段执行 1/2/3 |
| clarify | - | --clarify | 否 | 需求专业度检测，口语化时触发 clarify |
| dev-guide | - | --dev-guide | 否 | 生成 DEV_GUIDE.md 实现指南 |
| platforms | - | --platforms | 否 | 只分析指定端 |
| prompt | - | --prompt | 否 | 只输出 Prompt，不执行 |
| apply | - | --apply | 否 | 应用 AI 分析结果（支持 @file.json）|

---

## Step 2: 参数缺失 → 交互式提示

```
🔍 speccore analyze — 需求分析

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 当前环境
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
迭代: Iteration-001-meeting-system（从 context.json 读取）
端列表: api, h5-mobile, admin-web（从 CONSTITUTION.md 读取）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📖 可用参数
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  -I, --iteration <name>    目标迭代（默认: 当前迭代）
  -s, --scope <scope>       分析范围:
                            global    — 全局层分析（项目级，跨端）
                            iteration — 迭代级分析（默认）
                            task      — 任务级分析
  -a, --auto                全自动模式（不交互，直接输出）
  -c, --with-code           结合源码分析（扫描各端源码）
      --full                全自动三阶段合成（原 synthesize --full）
      --phase <N>           单阶段执行: 1(逐端) | 2(跨端) | 3(索引)
      --clarify             需求专业度检测，口语化时自动触发澄清
      --dev-guide           同时生成 DEV_GUIDE.md 开发者实现指南
      --platforms <list>    只分析指定端（如 api,h5）
      --prompt              只输出 Prompt，不执行分析
      --apply <json|@file>  应用 AI 分析结果（支持 @file.json 文件方式）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 使用示例
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /analyze -I Q1 --auto                   # 全自动分析迭代
  /analyze --scope global --with-code     # 全局层 + 源码分析
  /analyze --full                         # 三阶段全量合成
  /analyze --clarify                      # 检测需求专业度
  /analyze --dev-guide                    # 分析 + 生成实现指南
  /analyze --platforms api,h5             # 只分析 api 和 h5 端
  /analyze --prompt                       # 只输出 Prompt

请补充参数后重新调用，或直接调用 /analyze 使用默认设置。
```

---

## Step 3: 前置校验

### 3.1 检查迭代是否存在
```bash
# 检查迭代目录是否存在
# 如果不存在 → 提示用户先创建迭代
```

### 3.2 检查需求文档
```bash
# 检查 010-requirements/REQUIREMENT.md 或 converted/*.md 是否存在
# 如果不存在 → 提示用户先准备需求文档
```

### 3.3 需求专业度检测（--clarify）
```bash
# 读取 REQUIREMENT.md 或用户输入
# 检测指标：
#   - 口语化表达（"我要/我想/能不能"）
#   - 缺少结构化标题（## / ###）
#   - 缺少验收标准
#   - 缺少技术约束
#   - 缺少错误处理
#   - 缺少数据模型
# 如果专业度低 → 提示用户先执行 clarify
```

### 3.4 读取端列表
```bash
# 从 CONSTITUTION.md 读取项目配置的端列表
# 如果 --platforms 指定了不存在的端 → 提示可用端
```

### 3.5 检查 --apply 文件
```bash
# 如果 --apply 以 @ 开头，从文件读取 JSON
# 检查文件是否存在
```

---

## Step 4: 调用 speccore ask

```bash
execute_command("speccore ask '分析 Iteration-XXX...'")
```

> ⚠️ 最终仍然调用 `speccore ask`，不要绕过 ask 引擎。
