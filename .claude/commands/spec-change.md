---
name: spec-change
description: 需求变更专属 Skill。在调用 speccore ask 之前，执行参数提取、前置校验（当前迭代、已有 Task 列表、变更类型判断），参数缺失时输出交互式提示。不影响 speccore ask 的意图识别能力。
---

speccore change "${1:变更描述}" --task=${2:Task-001} --type ${3|feature,bugfix|}