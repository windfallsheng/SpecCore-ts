# SpecCore Pipeline — 阶段检测 + Prompt/Apply 级联

> **角色**: 检测迭代阶段 → 拼出 --prompt 命令 → 捕获 Prompt → AI 处理 → 写入结果

## 执行流程

```
1. 读取 context.json + PROJECT_GRAPH → 判断当前阶段
2. 拼出对应的 --prompt 命令
3. execute_command 执行 → 捕获 [SPECCORE_PROMPT]
4. 提交给宿主 AI 处理
5. 调用对应的 --apply/--response 写入结果
6. 进入下一阶段
```

## 阶段 → --prompt 命令

| 阶段 | --prompt 命令 | --apply/--response |
| :--- | :--- | :--- |
| 需求就绪 | `speccore analyze --prompt -I {iter}` | `speccore analyze --apply '...'` |
| 分析完成 | `speccore iteration split --prompt -I {iter}` | `speccore iteration split --response '...'` |
| 任务就绪 | `speccore plan --prompt -I {iter}` | `speccore plan --response '...'` |
| 计划就绪 | `speccore execute --prompt -t {task}` | `speccore execute --response '...'` |
| 开发完成 | `speccore pr --prompt -t {task}` | `speccore pr --response '...'` |
| PR 合并 | `speccore done --prompt -t {task}` | `speccore done --response '...'` |
