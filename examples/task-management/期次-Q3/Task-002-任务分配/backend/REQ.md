# Task-002 任务分配 - 后端需求

> 创建时间：2026-07-14 | 任务类型：feature | 关联期次：Q3 | 依赖：Task-001

## 1. 需求背景

任务创建后需要分配给具体成员。支持单个分配、批量分配和取消分配。

## 2. 功能描述

- 单个分配：PUT /api/v1/tasks/{id}/assign
- 批量分配：POST /api/v1/tasks/batch-assign
- 取消分配：DELETE /api/v1/tasks/{id}/assign
- 查询某人任务：GET /api/v1/tasks?assignee={name}

## 3. 验收标准

- [ ] 单个分配成功返回 200
- [ ] 批量分配返回 { success: N, failed: M }
- [ ] 取消分配后 assignee 置为 NULL
- [ ] 操作写入 audit_log 表
- [ ] assignee 为空时校验失败返回 400
