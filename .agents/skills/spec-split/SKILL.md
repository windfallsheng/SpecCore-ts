---
name: spec-split
description: >
  SpecCore 任务拆分专属 Skill。仅在用户明确提到 speccore、迭代、期次、Spec、
  /split 等关键词，或明确要求通过 speccore 执行 split 操作时使用。
  在调用 speccore ask 之前，执行参数提取、前置校验（analyze 是否完成、端列表提取、
  变更检测），参数缺失时输出交互式提示（参数说明 + 使用示例）。
  不处理一般性的"拆分任务"讨论（如"帮我拆分一下工作"），只处理 speccore 上下文中的拆分。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。
