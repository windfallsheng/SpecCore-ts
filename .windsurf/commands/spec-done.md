---
name: spec-done
description: 任务归档收尾专属 Skill。在调用 speccore ask 之前，执行参数提取、前置校验（Task 状态检查、依赖完成性检查、feature 分支合并检查），参数缺失时输出交互式提示。不影响 speccore ask 的意图识别能力。
---

speccore done --task=${1:Task-001}