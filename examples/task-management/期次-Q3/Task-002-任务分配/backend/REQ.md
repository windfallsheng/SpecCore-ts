# Task-002 任务分配 - 后端需求

> 创建时间：2026-07-14 | 任务类型：feature | 关联期次：Q3 | 依赖：Task-001

## 1. 需求背景

任务创建后需要分配给具体成员。支持单个分配和批量分配，分配后发送通知。

## 2. 功能描述

- 单个分配：PUT /api/v1/tasks/{id}/assign — 指定 assignee
- 批量分配：POST /api/v1/tasks/batch-assign — 一次分配多个任务
- 取消分配：DELETE /api/v1/tasks/{id}/assign
- 查询某人任务：GET /api/v1/tasks?assignee={name}

## 3. 接口定义

详见 `_shared/API_CONTRACT.yaml`

## 4. 验收标准

- [ ] 单个分配成功返回 200
- [ ] 批量分配成功返回 200 + 成功/失败计数
- [ ] 分配后 task.updated_at 自动更新
- [ ] 分配日志写入 audit_log 表
