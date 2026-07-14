# Task-002 任务分配 - 后端技术方案

> 依赖：Task-001 的 Task 实体 | 技术栈：Java 17 + Spring Boot 3.2

## 1. 数据变更

在 tasks 表上扩展，不新建表：
- assignee 字段已在 Task-001 建表时预留
- 新增 audit_log 表记录分配操作

```sql
CREATE TABLE audit_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    task_id BIGINT NOT NULL,
    action VARCHAR(50) NOT NULL COMMENT 'assign/unassign',
    operator VARCHAR(100),
    detail TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 2. 接口设计

- PUT /api/v1/tasks/{id}/assign — 校验用户存在后更新 assignee
- POST /api/v1/tasks/batch-assign — 事务性批量更新，任一失败则回滚
- DELETE /api/v1/tasks/{id}/assign — 清空 assignee

## 3. 关键决策

- 批量分配用 @Transactional 保证原子性
- 分配操作异步写入 audit_log（@Async 不阻塞主流程）
