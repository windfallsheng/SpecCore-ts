---
name: spec-analyze
description: >
  AI 需求分析引擎。按任务类型(feature/bugfix/review/test/docs/refactor/deploy/security/performance)
  自动生成对应分析报告。Use when user says "分析" "审查" "安全审计" "性能分析" "测试用例".
allowed-tools: ["Bash", "Read", "Write", "Edit"]
---
## 🚫 禁止

- 禁止在无 REQUIREMENT.md 时生成分析
- 禁止跳过需求确认直接输出结论
- 禁止不展示 [确认/修改/重新分析] 就写入文件

# SpecCore Analyze — 需求分析器

> **你负责**: 读取需求文档 → 你自己分析 → CLI 写入 ANALYSIS.md。你自己就是分析引擎。

## 核心规则
1. 迭代不存在时列出可用迭代让用户选。
2. 分析必须覆盖: API 完整性、数据模型、业务规则、技术映射、风险。
3. 输出必须是 Markdown，≥200 字符。

## 执行流程

```
1. execute_command("speccore analyze --prompt -I {iter}")

   exitCode=10 → 你分析
   exitCode=11 → 展示 NEEDS_INFO → 用户选迭代 → 重试

2. 取 stdout [SPECCORE_PROMPT]...[/SPECCORE_PROMPT]
   解析需求文档内容

3. 你自己分析并生成 Markdown 报告:
   ## 需求概述
   ## API 接口清单（表格）
   ## 数据模型
   ## 业务规则
   ## 技术映射
   ## 风险与建议

4. 自检: ≥200 字符，含 ≥2 个 ## 标题，含 API 表格
   失败 → 重试 ≤2 次 → 降级

5. 写入:
   Write /tmp/analysis.md
   execute_command("cat /tmp/analysis.md | speccore analyze --apply - -I {iter}")

6. 展示: API 数 + 模型数 + 风险数 + 推荐下一步 (split)
```

## 退出码

| exitCode | 行动 |
| :--- | :--- |
| 10 | 你分析并生成报告 |
| 11 | 展示迭代列表 → 用户选 |
| 其他 | [重试/跳过/停止] |
