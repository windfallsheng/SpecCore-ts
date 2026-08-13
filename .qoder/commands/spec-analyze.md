---
name: spec-analyze
description: SpecCore Analysis
---
SpecCore Analysis

执行命令: `## ⛔ 铁律: 分析必须落盘 020-specs/，走 prompt→Read→apply 流程
1. Read 010-requirements/INDEX.md → converted/*.md → features/*/README.md
2. Execute: speccore analyze --prompt -I ${1:Q1} --type feature
3. Fill docs via speccore analyze --apply`