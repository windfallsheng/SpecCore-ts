---
name: spec-spec2doc
description: 规格转文档专属 Skill。在调用 speccore ask 之前，执行参数提取、前置校验（迭代/Task 存在性），参数缺失时输出交互式提示。不影响 speccore ask 的意图识别能力。
---

speccore spec2doc -i ${1:Q1} -o ${2|需求.docx,方案.pdf|}