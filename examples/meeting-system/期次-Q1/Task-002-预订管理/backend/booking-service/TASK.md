# Task-002: 预订订单服务

> **来源**: `00-需求文档/backend需求.md § 预订订单服务`
> **平台**: backend | **优先级**: P0 | **服务**: booking-service
> **预估工时**: 8h | **负责人**: zs

---

## 1. 需求概述

实现预订订单管理 API，核心难点是**时间冲突检测**——同一会议室同一天不允许时间段重叠。同时提供独立的冲突检测接口供前端实时预检。

---

## 2. 详细 AC

### AC-1: 创建预订 + 自动冲突检测
```
Given 会议室 1 已被预订 2026-07-26 09:00-10:00
When  POST /api/v1/bookings { roomId:1, date:"2026-07-26", startTime:"09:30", endTime:"10:30", title:"周会" }
Then  返回 409, code=2001, message="该时段已被预订,冲突详情: 09:00-10:00 周会"
```

**冲突判断逻辑**: `(start1 < end2) AND (end1 > start2)` → 存在重叠

### AC-2: 禁止预订过去时间
```
When  POST /api/v1/bookings { date:"2026-01-01", ... }
Then  返回 400, code=2003, message="不可预订过去时间"
```

### AC-3: 我的预订列表
```
Given 当前用户(user_id=10)有 15 条预订
When  GET /api/v1/bookings?page=1&size=10&date=2026-07-26&status=active
Then  返回满足筛选条件的数据, total 正确
```

### AC-4: 预订详情
```
When  GET /api/v1/bookings/1
Then  返回预订完整信息, 含会议室名称(关联 room-service 或 JOIN)
```

### AC-5: 取消预订
```
Given 预订 id=1, status=0
When  DELETE /api/v1/bookings/1
Then  status 变为 1, 不可重复取消(再次取消返回 2002)
```

### AC-6: 冲突检测接口
```
When  POST /api/v1/bookings/check-conflict { roomId:1, date:"2026-07-26", startTime:"09:00", endTime:"10:00" }
Then  返回 { hasConflict: true/false, conflictDetail: "..." }
```

此接口在用户**选择时间段时**实时调用,不产生副作用。

---

## 3. 产出物清单

- [ ] `BookingController.java` — 5 个端点
- [ ] `BookingService.java` + `BookingServiceImpl.java`
- [ ] `BookingRepository.java` — 含自定义冲突检测查询
- [ ] `Booking.java` | `CreateBookingDTO.java` | `BookingVO.java`
- [ ] `V2__create_bookings.sql` — Flyway 迁移脚本
- [ ] 单元测试: BookingServiceTest·冲突检测 4 个场景(完全不重叠/完全重叠/部分重叠/接壤不冲突)

---

## 4. 技术决策

| 决策点 | 方案 | 原因 |
| :--- | :--- | :--- |
| 冲突检测 | MyBatis-Plus 条件构造器 + SQL BETWEEN | SQL 层面最快 |
| 时间存储 | TIME 类型 | 数据库原生支持,无需字符串转换 |
| 冲突检测接口 | 独立 POST 端点,不创建资源 | 前端预检,不产生副作用 |
| 会议室存在校验 | 调用 room-service API 或直接 JOIN | 二期可 MQ 异步(当前简单直接) |

---

## 5. 依赖

| 依赖 | 说明 |
| :--- | :--- |
| room-service | 会议室存在性 + 可用状态校验 |
| 统一认证中心 | JWT → user_id |
| Redis | 热点日期缓存 + 消息通知队列(P1) |

---

## 6. 关系约束

| 约束 | 校验方式 |
| :--- | :--- |
| 会议室存在 | `roomRepository.selectById(roomId) != null`, 否则 1001 |
| 不可预订自己 | `dto.userId != booking.userId` → 允许管理员取消他人 |
| 结束 > 开始 | `endTime.isAfter(startTime)`, 否则 400 |

---

## 7. 完成标准

- [ ] 6 个 AC 全部通过
- [ ] 冲突检测 4 个场景单元测试覆盖
- [ ] POSTMAN 测试集合包含并发预订场景
- [ ] 接口文档(SpringDoc)可在 /swagger-ui 查看

---

| 角色 | 姓名 | 日期 | 签名 |
| :--- | :--- | :--- | :--- |
| 开发 | zs | | |
| 审查 | — | | |
| 验收 | — | | |

---

## ⚠️ 踩坑记录

| 坑点 | 解决 | 预防 |
| :--- | :--- | :--- |
| 时间段比较: TIME 类型在 MyBatis `gt()`/`lt()` 中序列化为字符串导致比较失败 | `@JsonFormat(pattern = "HH:mm")` + SQL `CAST(? AS TIME)` | 时间字段统一用 java.time.LocalTime,MyBatis-Plus 3.5 原生支持 |
| 并发预订: 两个请求同时检测无冲突,同时写入 | 数据库层面 `(room_id, date, start_time, end_time)` 联合唯一索引防止脏写 | 靠应用层检测不够,必须有数据库兜底 |
| 时区: 服务器 UTC,前端北京时间 | 接口中日期用 `yyyy-MM-dd` 字符串,不传 timestamp | 日期时间用字符串传,避免时区转换 |


## 时间追踪
- 创建日期: 2026-07-22
- 预估AI时间: 4h
- 预估人工时间: 1.5h
- 预估Review时间: 0.5h
- 负责人: 张三
