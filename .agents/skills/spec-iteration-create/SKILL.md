---
name: spec-iteration-create
description: 创建 SpecCore 迭代
allowed-tools: ["Bash"]
disable-model-invocation: false
---

用户说要创建迭代时:
1. 从用户原话提取英文主题词（从中文名/AI 自己总结，如"会议系统"→"meeting-system"）
2. execute_command("speccore iteration create -n '<名称>' --topic '<英文主题词>' --owner '<owner>'")

示例:
- "创建Q1会议系统迭代" → speccore iteration create -n Q1 --topic meeting-system --owner luzhaosheng
- "新建个支付模块迭代" → speccore iteration create -n 支付 --topic payment --owner luzhaosheng
- "创建V2.0" → speccore iteration create -n V2.0 --topic v2 --owner luzhaosheng
