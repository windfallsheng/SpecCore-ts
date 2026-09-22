# 本期需求文档索引

> 迭代：Iteration-003-test-doc-trim
> 更新：2026-09-22

## 文档清单

| 类型 | 路径 | 状态 | 说明 |
| :--- | :--- | :--- | :--- |
| 原始文档 | sources/ | 待补充 | 放 PRD/Word/PDF |
| 转换规格 | converted/ | 待生成 | doc2spec 输出 |
| 功能需求 | features/ | 待补充 | feature 型：按模块子目录组织 |
| Bug 描述 | bugs/ | 待补充 | bugfix 型：扁平 MD 文件 |
| 重构目标 | refactors/ | 待补充 | refactor 型：扁平 MD 文件 |
| 研究主题 | research/ | 待补充 | research 型：扁平 MD 文件 |
| 原型素材 | prototypes/ | 待补充 | 原型（HTML/图片/链接） |

## 分析配置

- **默认读取**：converted/*.md + features/*/SOURCE.md（旧项目为 README.md）
- **指定文档**：speccore analyze -I Iteration-test-doc-trim --req converted/login.md
- **全部文档**：speccore analyze -I Iteration-test-doc-trim --scope all
