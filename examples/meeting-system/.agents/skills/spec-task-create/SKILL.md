---
name: spec-task-create
description: 创建 SpecCore 开发任务
allowed-tools: ["Bash"]
disable-model-invocation: false
---

用户说要创建任务时:
1. 从用户原话提取英文主题词（如"用户登录"→"user-login"、"支付"→"payment"）
2. execute_command("speccore task new -n '<名称>' --topic '<英文主题词>' -i <迭代> -t <类型>")

示例:
- "创建用户登录任务" → speccore task new -n 用户登录 --topic user-login -i Q1 -t feature
- "创建支付bug修复" → speccore task new -n 支付修复 --topic payment-fix -i Q1 -t bugfix
- "批量创建3个前端任务" → speccore task new --batch "登录页,注册页,首页" -i Q1 -t feature
