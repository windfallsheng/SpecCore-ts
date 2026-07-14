# Task-001 任务CRUD - 后端技术方案

> 创建时间：2026-07-14
> 技术栈：Java 17 + Spring Boot 3.2 + MySQL 8.0 + MyBatis-Plus

## 1. 数据模型

```sql
CREATE TABLE tasks (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    priority ENUM('HIGH','MEDIUM','LOW') DEFAULT 'MEDIUM',
    status ENUM('TODO','IN_PROGRESS','DONE') DEFAULT 'TODO',
    due_date DATE,
    assignee VARCHAR(100),
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

## 2. 分层设计

```
Controller → Service → Repository (MyBatis-Plus BaseMapper)
     ↓
  DTO 校验 (@Valid + @NotBlank/@NotNull)
     ↓
  Entity ↔ DTO 转换 (MapStruct)
```

## 3. 关键决策

- **软删除**：使用 MyBatis-Plus `@TableLogic` 注解，查询自动过滤已删除记录
- **分页**：使用 MyBatis-Plus `Page<T>` + `IPage<T>`
- **参数校验**：Controller 层 `@Valid` + DTO `@NotBlank` / `@NotNull`
- **异常处理**：全局 `@ControllerAdvice` 统一返回错误格式
