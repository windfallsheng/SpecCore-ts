---
name: spec-iteration-split
aliases: [spec-is, spec-iter-split]
description: 🔪 从总需求文档自动拆分为原子任务
category: SpecCore
intent:
  triggers:
    keywords: [拆分需求, 分解需求, 拆分文档, 需求拆分]
    patterns:
      - "拆分(.*)需求"
      - "分解(.*)需求"
      - "拆分(.*)文档"
      - "需求拆分"
  params:
    - name: requirement
      extract: "path"
      default: "auto"
      description: "需求文档路径"
    - name: sections
      extract: "sections"
      default: ""
      description: "指定章节（如 2.1,2.3）"
  examples:
    - "拆分需求"
    - "拆分 ./docs/PRD.md"
    - "只看 2.1 和 2.3 节"
    - "拆分这个需求文档"
---
# /spec-iteration-split - 需求拆分

## 命令说明
读取 `00-需求文档/REQUIREMENT.md`，自动拆分为原子任务。

## 使用方式
```bash
/spec-iteration-split
/spec-iteration-split --iteration=2026-07-会议预定
/spec-iteration-split --requirement=./docs/PRD.md
/spec-iteration-split --sections=2.1,2.3
/spec-iteration-split --sections=2.1-2.5
/spec-iteration-split --target=Task-001
/spec-iteration-split --dry-run
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| 无参数 | - | 使用当前期次 + 默认需求文档路径 | `/spec-iteration-split` |
| `--iteration=<期次>` | 否 | 指定期次 | `/spec-iteration-split --iteration=2026-07-会议预定` |
| `--requirement=<路径>` | 否 | 指定需求文档路径 | `/spec-iteration-split --requirement=./docs/PRD.md` |
| `--sections=<章节>` | 否 | 只拆分指定章节（逗号分隔） | `/spec-iteration-split --sections=2.1,2.3` |
| `--sections=<范围>` | 否 | 拆分章节范围 | `/spec-iteration-split --sections=2.1-2.5` |
| `--target=<Task编号>` | 否 | 合并到已有 Task 目录 | `/spec-iteration-split --target=Task-001` |
| `--dry-run` | 否 | 预览拆分结果，不实际创建 | `/spec-iteration-split --dry-run` |

## AI 执行流程

1. 读取 `期次-XXX/00-需求文档/REQUIREMENT.md`（或 `--requirement` 指定的路径）
2. 分析需求结构，识别功能模块和技术任务
3. 为每个模块创建 `Task-{编号}-{名称}/` 目录
4. 自动推断任务类型（feature/bugfix/research/...）
5. 生成 `REQ.md`、`TECH.md`、`TASK.md`
6. 创建 `.task-type` 文件
7. 更新 `PROJECT_GRAPH.md`

## 输出示例
```markdown
✅ 需求拆分完成！

📋 识别到 4 个任务：

| 编号 | 任务名称 | 类型 | 优先级 | 依赖 |
| :--- | :--- | :--- | :--- | :--- |
| Task-001 | 用户登录 | feature | 高 | 无 |
| Task-002 | 会议室管理 | feature | 高 | Task-001 |
| Task-003 | 修复超时问题 | bugfix | 中 | Task-001 |
| Task-004 | 接口优化 | optimization | 低 | Task-002 |

📁 已生成 4 个任务目录

📋 下一步：
1. 审查各任务的 REQ.md 是否准确
2. 运行 /spec-plan 生成调度方案
```
