---
name: spec-execute
description: 执行任务: 期次=${1:Q1} 任务=${2:Task-001} 类型=${3:feature} 端=${4:--backend}
---
speccore execute -i ${1:Q1} -t ${2:Task-001} --type ${3:feature} ${4:--backend} --force