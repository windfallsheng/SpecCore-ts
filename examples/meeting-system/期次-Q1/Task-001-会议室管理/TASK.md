# Task-001: 会议室管理

> **后端**: room-service (Spring Boot) | **前端**: Web 管理端 (Vue3 + Element Plus)
> **来源**: `docs/需求-会议室管理服务.md` + `docs/需求-后台管理端.md(会议室管理部分)`
> **预估工时**: 后端 6h + 前端 8h | **平台**: backend + frontend/web

## 需求概述

完整实现会议室的增删改查，包括后端 REST API 和管理员 Web 界面。

## 后端 AC

- [ ] **AC-1**: POST `/api/v1/rooms` — 新增会议室(参数校验,名称唯一)
- [ ] **AC-2**: GET `/api/v1/rooms` — 分页列表(楼层/状态筛选)
- [ ] **AC-3**: GET `/api/v1/rooms/{id}` — 会议室详情+当日日程
- [ ] **AC-4**: PUT `/api/v1/rooms/{id}` — 编辑会议室
- [ ] **AC-5**: DELETE `/api/v1/rooms/{id}` — 软删除

## 前端 AC

- [ ] **AC-6**: 会议室列表页 — 分页表格+搜索栏+新增按钮
- [ ] **AC-7**: 新增/编辑弹窗 — 表单校验+重复提示+刷新列表
- [ ] **AC-8**: 删除确认 — 二次确认→删除→列表移除

## 产出物

### backend/
- [ ] `RoomController.java` / `RoomService.java` + `Impl`
- [ ] `RoomRepository.java` / DTOs / VO
- [ ] Flyway V1__create_rooms.sql

### frontend/web/
- [ ] `views/rooms/RoomList.vue` — 列表+搜索+弹窗
- [ ] `components/RoomFormDialog.vue` — 新增/编辑弹窗
- [ ] `api/room.ts` — 6个 API 函数

## ⚠️ 踩坑: @TableLogic + UNIQUE 导致软删除行也查重
→ 联合索引 `(name, deleted)` | 写操作后 `redis.delete("rooms:*")`

---

| 角色 | 姓名 | 日期 | 签名 |
| :--- | :--- | :--- | :--- |
| 后端开发 | zs | | |
| 前端开发 | ls | | |
| 审查 | — | | |
