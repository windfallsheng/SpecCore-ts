# SpecCore Plan — Skill + CLI + AI 协作排程

> **架构**: CLI 准备上下文 → 输出 Prompt → AI 排程 → CLI 写入 plan.json

## 执行流程

```
1. Skill: execute_command("speccore plan --prompt -I Q1")
   → CLI 输出 [SPECCORE_PROMPT]...[/SPECCORE_PROMPT] 到 stdout

2. Skill 捕获 stdout → 传给宿主 AI
   → AI 返回执行计划 JSON

3. Skill: execute_command("speccore plan --response '$json' -I Q1")
   → CLI 写入 plan.json
```
