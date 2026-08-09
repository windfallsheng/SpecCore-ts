# Task-002: Booking Service — 需求文档

## 任务目标

开发会议预订后端服务，实现预订创建/取消、时间冲突检测、周期性会议、审批流程、通知推送等核心功能。

## 功能范围

### 1. 预订核心服务
- 可用时间查询（POST /api/v1/bookings/availability）
- 创建预订（含冲突检测）
- 预订列表查询（分页、多条件筛选）
- 预订详情查询
- 取消预订

### 2. 冲突检测服务
- 时间冲突检测（同一会议室同一时段）
- 营业时间校验
- 预订规则校验（时长、提前量）

### 3. 周期性会议服务
- 创建周期性会议（支持 DAILY/WEEKLY/BIWEEKLY/MONTHLY）
- 逐条生成预订记录，检测冲突
- 取消整个系列或单次

### 4. 审批服务
- 提交审批（当会议室配置需要审批时）
- 审批通过/拒绝
- 审批结果通知

### 5. 通知推送服务
- 系统消息生成（预订确认、审批通知、会议提醒、取消通知）
- 消息列表查询（分页、未读筛选）
- 标记已读/全部已读
- 邮件通知（通过 RabbitMQ 异步发送）

### 6. 数据统计服务
- 会议室使用率统计
- 热门时段分析

## 交付物

| 产出 | 说明 |
|------|------|
| Controller | BookingController, NotificationController, StatisticsController |
| Service | BookingService, ConflictDetectionService, RecurringService, ApprovalService, NotificationService, StatisticsService |
| Repository | BookingRecordRepository, RecurringRuleRepository, NotificationRepository, BookingAttendeeRepository |
| Entity/DTO | BookingRecord, RecurringRule, Notification, BookingAttendee + DTO |
| 消息队列 | RabbitMQ 配置 + 邮件发送消费者 |
| 单元测试 | Service 层覆盖率 ≥ 80% |
| 集成测试 | API 集成测试 |

## 非功能需求

- 并发预订使用 Redis 分布式锁防冲突
- 通知发送异步化，不阻塞主流程
- 预订编号生成规则: BK + yyyyMMdd + 3位序号
