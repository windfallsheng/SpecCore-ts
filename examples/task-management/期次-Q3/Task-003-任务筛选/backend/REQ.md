# Task-003 任务筛选 - 后端需求

> 创建时间：2026-07-14 | 任务类型：feature | 关联期次：Q3 | 依赖：Task-001

## 1. 需求背景

任务列表需要支持多条件组合筛选和关键词搜索。

## 2. 功能描述

| 筛选条件 | 参数 | 示例 |
| :--- | :--- | :--- |
| 按优先级 | priority=HIGH | /api/v1/tasks?priority=HIGH |
| 按状态 | status=TODO | /api/v1/tasks?status=TODO |
| 按负责人 | assignee=张三 | /api/v1/tasks?assignee=张三 |
| 日期范围 | from/to | /api/v1/tasks?from=2026-01-01&to=2026-06-30 |
| 关键词搜索 | keyword | 搜索标题和描述字段 |

以上条件可任意组合（AND 逻辑）。

## 3. 验收标准

- [ ] 单一条件筛选正确
- [ ] 多条件组合为 AND 逻辑
- [ ] 关键词搜索匹配标题和描述
- [ ] 空结果返回 { total: 0, data: [] }
- [ ] 非法参数值返回 400
