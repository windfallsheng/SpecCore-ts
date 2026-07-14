# Task-001 任务CRUD - 后端任务分解

## 子任务清单

| # | 子任务 | 预估 | 状态 |
| :--- | :--- | :--- | :--- |
| 1 | 建表 SQL + Task Entity | 0.5h | TODO |
| 2 | TaskController (5 接口) | 1.5h | TODO |
| 3 | TaskService (CRUD + 软删除) | 1h | TODO |
| 4 | TaskRepository (BaseMapper) | 0.5h | TODO |
| 5 | DTO 定义 + MapStruct | 0.5h | TODO |
| 6 | 参数校验 + 异常处理 | 0.5h | TODO |
| 7 | 单元测试 | 1h | TODO |
| **合计** | | **5.5h** | |

## 依赖关系

Task-001 无前置依赖，首先开发。完成后 Task-002 和 Task-003 可并行。

## 接口清单

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| POST | /api/v1/tasks | 创建 |
| GET | /api/v1/tasks | 分页列表 |
| GET | /api/v1/tasks/{id} | 详情 |
| PUT | /api/v1/tasks/{id} | 更新 |
| DELETE | /api/v1/tasks/{id} | 软删除 |
