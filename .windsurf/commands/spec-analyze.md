---
name: spec-analyze
description: 需求分析专属 Skill。在调用 speccore ask 之前，执行参数提取、前置校验（迭代存在性、需求文档检测、专业度评估、端列表读取），参数缺失时输出交互式提示。不影响 speccore ask 的意图识别能力。
---

直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。