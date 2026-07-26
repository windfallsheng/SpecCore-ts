# backend需求

> 来源: `docs/需求-会议室管理服务.md` + `docs/需求-预订订单服务.md`
> word2spec 自动合并 | 时间: 2026-07-26

---

## 会议室管理服务 (room-service)

**技术栈**: Spring Boot 3 + MyBatis-Plus + MySQL  
**职责**: 会议室 CRUD、设备管理、楼层管理、日程查询

### 功能优先级

| 优先级 | 功能 | 说明 |
| :--- | :--- | :--- |
| P0 | 会议室 CRUD | 核心 API |
| P0 | 会议室列表（分页+筛选） | 前端必需 |
| P1 | 会议室日程查询 | 前端可选 |

### 接口清单

| 方法 | 路径 | 说明 | 优先级 |
| :--- | :--- | :--- | :--- |
| POST | /api/v1/rooms | 新增会议室 | P0 |
| GET | /api/v1/rooms | 会议室列表（分页+筛选） | P0 |
| GET | /api/v1/rooms/{id} | 会议室详情 | P0 |
| PUT | /api/v1/rooms/{id} | 更新会议室 | P0 |
| DELETE | /api/v1/rooms/{id} | 软删除 | P0 |
| GET | /api/v1/rooms/{id}/schedule | 当日时间安排 | P1 |

### BDD 验收标准

```
Given 会议室表中有 12 条数据
When  GET /api/v1/rooms?page=1&size=10
Then  返回第 1 页 10 条数据，total=12

Given 请求新增会议室，名称为空
When  POST /api/v1/rooms { "name": "" }
Then  返回 400，提示"名称不能为空"

Given 请求删除不存在的会议室
When  DELETE /api/v1/rooms/999
Then  返回 404，错误码 1001
```

### 数据模型

**t_rooms**

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | BIGINT | 主键自增 |
| name | VARCHAR(100) | 唯一 |
| capacity | INT | 容纳人数 |
| floor | VARCHAR(20) | 所在楼层 |
| equipment | JSON | 设备（投影仪/白板/视频会议/音响/电话） |
| status | TINYINT | 0=空闲 1=使用中 2=维护中 |
| created_at | DATETIME | |
| updated_at | DATETIME | |
| deleted | TINYINT(1) | 软删除 |

### 非功能要求

| 类别 | 要求 |
| :--- | :--- |
| 性能 | 列表查询 < 200ms |
| 并发 | 500 TPS |
| 安全 | JWT + RBAC |
| 日志 | 写操作审计日志 |

---

## 预订订单服务 (booking-service)

**技术栈**: Spring Boot 3 + MyBatis-Plus + MySQL + Redis  
**职责**: 预订订单管理、冲突检测、会议签到、消息通知

### 功能优先级

| 优先级 | 功能 | 说明 |
| :--- | :--- | :--- |
| P0 | 创建预订（含冲突检测） | 核心业务 |
| P0 | 预订列表/详情/取消 | 核心业务 |
| P1 | 会议签到 | 运营需要 |
| P1 | 消息通知 | 体验优化 |

### 接口清单

| 方法 | 路径 | 说明 | 优先级 |
| :--- | :--- | :--- | :--- |
| POST | /api/v1/bookings | 创建预订 | P0 |
| GET | /api/v1/bookings | 我的预订列表 | P0 |
| GET | /api/v1/bookings/{id} | 预订详情 | P0 |
| DELETE | /api/v1/bookings/{id} | 取消预订 | P0 |
| POST | /api/v1/bookings/check-conflict | 冲突检测 | P0 |

### BDD 验收标准

```
Given 会议室 A 已被预订 09:00-10:00
When  另一个用户预订会议室 A 09:30-10:30
Then  返回 409，错误码 2001，提示"该时段已被预订"

Given 请求预订昨天的时间
When  POST /api/v1/bookings { "date": "2026-01-01", ... }
Then  返回 400，错误码 2003

Given 请求取消不存在的预订
When  DELETE /api/v1/bookings/999
Then  返回 404，错误码 2002
```

### 数据模型

**t_bookings**

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | BIGINT | 主键自增 |
| room_id | BIGINT | FK → t_rooms.id |
| user_id | BIGINT | 预订人 |
| date | DATE | 预订日期 |
| start_time | TIME | 开始时间 |
| end_time | TIME | 结束时间 |
| title | VARCHAR(200) | 会议主题 |
| attendees | VARCHAR(500) | 参会人员 |
| status | TINYINT | 0=有效 1=已取消 2=已完成 |
| created_at | DATETIME | |
| updated_at | DATETIME | |

**索引**: `idx_room_date (room_id, date)`

### 关系约束

| 约束 | 说明 |
| :--- | :--- |
| room-service | 校验会议室存在且可用 |
| 统一认证中心 | JWT Token → user_id |
| Redis | 冲突检测缓存 + 消息队列 |
