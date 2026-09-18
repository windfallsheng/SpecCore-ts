---
name: spec-spec2doc
description: >
  规格转文档专属 Skill。在调用 speccore ask 之前，执行参数提取、
  前置校验（迭代/Task 存在性），参数缺失时输出交互式提示。
  不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。
