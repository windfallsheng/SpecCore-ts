# SpecCore Task Create — 交互式任务创建

> **你负责**: 接收任意输入（文件/自然语言） → 内容澄清 → 生成 REQUIREMENT.md → 推荐下一步。

## 核心规则

1. **先理解再创建**: 不管用户给什么格式的输入，先阅读理解内容。
2. **主动澄清**: 内容模糊时必须向用户提问，确认后再写 spec。
3. **生成结构化的 REQUIREMENT.md**: 含属性表 + 描述 + 验收标准。
4. **创建后推荐**: analyze → plan → execute。

## 输入源支持

### A. Excel/CSV (bug列表)
```
1. execute_command("speccore doc2spec -f {file} --iter {iter}")
   → 自动逐行解析，创建 Task-001 ~ Task-NNN
2. 展示: ✅ 已创建N个任务 + 列表摘要
3. 推荐: analyze --prompt -I {iter}
```

### B. Word/Text/自然语言
```
1. 读取用户输入（文件或文字描述）

2. 你理解和澄清:
   "📋 我理解你要创建的任务:
    - 名称: {你推断的标题}
    - 描述: {你总结的要点}
    - 类型: {feature/bugfix/research}
    - 优先级: {推断的优先级}
    是否正确？需要补充什么？"

3. 用户确认或补充后:
   → 生成 REQUIREMENT.md
   → execute_command("speccore task new {name} --type {type}")
   → 如果有 iter，自动放到 Iteration-{iter}/030-tasks/ 下

4. 推荐:
   speccore analyze --prompt -I {iter} --task {taskId}
```

## 内容澄清模板

```
当用户提供的需求描述少于 50 字时，主动提问:

针对 Bug:
  1. 复现步骤是什么？
  2. 期望行为 vs 实际行为？
  3. 影响的模块/页面？
  4. 优先级（P0/P1/P2）？

针对新功能:
  1. 目标用户是谁？
  2. 核心交互流程是什么？
  3. 涉及哪些 API？
  4. 有哪些边界条件？

你的提问应该简洁（2-3 个关键问题），一次问完。
```

## 退出码

| exitCode | 行动 |
| :--- | :--- |
| 0 | task 创建完成 → 推荐下一步 |
| 11 | 参数不足 → 追问用户 |
| 其他 | [重试/跳过] |
