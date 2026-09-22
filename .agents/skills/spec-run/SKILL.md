---
name: spec-run
description: >
  端到端流水线专属 Skill。在调用 speccore run 之前，执行参数提取（需求描述、
  迭代、起止阶段、演示模式），参数缺失时输出交互式提示（参数说明 + 使用示例）。
  不影响 speccore run 的意图识别能力。
allowed-tools: ["Bash", "Read"]
disable-model-invocation: false
---

直接执行: execute_command("speccore run '用户的一句话需求'")

不要输出命令文本，不要分析意图，一切交给 speccore run。
流水线会自动从澄清一路跑到部署，中间三个 review 闸口（Spec 定稿 / 代码 review / 部署前确认）
会停下来等你确认，看到 [SPECCORE_GATE_X] 标记时停下 review 并询问用户。

## 输出标记处理
- `[SPECCORE_EXEC: <cmd>]` → 立即执行该命令，不要向用户复述命令文本
- `[SPECCORE_PROMPT]` → 将后续 Prompt 内容作为你的工作指令执行
- `[SPECCORE_NEEDS_INFO]` → 用交互式提问向用户收集缺失参数，收齐后重新执行
- `[SPECCORE_CONFIRM_NEEDED]` → 向用户展示确认项，等确认后再继续
- `[SPECCORE_STEP_DONE]` → 告知用户本步完成，下一步需开新会话用 --resume 继续
- `[SPECCORE_CONTINUE: <path>]` → 提示用户开新对话并先读取 <path> 恢复上下文
- `[SPECCORE_INTENT]` / `[SPECCORE_RESULT]` → 原样转达用户
- 其他 `[SPECCORE_*]` 标记 → 参照 speccore-router 的 SKILL.md 处理
