---
name: spec-plan
description: 执行计划专属 Skill。在调用 speccore ask 之前，执行参数提取、前置校验（任务是否已拆分、依赖关系检测、执行顺序优化），参数缺失时输出交互式提示（参数说明 + 使用示例）。不影响 speccore ask 的意图识别能力。
---

1. 仅生成并展示计划页面，不执行代码修复
2. speccore plan -I ${1:Q1} --owner ${2|张三,李四,王五|} --html
3. 打开 speccore-plan.html