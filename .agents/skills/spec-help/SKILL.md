---
name: spec-help
description: >
  帮助中心专属 Skill。引擎检测 CLI 版本是否为最新，
  发现新版本时提示用户更新。不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。

## 输出标记处理
- `[SPECCORE_EXEC: <cmd>]` → 立即执行该命令，不要向用户复述命令文本
- `[SPECCORE_PROMPT]` → 将后续 Prompt 内容作为你的工作指令执行
- `[SPECCORE_NEEDS_INFO]` → 用交互式提问向用户收集缺失参数，收齐后重新执行
- `[SPECCORE_CONFIRM_NEEDED]` → 向用户展示确认项，等确认后再继续
- `[SPECCORE_STEP_DONE]` → 告知用户本步完成，下一步请在同一会话继续执行提示中的命令；上下文紧张时才开新会话用 --resume 继续
- `[SPECCORE_CONTINUE: <path>]` → 优先在同一会话继续下一批（按标记中的命令执行）；上下文紧张时开新对话，先读取 <path> 恢复上下文
- `[SPECCORE_INTENT]` / `[SPECCORE_RESULT]` → 原样转达用户
- 其他 `[SPECCORE_*]` 标记 → 参照 speccore-router 的 SKILL.md 处理
