---
name: spec-iteration-create
description: >
  创建迭代专属 Skill。参数提取与前置校验（迭代名是否已存在、主题词有效性）由 speccore ask 引擎执行；
  参数缺失时引擎输出 [SPECCORE_NEEDS_INFO] 交互式提示。不影响 speccore ask 的意图识别能力。
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

## 主题词英译（v8.3.372）
- ask 输出的执行命令中含 `--topic "中文主题"` 时，执行前把中文主题英译（如「支付」→ `payment`）；
- 无法确定译名时保留原样执行（CLI 自带拼音兜底，如「支付」→ `zhi-fu`）；
- 若 ask 未提取出主题而用户原话明显带主题（「主要做 X」），执行后主动补充 `--topic` 重跑。
