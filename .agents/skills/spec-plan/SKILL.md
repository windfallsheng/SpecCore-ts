---
name: spec-plan
description: >
  执行计划专属 Skill。参数提取与前置校验（任务是否已拆分、依赖关系检测、执行顺序优化）由 speccore ask 引擎执行；
  参数缺失时引擎输出 [SPECCORE_NEEDS_INFO] 交互式提示（参数说明 + 使用示例）。
  不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read", "Write", "Edit"]
disable-model-invocation: false
---

直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。

## 计划→执行衔接（v8.3.397+）
- 计划是执行蓝图：plan 完成后，后续执行走 `speccore execute --plan <计划ID>`（ID 从 plan 命令收尾输出或 `speccore plan --list` 取）
- 多计划可一次执行：`speccore execute --plan <id1>,<id2>`（按依赖拓扑合并执行，已完成任务自动跳过）
- `speccore run` 流水线的 execute 阶段自动复用 plan 阶段产出的全部 active 计划
- execute 裸执行多任务时（--all/--auto），CLI 会先自动列计划（计划库 + PLAN.md + HTML，文档生成失败不阻塞执行）
- **两级拓扑**：计划与拓扑分析以功能单元为大模块划分（PLAN.md 模块依赖图 + 各模块分节，HTML subgraph 分组），模块内列子任务依赖；跨模块任务依赖聚合为模块间依赖

## --prompt 回传约定（v8.3.398+）
- `plan --prompt` 输出 Prompt 后，宿主 AI 按 Prompt 制定计划，完成后通过 `speccore plan --response "<计划完整内容>" -i <迭代名>` 回传落盘
- CLI 回传落盘时会同时登记执行库并输出计划 ID；计划内容必须包含任务 ID（Task-XXX），否则无法登记执行库（仅落盘 PLAN.md）
- 回传后计划即成为执行蓝图，用 `speccore execute --plan <计划ID>` 执行

## 输出标记处理
- `[SPECCORE_EXEC: <cmd>]` → 立即执行该命令，不要向用户复述命令文本
- `[SPECCORE_PROMPT]` → 将后续 Prompt 内容作为你的工作指令执行
- `[SPECCORE_NEEDS_INFO]` → 用交互式提问向用户收集缺失参数，收齐后重新执行
- `[SPECCORE_CONFIRM_NEEDED]` → 向用户展示确认项，等确认后再继续
- `[SPECCORE_STEP_DONE]` → 告知用户本步完成，下一步请在同一会话继续执行提示中的命令；上下文紧张时才开新会话用 --resume 继续
- `[SPECCORE_CONTINUE: <path>]` → 优先在同一会话继续下一批（按标记中的命令执行）；上下文紧张时开新对话，先读取 <path> 恢复上下文
- `[SPECCORE_INTENT]` / `[SPECCORE_RESULT]` → 原样转达用户
- 其他 `[SPECCORE_*]` 标记 → 参照 speccore-router 的 SKILL.md 处理
