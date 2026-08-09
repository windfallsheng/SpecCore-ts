# 会议室管理系统 — 需求规格说明书

> 来源: 原始 PRD 文档转换 | 日期: 2026-08-09 | 版本: v1.0

## 1. 项目概述

会议室管理系统（Meeting System）是一个多端的企业会议室资源管理平台，支持后台管理、H5 移动端和小程序端访问。系统旨在解决企业会议室资源利用率低、预定流程繁琐、冲突频发等问题，提供一站式的会议室预订与管理解决方案。

## 2. 用户角色

| 角色 | 权限 | 使用端 |
|------|------|--------|
| 管理员 (Admin) | 会议室管理、预订审批、系统配置、数据统计 | 后台管理端 |
| 普通用户 (User) | 浏览会议室、提交预订、查看我的会议 | 后台管理端 / H5 移动端 |
| 访客 (Guest) | 仅浏览公开会议室信息 | H5 移动端 |

## 3. 功能需求

### 3.1 用户认证模块（跨端通用）

#### 3.1.1 用户登录
- **后台管理端**: 用户名+密码登录，支持记住密码
- **H5 移动端**: 手机号+验证码登录、用户名+密码登录
- **统一认证**: 使用 JWT Token 实现多端统一认证

**接口设计**:
```
POST /api/v1/auth/login
Content-Type: application/json

Request:
{
  "username": "admin",
  "password": "encrypted_password",
  "loginType": "PASSWORD",     // PASSWORD | SMS
  "deviceType": "WEB"           // WEB | H5 | MINI_PROGRAM
}

Response:
{
  "code": 200,
  "message": "登录成功",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresIn": 7200,
    "userInfo": {
      "userId": 1001,
      "username": "admin",
      "realName": "管理员",
      "role": "ADMIN",
      "avatar": "/avatars/admin.png"
    }
  }
}
```

#### 3.1.2 短信验证码
```
POST /api/v1/auth/send-sms
Request:
{
  "phone": "13812345678",
  "type": "LOGIN"               // LOGIN | REGISTER | RESET_PASSWORD
}

Response:
{
  "code": 200,
  "message": "验证码已发送"
}
```

#### 3.1.3 Token 刷新
```
POST /api/v1/auth/refresh
Request:
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}

Response:
{
  "code": 200,
  "data": {
    "accessToken": "new_token...",
    "expiresIn": 7200
  }
}
```

### 3.2 会议室管理模块（后台管理端）

#### 3.2.1 会议室列表
- 分页查询所有会议室
- 支持按名称、位置、容量筛选
- 显示会议室当前状态（空闲/使用中/维护中）

```
GET /api/v1/rooms?page=1&size=20&keyword=301&status=IDLE&minCapacity=10

Response:
{
  "code": 200,
  "data": {
    "total": 45,
    "pages": 3,
    "current": 1,
    "records": [
      {
        "roomId": 1,
        "roomName": "301会议室",
        "location": "A栋3楼",
        "floor": 3,
        "capacity": 20,
        "area": 45.5,
        "status": "IDLE",
        "devices": ["投影仪", "白板", "视频会议设备"],
        "currentBooking": null,
        "imageUrl": "/images/rooms/301.jpg",
        "createdAt": "2026-08-01 10:00:00"
      }
    ]
  }
}
```

#### 3.2.2 会议室详情
```
GET /api/v1/rooms/{roomId}

Response:
{
  "code": 200,
  "data": {
    "roomId": 1,
    "roomName": "301会议室",
    "location": "A栋3楼",
    "floor": 3,
    "capacity": 20,
    "area": 45.5,
    "status": "IDLE",
    "description": "适合中小型会议，配备高清投影和视频会议设备",
    "devices": [
      { "deviceId": 1, "deviceName": "投影仪", "deviceType": "DISPLAY", "status": "NORMAL" },
      { "deviceId": 2, "deviceName": "白板", "deviceType": "WRITING", "status": "NORMAL" },
      { "deviceId": 3, "deviceName": "视频会议设备", "deviceType": "CONFERENCE", "status": "NORMAL" }
    ],
    "layouts": [
      { "layoutId": 1, "layoutName": "剧院式", "maxCapacity": 30, "layoutConfig": {} },
      { "layoutId": 2, "layoutName": "圆桌式", "maxCapacity": 16, "layoutConfig": {} }
    ],
    "bookingRules": {
      "maxDuration": 240,
      "minAdvanceMinutes": 30,
      "maxAdvanceDays": 30,
      "allowRecurring": true
    },
    "businessHours": {
      "openTime": "08:00",
      "closeTime": "22:00",
      "workdays": [1, 2, 3, 4, 5]
    },
    "images": ["/images/rooms/301-1.jpg", "/images/rooms/301-2.jpg"]
  }
}
```

#### 3.2.3 新增会议室
```
POST /api/v1/rooms
Request:
{
  "roomName": "302培训室",
  "location": "A栋3楼",
  "floor": 3,
  "capacity": 50,
  "area": 80.0,
  "description": "大型培训室",
  "devices": [
    { "deviceName": "投影仪", "deviceType": "DISPLAY" },
    { "deviceName": "音响系统", "deviceType": "AUDIO" }
  ],
  "layouts": [
    { "layoutName": "课桌式", "maxCapacity": 40, "layoutConfig": { "rows": 5, "cols": 8 } }
  ],
  "bookingRules": {
    "maxDuration": 480,
    "minAdvanceMinutes": 60,
    "maxAdvanceDays": 60,
    "allowRecurring": true
  },
  "businessHours": {
    "openTime": "08:00",
    "closeTime": "22:00",
    "workdays": [1, 2, 3, 4, 5]
  }
}

Response:
{
  "code": 200,
  "message": "会议室创建成功",
  "data": { "roomId": 2 }
}
```

#### 3.2.4 编辑会议室
```
PUT /api/v1/rooms/{roomId}
Request: 同新增，包含需要更新的字段
Response:
{
  "code": 200,
  "message": "会议室信息更新成功"
}
```

#### 3.2.5 删除会议室
- **约束**: 有关联的未来预订时禁止删除

```
DELETE /api/v1/rooms/{roomId}

Response:
{
  "code": 200,
  "message": "会议室已删除"
}
```

#### 3.2.6 设备管理
- 为会议室添加、编辑、删除设备
- 标记设备状态（正常/故障/维护中）

```
POST /api/v1/rooms/{roomId}/devices
PUT /api/v1/rooms/{roomId}/devices/{deviceId}
DELETE /api/v1/rooms/{roomId}/devices/{deviceId}
```

#### 3.2.7 布局管理
- 配置会议室座位布局
- 支持多种布局类型（剧院式、圆桌式、课桌式、U型等）

```
POST /api/v1/rooms/{roomId}/layouts
PUT /api/v1/rooms/{roomId}/layouts/{layoutId}
DELETE /api/v1/rooms/{roomId}/layouts/{layoutId}
```

### 3.3 会议预订模块

#### 3.3.1 查询可用时间
```
GET /api/v1/bookings/availability?roomId=1&date=2026-08-15

Response:
{
  "code": 200,
  "data": {
    "roomId": 1,
    "date": "2026-08-15",
    "businessHours": { "openTime": "08:00", "closeTime": "22:00" },
    "availableSlots": [
      { "startTime": "08:00", "endTime": "09:00" },
      { "startTime": "09:00", "endTime": "10:00" },
      { "startTime": "12:00", "endTime": "13:00" }
    ],
    "bookedSlots": [
      { "startTime": "10:00", "endTime": "12:00", "bookingId": 100, "title": "周例会" }
    ]
  }
}
```

#### 3.3.2 创建预订
```
POST /api/v1/bookings
Request:
{
  "roomId": 1,
  "title": "产品评审会",
  "description": "Q3 产品路线图评审",
  "startTime": "2026-08-15 14:00:00",
  "endTime": "2026-08-15 16:00:00",
  "attendees": [1001, 1002, 1003],
  "layoutId": 1,
  "isRecurring": false,
  "recurringRule": null
}

Response:
{
  "code": 200,
  "message": "预订成功",
  "data": {
    "bookingId": 200,
    "status": "CONFIRMED",
    "bookingNo": "BK20260815001"
  }
}
```

#### 3.3.3 冲突检测规则
预订时后端自动检测以下冲突：
1. **时间冲突**: 同一会议室同一时段已有预订 → 返回 `409 Conflict` 并提示冲突详情
2. **营业时间外**: 预订时间超出营业时间 → 返回 `400 Bad Request`
3. **提前预约限制**: 超出最短提前时间限制 → 返回 `400 Bad Request`
4. **时长限制**: 超出最大单次时长 → 返回 `400 Bad Request`

冲突响应示例：
```json
{
  "code": 409,
  "message": "时间冲突",
  "data": {
    "conflictType": "TIME_CONFLICT",
    "conflictingBooking": {
      "bookingId": 100,
      "title": "周例会",
      "startTime": "2026-08-15 15:00:00",
      "endTime": "2026-08-15 17:00:00",
      "bookedBy": "张三"
    }
  }
}
```

#### 3.3.4 周期性会议
```
POST /api/v1/bookings
Request:
{
  "roomId": 1,
  "title": "每周站会",
  "startTime": "2026-08-15 09:00:00",
  "endTime": "2026-08-15 09:30:00",
  "attendees": [1001, 1002, 1003, 1004, 1005],
  "isRecurring": true,
  "recurringRule": {
    "frequency": "WEEKLY",          // DAILY | WEEKLY | BIWEEKLY | MONTHLY
    "interval": 1,
    "daysOfWeek": [1, 3, 5],       // 周一、三、五 (WEEKLY 时)
    "endDate": "2026-12-31",
    "maxOccurrences": 50
  }
}

Response:
{
  "code": 200,
  "message": "周期性会议创建成功",
  "data": {
    "seriesId": "SER2026001",
    "bookingCount": 40,
    "conflictedDates": ["2026-09-07", "2026-10-05"]
  }
}
```

#### 3.3.5 预订列表
```
GET /api/v1/bookings?page=1&size=20&status=CONFIRMED&roomId=1&dateFrom=2026-08-01&dateTo=2026-08-31

Response:
{
  "code": 200,
  "data": {
    "total": 120,
    "records": [
      {
        "bookingId": 200,
        "bookingNo": "BK20260815001",
        "roomName": "301会议室",
        "title": "产品评审会",
        "startTime": "2026-08-15 14:00:00",
        "endTime": "2026-08-15 16:00:00",
        "status": "CONFIRMED",
        "bookedByName": "张三",
        "attendeeCount": 3
      }
    ]
  }
}
```

#### 3.3.6 取消预订
```
PUT /api/v1/bookings/{bookingId}/cancel
Request:
{
  "reason": "会议取消",
  "cancelSeries": false           // 周期性会议: 是否取消整个系列
}

Response:
{
  "code": 200,
  "message": "预订已取消"
}
```

#### 3.3.7 审批流程（可选配置）
- 部分会议室可配置为需要管理员审批
- 用户提交预订后状态为 `PENDING_APPROVAL`
- 管理员审批通过后变为 `CONFIRMED`，拒绝后变为 `REJECTED`

```
PUT /api/v1/bookings/{bookingId}/approve
Request:
{
  "action": "APPROVE",             // APPROVE | REJECT
  "remark": "已确认时间安排"
}

Response:
{
  "code": 200,
  "message": "审批完成"
}
```

### 3.4 通知推送模块

#### 3.4.1 通知类型
| 类型 | 触发条件 | 渠道 |
|------|---------|------|
| 预订确认通知 | 预订成功 | 系统消息 + 邮件 |
| 审批通知 | 预订提交审批 | 系统消息 + 邮件（管理员） |
| 审批结果通知 | 审批通过/拒绝 | 系统消息 + 邮件 |
| 会议提醒 | 会议开始前30分钟 | 系统消息 |
| 取消通知 | 预订被取消 | 系统消息 + 邮件 |

#### 3.4.2 通知列表
```
GET /api/v1/notifications?page=1&size=20&isRead=false

Response:
{
  "code": 200,
  "data": {
    "total": 5,
    "unreadCount": 3,
    "records": [
      {
        "notificationId": 1,
        "type": "BOOKING_CONFIRMED",
        "title": "预订确认通知",
        "content": "您的会议室预订（产品评审会）已确认，时间：2026-08-15 14:00-16:00",
        "isRead": false,
        "relatedId": 200,
        "createdAt": "2026-08-09 15:30:00"
      }
    ]
  }
}
```

#### 3.4.3 标记已读
```
PUT /api/v1/notifications/{notificationId}/read
PUT /api/v1/notifications/read-all
```

### 3.5 数据统计模块（后台管理端）

#### 3.5.1 使用率统计
```
GET /api/v1/statistics/usage-rate?dateFrom=2026-08-01&dateTo=2026-08-31&groupBy=DAILY

Response:
{
  "code": 200,
  "data": {
    "overallRate": 0.65,
    "details": [
      { "date": "2026-08-01", "rate": 0.72, "bookings": 8 },
      { "date": "2026-08-02", "rate": 0.58, "bookings": 6 }
    ]
  }
}
```

#### 3.5.2 热门时段
```
GET /api/v1/statistics/peak-hours?dateFrom=2026-08-01&dateTo=2026-08-31

Response:
{
  "code": 200,
  "data": {
    "peakSlots": [
      { "timeRange": "09:00-10:00", "bookingCount": 45, "avgOccupationRate": 0.85 },
      { "timeRange": "14:00-15:00", "bookingCount": 42, "avgOccupationRate": 0.80 }
    ]
  }
}
```

### 3.6 H5 移动端特有需求

#### 3.6.1 首页 — 快速预订入口
- 展示今日可用会议室数量
- 快速预订按钮（一键进入预订流程）
- 待参加的下场会议信息

#### 3.6.2 会议室浏览
- 卡片式展示会议室列表
- 支持按时间、容量、楼层筛选
- 点击进入详情查看设备、布局、图片

#### 3.6.3 快速预订
- 选择日期 → 选择时间段 → 选择会议室 → 填写会议信息 → 提交
- 全程引导式操作，适配移动端
- 展示会议室图片、设备信息，帮助决策

#### 3.6.4 我的会议
- 列表展示我的预订（支持状态筛选：待审批/已确认/已结束/已取消）
- 点击查看会议详情
- 支持取消操作

## 4. 非功能需求

### 4.1 性能要求
- API 响应时间 P95 < 500ms
- 页面首次加载 < 2s
- 支持 2000+ 会议室、10000+ 并发用户

### 4.2 安全要求
- 所有 API 需要 JWT Token 认证
- 敏感数据（密码）使用 BCrypt 加密
- HTTPS 传输
- 防 SQL 注入、XSS、CSRF 攻击
- 操作日志记录

### 4.3 可用性要求
- 系统可用性 99.9%
- 支持水平扩展
- 数据库主从备份

## 5. 数据字典（核心字段）

### 会议室 (meeting_room)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| room_id | BIGINT | ✅ | 主键 |
| room_name | VARCHAR(100) | ✅ | 会议室名称 |
| location | VARCHAR(200) | ✅ | 位置描述 |
| floor | INT | ✅ | 楼层 |
| capacity | INT | ✅ | 最大容纳人数 |
| area | DECIMAL(8,2) | ❌ | 面积（平方米） |
| status | VARCHAR(20) | ✅ | IDLE/IN_USE/MAINTENANCE/OFFLINE |
| description | TEXT | ❌ | 描述 |
| created_at | DATETIME | ✅ | 创建时间 |
| updated_at | DATETIME | ✅ | 更新时间 |

### 预订记录 (booking_record)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| booking_id | BIGINT | ✅ | 主键 |
| booking_no | VARCHAR(32) | ✅ | 预订编号 |
| room_id | BIGINT | ✅ | 会议室ID |
| user_id | BIGINT | ✅ | 预订人ID |
| title | VARCHAR(200) | ✅ | 会议标题 |
| description | TEXT | ❌ | 会议描述 |
| start_time | DATETIME | ✅ | 开始时间 |
| end_time | DATETIME | ✅ | 结束时间 |
| status | VARCHAR(20) | ✅ | PENDING_APPROVAL/CONFIRMED/IN_PROGRESS/COMPLETED/CANCELLED/REJECTED |
| layout_id | BIGINT | ❌ | 布局ID |
| series_id | VARCHAR(32) | ❌ | 系列ID（周期性会议） |
| created_at | DATETIME | ✅ | 创建时间 |

### 周期规则 (recurring_rule)
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| rule_id | BIGINT | ✅ | 主键 |
| series_id | VARCHAR(32) | ✅ | 系列ID |
| frequency | VARCHAR(20) | ✅ | DAILY/WEEKLY/BIWEEKLY/MONTHLY |
| interval | INT | ✅ | 间隔 |
| days_of_week | VARCHAR(20) | ❌ | 星期几 (逗号分隔: 1,3,5) |
| end_date | DATE | ❌ | 结束日期 |
| max_occurrences | INT | ❌ | 最大次数 |

## 6. 状态流转

### 预订状态流转
```
                ┌──────────────┐
                │ 用户提交预订  │
                └──────┬───────┘
                       │
              ┌────────┴────────┐
              │                 │
        ┌─────┴──────┐   ┌─────┴──────────┐
        │ 无需审批   │   │ 需要审批        │
        │ → CONFIRMED│   │→ PENDING_APPROVAL│
        └─────┬──────┘   └─────┬──────────┘
              │                 │
              │          ┌──────┴──────┐
              │          │ 管理员审批   │
              │          └──────┬──────┘
              │                 │
              │        ┌────────┼────────┐
              │        │        │        │
              │   ┌────┴───┐ ┌──┴────┐  │
              │   │APPROVED│ │REJECTED│  │
              │   │CONFIRMED│ └───────┘  │
              │   └────┬───┘             │
              │        │                 │
              └────────┼─────────────────┘
                       │
              ┌────────┴────────┐
              │ 会议时间到达     │
              │ → IN_PROGRESS   │
              └────────┬────────┘
                       │
              ┌────────┴────────┐
              │ 会议时间结束     │
              │ → COMPLETED     │
              └─────────────────┘
```

任意非终态可被用户取消 → CANCELLED

## 7. 约束和假设

1. 所有时间以服务器时间为准（UTC+8）
2. 会议室最小预订时长为 15 分钟
3. 同一用户同一时段只能预订一个会议室
4. 删除会议室前必须检查关联的预订记录
5. 通知消息发送失败不影响主流程（异步消息队列）
