---
name: spec-pr
description: 代码提交与 PR 专属 Skill。在调用 speccore ask 之前，执行参数提取、前置校验（分支安全检查、未提交变更检测、ANALYSIS.md 路径校验、冲突检测），参数缺失时输出交互式提示。不影响 speccore ask 的意图识别能力。
---

speccore pr --task=${1:Task-001}