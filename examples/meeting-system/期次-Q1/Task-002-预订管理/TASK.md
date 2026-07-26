# Task-002: 预订管理

> **后端**: booking-service (Spring Boot) | **前端**: Web 管理端 + H5 移动端
> **来源**: `docs/需求-预订订单服务.md` + `docs/需求-后台管理端.md(预订管理)` + `docs/需求-H5移动端.md`
> **预估工时**: 后端 8h + Web 4h + H5 8h | **平台**: backend + frontend/web + frontend/h5

## 需求概述

实现预订订单管理：创建(冲突检测)、查看、取消。后端提供 API，Web 端管理员管理所有预订，H5 端员工自助预订。

## 后端 AC

- [ ] **AC-1**: POST `/api/v1/bookings` — 创建预订+冲突检测
- [ ] **AC-2**: 冲突检测: `(start1<end2) AND (end1>start2)` → 409
- [ ] **AC-3**: GET `/api/v1/bookings` — 我的预订列表(分页+筛选)
- [ ] **AC-4**: DELETE `/api/v1/bookings/{id}` — 取消预订
- [ ] **AC-5**: POST `/api/v1/bookings/check-conflict` — 实时预检

## 前端 Web 端 AC

- [ ] **AC-6**: 预订管理列表 — 查看所有预订+按日期/状态筛选
- [ ] **AC-7**: 取消预订 — 二次确认→调用 DELETE→列表刷新

## 前端 H5 端 AC

- [ ] **AC-8**: 会议室列表 — 日期选择+卡片列表+占用状态
- [ ] **AC-9**: 预订确认 — 时间段选择+实时冲突检测+提交
- [ ] **AC-10**: 我的预订 — 列表+左滑取消

## 关键决策

- 冲突检测: MyBatis-Plus 条件构造器 + SQL BETWEEN
- 并发防护: 数据库 `uk_booking_unique` 联合唯一索引

## ⚠️ 踩坑

- 并发预订脏写 → 唯一索引兜底
- 时区: UTC vs 北京时间 → 日期统一用 `yyyy-MM-dd` 字符串
- H5 冲突检测频繁调用 → 300ms debounce

---

| 角色 | 姓名 | 日期 | 签名 |
| :--- | :--- | :--- | :--- |
| 后端开发 | zs | | |
| Web 前端 | ls | | |
| H5 前端 | ls | | |
| 审查 | — | | |
