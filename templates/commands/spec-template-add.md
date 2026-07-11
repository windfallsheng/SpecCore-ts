---
name: spec-template-add
aliases: [spec-ta]
suggestions:
  - "--file=<路径>       代码文件路径"
  - "--name=<模板名>     模板名称"
  - "--category=<分类>   模板分类"
  - "--desc=<描述>       模板描述"
description: 📝 添加代码生成模板到模板库
category: SpecCore
intent:
  triggers:
    keywords: [添加模板, 新增模板, 保存模板]
    patterns:
      - "添加模板"
      - "新增模板"
      - "保存(.*)模板"
  params:
    - name: name
      extract: "name"
      required: true
      description: "模板名称"
    - name: type
      extract: "type"
      required: true
      description: "模板类型（crud/auth/export/report）"
  examples:
    - "添加 CRUD 模板"
    - "保存这个为模板"
---
# /spec-template-add - 添加代码模板

## 命令说明
将现有代码提取为可复用的模板，保存到模板库中。

**适用场景**：发现可复用的代码模式

**核心理念**：让团队的最佳实践变成可复用的模板。

## 使用方式
```
/spec-template-add --name=CRUD Controller --type=crud --files=./AuthController.java
/spec-template-add --name=Excel导出 --type=export --files=./ExportService.java
/spec-template-add --name=JWT认证 --type=auth --files=./JwtFilter.java --desc="JWT 令牌认证过滤器"
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `--name=<模板名称>` | 是 | 模板名称 | `--name=CRUD Controller` |
| `--type=<模板类型>` | 是 | 模板类型 | `--type=crud` |
| `--files=<路径>` | 是 | 代码文件路径 | `--files=./AuthController.java` |
| `--desc=<描述>` | 否 | 模板描述 | `--desc="标准 CRUD 控制器"` |

## 模板类型

| 类型 | 说明 | 存储位置 |
| :--- | :--- | :--- |
| `crud` | CRUD 操作模板 | `TEMPLATES/crud/` |
| `auth` | 认证授权模板 | `TEMPLATES/auth/` |
| `export` | 数据导出模板 | `TEMPLATES/export/` |
| `report` | 报表生成模板 | `TEMPLATES/report/` |

## AI 执行流程

### 第一步：读取代码文件

读取指定的代码文件内容，分析代码结构。

### 第二步：识别可替换部分

识别代码中的可变部分：
- 类名 → `{EntityName}`
- 变量名 → `{entityName}`
- 包名 → `{packageName}`
- 字段名 → `{fieldName}`
- 接口路径 → `{apiPath}`
- 表名 → `{tableName}`

### 第三步：生成模板文件

将可变部分替换为占位符，生成 `.tmpl` 文件。

### 第四步：保存并更新索引

1. 保存到 `.speccore/PATTERNS/TEMPLATES/{type}/`
2. 更新 `TEMPLATES/README.md` 索引

## 输出示例
```text
✅ 模板已添加！

📁 位置：.speccore/PATTERNS/TEMPLATES/crud/controller.tmpl
📋 模板ID：T-006
📝 模板名称：CRUD Controller
📂 模板类型：crud
🔧 可替换变量：{EntityName}, {entityName}, {packageName}
📄 源文件：AuthController.java

📋 使用方式：
  AI 在执行相关 Task 时，会自动匹配并使用此模板。

💡 提示：
  - 运行 /spec-review 时，会检查代码是否符合模板规范
  - 模板更新时，关联的代码会收到通知
```
