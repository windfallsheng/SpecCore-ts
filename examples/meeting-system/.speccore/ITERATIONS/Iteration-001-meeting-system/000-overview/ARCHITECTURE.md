# 架构概览 — Meeting System

## 整体架构

Meeting System 采用前后端分离架构，包含三个端：

```
┌─────────────────────────────────────────────────────┐
│                    Nginx (反向代理)                    │
│              http://meeting.example.com               │
└──────────────┬───────────┬──────────┬────────────────┘
               │           │          │
      ┌────────┴──────┐ ┌──┴───────┐ ┌┴───────────────┐
      │ Admin Dashboard│ │  H5 App  │ │  Static Assets │
      │  (Vue 3 SPA)  │ │  (Vue 3) │ │  /static/*     │
      │  Port: 8080   │ │ Port:8081│ │                │
      └───────┬───────┘ └────┬─────┘ └────────────────┘
              │              │
              ▼              ▼
┌─────────────────────────────────────────────────────┐
│              Backend Service (Spring Boot)            │
│                   Port: 9090                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Security │  │  Controllers  │   Services    │   │
│  │ (JWT)   │  │  /api/v1/* │  │  Business Logic│   │
│  └──────────┘  └──────────┘  └──────────────────┘   │
└───────────┬───────────────┬───────────────┬─────────┘
            │               │               │
      ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────────┐
      │  MySQL 8  │   │  Redis 7  │   │   RabbitMQ    │
      │  主数据库  │   │   缓存    │   │   消息队列     │
      └───────────┘   └───────────┘   └───────────────┘
```

## 模块划分

### Backend Service (Spring Boot)
- **认证模块**: 用户登录、JWT Token 管理、权限校验
- **会议室模块**: 会议室 CRUD、设备管理、布局管理
- **预订模块**: 会议预订、时间冲突检测、周期性会议、审批流程
- **通知模块**: 邮件通知、系统消息、审批提醒

### Admin Dashboard (Vue 3 + Element Plus)
- 用户登录/退出
- 会议室管理（列表、新增、编辑、删除）
- 预订管理（审批、查看、取消）
- 数据统计（使用率、热门时段）

### H5 Mobile (Vue 3 + Vant 4)
- 用户登录/退出
- 会议室浏览与筛选
- 快速预订（选择时间、会议室、会议详情）
- 我的会议列表

## 数据库设计（核心表）

| 表名 | 说明 | 核心字段 |
|------|------|---------|
| `sys_user` | 用户表 | id, username, password, real_name, email, phone, role |
| `meeting_room` | 会议室表 | id, room_name, location, capacity, status, description |
| `room_device` | 设备表 | id, room_id, device_name, device_type, status |
| `room_layout` | 布局表 | id, room_id, layout_name, layout_config(JSON) |
| `booking_record` | 预订记录 | id, room_id, user_id, title, start_time, end_time, status |
| `recurring_rule` | 周期规则 | id, booking_id, frequency, interval, end_date |
| `notification` | 通知表 | id, user_id, type, title, content, is_read |

## 技术决策

1. **JWT 认证**: 无状态认证，支持多端同时登录
2. **MyBatis-Plus**: 简化 CRUD，使用代码生成器
3. **Redis 缓存**: 缓存会议室列表、用户信息，减少数据库压力
4. **RabbitMQ**: 异步处理通知发送，避免阻塞主流程
5. **Vite**: 快速开发构建，HMR 热更新
