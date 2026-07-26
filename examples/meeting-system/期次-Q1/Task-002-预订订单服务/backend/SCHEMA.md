# 数据库 Schema: Task-002 预订订单服务

> Flyway 迁移 | V2__create_bookings.sql

```sql
CREATE TABLE t_bookings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    room_id BIGINT NOT NULL COMMENT 'FK → t_rooms.id',
    user_id BIGINT NOT NULL COMMENT '预订人',
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    title VARCHAR(200) NOT NULL COMMENT '会议主题',
    attendees VARCHAR(500) COMMENT '参会人员,逗号分隔',
    status TINYINT NOT NULL DEFAULT 0 COMMENT '0=有效 1=已取消 2=已完成',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_room_date (room_id, date),
    INDEX idx_user_id (user_id),
    UNIQUE KEY uk_booking_unique (room_id, date, start_time, end_time, status),
    CONSTRAINT fk_booking_room FOREIGN KEY (room_id) REFERENCES t_rooms(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预订表';
```

## 索引说明

| 索引 | 用途 |
| :--- | :--- |
| idx_room_date | 冲突检测: WHERE room_id=? AND date=? |
| idx_user_id | 我的预订查询 |
| uk_booking_unique | 并发防护: 同房间同时间段不能有两条有效预订 |

> ⚠️ `uk_booking_unique` 包含 status 字段：已取消(status=1)不参与唯一约束，允许重新预订同一时间段。
