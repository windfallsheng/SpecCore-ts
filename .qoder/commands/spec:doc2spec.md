---
name: spec:doc2spec
description: 导入需求文档: 文件=${1:PRD.docx} 迭代=${2:Q1}
---
导入需求文档: 文件=${1:PRD.docx} 迭代=${2:Q1}

执行命令: `speccore doc2spec -f ${1:PRD.docx} --iter ${2:Q1}`