# Task-002: Booking Service — 技术方案

## 技术选型增强

在 Task-001 基础上新增：

| 组件 | 选型 | 说明 |
|------|------|------|
| 消息队列 | RabbitMQ 3.13 + Spring AMQP | 异步通知 |
| 分布式锁 | Redisson | 基于 Redis 的分布式锁 |
| 邮件 | Spring Boot Mail | SMTP 邮件发送 |
| 编号生成 | 自定义 SequenceGenerator | 日期+序号 |

## 模块结构

```
com.example.meeting.system
├── controller/
│   ├── BookingController.java       # 预订接口
│   ├── NotificationController.java  # 通知接口
│   └── StatisticsController.java    # 统计接口
├── service/
│   ├── BookingService.java          # 预订核心业务
│   ├── ConflictDetectionService.java # 冲突检测
│   ├── RecurringService.java        # 周期性会议
│   ├── ApprovalService.java         # 审批流程
│   ├── NotificationService.java     # 通知业务
│   └── StatisticsService.java       # 统计分析
├── repository/
│   ├── BookingRecordRepository.java
│   ├── RecurringRuleRepository.java
│   ├── NotificationRepository.java
│   └── BookingAttendeeRepository.java
├── entity/
│   ├── BookingRecord.java
│   ├── RecurringRule.java
│   ├── Notification.java
│   └── BookingAttendee.java
├── dto/
│   ├── BookingRequest.java
│   ├── BookingResponse.java
│   ├── AvailabilityRequest.java
│   └── StatisticsResponse.java
├── mq/
│   ├── RabbitConfig.java            # 队列/交换机配置
│   └── NotificationConsumer.java    # 通知消息消费者
└── util/
    └── BookingNoGenerator.java      # 编号生成器
```

## 关键设计

### 分布式锁防并发冲突

```java
@Service
public class BookingService {
    @Autowired
    private RedissonClient redissonClient;

    public BookingResponse createBooking(BookingRequest request) {
        String lockKey = "booking:room:" + request.getRoomId();
        RLock lock = redissonClient.getLock(lockKey);
        try {
            if (lock.tryLock(5, 10, TimeUnit.SECONDS)) {
                // 检测冲突
                conflictDetectionService.checkConflict(request);
                // 创建预订
                return saveBooking(request);
            }
        } finally {
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
}
```

### 冲突检测 SQL

```sql
SELECT COUNT(*) FROM booking_record
WHERE room_id = #{roomId}
  AND status IN ('CONFIRMED', 'IN_PROGRESS')
  AND start_time < #{endTime}
  AND end_time > #{startTime}
```

### 预订编号生成

```
格式: BK + yyyyMMdd + 3位序号
示例: BK20260815001

实现:
1. 获取当天日期
2. Redis INCR "booking:seq:20260815" 获取序号
3. 拼接生成编号
4. Redis Key 每天自动过期
```

### RabbitMQ 通知配置

```java
@Configuration
public class RabbitConfig {
    @Bean
    public Queue notificationQueue() {
        return QueueBuilder.durable("meeting.notification.queue").build();
    }

    @Bean
    public DirectExchange notificationExchange() {
        return new DirectExchange("meeting.notification.exchange");
    }
}

// 生产者 - 预订成功后
rabbitTemplate.convertAndSend("meeting.notification.exchange",
    "notification.email", emailMessage);

// 消费者
@RabbitListener(queues = "meeting.notification.queue")
public void handleNotification(NotificationMessage message) {
    mailService.send(message);
}
```

## 新增依赖

```xml
<!-- Redisson -->
<dependency>
    <groupId>org.redisson</groupId>
    <artifactId>redisson-spring-boot-starter</artifactId>
    <version>3.32.0</version>
</dependency>
<!-- RabbitMQ -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-amqp</artifactId>
</dependency>
<!-- Mail -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-mail</artifactId>
</dependency>
```
