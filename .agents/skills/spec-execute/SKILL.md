---
name: spec-execute
description: >
  执行开发专属 Skill。参数提取与前置校验（任务状态检查、代码模式读取、上下文准备）由 speccore ask 引擎执行；
  参数缺失时引擎输出 [SPECCORE_NEEDS_INFO] 交互式提示（参数说明 + 使用示例）。
  不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read", "Write", "Edit"]
disable-model-invocation: false
---

直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。

## 🎯 高频表达的默认语义映射（v8.3.387+）

以下高频表达有明确默认语义，禁止降格理解、禁止打折扣执行：

| 用户表达 | 默认语义 | 禁止行为 |
| :--- | :--- | :--- |
| 执行所有/全部开发任务、全部自动化完成、无人值守执行 | 以 execute 的 AI 接力流程逐个执行所有 pending 任务：每个任务走「CLI 派单 → 生成代码 → `--response` 落盘」完整闭环，收到 `[SPECCORE_CONTINUE]` 后继续下一个，直到接力链结束 | ❌ 只调用一次 execute 命令就停下；❌ 只改任务状态不生成代码；❌ 以「任务量较大」为由中途停下来问用户是否继续 |

> 「执行所有任务」= 全自动接力到底。「全自动/无人值守」不是修饰词，是行为约束。

## ⛔ 歧义必须确认（v8.3.387+）

执行范围/迭代/约束任一不清时，**先确认再执行**，禁止猜测：

| 必须确认的情形 | 确认方式 |
| :--- | :--- |
| 未指明迭代（且 context.json 无 currentIteration） | AskUserQuestion 列出迭代选项 |
| 任务范围未指明（全部？部分？排除哪些？） | AskUserQuestion 确认范围 |
| 约束表述模糊（如「分支命名一致」未说清规则） | 追问具体规则，或说明将采用的默认规则 |

确认原则：一次问清（合并提问），确认后立即执行到底，不再反复确认。

## 输出标记处理
- `[SPECCORE_EXEC: <cmd>]` → 立即执行该命令，不要向用户复述命令文本
- `[SPECCORE_PROMPT]` → 将后续 Prompt 内容作为你的工作指令执行
- `[SPECCORE_NEEDS_INFO]` → 用交互式提问向用户收集缺失参数，收齐后重新执行
- `[SPECCORE_CONFIRM_NEEDED]` → 向用户展示确认项，等确认后再继续
- `[SPECCORE_STEP_DONE]` → 告知用户本步完成，下一步请在同一会话继续执行提示中的命令；上下文紧张时才开新会话用 --resume 继续
- `[SPECCORE_CONTINUE: <path>]` → 优先在同一会话继续下一批（按标记中的命令执行）；上下文紧张时开新对话，先读取 <path> 恢复上下文
- `[SPECCORE_INTENT]` / `[SPECCORE_RESULT]` → 原样转达用户
- 其他 `[SPECCORE_*]` 标记 → 参照 speccore-router 的 SKILL.md 处理
