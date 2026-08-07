---
name: spec-dev
description: >
  智能进度推进器。检测迭代阶段 → 展示状态 → 等用户确认后执行下一步。
  Use when user says "下一步" "流水线" "进度" "推进" "what's next".
allowed-tools: ["Bash", "Read"]
---
# SpecCore Pipeline — 智能级联推进器

> **你负责**: 检测迭代阶段 → 推荐并执行下一步 → 逐步推进项目。

## 执行流程

```
1. Read .speccore/local/context.json → 获取当前迭代
   Read PROJECT_GRAPH.md → 获取 Task 进度

2. 展示状态:
   "📊 {iter} 进度: analyze ✅ → split ▶ → plan ⬜ → execute ⬜
    下一步: speccore iteration split --prompt -I {iter}"

3. 用户确认 → execute_command 执行下一步
   走对应 Skill 的流程(analyze→spec-analyze, execute→spec-execute)

4. 每步完成 → 回到步骤 1 → 重新检测 → 推荐最新下一步

5. --auto 模式: 跳过确认，自动执行所有步骤
   但每步仍需检查退出码，失败时暂停
```

## 退出码

| exitCode | 行动 |
| :--- | :--- |
| 10 | 交给对应 Skill 处理 |
| 11 | 展示参数列表 |
| 其他 | [重试/跳过/停止] |
