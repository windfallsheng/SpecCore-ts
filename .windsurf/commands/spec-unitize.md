---
name: spec-unitize
description: 切分需求专属 Skill。在调用 speccore ask 之前，执行参数提取、前置校验（输入文件格式：.md 可直接切、.docx/.pdf 先 doc2spec 转换；端名须与 CONSTITUTION.md 端列表一致；重切会覆盖旧切片；支持 --titles 仅切指定标题章节、--files 批量多文档各自挂标题组 a.md=端@标题1|标题2），参数缺失时输出交互式提示（参数说明 + 使用示例）。不影响 speccore ask 的意图识别能力。切分后目录名必须走英译流程（auto 默认，LLM 英译优先、宿主 AI 接力、拼音仅兜底），禁止主动传 --translate-en off；CLI 输出 [SPECCORE_PROMPT] 时宿主 AI 必须逐条翻译回传续跑（Windows 用 --translate-response-file 传参）。
---
## ⛔ 铁律: 分析前必须先切分功能单元，禁止跳过
1. 输入 .md 直接切分；.docx/.pdf 先 speccore doc2spec 转换
2. 直接执行: execute_command("speccore ask '用户原话'")

注意: 切需求 = unitize（需求文档→功能单元 features/）；拆任务 = taskify（功能单元→开发任务 Task-*），勿混淆。

## 标题过滤（v8.3.334+）
- 单文档：speccore unitize --file x.md --titles "预订管理,消息中心"（模糊包含匹配，可写编号标题如「3.1 预订管理」）
- 多文档各自标题：--files "a.md=端1@标题1|标题2,b.md=端2@标题3"
- ask 识别：用户说「切 admin-web.md 里的预订管理、消息中心」「只切 a.md 的订单确认和 b.md 的扫码签到」时引擎自动生成对应命令

## 英译接力剧本（宿主 AI 接手翻译）

unitize 执行时（auto 默认），若当前环境无直连 LLM（无 providers 池/SPECCORE_LLM_KEY/OPENAI_API_KEY），且项目处于宿主模式（ai.provider=host 或 auto_host_ai: true），CLI 会：
1. 输出 `[SPECCORE_PROMPT]` + 编号标题清单（1~N）+ 响应 JSON 格式示例，并以退出码 10 结束。

宿主 AI 收到后按以下剧本接力：
1. 将清单中每个中文标题翻译为英文 kebab-case 目录名：小写字母/数字/连字符，2~5 个单词，禁用拼音（如「预订管理」→ booking-management）。
2. 构造 JSON 对象：键=清单序号（1~N，与编号一一对应，勿改名重排），值=英文 slug。
3. 以 `--translate-response '<JSON>'` 续跑同一条 unitize 命令。

```bash
speccore unitize --file <文件> --iter <迭代> --translate-en host --translate-response '{"1":"booking-management","2":"meeting-room-rules"}'
```

**Windows 传参注意（v8.3.364+）**：npm shim 会把命令行中含双引号的 JSON 参数转义破坏，导致响应被吞。两种可靠解法：① 把 JSON 写入文件后用 `--translate-response-file <path>` 续跑（推荐，绕开全部 shell 转义）；② PowerShell 用单引号包裹 + 内部 `\"` 转义。
