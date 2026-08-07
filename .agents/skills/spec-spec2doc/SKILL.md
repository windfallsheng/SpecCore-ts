---
name: spec-spec2doc
description: >
  文档导出。Spec Markdown → Word/PDF/HTML/PPTX。
  Use when user says "导出" "生成文档" "生成报告" "导出Word" "导出PDF".
allowed-tools: ["Bash", "Read", "Write", "Edit"]
---
# SpecCore spec2doc — AI 排版 + Pandoc 导出

> **你负责**: 审计 Spec 文档 → 你自己编排排版 → Pandoc 机械导出。

## 执行流程

```
1. execute_command("speccore spec2doc --prompt -i {iter} -o {file}")
   获取文档审计 prompt
   exitCode=10 → 你审计

2. 你自己做内容审计:
   - 检查: TODO/TBD 残留、API 定义完整、交叉引用有效
   - 生成审计报告: 通过/警告/建议

3. 生成编排版 Markdown:
   - 封面 + 目录 + 章节重排 + Mermaid 标注
   Write /tmp/spec2doc-merged.md

4. 导出:
   execute_command("pandoc /tmp/spec2doc-merged.md -f gfm -t {format} -o {output}")

5. 后处理:
   execute_command("speccore spec2doc --apply '{audit_report}' -o {file}")

6. 展示: 页数 + 章节 + 图片 + 推荐
```

## 退出码

| exitCode | 行动 |
| :--- | :--- |
| 10 | 你审计 + 编排 |
| 0 | pandoc 完成 → 你验证 |
| 其他 | [重试/跳过] |
