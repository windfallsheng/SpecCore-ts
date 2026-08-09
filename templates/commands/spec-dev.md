---
name: spec-dev
description: SpecCore Smart Pipeline
---
## ⛔ 核心铁律
走完整 analyze→split→plan→execute 链路，禁止跳过任何步骤。

## 执行
1. Read .speccore/local/context.json for current state
2. Read 000-overview/PROJECT_GRAPH.md for progress
3. Present current phase and recommend next step
4. Execute: speccore dev -i ${1:Q1} ${2|,--auto|}
