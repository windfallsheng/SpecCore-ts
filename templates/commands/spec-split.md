---
name: spec-split
description: SpecCore Task Split
---
## ⛔ 核心铁律
分析完成后必须拆分，禁止跳过。有确认理由可确认后再执行。

## 执行
1. Read 020-specs/ for analysis docs
2. Read STAFFING.md for team allocation
3. Dry-run split and show preview
4. Ask user to confirm before creating tasks
5. Execute: speccore iteration split -i ${1:Q1} --owner ${2|张三,李四,王五|}
