# Q3 期次需求文档

> 期次：Q3 | 时间范围：2026-07-14 ~ 2026-09-30

## 期次目标

交付任务管理系统 MVP：CRUD + 分配 + 筛选三大功能。

## 需求清单

| REQ-ID | 需求 | 关联 Task | 优先级 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| REQ-001 | 任务 CRUD | Task-001 | HIGH | 进行中 |
| REQ-002 | 任务分配 | Task-002 | HIGH | 待开始 |
| REQ-003 | 任务筛选 | Task-003 | MEDIUM | 待开始 |

## 技术选型

- 后端：Java 17 + Spring Boot 3.2 + MySQL 8.0 + MyBatis-Plus
- 前端：Vue 3 + TypeScript + Element Plus
- 部署：Docker Compose

## 里程碑

| 时间 | 里程碑 | 交付物 |
| :--- | :--- | :--- |
| W1-W2 | Task-001 完成 | CRUD 接口 + 前端页面 |
| W3 | Task-002 完成 | 分配功能 + 操作日志 |
| W4 | Task-003 完成 | 筛选功能 + 联调 |
| W5 | 集成测试 | 全功能回归 |
