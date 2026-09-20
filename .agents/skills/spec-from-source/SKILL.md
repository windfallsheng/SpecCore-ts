---
name: spec-from-source
description: >
  SpecCore 源码反推专属 Skill（分析源码生成需求/全局资产）。仅在用户明确提到
  speccore、从源码反推、分析源码、源码生成需求文档、源码生成技术文档、反推全局资产、
  spec-from-source、reverse、--from-code 等关键词，或明确要求通过 speccore
  从现有代码工程生成需求/全局层文档时使用。
  在调用 speccore ask 之前，执行参数提取（源码目录列表，多端用逗号分隔），
  用户未提供源码目录时输出交互式提示（示例: --src backend/src,admin-web/src）。
  不处理一般性的"帮我看看这段代码"讨论，只处理 speccore 上下文中的源码反推。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。
用户未提供源码目录时，先询问源码目录（如 backend/src,admin-web/src）再执行。
