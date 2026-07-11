---
name: spec-sync
aliases: [spec-sy]
suggestions:
  - "--task=<Task编号>   目标 Task"
  - "--iteration=<期次>  同步整个期次"
  - "--auto              自动执行同步"
  - "--dry-run           预览差异（不修改）"
description: 🔄 反向同步：检测代码与 Spec 的差异，更新 Spec 文件
category: SpecCore
intent:
  triggers:
    keywords: [同步, 反向同步, 更新Spec, 对齐]
    patterns:
      - "同步(.*)"
      - "更新(.*)Spec"
      - "对齐(.*)"
  params:
    - name: task
      extract: "task"
      default: "auto"
      description: "任务编号"
  examples:
    - "同步 Spec 和代码"
    - "更新 Task-001 的 Spec"
    - "对齐一下代码和文档"
---
# /spec-sync - 反向同步

## 命令说明
检测指定 Task 的代码实现与 Spec 文件之间的差异，生成同步建议。

## 使用方式
```bash
/spec-sync Task-001
/spec-sync --iteration=2026-07-会议预定
/spec-sync Task-001 --auto
/spec-sync Task-001 --dry-run
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `--task=<Task编号>` | 是* | 目标任务 | `/spec-sync Task-001` |
| `--iteration=<期次>` | 是* | 同步整个期次 | `/spec-sync --iteration=2026-07-会议预定` |
| `--auto` | 否 | 自动执行同步 | `/spec-sync Task-001 --auto` |
| `--dry-run` | 否 | 预览差异，不实际修改 | `/spec-sync Task-001 --dry-run` |
| `--force` | 否 | 跳过预览，直接同步 | `/spec-sync Task-001 --force` |

> *注：`--task` 和 `--iteration` 必须二选一。未指定 `--iteration` 时自动使用当前活跃期次。

## AI 执行流程

### 第一步：加载上下文

1. 读取 `.speccore/local/context.json` 获取当前上下文
2. 如果未指定 `--iteration`，自动使用 `current_iteration`
3. 如果未指定 `--task` 且 `--iteration` 未设置，使用 `current_task`

### 第二步：预览差异

```
📋 同步预览：Task-001

差异分析：
| 对比项 | Spec 定义 | 代码实现 | 状态 |
| :--- | :--- | :--- | :--- |
| 接口路径 | /api/v1/auth/login | /api/v1/auth/login | ✅ 一致 |
| 入参字段 | phone, password | phone, password, captcha | ⚠️ 代码多出字段 |
| 错误码 | 1001 用户不存在 | 1001 用户不存在 | ✅ 一致 |

同步建议：
- API_CONTRACT.yaml：入参增加 captcha 字段
- REQ.md：增加验证码校验逻辑描述

是否继续同步？输入 确认 同步，取消 终止
```

> 使用 `--force` 或 `--auto` 跳过此步骤

### 第三步：执行同步

1. 加载 Spec 文件
2. 读取对应的代码文件
3. 逐项对比，生成差异报告
4. 经用户确认后执行同步
5. 更新 `context.json` 的 `current_task` 和 `last_updated`

## 输出示例
```markdown
📋 差异报告：Task-001

| 对比项 | Spec 定义 | 代码实现 | 状态 |
| :--- | :--- | :--- | :--- |
| 接口路径 | /api/v1/auth/login | /api/v1/auth/login | ✅ 一致 |
| 入参字段 | phone, password | phone, password, captcha | ⚠️ 代码多出字段 |
| 错误码 | 1001 用户不存在 | 1001 用户不存在 | ✅ 一致 |

同步建议
- API_CONTRACT.yaml：入参增加 captcha 字段
- REQ.md：增加验证码校验逻辑描述
```
