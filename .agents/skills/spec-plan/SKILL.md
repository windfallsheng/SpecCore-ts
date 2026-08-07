---
name: spec-plan
description: >
  执行计划生成。根据任务列表生成多阶段计划(Mermaid 图+风险评估+里程碑)。
  Use when user says "规划" "计划" "plan" "排程".
allowed-tools: ["Bash", "Read", "Write", "Edit"]
---
# SpecCore Plan — 执行计划生成器

> **你负责**: 读取 Task 列表 → 你自己排程 → CLI 写入 plan.json。

## 执行流程

```
1. execute_command("speccore plan --prompt -I {iter}")
   exitCode=10 → 你排程
   exitCode=11 → 展示迭代 → 用户选

2. 取 stdout [SPECCORE_PROMPT]...[/SPECCORE_PROMPT]
   解析 Task 列表和依赖关系

3. 你排程: 拓扑排序 + 并行分组 + 工作量估算
   返回 JSON: {"batches":[{"tasks":["Task-001"],"assignee":"张三","days":2}]}

4. 自检: 含 batches 数组, 每个 task 有 assignee 和 days
   失败 → 重试 ≤2 次

5. 写入: Write /tmp/plan.json
   execute_command("cat /tmp/plan.json | speccore plan --response - -I {iter}")

6. 展示: 批次数 + 总人天 + 推荐 (execute)
```

## 退出码
| exitCode | 行动 |
| :--- | :--- |
| 10 | 你排程 |
| 11 | 展示迭代列表 |
| 其他 | [重试/跳过/停止] |
