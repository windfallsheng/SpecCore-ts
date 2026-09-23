---
name: spec-run
description: >
  端到端流水线专属 Skill。参数提取（需求描述、
  迭代、起止阶段、演示模式）由 speccore run 引擎执行；参数缺失时引擎输出交互式提示（参数说明 + 使用示例）。
  不影响 speccore run 的意图识别能力。
allowed-tools: ["Bash", "Read", "Write", "Edit"]
disable-model-invocation: false
---

直接执行: execute_command("speccore run '用户的一句话需求'")

不要输出命令文本，不要分析意图，一切交给 speccore run。
流水线会自动从澄清一路跑到部署，中间三个 review 闸口（Spec 定稿 / 代码 review / 部署前确认）
会停下来等你确认，看到 [SPECCORE_GATE_X] 标记时停下 review 并询问用户。

## 输出标记处理（run 流水线）
- `[SPECCORE_GATE_A]` / `[SPECCORE_GATE_B]` / `[SPECCORE_GATE_C]` → 停下来 review 闸口内容，向用户展示 review 产物并询问「是否确认继续？」，用户明确确认后才执行「确认后继续」命令（`speccore run --auto --from <stage>`），禁止自动续跑
- `🛑 [SPECCORE_GATE]`（硬停） → 流水线已停，向用户报告缺失原因与修复建议，不要自动续跑
- 流水线内部透出的 `[SPECCORE_EXEC]` / `[SPECCORE_PROMPT]` / `[SPECCORE_STEP_DONE]` 等标记 → 按 speccore-router 的 SKILL.md 处理
