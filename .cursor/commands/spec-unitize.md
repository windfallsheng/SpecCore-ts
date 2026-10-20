---
name: spec-unitize
description: 切分需求专属 Skill。在调用 speccore ask 之前，执行参数提取、前置校验（输入文件格式：.md 可直接切、.docx/.pdf 先 doc2spec 转换；端名须与 CONSTITUTION.md 端列表一致；重切会覆盖旧切片；支持 --titles 仅切指定标题章节、--files 批量多文档各自挂标题组 a.md=端@标题1|标题2），参数缺失时输出交互式提示（参数说明 + 使用示例）。不影响 speccore ask 的意图识别能力。
---
## ⛔ 铁律: 分析前必须先切分功能单元，禁止跳过
1. 输入 .md 直接切分；.docx/.pdf 先 speccore doc2spec 转换
2. 直接执行: execute_command("speccore ask '用户原话'")

注意: 切需求 = unitize（需求文档→功能单元 features/）；拆任务 = taskify（功能单元→开发任务 Task-*），勿混淆。

## 标题过滤（v8.3.334+）
- 单文档：speccore unitize --file x.md --titles "预订管理,消息中心"（模糊包含匹配，可写编号标题如「3.1 预订管理」）
- 多文档各自标题：--files "a.md=端1@标题1|标题2,b.md=端2@标题3"
- ask 识别：用户说「切 admin-web.md 里的预订管理、消息中心」「只切 a.md 的订单确认和 b.md 的扫码签到」时引擎自动生成对应命令