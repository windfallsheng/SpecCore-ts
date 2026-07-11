# 代码生成模板库

> 本目录存放可复用的代码生成模板。
> AI 在执行 Task 时，自动匹配最合适的模板，提高代码生成效率和质量。

## 模板列表

| 模板ID | 名称 | 适用场景 | 技术栈 | 输出文件数 |
| :--- | :--- | :--- | :--- | :--- |
| T-001 | CRUD Controller | RESTful CRUD 接口 | Spring Boot | 4 |
| T-002 | JWT Authentication | 用户认证 | Spring Boot + JWT | 3 |
| T-003 | Excel Export | 数据导出 | Spring Boot + POI | 2 |
| T-004 | Report Generator | 报表生成 | Spring Boot + Jasper | 3 |
| T-005 | PDF Export | PDF 导出 | Spring Boot + iText | 2 |

## 模板使用规则

1. AI 在开始编码前，先检查 `TEMPLATES/` 目录
2. 根据 Task 类型和需求描述，匹配最合适的模板
3. 匹配到的模板作为代码生成的基础，再根据具体需求调整
4. 如果模板库中没有匹配的模板，AI 从头生成并记录"可提取为新模板"

## 贡献模板

发现一个可复用的代码模式时，运行：
```
/spec-template-add --name=<模板名称> --type=<类型> --files=<文件路径>
```
