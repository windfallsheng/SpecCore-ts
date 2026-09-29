---
name: spec-task-create
description: >
  创建开发任务专属 Skill。参数提取与前置校验（迭代存在性、主题词有效性、命名冲突检测）由 speccore ask 引擎执行；
  参数缺失时引擎输出 [SPECCORE_NEEDS_INFO] 交互式提示。不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。

## 输出标记处理
- `[SPECCORE_EXEC: <cmd>]` → 立即执行该命令，不要向用户复述命令文本
- `[SPECCORE_PROMPT]` → 将后续 Prompt 内容作为你的工作指令执行
- `[SPECCORE_NEEDS_INFO]` → 用交互式提问向用户收集缺失参数，收齐后重新执行
- `[SPECCORE_CONFIRM_NEEDED]` → 向用户展示确认项，等确认后再继续
- `[SPECCORE_STEP_DONE]` → 告知用户本步完成，下一步请在同一会话继续执行提示中的命令；上下文紧张时才开新会话用 --resume 继续
- `[SPECCORE_CONTINUE: <path>]` → 优先在同一会话继续下一批（按标记中的命令执行）；上下文紧张时开新对话，先读取 <path> 恢复上下文
- `[SPECCORE_INTENT]` / `[SPECCORE_RESULT]` → 原样转达用户
- 其他 `[SPECCORE_*]` 标记 → 参照 speccore-router 的 SKILL.md 处理

## 英译接力剧本（宿主 AI 接手翻译，v8.3.289+）

`task new --batch-file <xlsx>` 批量导入 bug 时，CLI 会把全部「Bug 标题」批量英译为任务目录 slug（Task-001-booking-order-status-not-synced）。若当前环境无直连 LLM（无 providers 池/SPECCORE_LLM_KEY/OPENAI_API_KEY）且项目处于宿主模式（ai.provider=host 或 auto_host_ai: true），CLI 会输出 `[SPECCORE_PROMPT]` + 编号标题清单（1~N）并以退出码 10 结束。

宿主 AI 收到后：
1. 将清单中每个中文标题翻译为英文 kebab-case 目录名（小写字母/数字/连字符，2~5 词，禁用拼音）。
2. 构造 JSON：键=清单序号（1~N，与编号一一对应），值=英文 slug。
3. 以 `--translate-response '<JSON>'` 续跑同一条 task new 命令（其他参数保持不变）。

```bash
speccore task new --batch-file TEST/bugs-20260928.xlsx --type bugfix --translate-response '{"1":"booking-order-status-not-synced","2":"check-in-qr-scan-failed"}'
```

注意：翻译必须逐条对应序号；漏翻的条目回退拼音。若不希望英译，加 `--translate-en off`。
