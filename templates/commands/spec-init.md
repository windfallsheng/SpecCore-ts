---
name: spec-init
aliases: [spec-in]
description: 🚀 项目初始化，创建 .speccore/ 目录和基础配置
category: SpecCore
intent:
  triggers:
    keywords: [初始化, 建立项目, 创建项目, 新建项目, 迁移项目]
    patterns:
      - "初始化(这个)?项目"
      - "在(.*)初始化"
      - "建立(.*)项目"
      - "创建(.*)项目"
      - "迁移(.*)项目"
  params:
    - name: path
      extract: "path"
      default: "./"
      description: "项目路径"
    - name: mode
      extract: "mode"
      default: "fresh"
      description: "初始化模式（fresh/migration）"
  examples:
    - "初始化这个项目"
    - "在 ./my-project 初始化"
    - "迁移这个项目"
    - "建立一个新项目"
---
# /spec-init - 项目初始化

## 命令说明
初始化业务项目，创建 `.speccore/` 目录和基础配置。

## 使用方式
```bash
/spec-init
/spec-init --mode=migration
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| 无参数 | - | 从零开始创建新项目 | `/spec-init` |
| `--mode=migration` | 否 | 存量项目迁移模式 | `/spec-init --mode=migration` |

## AI 执行流程

### 模式一：从零开始（无参数）

1. 创建 `.speccore/` 目录结构
2. 生成 `CONSTITUTION.md` 模板
3. 生成 `SETTINGS.md` 默认配置
4. 生成 `PATTERNS/` 目录
5. 生成 `PROJECT/` 目录（含所有项目级资产模板）
6. 生成 `ITERATIONS/README.md`
7. 生成 `RULES/` 目录

### 模式二：存量迁移（--mode=migration）

1. 扫描项目代码，识别技术栈
2. 从 `pom.xml`/`package.json` 提取技术版本
3. 从 `application.yml` 提取数据库/缓存配置
4. 从 Controller 识别 API 模式
5. 自动填充 `CONSTITUTION.md`
6. 生成 `PROJECT/CODE_INDEX.md`

## 输出示例
```markdown
✅ SpecCore 框架初始化完成！

📁 已创建：
- .speccore/CONSTITUTION.md（请补充技术栈）
- .speccore/SETTINGS.md
- .speccore/PATTERNS/
- .speccore/PROJECT/（含 8 个模板文件）
- .speccore/ITERATIONS/README.md
- .speccore/RULES/

📋 下一步：
1. 编辑 .speccore/CONSTITUTION.md 填写技术栈
2. 编辑 .speccore/PROJECT/TEAM.md 填写团队成员
3. 运行 /spec-iteration-create 创建第一个期次
```
