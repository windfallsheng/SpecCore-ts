---
name: spec-taskify
description: 任务拆分专属 Skill。在调用 speccore ask 之前，执行参数提取、前置校验（analyze 是否完成、端列表提取、变更检测），参数缺失时输出交互式提示（参数说明 + 使用示例）。不影响 speccore ask 的意图识别能力。
---

直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。