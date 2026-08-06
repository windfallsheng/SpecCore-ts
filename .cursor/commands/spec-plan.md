---
name: spec-plan
description: 生成计划: 期次=${1:Q1} 责任人=${2|张三,李四,王五|}
---
speccore plan -I ${1:Q1} --owner ${2|张三,李四,王五|}