---
name: spec-unitize
description: 切分需求专属 Skill。在调用 speccore ask 之前，执行参数提取、前置校验（输入文件格式：.md 可直接切、.docx/.pdf 先 doc2spec 转换；端名须与 CONSTITUTION.md 端列表一致；重切会覆盖旧切片），参数缺失时输出交互式提示（参数说明 + 使用示例）。不影响 speccore ask 的意图识别能力。
---

## ⛔ 铁律: 分析前必须先切分功能单元，禁止跳过
1. 输入 .md 直接切分；.docx/.pdf 先 speccore doc2spec 转换
2. 直接执行: execute_command("speccore ask '用户原话'")

注意: 切需求 = unitize（需求文档→功能单元 features/）；拆任务 = taskify（功能单元→开发任务 Task-*），勿混淆。
