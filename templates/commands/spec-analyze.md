---
name: spec-analyze
description: SpecCore Analysis
---
## ⛔ 核心铁律
分析必须落盘到 020-specs/，禁止只输出聊天文字。走 speccore analyze --prompt → Read 文档 → --apply 流程。

## 执行
1. Read 010-requirements/ for all platform docs
2. Ask user for iteration name if not provided
3. Execute: speccore analyze -I ${1:Q1} --task ${2:Task-001}
4. Present analysis report and ask for confirmation
