---
name: spec-split
description: 拆分任务: 期次=${1:Q1} 责任人=${2|张三,李四,王五|}
---
speccore iteration split -i ${1:Q1} --owner ${2|张三,李四,王五|}