---
name: spec-from-source
description: 源码反推专属 Skill（分析源码生成需求/全局资产）。在调用 speccore ask 之前，执行参数提取（源码目录列表，多端用逗号分隔），用户未提供源码目录时输出交互式提示。不影响 speccore ask 的意图识别能力。
---

直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。
用户未提供源码目录时，先询问源码目录（如 backend/src,admin-web/src）再执行。