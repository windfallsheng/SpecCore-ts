---
name: spec-doc2spec
description: 文档转规格专属 Skill。在调用 speccore ask 之前，执行参数提取、前置校验（文件存在性、格式检测），参数缺失时输出交互式提示。不影响 speccore ask 的意图识别能力。
---

speccore doc2spec -f ${1:PRD.docx} --iter ${2:Q1}