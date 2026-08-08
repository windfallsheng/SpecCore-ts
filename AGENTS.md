# AGENTS.md — SpecCore AI 助手配置

> **定位**: 路由决策表。不装知识，只做路由。始终加载(< 80 行)。

---

## 🚫 核心禁止规则

| 禁止行为 | 原因 | 例外 |
|:---|:---|:---|
| **禁止输出 `speccore xxx` 命令文本给用户复制** | AI 上下文必须用 `execute_command` 执行 | 用户明确要求"只看不跑" |
| **禁止无 ANALYSIS.md 时执行 execute** | 分析文件是代码生成的前提 | `speccore init` 首次初始化 |
| **禁止跳过 analyze 直接 execute** | 分析 → 计划 → 执行 是强制性链路 | `--force` 用户明确知晓风险 |
| **禁止在 explore/spec-dev 模式写代码** | 探索阶段只读不改 | 无 |
| **禁止一次执行多个不相关的 Task** | 防止上下文过长导致幻觉 | `--all` 批量模式 |

---

## 📋 Skill 路由表

| 用户意图（关键词） | 动作 | 说明 |
|:---|:---|:---|
| "创建任务" "新建任务" "bug任务" "审查任务" "测试任务" | 加载 `spec-task-create` → `execute_command` | 10 种任务类型选择器 + 智能命名 |
| "创建迭代" "新建迭代" | 加载 `spec-iteration-create` → `execute_command` | 自动英文关键词 + 平台检查 |
| "分析" "audit" "审查代码" "安全审计" | 加载 `spec-analyze` → `execute_command` | 10 种分析模板，自动/交互双模式 |
| "开发" "执行" "写代码" "跑任务" | 加载 `spec-execute` → `execute_command` | Prompt/Apply 模式 |
| "下一步" "流水线" "进度" "推进" | 加载 `spec-dev` → 展示状态，等用户确认 | 状态检测 + 推荐下一步 |
| "导入文档" "Word" "Excel" "CSV" | 加载 `spec-doc2spec` → `execute_command` | 多格式导入 + 图片提取 |
| "导出文档" "生成报告" | 加载 `spec-spec2doc` → `execute_command` | Spec → Word/PDF/HTML/PPTX |
| "规划" "拆任务" "分任务" | 加载 `spec-split` 或 `spec-plan` → `execute_command` | 拆分 + 计划生成 |
| "变更" "改需求" "修改" | 加载 `spec-change` → `execute_command` | 联动更新关联 Spec |
| **模糊/复杂意图**（无法匹配以上） | `execute_command("speccore ask '...'")` | 路由到 ask 引擎推理 |
| "多步" "然后" "再" "接着" "定时" "分批" | `execute_command("speccore ask '...'")` | 路由到 ask 引擎 → pipeline 模式 |

---

## 🔄 退出码 → 下一个 Skill

| exitCode | 含义 | 交接给 |
|:---|:---|:---|
| 0 | 成功完成 | 展示结果，推荐下一步 |
| 10 | 需要 AI 生成内容 | 当前 Skill 的生成逻辑 (Prompt/Apply) |
| 11 | 参数缺失 | 追问用户补参，重试 |
| 其他 | 执行失败 | [重试 ≤2次 / 跳过 / 停止] |

---

## 🏷️ 输出标记处理规则

| 标记 | 含义 | 动作 |
|:---|:---|:---|
| `[SPECCORE_ONBOARD: <path>]` | 首次/升级引导页 | **必须用 `present_files` 立即展示**，不要等到其他内容处理完 |
| `[SPECCORE_MODE: <mode>]` | intent 模式 | 读取模式，决定后续流程 |
| `[SPECCORE_EXEC: <cmd>]` | 自动执行命令 | 按 `autoExecute` 规则执行 |
| `[SPECCORE_EXEC_STATUS: ok\|fail]` | 执行结果 | 成功继续，失败处理 |
| `[SPECCORE_INTENT]...[\END]` | 意图确认块 | 展示给用户，等确认 |
| `[SPECCORE_CONFIRM_NEEDED]...[\END]` | 需要用户确认 | 用 `AskUserQuestion` 确认/修改/取消 |
| `[SPECCORE_ABOUT: <path>]` | 版本信息页 | 用 `present_files` 展示 |

**关键**: `[SPECCORE_ONBOARD]` 必须优先处理，在展示引导页之前不处理其他标记。

---

## 📁 Skill 标准结构

每个 Skill 必须遵循三段式：

```
SKILL.md          ← ≤500 行，聚焦执行指令
references/       ← 按需加载的模板、规范文档
scripts/          ← 确定性操作（验证/格式化）
assets/           ← 示例输出/图标
```

---

> 本文件由 Speccore 自动维护。路径: `.agents/skills/*/SKILL.md`
> 模板: `references/` (analysis-report, code-output, requirement-template, plan-template)
