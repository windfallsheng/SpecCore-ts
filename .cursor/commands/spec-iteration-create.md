---
name: spec-iteration-create
description: 创建迭代专属 Skill。在调用 speccore ask 之前，执行参数提取、前置校验（迭代名是否已存在、主题词有效性），参数缺失时输出交互式提示。不影响 speccore ask 的意图识别能力。
---

speccore iteration create -n ${1:Q2} --owner=${2|张三,李四,王五|}