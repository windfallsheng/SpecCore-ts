---
name: spec-execute
description: SpecCore Execute
---
## ⛔ 核心铁律
有任务就执行，禁止说"已完成"而跳过。支持 --force 重跑。

## 执行
1. Read Task REQ.md and TECH.md for completeness
2. Check .needs-retry for previous failures
3. Show execution plan and batch info
4. Execute: speccore execute -i ${1:Q1} -t ${2:Task-001} --type ${3|feature,bugfix,research|} --force
5. If failed, write .issues.md and suggest --resume
