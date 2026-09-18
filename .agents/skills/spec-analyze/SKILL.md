---
name: spec-analyze
description: >
  SpecCore 需求分析专属 Skill。仅在用户明确提到 speccore、迭代、期次、Spec、
  /analyze 等关键词，或明确要求通过 speccore 执行 analyze 操作时使用。
  在调用 speccore ask 之前，执行参数提取、前置校验（迭代存在性、需求文档检测、
  专业度评估、端列表读取），参数缺失时输出交互式提示。
  不处理一般性的"分析需求"讨论（如"帮我分析一下登录功能"），只处理 speccore 上下文中的分析。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。
