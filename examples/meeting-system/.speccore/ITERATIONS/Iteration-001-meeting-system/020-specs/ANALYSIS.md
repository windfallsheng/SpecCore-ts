# 分析报告 — Iteration-001: Meeting System

> 分析时间: 2026-08-09 | 分析师: SpecCore AI

## 1. API 清单

### 1.1 认证模块 (AuthController)

| 方法 | 路径 | 说明 | 归属任务 |
|------|------|------|---------|
| POST | /api/v1/auth/login | 用户登录 | Task-001 |
| POST | /api/v1/auth/send-sms | 发送短信验证码 | Task-001 |
| POST | /api/v1/auth/refresh | 刷新Token | Task-001 |
| POST | /api/v1/auth/logout | 退出登录 | Task-001 |

### 1.2 会议室模块 (RoomController)

| 方法 | 路径 | 说明 | 归属任务 |
|------|------|------|---------|
| GET | /api/v1/rooms | 会议室列表（分页） | Task-001 |
| GET | /api/v1/rooms/{roomId} | 会议室详情 | Task-001 |
| POST | /api/v1/rooms | 新增会议室 | Task-001 |
| PUT | /api/v1/rooms/{roomId} | 编辑会议室 | Task-001 |
| DELETE | /api/v1/rooms/{roomId} | 删除会议室 | Task-001 |
| POST | /api/v1/rooms/{roomId}/devices | 添加设备 | Task-001 |
| PUT | /api/v1/rooms/{roomId}/devices/{deviceId} | 编辑设备 | Task-001 |
| DELETE | /api/v1/rooms/{roomId}/devices/{deviceId} | 删除设备 | Task-001 |
| POST | /api/v1/rooms/{roomId}/layouts | 添加布局 | Task-001 |
| PUT | /api/v1/rooms/{roomId}/layouts/{layoutId} | 编辑布局 | Task-001 |
| DELETE | /api/v1/rooms/{roomId}/layouts/{layoutId} | 删除布局 | Task-001 |

### 1.3 预订模块 (BookingController)

| 方法 | 路径 | 说明 | 归属任务 |
|------|------|------|---------|
| GET | /api/v1/bookings/availability | 查询可用时间 | Task-002 |
| POST | /api/v1/bookings | 创建预订 | Task-002 |
| GET | /api/v1/bookings | 预订列表 | Task-002 |
| GET | /api/v1/bookings/{bookingId} | 预订详情 | Task-002 |
| PUT | /api/v1/bookings/{bookingId}/cancel | 取消预订 | Task-002 |
| PUT | /api/v1/bookings/{bookingId}/approve | 审批预订 | Task-002 |

### 1.4 通知模块 (NotificationController)

| 方法 | 路径 | 说明 | 归属任务 |
|------|------|------|---------|
| GET | /api/v1/notifications | 通知列表 | Task-002 |
| PUT | /api/v1/notifications/{id}/read | 标记已读 | Task-002 |
| PUT | /api/v1/notifications/read-all | 全部已读 | Task-002 |

### 1.5 统计模块 (StatisticsController)

| 方法 | 路径 | 说明 | 归属任务 |
|------|------|------|---------|
| GET | /api/v1/statistics/usage-rate | 使用率统计 | Task-002 |
| GET | /api/v1/statistics/peak-hours | 热门时段 | Task-002 |

## 2. 数据模型设计

### 2.1 ER 关系图

```
┌─────────────┐       ┌──────────────────┐       ┌─────────────┐
│   sys_user  │       │   meeting_room    │       │ room_device │
├─────────────┤       ├──────────────────┤       ├─────────────┤
│ user_id (PK)│       │ room_id (PK)     │       │device_id(PK)│
│ username    │       │ room_name        │       │ room_id (FK)│
│ password    │       │ location         │       │ device_name │
│ real_name   │       │ capacity         │       │ device_type │
│ role        │       │ status           │       │ status      │
└──────┬──────┘       └────────┬─────────┘       └─────────────┘
       │                       │
       │            ┌──────────┼──────────┐
       │            │          │          │
       │     ┌──────┴────┐ ┌───┴──────┐ ┌┴────────────┐
       │     │room_layout│ │ booking  │ │recurring_rule│
       │     ├───────────┤ │_record   │ ├─────────────┤
       │     │layout_id  │ ├──────────┤ │ rule_id (PK)│
       │     │room_id(FK)│ │booking_id│ │series_id    │
       │     │layout_name│ │room_id   │ │frequency    │
       │     └───────────┘ │user_id   │ │interval     │
       │                   │title     │ │end_date     │
       │                   │start_time│ └─────────────┘
       │                   │end_time  │
       │                   │status    │
       │                   └──────────┘
       │
┌──────┴──────┐       ┌────────────────┐
│ booking     │       │  notification  │
│_attendee    │       ├────────────────┤
├─────────────┤       │notification_id │
│ id (PK)     │       │ user_id (FK)   │
│ booking_id  │       │ type           │
│ user_id(FK) │       │ title          │
│ status      │       │ content        │
└─────────────┘       │ is_read        │
                      └────────────────┘
```

### 2.2 建表 SQL

```sql
-- 会议室表
CREATE TABLE meeting_room (
    room_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    room_name VARCHAR(100) NOT NULL COMMENT '会议室名称',
    location VARCHAR(200) NOT NULL COMMENT '位置',
    floor INT NOT NULL COMMENT '楼层',
    capacity INT NOT NULL COMMENT '容量',
    area DECIMAL(8,2) COMMENT '面积(平方米)',
    status VARCHAR(20) NOT NULL DEFAULT 'IDLE' COMMENT '状态: IDLE/IN_USE/MAINTENANCE/OFFLINE',
    description TEXT COMMENT '描述',
    booking_rules JSON COMMENT '预订规则',
    business_hours JSON COMMENT '营业时间',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status (status),
    INDEX idx_location (location),
    INDEX idx_capacity (capacity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='会议室表';

-- 设备表
CREATE TABLE room_device (
    device_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    room_id BIGINT NOT NULL,
    device_name VARCHAR(100) NOT NULL COMMENT '设备名称',
    device_type VARCHAR(50) NOT NULL COMMENT '设备类型: DISPLAY/AUDIO/WRITING/CONFERENCE/OTHER',
    status VARCHAR(20) NOT NULL DEFAULT 'NORMAL' COMMENT '状态: NORMAL/FAULT/MAINTENANCE',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES meeting_room(room_id) ON DELETE CASCADE,
    INDEX idx_room_id (room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='设备表';

-- 布局表
CREATE TABLE room_layout (
    layout_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    room_id BIGINT NOT NULL,
    layout_name VARCHAR(100) NOT NULL COMMENT '布局名称: 剧院式/圆桌式/课桌式/U型等',
    max_capacity INT COMMENT '最大容纳人数',
    layout_config JSON COMMENT '布局配置',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES meeting_room(room_id) ON DELETE CASCADE,
    INDEX idx_room_id (room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='布局表';

-- 预订记录表
CREATE TABLE booking_record (
    booking_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    booking_no VARCHAR(32) NOT NULL COMMENT '预订编号',
    room_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    title VARCHAR(200) NOT NULL COMMENT '会议标题',
    description TEXT COMMENT '会议描述',
    start_time DATETIME NOT NULL COMMENT '开始时间',
    end_time DATETIME NOT NULL COMMENT '结束时间',
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING_APPROVAL' COMMENT '状态',
    layout_id BIGINT COMMENT '布局ID',
    series_id VARCHAR(32) COMMENT '系列ID(周期性会议)',
    cancel_reason VARCHAR(500) COMMENT '取消原因',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES meeting_room(room_id),
    INDEX idx_room_time (room_id, start_time, end_time),
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_booking_no (booking_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预订记录表';

-- 会议参与人表
CREATE TABLE booking_attendee (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    booking_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/ACCEPTED/DECLINED',
    FOREIGN KEY (booking_id) REFERENCES booking_record(booking_id) ON DELETE CASCADE,
    UNIQUE KEY uk_booking_user (booking_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='会议参与人表';

-- 周期性规则表
CREATE TABLE recurring_rule (
    rule_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    series_id VARCHAR(32) NOT NULL,
    frequency VARCHAR(20) NOT NULL COMMENT 'DAILY/WEEKLY/BIWEEKLY/MONTHLY',
    `interval` INT NOT NULL DEFAULT 1 COMMENT '间隔',
    days_of_week VARCHAR(20) COMMENT '星期(1-7,逗号分隔)',
    end_date DATE COMMENT '结束日期',
    max_occurrences INT COMMENT '最大发生次数',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_series_id (series_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='周期性规则表';

-- 通知表
CREATE TABLE notification (
    notification_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    type VARCHAR(50) NOT NULL COMMENT '通知类型',
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    is_read TINYINT NOT NULL DEFAULT 0,
    related_type VARCHAR(50) COMMENT '关联类型',
    related_id BIGINT COMMENT '关联ID',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_read (user_id, is_read),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='通知表';
```

## 3. 业务规则分析

### 3.1 预订冲突检测逻辑

```
输入: roomId, startTime, endTime
步骤:
1. 查询该会议室在 [startTime, endTime] 区间内的预订
2. SQL 条件: room_id = ? AND status IN ('CONFIRMED','IN_PROGRESS')
   AND start_time < endTime AND end_time > startTime
3. 如果结果集非空 → 时间冲突
4. 如果结果集为空 → 无冲突
```

### 3.2 周期性会议生成逻辑

```
输入: recurringRule (frequency, interval, daysOfWeek, endDate, maxOccurrences)
步骤:
1. 从首次 startTime 开始，按规则计算所有发生日期
2. 对每个发生日期：
   a. 检查是否在 endDate 之前
   b. 检查是否在 daysOfWeek 中 (WEEKLY 模式)
   c. 检查是否超过 maxOccurrences
3. 对每个合法日期，生成一条 booking_record (series_id 相同)
4. 逐条检测冲突，记录冲突日期
5. 仅创建无冲突的预订记录
```

### 3.3 审批流程规则

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| 全局审批开关 | OFF | 关闭时所有预订自动确认 |
| 按会议室审批 | OFF | 可单独配置某会议室需审批 |
| 审批人 | 管理员角色 | ROLE_ADMIN 用户均可审批 |

## 4. 前后端交互时序

```
用户操作        前端              API                   后端
  │              │                │                      │
  ├─选择会议室──►│                │                      │
  │              ├──GET /bookings/availability──────────►│
  │              │                │  ◄──可用时段列表──────│
  │              │◄────────────────                      │
  │              │                │                      │
  ├─提交预订────►│                │                      │
  │              ├──POST /bookings───────────────────────►│
  │              │                │  ◄──预订结果──────────│
  │              │◄────────────────                      │
  │              │                │                      │
  │              │                │  ◄──异步发送通知──────│ (RabbitMQ)
  │              │                │                      │
  │◄─预订成功───┤                │                      │
```

## 5. 任务依赖与影响分析

### 5.1 数据共享边界

| 共享数据 | 生产者 | 消费者 |
|---------|--------|--------|
| meeting_room 表 | Task-001 (写) | Task-002 (读), Task-003 (读) |
| booking_record 表 | Task-002 (写) | Task-003 (读), Task-004 (读) |
| notification 表 | Task-002 (写) | Task-003 (读), Task-004 (读) |
| sys_user 表 | Task-001 (写) | Task-002 (读), Task-003 (读), Task-004 (读) |

### 5.2 关键路径

```
Task-001 (Room Service) ──► Task-002 (Booking Service) ──► Task-003 (Admin Dashboard)
                         ──► Task-002 (Booking Service) ──► Task-004 (H5 Mobile)
```

Task-003 和 Task-004 可以并行开发（共享后端 API）。

## 6. 风险评估

| 风险 | 级别 | 缓解措施 |
|------|------|---------|
| 并发预订导致时间冲突 | 高 | 数据库乐观锁 + 分布式锁 (Redis) |
| 周期性会议生成大量记录 | 中 | 限制 maxOccurrences ≤ 100 |
| 移动端与后台数据一致性问题 | 低 | 共用同一套后端 API |
