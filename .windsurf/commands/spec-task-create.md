---
name: spec-task-create
description: 创建开发任务专属 Skill。在调用 speccore ask 之前，执行参数提取、前置校验（迭代存在性、主题词有效性、命名冲突检测），参数缺失时输出交互式提示。不影响 speccore ask 的意图识别能力。
---

speccore task new --name ${1:任务名称}