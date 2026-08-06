---
name: spec-spec2doc
description: 导出文档: 期次=${1:Q1} 格式=${2|需求.docx,方案.pdf|}
---
speccore spec2doc -i ${1:Q1} -o ${2|需求.docx,方案.pdf|}