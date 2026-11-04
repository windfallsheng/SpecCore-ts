---
name: spec-from-source
description: >
  SpecCore 源码反推专属 Skill（从源码生成需求/全局资产）。仅在用户明确提到
  speccore、从源码反推、分析源码、源码生成需求文档、源码生成技术文档、反推全局资产、
  spec-from-source、global from-source、reverse、--from-code 等关键词，
  或用户要求对**全部/所有工程（端）的源码做全局分析**（「全局分析」「全局层分析」「分析所有工程」「分析所有端」「全局技术分析」——v8.3.393+：中性全局分析句路由 global analyze（ask 默认 --no-product 纯技术文档，不反推需求）；仅当句含「反推/逆向/生成需求」词或显式提「产品层/需求文档」时才走 global from-source 反推需求），
  或明确要求通过 speccore 从现有代码工程生成需求/全局层文档时使用。
  本 Skill 对应 speccore global from-source 命令（spec-from-source 为兼容别名），
  底层复用 speccore global 命令族（global analyze 源码技术分析 / global from-source 源码反推需求）。
  参数提取（源码目录列表，多端用逗号分隔）由 speccore ask 引擎执行；
  用户句中出现端名时 ask 引擎自动映射 --platform 与 --src（PROJECT.yaml code_path）；
  用户句中出现类型词（前端/后端/前后端）或全量词（所有端/所有工程）**且语境为反推需求**（含反推/生成需求词）时，
  引擎映射该类型全部端（v8.3.381+，如「所有前端项目」→ 全部 frontend 端的 --platform + --src，不碰后端）；
  用户未提供源码目录时输出交互式提示（示例: --src backend/src,admin-web/src）。
  两跳完成后运行 speccore global from-source --src <dirs> --verify 做锚点验证环。
  QA 环三阶段（--verify → --review → --revise）须逐个运行、不可组合（v8.3.394+）：
  CLI 各阶段收尾输出 [SPECCORE_PROMPT] 接力并 exit 10，宿主 AI 按剧本填写 _qa/verify.json、review.json 后运行下一阶段；
  旧域产物（GLOBAL/_reverse/、requirements/ 根级直铺）用 --migrate 可逆迁移到 _legacy-*。
  不处理一般性的"帮我看看这段代码"讨论，只处理 speccore 上下文中的源码反推。
allowed-tools: ["Bash", "Read", "Write", "Edit"]
disable-model-invocation: false
---

直接执行: execute_command("speccore ask '用户原话'")

不要输出命令文本，不要分析意图，一切交给 speccore ask。
用户未提供源码目录时，先询问源码目录（如 backend/src,admin-web/src）再执行。

## 输出标记处理
- `[SPECCORE_EXEC: <cmd>]` → 立即执行该命令，不要向用户复述命令文本
- `[SPECCORE_PROMPT]` → 将后续 Prompt 内容作为你的工作指令执行
- `[SPECCORE_EXEC_STATUS: relay(10)]` → 接力信号（非失败）：上方子命令已输出 [SPECCORE_PROMPT]（两跳填充或 QA 环阶段交棒），按 Prompt 执行落盘后按末尾续跑命令继续
- `[SPECCORE_NEEDS_INFO]` → 用交互式提问向用户收集缺失参数，收齐后重新执行
- `[SPECCORE_CONFIRM_NEEDED]` → 向用户展示确认项，等确认后再继续
- `[SPECCORE_STEP_DONE]` → 告知用户本步完成，下一步请在同一会话继续执行提示中的命令；上下文紧张时才开新会话用 --resume 继续
- `[SPECCORE_CONTINUE: <path>]` → 优先在同一会话继续下一批（按标记中的命令执行）；上下文紧张时开新对话，先读取 <path> 恢复上下文
- `[SPECCORE_INTENT]` / `[SPECCORE_RESULT]` → 原样转达用户
- 其他 `[SPECCORE_*]` 标记 → 参照 speccore-router 的 SKILL.md 处理
