---
name: spec-analyze
description: >
  SpecCore 迭代层需求分析专属 Skill（产物 020-specs/）。仅在用户明确提到 speccore、迭代、Spec、
  /analyze 等关键词，或明确要求通过 speccore 执行 analyze 操作时使用。
  参数提取与前置校验（迭代存在性、需求文档检测、
  专业度评估、端列表读取）由 speccore ask 引擎执行；参数缺失时引擎输出 [SPECCORE_NEEDS_INFO] 交互式提示。
  全局层分析（源码→技术文档/反推需求）走 speccore global，不属于本 Skill。
  不处理一般性的"分析需求"讨论（如"帮我分析一下登录功能"），只处理 speccore 上下文中的分析。
allowed-tools: ["Bash", "Read", "Write", "Edit"]
disable-model-invocation: false
---

直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。

## 输出标记处理
- `[SPECCORE_EXEC: <cmd>]` → 立即执行该命令，不要向用户复述命令文本
- `[SPECCORE_PROMPT]` → 将后续 Prompt 内容作为你的工作指令执行
- `[SPECCORE_NEEDS_INFO]` → 用交互式提问向用户收集缺失参数，收齐后重新执行
- `[SPECCORE_CONFIRM_NEEDED]` → 向用户展示确认项，等确认后再继续
- `[SPECCORE_STEP_DONE]` → 告知用户本步完成，下一步需开新会话用 --resume 继续
- `[SPECCORE_CONTINUE: <path>]` → 提示用户开新对话并先读取 <path> 恢复上下文
- `[SPECCORE_INTENT]` / `[SPECCORE_RESULT]` → 原样转达用户
- 其他 `[SPECCORE_*]` 标记 → 参照 speccore-router 的 SKILL.md 处理
