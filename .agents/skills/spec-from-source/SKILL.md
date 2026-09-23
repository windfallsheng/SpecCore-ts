---
name: spec-from-source
description: >
  SpecCore 源码反推专属 Skill（从源码生成需求/全局资产）。仅在用户明确提到
  speccore、从源码反推、分析源码、源码生成需求文档、源码生成技术文档、反推全局资产、
  spec-from-source、global from-source、reverse、--from-code 等关键词，或明确要求通过 speccore
  从现有代码工程生成需求/全局层文档时使用。
  本 Skill 对应 speccore global from-source 命令（spec-from-source 为兼容别名），
  底层复用 speccore global 命令族（global analyze 源码技术分析 / global from-source 源码反推需求）。
  参数提取（源码目录列表，多端用逗号分隔）由 speccore ask 引擎执行；
  用户未提供源码目录时输出交互式提示（示例: --src backend/src,admin-web/src）。
  不处理一般性的"帮我看看这段代码"讨论，只处理 speccore 上下文中的源码反推。
allowed-tools: ["Bash", "Read", "Write", "Edit"]
disable-model-invocation: false
---

直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。
用户未提供源码目录时，先询问源码目录（如 backend/src,admin-web/src）再执行。

## 输出标记处理
- `[SPECCORE_EXEC: <cmd>]` → 立即执行该命令，不要向用户复述命令文本
- `[SPECCORE_PROMPT]` → 将后续 Prompt 内容作为你的工作指令执行
- `[SPECCORE_NEEDS_INFO]` → 用交互式提问向用户收集缺失参数，收齐后重新执行
- `[SPECCORE_CONFIRM_NEEDED]` → 向用户展示确认项，等确认后再继续
- `[SPECCORE_STEP_DONE]` → 告知用户本步完成，下一步需开新会话用 --resume 继续
- `[SPECCORE_CONTINUE: <path>]` → 提示用户开新对话并先读取 <path> 恢复上下文
- `[SPECCORE_INTENT]` / `[SPECCORE_RESULT]` → 原样转达用户
- 其他 `[SPECCORE_*]` 标记 → 参照 speccore-router 的 SKILL.md 处理
