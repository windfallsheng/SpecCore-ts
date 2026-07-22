# 会议预订系统 — 需求规格说明书 (PRD)

> 版本: v1.0 | 日期: 2026-07-22 | 作者: SpecCore E2E Test

---

## 1. 项目背景

企业内部需要一套完整的会议预订系统，支持员工在线预约会议室、查看会议安排、管理会议室资源。系统覆盖 Web 管理端（PC）和 H5 移动端两大前端，后台拆分为会议室管理服务和订单预订服务。

---

## 后台管理端需求

### 1. 会议室管理（CRUD）

管理端对会议室进行增删改查，支持设置容量、设备（投影仪/白板/视频会议）、楼层位置。

| POST | /api/admin/rooms | 新增会议室 |
| GET | /api/admin/rooms | 会议室列表（分页+筛选） |
| GET | /api/admin/rooms/:id | 会议室详情 |
| PUT | /api/admin/rooms/:id | 编辑会议室 |
| DELETE | /api/admin/rooms/:id | 删除会议室（软删除） |

### 2. 预订管理

管理员查看和管理所有预订，可取消违规预订。

| GET | /api/admin/bookings | 所有预订列表 |
| GET | /api/admin/bookings/:id | 预订详情 |
| DELETE | /api/admin/bookings/:id | 取消预订（管理员） |

### 3. 用户权限管理（RBAC）

管理用户角色和权限，区分管理员和普通用户。

| POST | /api/admin/users | 新增用户 |
| GET | /api/admin/users | 用户列表 |
| PUT | /api/admin/users/:id | 编辑用户 |
| PUT | /api/admin/users/:id/role | 变更角色 |
| DELETE | /api/admin/users/:id | 禁用用户 |

### 4. 数据统计看板

展示会议室使用率、预订趋势、热门时段等报表。

| GET | /api/admin/dashboard/stats | 核心统计数据 |
| GET | /api/admin/dashboard/trends | 预订趋势图数据 |
| GET | /api/admin/dashboard/hot-rooms | 热门会议室排行 |

---

## 后台管理H5端需求

### 1. 会议室浏览

H5端快速浏览可用会议室，支持按楼层/容量筛选。

| GET | /api/h5/rooms | 可用会议室列表 |
| GET | /api/h5/rooms/:id | 会议室详情+今日安排 |

### 2. 快速预订

H5端一键预订，选择时段后自动匹配可用会议室。

| POST | /api/h5/bookings | 创建预订 |
| GET | /api/h5/bookings/mine | 我的预订列表 |
| DELETE | /api/h5/bookings/:id | 取消我的预订 |

### 3. 会议签到

扫码或手动签到，记录实际参会情况。

| POST | /api/h5/checkin/:bookingId | 会议签到 |
| GET | /api/h5/checkin/:bookingId | 签到状态 |

### 4. 消息通知

预订成功/取消/提醒等消息推送。

| GET | /api/h5/notifications | 我的通知列表 |
| PUT | /api/h5/notifications/:id/read | 标记已读 |

---

## 后台服务需求

### 后台服务1：会议室管理服务 (room-service)

管理会议室资源、设备、楼层等基础数据。

| POST | /api/rooms | 新增会议室 |
| GET | /api/rooms | 会议室列表 |
| GET | /api/rooms/:id | 会议室详情 |
| PUT | /api/rooms/:id | 更新会议室 |
| DELETE | /api/rooms/:id | 删除会议室 |
| GET | /api/rooms/:id/schedule | 该会议室今日安排 |

### 后台服务2：预订订单服务 (booking-service)

管理预订订单、冲突检测、签到、通知。

| POST | /api/bookings | 创建预订（含冲突检测） |
| GET | /api/bookings | 预订列表 |
| GET | /api/bookings/:id | 预订详情 |
| DELETE | /api/bookings/:id | 取消预订 |
| POST | /api/bookings/check-conflict | 检查时段冲突 |
| POST | /api/checkin/:bookingId | 签到 |
| GET | /api/notifications | 通知列表 |

---

## 数据库设计（概要）

### 表结构

1. **rooms** — 会议室表
   - id, name, capacity, floor, equipment (JSON), status, created_at, updated_at

2. **bookings** — 预订表
   - id, room_id, user_id, title, start_time, end_time, status, checkin_at, created_at

3. **users** — 用户表
   - id, name, email, role (admin/user), status, created_at

4. **notifications** — 通知表
   - id, user_id, type, title, content, is_read, created_at

---

## 技术栈

| 层 | 技术 | 说明 |
| :--- | :--- | :--- |
| Web管理端 | Vue 3 + Element Plus | PC端后台管理 |
| H5移动端 | Vue 3 + Vant UI | 移动端H5 |
| 后台服务1 | Spring Boot 3 + MyBatis-Plus | 会议室管理 |
| 后台服务2 | Spring Boot 3 + MyBatis-Plus | 预订管理 |
| 数据库 | MySQL 8.0 | 关系型数据库 |
| 缓存 | Redis | 会议室实时状态 |
