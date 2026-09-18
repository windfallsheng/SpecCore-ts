---
name: spec-execute
description: >
  执行开发专属 Skill。在调用 speccore ask 之前，执行参数提取、
  前置校验（任务状态检查、代码模式读取、上下文准备），
  参数缺失时输出交互式提示（参数说明 + 使用示例）。
  不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。
