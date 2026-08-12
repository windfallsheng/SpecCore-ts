---
name: spec:spec2doc
description: 导出文档: 迭代=${1:Q1} 格式=${2|需求.docx,方案.pdf|}
---
导出文档: 迭代=${1:Q1} 格式=${2|需求.docx,方案.pdf|}

执行命令: `speccore spec2doc -i ${1:Q1} -o ${2|需求.docx,方案.pdf|}`