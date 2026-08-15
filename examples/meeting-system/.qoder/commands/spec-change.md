---
name: spec-change
description: 需求变更: 描述=${1:变更描述} 任务=${2:Task-001}
---
需求变更: 描述=${1:变更描述} 任务=${2:Task-001}

执行命令: `speccore change "${1:变更描述}" --task=${2:Task-001} --type ${3|feature,bugfix|}`