---
name: spec-plan
aliases: [spec-pl]
description: 📋 智能任务调度：分析依赖、识别并行机会、生成团队调度方案
category: SpecCore
intent:
  triggers:
    keywords: [方案, 计划, 怎么做, 怎么实现, 技术方案, 评估, 估算]
    patterns:
      - "(.*)怎么做"
      - "(.*)怎么实现"
      - "需要(.*)时间"
      - "评估(.*)"
  params:
    - name: task
      extract: "task"
      default: "auto"
      description: "任务编号"
    - name: team
      extract: "team"
      default: ""
      description: "团队人数"
  examples:
    - "登录模块怎么做"
    - "帮我规划一下"
    - "评估一下工期"
    - "会议室管理怎么实现"
---
# /spec-plan - 智能任务调度

## 命令说明
分析任务依赖关系，生成调度方案。

## 使用方式
```bash
/spec-plan
/spec-plan --iteration=2026-07-会议预定
/spec-plan --team=3
/spec-plan --assign=张三,李四,王五
/spec-plan --task=Task-001
/spec-plan --type=feature
/spec-plan --priority=高
/spec-plan --mode=claim
/spec-plan --dry-run
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| 无参数 | - | 自动分析当前期次 | `/spec-plan` |
| `--iteration=<期次>` | 否 | 指定期次 | `/spec-plan --iteration=2026-07-会议预定` |
| `--team=<人数>` | 否 | 指定团队人数 | `/spec-plan --team=3` |
| `--assign=<成员列表>` | 否 | 指定成员 | `/spec-plan --assign=张三,李四,王五` |
| `--task=<Task编号>` | 否 | 分析单个 Task | `/spec-plan --task=Task-001` |
| `--type=<任务类型>` | 否 | 按类型筛选 | `/spec-plan --type=feature` |
| `--priority=<优先级>` | 否 | 按优先级筛选 | `/spec-plan --priority=高` |
| `--mode=claim` | 否 | 生成可认领列表 | `/spec-plan --mode=claim` |
| `--dry-run` | 否 | 预览模式，不执行 | `/spec-plan --dry-run` |

## AI 执行流程

1. 读取 `PROJECT_GRAPH.md` 获取所有任务
2. 分析任务间依赖关系（通过 `上游依赖` 字段）
3. 识别可并行的任务组
4. 计算关键路径和总工期
5. 按团队人数分配任务（如果指定）
6. 输出调度方案

## 输出示例
```markdown
📋 任务调度方案

依赖关系总览

关键路径
Task-001（2天）→ Task-002/003（3天并行）→ Task-004（2天）
总工期：7天

任务分配（3人团队）

| 人员 | 角色 | 任务 | 工期 | 开始时间 |
| :--- | :--- | :--- | :--- | :--- |
| 张三 | 全栈 | Task-001 用户登录 | 2天 | Day 1 |
| 李四 | 后端 | Task-002 会议室管理 | 3天 | Day 3 |
| 王五 | 前端 | Task-003 会议预定 | 2天 | Day 3 |

风险提示
⚠️ Task-001 是关键路径唯一入口，延期会导致整体延期

后续操作
确认后输入 confirm 执行分配。
```
