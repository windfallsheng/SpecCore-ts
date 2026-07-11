---
name: spec-execute
aliases: [spec-ex, spec-run]
suggestions:
  - "--all              执行所有待开发任务"
  - "--assignee=<成员>  按执行人过滤"
  - "--task=<Task编号>  按任务过滤"
  - "--type=<类型>      按类型过滤（feature/bugfix/research/optimization/migration/document）"
  - "--priority=<优先级> 按优先级过滤（high/medium/low）"
  - "--backend          仅后端任务"
  - "--frontend         仅前端任务"
  - "--interactive      交互式选择"
  - "--dry-run          预览模式（不执行）"
  - "--resume           断点续传"
  - "--parallel=<数量>  并行执行数量"
  - "--force            跳过预览，直接执行"
  - "--iteration=<期次> 指定期次（默认使用当前活跃期次）"
description: ⚡ 执行控制中心：按人员/任务/类型执行开发任务
category: SpecCore
intent:
  triggers:
    keywords: [开始, 执行, 干活, 继续, 开发, 做, 跑]
    patterns:
      - "开始(.*)"
      - "继续(.*)"
      - "开发(.*)"
      - "做(.*)"
      - "执行(.*)"
  params:
    - name: all
      extract: "all"
      default: false
      description: "是否执行所有任务"
    - name: assignee
      extract: "assignee"
      default: "auto"
      description: "执行人"
    - name: task
      extract: "task"
      default: "auto"
      description: "任务编号"
    - name: type
      extract: "type"
      default: ""
      description: "任务类型"
  examples:
    - "开始干活"
    - "继续开发"
    - "开发 Task-001"
    - "开发登录"
    - "做下一个"
    - "执行张三的任务"
    - "只做 bugfix 类型的任务"
---
# /spec-execute - 执行控制中心

## 命令说明
执行已确认的调度方案，支持多种过滤方式。

## 使用方式
```bash
/spec-execute --all
/spec-execute --assignee=张三
/spec-execute --task=Task-001
/spec-execute --task=Task-001,Task-003
/spec-execute --type=bugfix
/spec-execute --type=feature,bugfix
/spec-execute --priority=高
/spec-execute --status=待开发
/spec-execute --assignee=张三 --backend
/spec-execute --assignee=张三 --frontend
/spec-execute --interactive
/spec-execute --dry-run
/spec-execute --resume
/spec-execute --all --parallel=2
/spec-execute --all --iteration=2026-07-会议预定
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `--all` | 否 | 执行所有待开发任务 | `/spec-execute --all` |
| `--assignee=<成员>` | 否 | 按执行人过滤 | `/spec-execute --assignee=张三` |
| `--task=<Task编号>` | 否 | 按任务过滤 | `/spec-execute --task=Task-001` |
| `--task=<列表>` | 否 | 执行多个指定任务 | `/spec-execute --task=Task-001,Task-003` |
| `--type=<任务类型>` | 否 | 按类型过滤 | `/spec-execute --type=bugfix` |
| `--type=<列表>` | 否 | 执行多种类型 | `/spec-execute --type=feature,bugfix` |
| `--priority=<优先级>` | 否 | 按优先级过滤 | `/spec-execute --priority=高` |
| `--status=<状态>` | 否 | 按状态过滤 | `/spec-execute --status=待开发` |
| `--backend` | 否 | 仅后端任务 | `/spec-execute --assignee=张三 --backend` |
| `--frontend` | 否 | 仅前端任务 | `/spec-execute --assignee=张三 --frontend` |
| `--interactive` | 否 | 交互式选择 | `/spec-execute --interactive` |
| `--dry-run` | 否 | 预览模式 | `/spec-execute --dry-run` |
| `--resume` | 否 | 断点续传 | `/spec-execute --resume` |
| `--parallel=<数量>` | 否 | 并行执行数量 | `/spec-execute --all --parallel=2` |
| `--iteration=<期次>` | 否 | 指定期次（默认使用当前活跃期次） | `/spec-execute --all --iteration=2026-07-会议预定` |
| `--force` | 否 | 跳过预览，直接执行 | `/spec-execute --all --force` |

> 💡 **智能默认值**：未指定 `--iteration` 时自动使用当前活跃期次；未指定 `--assignee` 时自动使用当前 Git 用户。

## AI 执行流程

### 第一步：加载上下文

1. 读取 `.speccore/local/context.json` 获取当前上下文
2. 如果用户未指定 `--iteration`，自动使用 `current_iteration`
3. 如果 `current_iteration` 为空，自动检测：
   - 读取 `.speccore/ITERATIONS/README.md`
   - 找到状态为 `🔄 进行中` 的期次
   - 若无进行中期次，使用最新期次
4. 如果用户未指定 `--assignee`，自动使用 `current_assignee`
5. 如果 `current_assignee` 为空，执行 `git config user.name`

### 第二步：生成执行计划（预览）

在执行前，生成详细的执行计划：

```
📋 执行预览（/spec-execute --all --dry-run）

将执行以下操作：

| 序号 | Task | 类型 | 依赖状态 | 预计耗时 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Task-002 会议室管理 | backend | ✅ 依赖 Task-001 已完成 | 3 分钟 |
| 2 | Task-003 会议预定 | frontend | ✅ 依赖 Task-001 已完成 | 2 分钟 |
| 3 | Task-004 审批流程 | backend | ⏳ 依赖 Task-002 未完成 | 等待中 |

预计总耗时：5 分钟
涉及代码文件：8 个
```

### 第三步：确认执行

```
是否继续执行？
输入 确认 开始，调整 修改执行范围，取消 终止
```

> 使用 `--force` 跳过此步骤直接执行

### 第四步：执行与实时进度反馈

执行过程中，实时输出进度：

```
⏳ 执行中...（第 2/4 个 Task）

[████████░░░░░░░░░░] 40% - Task-002 会议室管理（后端）

已完成：
✅ Task-001 用户登录（后端）- 3 个文件
✅ Task-001 用户登录（前端）- 4 个文件

进行中：
🔄 Task-002 会议室管理（后端）- 生成 RoomController.java...

等待中：
⏳ Task-003 会议预定（前端）
⏳ Task-004 审批流程（后端）

已耗时：1 分 30 秒
预计剩余：2 分钟
```

用户可随时输入 `暂停` 中断执行，稍后使用 `/spec-execute --resume` 继续。

### 第五步：更新上下文

执行完成后，更新 `context.json`：
- 更新 `current_task` 为最后一个执行的任务
- 更新 `last_updated` 为当前时间
- 追加执行历史到 `history`
