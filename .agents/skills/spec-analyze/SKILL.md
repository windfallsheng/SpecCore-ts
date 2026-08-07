# SpecCore Analyze — Skill + CLI + AI 协作分析

> **架构**: CLI 准备上下文 → 输出 Prompt → AI 分析 → CLI 写回文件

## 执行流程

```
1. Skill: execute_command("speccore analyze --prompt -I Q1")
   → CLI 输出 [SPECCORE_PROMPT]...[/SPECCORE_PROMPT] 到 stdout

2. Skill 捕获 stdout → 传给宿主 AI
   → AI 分析需求文档，返回 Markdown 分析报告

3. Skill: execute_command("speccore analyze --apply '$content' -I Q1")
   → CLI 写入 020-specs/ANALYSIS.md
```

## 完整 Skill 示例

```
用户: "分析 Q1 的需求"

Skill 执行:
1. execute_command("speccore analyze --prompt -I Q1")
2. 提取 Prompt → 提交给 AI
3. AI 返回分析结果
4. execute_command("speccore analyze --apply '...' -I Q1")
```
