---
name: spec-ask
description: SpecCore AI Router
---
## ⛔ 核心铁律
1. 用户说"重新/再/重跑"禁止用"未变/已完成"拒绝，可确认后执行
2. 分析结果必须落盘 020-specs/，禁止只输出聊天文字
3. 复杂流程走 analyze → split → plan → execute 完整链路

## 执行
1. Read .speccore/CONSTITUTION.md 和 .speccore/local/context.json
2. Read .agents/skills/spec-ask/SKILL.md 获取完整规则
3. Execute: speccore ask "${1:描述你的需求}"