---
name: spec-unitize
description: >
  SpecCore 切分需求专属 Skill。仅在用户明确提到 speccore、迭代、期次、Spec、
  /unitize 等关键词，或明确要求通过 speccore 切分需求文档为功能单元（unitize）时使用。
  参数提取与前置校验（输入文件格式：.md 可直接切、
  .docx/.pdf 需先 doc2spec 转换；端名须与 CONSTITUTION.md 端列表一致；
  features/ 已有同名单元时重切会覆盖旧切片；多文档可批量 --files "a.md=端1,b.md"）由 speccore ask 引擎执行；
  参数缺失时引擎输出 [SPECCORE_NEEDS_INFO] 交互式提示（参数说明 + 使用示例）。
  不处理一般性的"切分/拆分"讨论（如"帮我切一下这段文本"），只处理 speccore 上下文中的切分。
  与 spec-taskify 的区别：unitize 切需求（文档→功能单元 features/），taskify 拆任务（功能单元→开发任务 Task-*）。
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
- `[SPECCORE_STEP_DONE]` → 告知用户本步完成，下一步请在同一会话继续执行提示中的命令；上下文紧张时才开新会话用 --resume 继续
- `[SPECCORE_CONTINUE: <path>]` → 优先在同一会话继续下一批（按标记中的命令执行）；上下文紧张时开新对话，先读取 <path> 恢复上下文
- `[SPECCORE_INTENT]` / `[SPECCORE_RESULT]` → 原样转达用户
- 其他 `[SPECCORE_*]` 标记 → 参照 speccore-router 的 SKILL.md 处理
