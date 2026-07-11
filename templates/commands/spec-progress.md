---
name: spec-progress
aliases: [spec-pg, spec-prog]
suggestions:
  - "--iteration=<期次>  查看指定期次（默认当前期次）"
  - "--assignee=<成员>   查看指定成员"
  - "--type=<类型>       按类型过滤"
  - "--task=<Task编号>   查看单个 Task 详情"
  - "--detail            显示每个 Task 的详细状态"
  - "--format=json       输出 JSON 格式"
description: 📊 进度总览：查看期次总体进度、各 Task 详情、各开发人员完成情况
category: SpecCore
intent:
  triggers:
    keywords: [进度, 进展, 完成, 还差, 多少]
    patterns:
      - "进度"
      - "进展"
      - "完成多少"
      - "还有多少"
  params:
    - name: iteration
      extract: "iteration"
      default: "auto"
      description: "期次名称"
    - name: assignee
      extract: "assignee"
      default: ""
      description: "按执行人过滤"
  examples:
    - "进度怎么样了"
    - "当前进度"
    - "张三的任务完成没"
    - "还有多少任务"
---
# /spec-progress - 进度总览

## 命令说明
汇总显示指定期次的整体进度、各 Task 详情、各开发人员的任务完成情况。

## 使用方式
```bash
/spec-progress
/spec-progress --iteration=2026-07-会议预定
/spec-progress --assignee=张三
/spec-progress --type=bugfix
/spec-progress --task=Task-001
/spec-progress --detail
/spec-progress --format=json
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| 无参数 | - | 查看当前期次 | `/spec-progress` |
| `--iteration=<期次>` | 否 | 查看指定期次 | `/spec-progress --iteration=2026-07-会议预定` |
| `--assignee=<成员>` | 否 | 查看指定人员 | `/spec-progress --assignee=张三` |
| `--type=<任务类型>` | 否 | 按类型过滤 | `/spec-progress --type=bugfix` |
| `--task=<Task编号>` | 否 | 查看单个任务详情 | `/spec-progress --task=Task-001` |
| `--detail` | 否 | 显示每个任务的详细状态 | `/spec-progress --detail` |
| `--format=json` | 否 | 输出 JSON 格式 | `/spec-progress --format=json` |

## 输出示例
```markdown
📊 进度总览 - 2026-07-会议预定

总体进度

| 指标 | 数值 |
| :--- | :--- |
| 总 Task 数 | 4 |
| ✅ 已完成 | 1 (25%) |
| 🟦 开发中 | 1 (25%) |
| 🔲 待开发 | 1 (25%) |
| 🔶 待回归 | 1 (25%) |
| 整体完成度 | 25% |

各开发人员完成情况

| 人员 | 总任务数 | ✅ 已完成 | 🟦 进行中 | 🔲 待开发 | 完成率 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 张三 | 2 | 1 | 1 | 0 | 50% |
| 李四 | 1 | 0 | 0 | 1 | 0% |
| 王五 | 1 | 0 | 0 | 1 | 0% |
```
