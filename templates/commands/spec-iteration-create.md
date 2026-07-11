---
name: spec-iteration-create
aliases: [spec-ic, spec-iter-create]
description: 🚀 创建新的期次，包含需求文档、技术文档和任务总览
category: SpecCore
intent:
  triggers:
    keywords: [创建期次, 新建期次, 开启期次, 添加期次]
    patterns:
      - "创建(.*)期次"
      - "新建(.*)期次"
      - "开启(.*)期次"
      - "添加(.*)期次"
  params:
    - name: name
      extract: "name"
      required: true
      description: "期次名称"
  examples:
    - "创建一个期次"
    - "创建 2026-08 期次"
    - "新建一个订单系统期次"
---
# /spec-iteration-create - 创建期次

## 命令说明
创建一个新的期次目录，包含需求文档、技术文档和任务总览。

## 使用方式
```bash
/spec-iteration-create --name=2026-07-会议预定
/spec-iteration-create 2026-07-会议预定
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `--name=<期次名称>` | 是 | 期次名称 | `/spec-iteration-create --name=2026-07-会议预定` |
| 简写 | 是 | 直接跟名称 | `/spec-iteration-create 2026-07-会议预定` |

## AI 执行流程

1. 创建 `期次-{名称}/` 目录
2. 创建 `00-需求文档/REQUIREMENT.md` 模板
3. 创建 `00-技术文档/ARCHITECTURE.md` 模板
4. 创建 `00-期次总览/PROJECT_GRAPH.md` 模板
5. 在 `.speccore/ITERATIONS/README.md` 中追加期次记录
6. 在 `.speccore/ITERATIONS/README.md` 中记录全局层版本

## 输出示例
```markdown
✅ 期次创建完成！

📁 已创建：
- 期次-2026-07-会议预定/00-需求文档/REQUIREMENT.md
- 期次-2026-07-会议预定/00-技术文档/ARCHITECTURE.md
- 期次-2026-07-会议预定/00-期次总览/PROJECT_GRAPH.md

📋 下一步：
1. 编辑 REQUIREMENT.md 填写需求
2. 运行 /spec-iteration-split 拆分为任务
```
