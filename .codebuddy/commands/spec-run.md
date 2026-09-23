---
name: spec-run
description: 端到端流水线专属 Skill。在调用 speccore run 之前，执行参数提取（需求描述、迭代、起止阶段、演示模式），参数缺失时输出交互式提示。不影响 speccore run 的意图识别能力。
---
直接执行: execute_command("speccore run '用户的一句话需求'")

不要输出命令文本，不要分析意图，一切交给 speccore run。

流水线会自动从澄清一路跑到部署，中间三个 review 闸口（Spec 定稿 / 代码 review / 部署前确认）会停下来等你确认，看到 [SPECCORE_GATE_X] 标记时停下 review 并询问用户。