# Task-002: Booking Service — 任务拆解

## 子任务列表

### Subtask 2.1: 数据表与基础设施搭建
- [ ] 创建 Flyway 迁移脚本（booking_record, booking_attendee, recurring_rule, notification）
- [ ] 创建 BookingRecord, RecurringRule, Notification 实体
- [ ] 创建对应 Repository 接口
- [ ] 配置 RabbitMQ 队列和交换机
- [ ] 配置 Redisson（分布式锁）
- [ ] 配置 Spring Mail
- [ ] 实现 BookingNoGenerator 编号生成器
- [ ] 创建相应 DTO 类

### Subtask 2.2: 可用时间查询
- [ ] 实现 AvailabilityService: getAvailableSlots()
- [ ] 查询逻辑：营业时间切片 - 已预订时间段 = 可用时间段
- [ ] 实现 BookingController: GET /api/v1/bookings/availability
- [ ] 编写单元测试

### Subtask 2.3: 预订创建与冲突检测
- [ ] 实现 ConflictDetectionService: checkConflict()
- [ ] 时间冲突检测（数据库 + 分布式锁双重保障）
- [ ] 营业时间校验
- [ ] 预订规则校验（时长、提前量）
- [ ] 实现 BookingService: createBooking()
- [ ] 预订记录 + 参与人 + 编号生成
- [ ] 实现 BookingController: POST /api/v1/bookings
- [ ] 编写单元测试（正常/冲突/越界场景）

### Subtask 2.4: 预订管理
- [ ] 实现 BookingService: listBookings() — 分页+筛选
- [ ] 实现 BookingService: getBookingDetail()
- [ ] 实现 BookingService: cancelBooking()
- [ ] 实现 BookingController: GET/PUT 端点
- [ ] 编写单元测试

### Subtask 2.5: 周期性会议
- [ ] 实现 RecurringService: createRecurringBookings()
- [ ] 日期序列计算（DAILY/WEEKLY/BIWEEKLY/MONTHLY）
- [ ] 逐条冲突检测
- [ ] 系列取消功能（cancelSeries=true）
- [ ] 编写单元测试

### Subtask 2.6: 审批流程
- [ ] 实现 ApprovalService: submitForApproval()
- [ ] 实现 ApprovalService: approve() / reject()
- [ ] 审批权限校验（管理员角色）
- [ ] 实现 BookingController: PUT /api/v1/bookings/{id}/approve
- [ ] 编写单元测试

### Subtask 2.7: 通知推送
- [ ] 实现 NotificationService: createNotification() — 创建系统消息
- [ ] 实现 RabbitMQ 消息生产者（预订/审批事件 → 发送通知消息）
- [ ] 实现邮件消费者（RabbitMQ → SMTP 发送）
- [ ] 实现 NotificationController: 通知列表/标记已读
- [ ] 编写单元测试

### Subtask 2.8: 数据统计
- [ ] 实现 StatisticsService: getUsageRate()
- [ ] 实现 StatisticsService: getPeakHours()
- [ ] 实现 StatisticsController 端点
- [ ] 编写单元测试

## 验收标准

1. ✅ 预订创建有冲突检测，并发安全的
2. ✅ 周期性会议正确生成所有发生日期
3. ✅ 审批流程正常工作
4. ✅ 通知消息生成并异步发送
5. ✅ 统计报表数据正确
6. ✅ 所有 API 端点有正确的错误处理
7. ✅ 单元测试覆盖率 ≥ 80%
