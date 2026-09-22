---
name: spec-unitize
description: >
  SpecCore 切分需求专属 Skill。仅在用户明确提到 speccore、迭代、期次、Spec、
  /unitize 等关键词，或明确要求通过 speccore 切分需求文档为功能单元（unitize）时使用。
  在调用 speccore ask 之前，执行参数提取、前置校验（输入文件格式：.md 可直接切、
  .docx/.pdf 需先 doc2spec 转换；端名须与 CONSTITUTION.md 端列表一致；
  features/ 已有同名单元时重切会覆盖旧切片；多文档可批量 --files "a.md=端1,b.md"），
  参数缺失时输出交互式提示（参数说明 + 使用示例）。
  不处理一般性的"切分/拆分"讨论（如"帮我切一下这段文本"），只处理 speccore 上下文中的切分。
  与 spec-taskify 的区别：unitize 切需求（文档→功能单元 features/），taskify 拆任务（功能单元→开发任务 Task-*）。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。
