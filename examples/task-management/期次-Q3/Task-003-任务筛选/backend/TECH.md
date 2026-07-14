# Task-003 任务筛选 - 后端技术方案

> 依赖：Task-001 的 Task 实体和查询接口

## 1. 实现方案

在 Task-001 的 GET /api/v1/tasks 基础上扩展查询参数，使用 MyBatis-Plus QueryWrapper 动态构建 WHERE 条件：

```java
QueryWrapper<Task> wrapper = new QueryWrapper<>();
if (priority != null) wrapper.eq("priority", priority);
if (status != null) wrapper.eq("status", status);
if (assignee != null) wrapper.eq("assignee", assignee);
if (keyword != null) wrapper.and(w -> w.like("title", keyword).or().like("description", keyword));
if (from != null) wrapper.ge("due_date", from);
if (to != null) wrapper.le("due_date", to);
```

## 2. 关键决策

- 使用 QueryWrapper 动态拼接，避免大量 if-else
- 关键词搜索用 OR 连接 title 和 description
- 日期范围用 ge/le 而非 between（更灵活）
- 参数校验：priority/status 枚举值用 @Pattern 校验
