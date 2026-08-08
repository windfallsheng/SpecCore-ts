---
name: spec-doc2spec
description: >
  文档导入。Word/Excel/CSV → Spec Markdown，支持图片提取和 Bug 列表解析。
  Use when user says "导入文档" "Word" "Excel" "CSV" "Bug列表".
allowed-tools: ["Bash", "Read", "Write", "Edit"]
---
## 🚫 禁止

- 禁止在无 pandoc 时直接放弃（AI 上下文自动安装）
- 禁止跳过图片提取步骤
- 禁止对非文档文件执行转换

# SpecCore doc2spec — AI + Pandoc 双路验证

> **你负责**: Pandoc 机械转换 + 你自己交叉验证 = 零数据丢失。

## 执行流程

```
1. execute_command("speccore doc2spec -f {file} --iter {iter} --no-ai")
   先用 pandoc 做机械转换（快，但可能有乱码/断表/遗漏）

2. Read 转换后的 REQUIREMENT.md
   Read 原始文件 {file}

3. execute_command("speccore doc2spec --prompt -f {file} --iter {iter}")
   获取 AI 验证 prompt

4. 你自己做交叉验证:
   - 对比原始文档 vs pandoc 输出
   - 检查: 乱码、标题断裂、表格损坏、图片缺失、内容丢失
   - 生成修正后的 Markdown

5. 写入:
   Write /tmp/doc2spec-fixed.md
   execute_command("cat /tmp/doc2spec-fixed.md | speccore doc2spec --response - -f {file} --iter {iter}")

6. 展示: 发现N个问题已修复 + VALIDATION.md 报告 + 推荐下一步 (analyze)
```

## 退出码

| exitCode | 行动 |
| :--- | :--- |
| 0 | pandoc 转换完成 → 你验证 |
| 10 | 获取 prompt → 你交叉验证 |
| 其他 | [重试/跳过] |
