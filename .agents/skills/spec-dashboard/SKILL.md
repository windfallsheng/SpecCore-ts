---
name: spec-dashboard
description: >
  仪表盘专属 Skill。在调用 speccore ask 之前，检测当前是否有活跃迭代，
  无迭代时提示用户先创建迭代。不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。
