---
name: spec-ask
description: >
  SpecCore CLI 执行引擎。仅在用户明确要求通过 speccore 命令行工具执行以下操作时触发：
  - analyze --prompt：生成迭代级/全局级 Spec 分析文档（ANALYSIS.md、TECH.md 等），不是单纯解释代码
  - unitize：切分需求文档为功能单元（features/，原 doc2spec --split）
  - taskify：将功能单元拆分为开发任务并写入迭代目录（原 split）
  - plan --prompt：制定执行计划并写入 Task 目录
  - execute --prompt：执行开发任务并生成代码
  - doc2spec：导入 PRD/Word 文档到迭代目录
  - spec2doc：导出 Spec 文档为 Word/PDF
  - iteration create：创建新迭代目录
  - done：任务归档收尾
  - pr：代码提交与创建 Pull Request
  - run：端到端全自动流水线推进全流程
  - dashboard/status/doctor：查看项目状态/健康度
  以下情况明确不触发此 Skill（走正常 AI 对话）：
  解释代码逻辑、审查代码片段、讨论需求合理性、排查具体 bug、
  一般性技术咨询、算法实现、架构讨论、任何不涉及 speccore CLI 执行的请求。
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
