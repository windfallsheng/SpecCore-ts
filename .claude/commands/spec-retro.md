---
name: spec-retro
description: 回顾报告: 任务=${1:Task-001} 格式=${2|总结,详细,图表|}
---
speccore retro --task ${1:Task-001} --format ${2|summary,full,chart|}