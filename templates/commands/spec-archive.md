---
name: spec-archive
aliases: [spec-ar, spec-arch]
suggestions:
  - "--task=<Task编号>   归档单个 Task"
  - "--all               归档所有已完成 Task"
  - "--iteration=<期次>  归档整个期次"
  - "--list              查看已归档列表"
  - "--restore=<Task编号> 恢复已归档 Task"
  - "--force             跳过预览，直接归档"
description: 🗄️ 归档已完成的 Task，保留完整历史信息
category: SpecCore
intent:
  triggers:
    keywords: [归档, 存档, 清理, 整理]
    patterns:
      - "归档"
      - "清理"
      - "整理"
  params:
    - name: task
      extract: "task"
      default: "all"
      description: "任务编号（all=全部已完成）"
  examples:
    - "归档已完成的任务"
    - "清理一下"
    - "归档 Task-001"
---
# /spec-archive - 归档 Task

## 命令说明
将已完成的 Task 移动到 `archived/` 目录，保留完整文件，同时生成归档索引。

## 使用方式
```bash
/spec-archive --task=Task-001
/spec-archive --all
/spec-archive --iteration=2026-07-会议预定
/spec-archive --list
/spec-archive --restore=Task-001
/spec-archive --restore=Task-001 --iteration=2026-07-会议预定
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `--task=<Task编号>` | 是* | 归档单个任务 | `/spec-archive --task=Task-001` |
| `--all` | 是* | 归档所有已完成任务 | `/spec-archive --all` |
| `--iteration=<期次>` | 否 | 归档整个期次 | `/spec-archive --iteration=2026-07-会议预定` |
| `--list` | 否 | 查看归档列表 | `/spec-archive --list` |
| `--restore=<Task编号>` | 否 | 恢复归档任务 | `/spec-archive --restore=Task-001` |
| `--restore=<Task编号> --iteration=<期次>` | 否 | 恢复到指定期次 | `/spec-archive --restore=Task-001 --iteration=2026-07-会议预定` |
| `--force` | 否 | 跳过预览，直接归档 | `/spec-archive --all --force` |

> *注：`--task` 和 `--all` 必须二选一。未指定 `--iteration` 时自动使用当前活跃期次。

## AI 执行流程

### 第一步：加载上下文

1. 读取 `.speccore/local/context.json` 获取当前上下文
2. 如果未指定 `--iteration`，自动使用 `current_iteration`
3. 如果未指定 `--task` 且 `--all` 未设置，使用 `current_task`

### 第二步：预览归档范围

```
📋 归档预览

将归档以下任务：
- Task-001 用户登录（✅ 已完成）
- Task-002 会议室管理（✅ 已完成）
- Task-003 会议预定（✅ 已完成）

共 3 个任务，预计释放目录空间：{N} 个文件

是否继续？输入 确认 归档，取消 终止
```

> 使用 `--force` 跳过此步骤

### 第三步：执行归档

#### 归档单个 Task

1. 校验任务状态是否为 `✅ 已完成`
2. 移动目录到 `archived/`
3. 更新 `PROJECT_GRAPH.md` 状态为 `🗄️ 已归档`
4. 更新 `ARCHIVE_INDEX.md`

#### 恢复归档 Task

1. 从 `archived/` 移回期次根目录
2. 更新 `PROJECT_GRAPH.md` 状态为 `✅ 已完成`

## 输出示例
```markdown
✅ Task-001 已归档！

📁 位置：期次-2026-07-会议预定/archived/Task-001-用户登录/
📋 归档索引已更新
```
