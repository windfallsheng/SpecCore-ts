---
name: spec-execute
description: 执行开发专属 Skill。在调用 speccore ask 之前，执行参数提取、前置校验（任务状态检查、代码模式读取、上下文准备），参数缺失时输出交互式提示（参数说明 + 使用示例）。不影响 speccore ask 的意图识别能力。
---

## ⛔ 铁律: 有任务就执行，禁止说"已完成"跳过
1. Read Task REQ.md + TECH.md
2. Show plan then execute: speccore execute -i ${1:Q1} -t ${2:Task-001} --force