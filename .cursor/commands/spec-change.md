---
name: spec-change
description: 需求变更/新增: 描述=${1:变更描述} 任务=${2:Task-001}
---
# 需求变更/新增 — AI 澄清 → 用户确认 → 持久化

## 流程
1. 执行: `speccore change --prompt "${1:变更描述}"`
2. 根据输出的澄清 Prompt，生成结构化 JSON（intent/structuredDesc/keyPoints/acceptanceCriteria）
3. **展示澄清结果给用户，询问"以上理解是否正确？需要调整什么？"**
4. 用户确认 → 执行: `speccore change --response '{JSON}'`
5. 用户不满意 → 根据反馈重新澄清（回步骤 2）

## 铁律
- 澄清结果必须展示给用户确认，不可跳过
- 用户不满意就反复澄清，直到确认
- 不要输出命令文本，用 execute_command 执行
