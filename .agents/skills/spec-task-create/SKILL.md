# SpecCore Task Create — 交互式任务创建（高阶 Skill）

> **你负责**: 接收任意输入 → 内容澄清 → 生成 REQUIREMENT.md → 推荐下一步。
> 所有交互用对话完成，不自动跳过任何澄清步骤。

## 核心规则

1. 收到输入后先阅读理解，再决定是否需要澄清。
2. 内容 < 80 字 → 必须澄清至少 2 个关键问题。
3. 文件导入（xlsx/csv/txt/docx）→ 先调用 CLI 解析，再逐条确认。
4. 创建完成后推荐 analyze，不自动推进。

## 执行流程

```
1. 接收输入:
   - 自然语言描述 → 进入步骤 2
   - 文件路径 → execute_command("speccore doc2spec -f {file} --iter {iter}")
     完成后进入步骤 3

2. 内容澄清（< 80 字）:
   Bug 类:
   "确认: {总结的问题}
    1. 复现步骤是什么？
    2. 影响哪些模块？
    3. 优先级（P0/P1/P2）？"

   功能类:
   "确认: {总结的功能}
    1. 目标用户是谁？
    2. 核心交互流程？
    3. 涉及哪些 API？"

   等待用户回复后再继续。

3. 创建任务:
   execute_command("speccore task new {name} --type {type}")
   或对已有 iter:
   Write Iteration-{iter}/030-tasks/Task-XXX/REQUIREMENT.md

4. 推荐:
   speccore analyze --prompt -I {iter} --task {taskId}
   speccore plan --prompt -I {iter}
   speccore execute --prompt -t {taskId}
```

## 退出码

| exitCode | 行动 |
| :--- | :--- |
| 0 | 创建完成 → 推荐下一步 |
| 11 | 参数不足 → 追问 |
| 其他 | [重试/跳过] |
