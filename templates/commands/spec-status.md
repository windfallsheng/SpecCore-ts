---
name: spec-status
aliases: [spec-st, spec-sts]
suggestions:
  - "--iteration=<期次>  查看指定期次（默认当前期次）"
  - "--assignee=<成员>   查看指定成员"
  - "--type=<类型>       按类型过滤"
description: 📊 查看当前项目的整体状态和进度（简洁版）
category: SpecCore
intent:
  triggers:
    keywords: [状态, 情况, 怎么样了]
    patterns:
      - "状态"
      - "情况"
      - "怎么样了"
  params:
    - name: iteration
      extract: "iteration"
      default: "auto"
      description: "期次名称"
  examples:
    - "当前状态"
    - "怎么样了"
    - "项目状态"
---
# /spec-status - 查看状态

## 命令说明
简洁版状态看板，快速查看项目整体状态。

## 使用方式
```bash
/spec-status
/spec-status --iteration=2026-07-会议预定
/spec-status --assignee=张三
/spec-status --type=feature
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| 无参数 | - | 查看当前期次 | `/spec-status` |
| `--iteration=<期次>` | 否 | 查看指定期次 | `/spec-status --iteration=2026-07-会议预定` |
| `--assignee=<成员>` | 否 | 查看指定人员 | `/spec-status --assignee=张三` |
| `--type=<任务类型>` | 否 | 按类型查看 | `/spec-status --type=feature` |

## 输出示例
```markdown
📊 项目状态 - 2026-07-会议预定

状态分布

| 状态 | 数量 |
| :--- | :--- |
| ✅ 已完成 | 1 |
| 🟦 开发中 | 1 |
| 🔲 待开发 | 1 |
| 🔶 待回归 | 1 |

Task 列表

| Task | 名称 | 负责人 | 状态 |
| :--- | :--- | :--- | :--- |
| Task-001 | 用户登录 | 张三 | ✅ |
| Task-002 | 会议室管理 | 李四 | 🟦 |
| Task-003 | 会议预定 | 王五 | 🔲 |
| Task-004 | 审批流程 | - | 🔶 |
```
