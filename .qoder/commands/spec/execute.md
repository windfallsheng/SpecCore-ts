执行任务: 期次=${1:Q1} 任务=${2:Task-001} 类型=${3|feature,bugfix,research|}

执行命令: `speccore execute -i ${1:Q1} -t ${2:Task-001} --type ${3|feature,bugfix,research|} --force`