---
name: spec-task-create
description: 创建开发任务专属 Skill。在调用 speccore ask 之前，执行参数提取、前置校验（迭代存在性、主题词有效性、命名冲突检测），参数缺失时输出交互式提示。不影响 speccore ask 的意图识别能力。英译接力（v8.3.289+）：--batch-file 批量导入 bug 时目录名走宿主 AI 英译（逐条序号对应，漏翻回退拼音，--translate-en off 可关闭）。
---

speccore task new --name ${1:任务名称}

## 英译接力剧本（宿主 AI 接手翻译，v8.3.289+）

`task new --batch-file <xlsx>` 批量导入 bug 时，CLI 会把全部「Bug 标题」批量英译为任务目录 slug。若当前环境无直连 LLM（无 providers 池/SPECCORE_LLM_KEY/OPENAI_API_KEY）且项目处于宿主模式（ai.provider=host 或 auto_host_ai: true），CLI 会输出 `[SPECCORE_PROMPT]` + 编号标题清单（1~N）并以退出码 10 结束。

宿主 AI 收到后：
1. 将清单中每个中文标题翻译为英文 kebab-case 目录名（小写字母/数字/连字符，2~5 词，禁用拼音）。
2. 构造 JSON：键=清单序号（1~N，与编号一一对应），值=英文 slug。
3. 以 `--translate-response '<JSON>'` 续跑同一条 task new 命令（其他参数保持不变）。

注意：翻译必须逐条对应序号；漏翻的条目回退拼音。若不希望英译，加 `--translate-en off`。
