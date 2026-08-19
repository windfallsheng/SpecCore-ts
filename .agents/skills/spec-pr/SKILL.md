---
name: spec-pr
description: >
  代码提交与 PR 专属 Skill。在调用 speccore ask 之前，执行参数提取、
  前置校验（分支安全检查、未提交变更检测、ANALYSIS.md 路径校验、冲突检测），
  参数缺失时输出交互式提示。不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

# spec-pr — 代码提交与 PR（专属逻辑）

> **定位**：`/pr` 快捷入口的专属预处理层
> **原则**：不影响 `speccore ask` 的意图识别能力

---

## 调用方式

```
/pr [参数]
/pr --task Task-001 --commit
/pr --task Task-001 --force
/pr --task Task-001 --prompt
```

---

## 执行流程

```
用户输入 /pr [参数]
        │
        ▼
┌───────────────────────────────────────┐
│ Step 1: 参数提取                        │
│ 从用户输入提取 task/iteration/commit 等  │
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
│ Step 2: 前置校验（安全检查）              │
│ - 当前分支不是 main/master？             │
│ - 有未提交的变更？                      │
│ - ANALYSIS.md 是否存在？                │
│ - 是否有合并冲突？                      │
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
│ Step 3: 调用 speccore ask               │
└───────────────────────────────────────┘
```

---

## Step 1: 参数提取

| 参数 | 短名 | 长名 | 必填 | 说明 |
|:---|:---|:---|:---|:---|
| task | -t | --task | 否 | 目标 Task（默认 current）|
| iteration | -i | --iteration | 否 | 目标迭代名 |
| base | -b | --base | 否 | PR 目标分支（默认 main）|
| draft | -d | --draft | 否 | 创建 Draft PR |
| title | - | --title | 否 | PR 标题 |
| commit | -c | --commit | 否 | 只提交不创建远程 PR |
| force | -f | --force | 否 | 非交互自动提交（流水线用）|
| confirm | - | --confirm | 否 | 确认提交（覆盖安全检查）|
| prompt | -p | --prompt | 否 | 输出 PR 分析 Prompt |
| response | -r | --response | 否 | 接收 AI 分析结果（JSON）|

---

## Step 2: 参数缺失 → 交互式提示

```
🔀 speccore pr — 代码提交与 PR

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 当前环境
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
迭代: Iteration-001-meeting-system（从 context.json 读取）
当前分支: feature/Task-001-user-login
保护分支: main（不可直接推送）
未提交变更: 3 个文件

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📖 可用参数
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  -t, --task <id>           目标 Task（默认: current）
  -i, --iteration <name>    目标迭代（默认: 当前迭代）
  -b, --base <branch>       PR 目标分支（默认: main）
  -d, --draft               创建 Draft PR
      --title <title>       PR 标题
  -c, --commit              只提交不创建远程 PR
  -f, --force               非交互自动提交（流水线用）
      --confirm             确认提交（覆盖安全检查）
  -p, --prompt              输出 PR 分析 Prompt
  -r, --response <json>     接收 AI 分析结果

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 使用示例
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  /pr -t Task-001                           # 提交 Task-001 的变更
  /pr -t Task-001 --commit                  # 只提交不推远程
  /pr -t Task-001 --force                   # 自动提交（流水线用）
  /pr -t Task-001 --prompt                  # 生成 PR 分析 Prompt
  /pr -t Task-001 -r '{...json...}'         # 应用 AI 分析结果
  /pr -t Task-001 --base develop            # 目标分支为 develop

请补充参数后重新调用，或直接调用 /pr 提交当前变更。
```

---

## Step 3: 前置校验（安全检查）

### 3.1 分支安全检查
```bash
# 检查当前分支
# 如果是 main/master → 阻止提交，提示创建 feature 分支
# 如果是 feature/Task-XXX → 正常通过
```

### 3.2 未提交变更检测
```bash
# 检查 git status
# 如果没有变更 → 提示没有可提交的内容
# 如果有变更 → 列出变更文件摘要
```

### 3.3 ANALYSIS.md 路径校验
```bash
# 检查 020-specs/ANALYSIS.md 或 030-tasks/Task-XXX/00-specs/REQ.md
# 如果不存在 → 提示缺少分析文档（PR 描述质量会降低）
```

### 3.4 冲突检测
```bash
# 检查 git diff --check（空白冲突）
# 检查是否有未解决的合并标记（<<<<<<<）
```

### 3.5 远程仓库检查
```bash
# 检查是否配置了远程仓库 origin
# 如果没有 → 提示先配置远程仓库
```

---

## Step 4: 调用 speccore ask

```bash
execute_command("speccore ask '提交 Task-XXX 的代码...'")
```

> ⚠️ 最终仍然调用 `speccore ask`，不要绕过 ask 引擎。

---

## 核心流程（保留）

```
用户说 "提交 Task-001"
        │
        ▼
┌─ 1. Prompt 模式 ─────────────────────────────┐
│  speccore pr --prompt -t Task-001              │
│  → CLI 收集 git diff + 读取 ANALYSIS.md       │
│  → 输出 PR 分析 Prompt 给 AI                   │
└───────────────┬────────────────────────────────┘
                │
                ▼
┌─ 2. AI 分析 ─────────────────────────────────┐
│  AI 返回 JSON:                                 │
│  {                                             │
│    "commitMsg": "提交信息（中文，<72字）",      │
│    "analysisMatch": true|false,               │
│    "mismatchReason": "...",                   │
│    "recommendation": "auto-commit|confirm-first"│
│  }                                             │
└───────────────┬────────────────────────────────┘
                │
                ▼
┌─ 3. 安全检查 ────────────────────────────────┐
│  analysisMatch=false → 提示用户确认            │
│  analysisMatch=true  → 自动提交               │
└───────────────┬────────────────────────────────┘
                │
                ▼
┌─ 4. 执行提交 ────────────────────────────────┐
│  git add -A → git commit -m "..." → git push  │
│  保护分支检查：main/master 不推送               │
└───────────────────────────────────────────────┘
```

## 铁律

1. **绝不提交到 main/master** — 必须通过 PR 合并
2. **analysisMatch=false 时必须确认** — 防止变更超出分析范围
3. **无变更时不执行** — 避免空提交
