# Task-001 任务CRUD - 后端技术方案

> 技术栈：Java 17 + Spring Boot 3.2 + MySQL 8.0 + MyBatis-Plus 3.5

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

Controller → Service → Repository (MyBatis-Plus BaseMapper)

## 3. 关键决策

- 软删除: @TableLogic 注解，查询自动过滤
- 分页: MyBatis-Plus Page<T> 内置支持
- 校验: @Valid + JSR-303 注解
- 异常处理: @ControllerAdvice 全局统一格式
- 对象转换: MapStruct 编译期生成
