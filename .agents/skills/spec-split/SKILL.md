# SpecCore Split — Skill + CLI + AI 协作拆分

> **架构**: CLI 准备上下文 → 输出 Prompt → AI 拆分 → CLI 创建 Task 目录

## 执行流程

```
1. Skill: execute_command("speccore iteration split --prompt -I Q1")
   → CLI 输出 [SPECCORE_PROMPT]...[/SPECCORE_PROMPT] 到 stdout

2. Skill 捕获 stdout → 传给宿主 AI
   → AI 返回 Task 列表 JSON: [{"id":"Task-001","req":"...","tech":"..."}]

3. Skill: execute_command("speccore iteration split --response '$json' -I Q1")
   → CLI 创建 Task-001/, Task-002/ 等目录和文件
```
