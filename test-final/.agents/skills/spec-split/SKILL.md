---
name: spec-split
description: >
  任务拆分。将需求 REQUIREMENT.md 拆分为独立开发任务。
  Use when user says "拆分" "分解" "split" "拆任务".
allowed-tools: ["Bash", "Read", "Write", "Edit"]
---
## 🚫 禁止

- 禁止在无 REQUIREMENT.md 时拆分
- 禁止拆分粒度过细（单个 Task < 1 文件）
- 禁止拆分时不标注依赖关系

# SpecCore Split — 任务拆分器

> **你负责**: 读取分析结果 → 你自己拆分 → CLI 创建 Task 目录。

## 核心规则
1. 按端（app/h5/miniapp/admin）和 API 数（3-8 个/Task）拆分。
2. 计算依赖关系：数据模型 Task 前置，认证 Task 前置。
3. 返回 JSON Task 列表。

## 执行流程

```
1. execute_command("speccore iteration split --prompt -I {iter}")
   exitCode=10 → 你拆分
   exitCode=11 → 展示 NEEDS_INFO → 用户选迭代 → 重试

2. 取 stdout [SPECCORE_PROMPT]...[/SPECCORE_PROMPT]
   解析 ANALYSIS.md 内容

3. 你自己拆分，返回 JSON:
   [
     {"id":"Task-001","name":"数据模型","req":"...","tech":"...","depends":[]},
     {"id":"Task-002","name":"app 认证","req":"...","tech":"...","depends":["Task-001"]}
   ]

4. 自检: JSON 数组，每个 item 含 id/name/req
   失败 → 重试 ≤2 次 → 降级: Markdown 表格写入 REQUIREMENT.md

5. 写入:
   Write /tmp/split.json
   execute_command("cat /tmp/split.json | speccore iteration split --response - -I {iter}")

6. 展示: Task 数量 + 依赖关系 + 推荐下一步 (plan)
```

## 退出码

| exitCode | 行动 |
| :--- | :--- |
| 10 | 你拆分任务 |
| 11 | 展示迭代列表 → 用户选 |
| 其他 | [重试/跳过/停止] |
