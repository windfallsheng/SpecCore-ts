---
name: spec-change
aliases: [spec-ch, spec-update]
suggestions:
  - "--task=<Task编号>   目标 Task（默认最近修改的 Task）"
  - "--desc=\"变更描述\"   变更内容"
  - "--global            全局层变更"
  - "--dry-run           预览影响范围（不修改）"
  - "--iteration=<期次>  跨期次影响分析"
description: 🔄 需求变更联动：修改一个 Task 的 Spec，自动影响关联 Task
category: SpecCore
intent:
  triggers:
    keywords: [改成, 改为, 调整, 修改, 更新, 变更, 升级, 换成, 替换]
    patterns:
      - "把(.*)改成(.*)"
      - "将(.*)调整为(.*)"
      - "修改(.*)"
      - "升级(.*)"
      - "换成(.*)"
  params:
    - name: task
      extract: "task"
      default: "auto"
      description: "目标任务（auto=当前任务）"
    - name: desc
      extract: "desc"
      required: true
      description: "变更描述"
    - name: global
      extract: "global"
      default: false
      description: "是否为全局变更"
  examples:
    - "把登录改成验证码登录"
    - "把锁定时间改成10分钟"
    - "升级 Spring Boot 版本"
    - "将 Redis 换成 Caffeine"
---
# /spec-change - 需求变更联动

## 命令说明
当某个 Task 的需求发生变更时，自动更新该 Task 的所有 Spec 文件，并标记受影响的上下游 Task。

## 使用方式
```bash
/spec-change --task=Task-001 --desc="登录增加验证码"
/spec-change Task-001 "登录接口增加验证码校验"
/spec-change --global --desc="JWT改为OAuth2"
/spec-change --task=Task-001 --iteration=2026-07-会议预定
/spec-change --task=Task-001 --desc="增加验证码" --dry-run
```

## 参数说明

| 参数 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `--task=<Task编号>` | 是* | 目标任务 | `/spec-change --task=Task-001` |
| `--desc=<变更描述>` | 是 | 变更内容 | `/spec-change Task-001 "登录增加验证码"` |
| `--global` | 是* | 全局层变更 | `/spec-change --global --desc="JWT改为OAuth2"` |
| `--iteration=<期次>` | 否 | 跨期次变更影响分析 | `/spec-change --task=Task-001 --iteration=2026-07-会议预定` |
| `--dry-run` | 否 | 预览影响范围，不实际修改 | `/spec-change --task=Task-001 --desc="增加验证码" --dry-run` |
| `--force` | 否 | 跳过预览，直接修改 | `/spec-change --task=Task-001 --desc="增加验证码" --force` |

> *注：`--task` 和 `--global` 必须二选一。未指定 `--task` 时默认使用最近修改的 Task。

## AI 执行流程

### 第一步：加载上下文

1. 读取 `.speccore/local/context.json` 获取当前上下文
2. 如果未指定 `--task` 且未指定 `--global`，自动使用 `current_task`
3. 如果未指定 `--iteration`，自动使用 `current_iteration`

### 第二步：预览影响范围

```
📋 变更预览

变更内容：登录接口增加验证码校验

影响分析：
📁 将修改的文件：
- Task-001/_shared/API_CONTRACT.yaml（入参新增 captcha 字段）
- Task-001/backend/REQ.md（新增"验证码校验"规则）
- Task-001/backend/TECH.md（更新接口设计章节）
- Task-001/backend/TASK.md（变更履历追加 + AC-04 新增）

🔗 受影响下游任务：
- Task-002（会议室管理）：依赖登录功能，标记为 🔶 待回归
- Task-003（会议预定）：依赖登录功能，标记为 🔶 待回归

是否继续？输入 确认 修改，取消 终止
```

> 使用 `--force` 跳过此步骤

### 第三步：执行变更

1. 定位目标任务
2. 分析变更影响范围：
   - API 契约变更 → `API_CONTRACT.yaml` + `TECH.md`
   - 业务规则变更 → `REQ.md` + `TECH.md`
   - 技术方案变更 → `TECH.md`
   - 验收标准变更 → `TASK.md`
   - 核心类设计变更 → `TECH.md`
3. 更新对应的 Spec 文件
4. 在 `TASK.md` 的变更履历中追加记录
5. 标记受影响的下游任务为 `🔶 待回归`
6. 更新 `context.json` 的 `current_task` 和 `last_updated`

## 输出示例
```markdown
✅ 需求变更已同步！

📝 变更内容：登录接口增加验证码校验

📁 已更新的文件：
- Task-001/_shared/API_CONTRACT.yaml（入参新增 captcha 字段）
- Task-001/backend/REQ.md（新增"验证码校验"规则）
- Task-001/backend/TECH.md（更新接口设计章节）
- Task-001/backend/TASK.md（变更履历追加 + AC-04 新增）

🔗 影响分析：
- Task-002（会议室管理）：依赖登录功能，标记为 🔶 待回归
- Task-003（会议预定）：依赖登录功能，标记为 🔶 待回归
```
