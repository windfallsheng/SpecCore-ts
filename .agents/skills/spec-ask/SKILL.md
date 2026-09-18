---
name: spec-ask
description: >
  SpecCore CLI 执行引擎。仅在用户明确要求通过 speccore 命令行工具执行以下操作时触发：
  - analyze --prompt：生成迭代级/全局级 Spec 分析文档（ANALYSIS.md、TECH.md 等），不是单纯解释代码
  - split：将需求拆分为开发任务并写入迭代目录
  - plan --prompt：制定执行计划并写入 Task 目录
  - execute --prompt：执行开发任务并生成代码
  - doc2spec：导入 PRD/Word 文档到迭代目录
  - spec2doc：导出 Spec 文档为 Word/PDF
  - iteration create：创建新迭代目录
  - done：任务归档收尾
  - pr：代码提交与创建 Pull Request
  - dev：智能级联推进全流程
  - dashboard/status/doctor：查看项目状态/健康度
  以下情况明确不触发此 Skill（走正常 AI 对话）：
  解释代码逻辑、审查代码片段、讨论需求合理性、排查具体 bug、
  一般性技术咨询、算法实现、架构讨论、任何不涉及 speccore CLI 执行的请求。
allowed-tools: ["Bash", "Read", "Write", "Edit"]
disable-model-invocation: false
---

直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。
