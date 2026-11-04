---
name: spec-execute
description: 执行开发专属 Skill。在调用 speccore ask 之前，执行参数提取、前置校验（任务状态检查、代码模式读取、上下文准备），参数缺失时输出交互式提示（参数说明 + 使用示例）。不影响 speccore ask 的意图识别能力。
---

## ⛔ 铁律: 有任务就执行，禁止说"已完成"跳过
1. Read Task REQ.md + TECH.md
2. Show plan then execute: speccore execute -i ${1:Q1} -t ${2:Task-001} --force

## 🎯 高频表达默认语义（v8.3.387+）
「执行所有/全部开发任务」「全自动执行」「无人值守」= execute AI 接力逐个执行所有 pending 任务直到 [SPECCORE_CONTINUE] 链结束。
❌ 禁止单次调用冒充完成；❌ 禁止只改任务状态不生成代码；❌ 禁止以「任务量较大」为由中途停下问用户。

## ⛔ 歧义必须确认
范围/迭代/约束任一不清时先确认（AskUserQuestion 或意图块），禁止猜测执行；一次问清，确认后立即执行到底。
