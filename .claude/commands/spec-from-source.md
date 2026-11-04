---
name: spec-from-source
description: 源码反推专属 Skill（分析源码生成需求/全局资产，覆盖「全局分析/全局层分析/分析所有工程/分析所有端」等全局层表述——中性句路由 global analyze（默认 --no-product 纯技术，不反推需求）；含「反推/生成需求」词才走 global from-source）。在调用 speccore ask 之前，执行参数提取（源码目录列表，多端用逗号分隔），用户未提供源码目录时输出交互式提示。QA 环三阶段（--verify → --review → --revise）须逐个运行不组合；CLI 接力输出 [SPECCORE_PROMPT] 并 exit 10 时按 Prompt 落盘后续跑；旧域产物用 --migrate 可逆迁移。不影响 speccore ask 的意图识别能力。
---

直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。
用户未提供源码目录时，先询问源码目录（如 backend/src,admin-web/src）再执行。

## 输出标记处理
- `[SPECCORE_PROMPT]` → 将后续 Prompt 内容作为你的工作指令执行（两跳填充或 QA 环阶段交棒，落盘后按末尾续跑命令继续）
- `[SPECCORE_EXEC_STATUS: relay(10)]` → 接力信号（非失败），按上方 Prompt 执行即可
