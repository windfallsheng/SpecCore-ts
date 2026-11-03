---
name: spec-verify
description: >
  测试验证专属 Skill。覆盖 verify 命令的测试意图识别与参数提取（由引擎执行）。
  支持自然语言（"跑一下冒烟测试"）和显式参数（--config ./tests/smoke.yaml --stage deploy）。
  参数缺失时引擎输出 [SPECCORE_NEEDS_INFO] 交互式提示，自动发现测试配置文件。支持 --project-dir 测试外部项目。
  新增 AI 浏览器验证模式（--ai/--ai-report）：CLI 生成自然语言验证剧本，宿主 AI 用 Browser 子代理视觉执行，无需配置 selector。
  不影响 speccore ask 的意图识别能力。
allowed-tools: ["Bash", "Read", "Write", "Edit"]
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

## AI 浏览器验证模式（v8.3.350+）

`speccore verify --ai` 输出剧本后带两个接管标记：
- `[SPECCORE_AI_VERIFY: <plan.json 路径>]` → 接管执行验证剧本
- `[SPECCORE_AI_VERIFY_ACCOUNTS: <账号来源>]` → 登录账号明文来源（v8.3.351+ 账号收敛后可能是环境文件 tests.accounts，也可能是 accounts.yaml，可有多条）

看到 `[SPECCORE_AI_VERIFY]` 标记后，按以下协议执行（不再走 ask 引擎）：
1. 读 plan.json（accountSources 字段指明账号来源：`environments/{env}.yaml` 的 tests.accounts 为权威源、引用名即账号名（如 admin）；`.speccore/tests/accounts.yaml` 为兑底、引用名 `{env}.{name}`（如 staging.admin））。按来源取账号明文（勿写入任何落盘文件；password/username 为 `${VAR}` 形式时从环境变量取明文；plan.json 的 accountEnvVars 已列出引用清单）
2. **按层推进**（plan.json 的 groups 字段，缺省两层）：先「公共能力层」（入口可达性/登录态/全局导航）全部通过，再进「模块层」逐单元业务场景；`enabled: false` 的层跳过；层内按端分批，逐场景执行：打开入口地址 → 登录 → 按操作步骤原文交互 → 每步截图
3. 判定 pass / fail / skip + 判断理由 + 截图路径；验证码/支付/生物识别等无法自动化场景标 skip，理由注明；截图落 `<剧本目录>/screenshots/`
4. 结果写 `<剧本目录>/results.json`（结构见 plan.json 同目录；version/env/executedAt + results[{scenarioId,unit,platform,passed,skipped?,executor?,judged?,reason,screenshots[]}]）
5. 执行 `speccore verify --ai-report <results.json>` 生成 HTML 报告（按层展示），向用户展示报告路径与通过/失败摘要

**三级执行通道回退**（按优先级降级，结果中 executor 字段记录实际通道）：
- 通道 1（首选）：Browser 子代理视觉执行 + 视觉判定。executor 写 `browser-agent`（默认，可省略）
- 通道 2（降级）：宿主无 Browser 子代理但有 Playwright MCP 时，用 MCP 的 browser_* 工具执行 + 宿主视觉判定。executor 写 `playwright-mcp`
- 通道 3（兜底）：宿主无多模态能力时，只操作页面截图（Playwright MCP 或其它方式），该场景结果写 `judged: false`（passed 可占位 false，reason 写操作过程描述），executor 写 `playwright-mcp` 或 `manual`；全部截图完成后执行 `speccore verify --ai-judge <results.json>`，CLI 用视觉模型（qwen-vl 默认）对截图 + 预期结果做业务断言并回写（executor 改写为 `visual-judge`）

约束：CLI 只切片不解析语义，剧本中的步骤/预期是原文切片，语义理解与页面操作由你（执行 AI）负责；不确定的元素用视觉定位，不要要求用户提供 selector。
