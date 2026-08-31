---
name: spec-split
description: 任务拆分专属 Skill。在调用 speccore ask 之前，执行参数提取、前置校验（analyze 是否完成、端列表提取、变更检测），参数缺失时输出交互式提示（参数说明 + 使用示例）。不影响 speccore ask 的意图识别能力。
---

## ⛔ 铁律: 分析完成后必须拆分，禁止跳过
1. Read 020-specs/ for analysis docs
2. Dry-run split and show preview
3. Execute: speccore iteration split -i ${1:Q1} --owner ${2|张三,李四,王五|}