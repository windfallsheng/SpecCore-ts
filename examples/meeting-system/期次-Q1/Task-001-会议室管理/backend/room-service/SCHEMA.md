# 数据库 Schema: Task-001 会议室管理服务

> Flyway 迁移脚本 | V1__create_rooms.sql

```sql
CREATE TABLE t_rooms (
    id BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
    name VARCHAR(100) NOT NULL COMMENT '会议室名称',
    capacity INT NOT NULL DEFAULT 10 COMMENT '容纳人数',
    floor VARCHAR(20) NOT NULL COMMENT '所在楼层',
    equipment JSON COMMENT '设备列表',
    status TINYINT NOT NULL DEFAULT 0 COMMENT '0=空闲 1=使用中 2=维护中',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted TINYINT(1) NOT NULL DEFAULT 0 COMMENT '软删除',
    UNIQUE KEY uk_name_deleted (name, deleted),
    INDEX idx_floor_status (floor, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='会议室表';
```

```sql
-- V1.1__create_users.sql
CREATE TABLE t_users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user' COMMENT 'super_admin/admin/user',
    status TINYINT(1) NOT NULL DEFAULT 0 COMMENT '0=正常 1=禁用',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';
```

## 索引说明

| 索引名 | 字段 | 用途 |
| :--- | :--- | :--- |
| PRIMARY | id | 主键 |
| uk_name_deleted | (name, deleted) | 名称唯一 + 软删除后复用 |
| idx_floor_status | (floor, status) | 列表筛选加速 |
