# Task-001: 会议室管理服务

> **来源**: `00-需求文档/backend需求.md § 会议室管理服务`
> **平台**: backend | **优先级**: P0 | **服务**: room-service
> **预估工时**: 6h | **负责人**: zs

---

## 1. 需求概述

实现会议室资源的完整 CRUD 管理 API，支持分页、筛选、软删除。提供会议室日程查询接口供前端判断占用状态。

---

## 2. 详细 AC

### AC-1: 新增会议室
```
Given 管理员填写会议室信息
When  POST /api/v1/rooms { name:"A101", capacity:20, floor:"1F", equipment:"投影仪,白板" }
Then  返回 200, data 包含 id + 创建时间
And   数据库新增一条记录
```

**校验规则**:
- name: 必填, max 100, 不可重复
- capacity: 必填, 1-200
- floor: 必填, ≥1
- equipment: 可选, 逗号分隔, 值必须在 [投影仪,白板,视频会议,音响,电话] 内

### AC-2: 名称唯一性
```
Given 已存在会议室 "A101"
When  POST /api/v1/rooms { name:"A101", ... }
Then  返回 409, code=1002, message="会议室名称已存在"
```

### AC-3: 分页列表
```
Given 数据库有 25 条会议室数据
When  GET /api/v1/rooms?page=1&size=10&floor=1&status=0
Then  返回第 1 页的满足筛选条件的数据, total 为满足条件的总数
```

支持筛选: floor(int), status(0/1/2), keyword(name LIKE)

### AC-4: 会议室详情
```
Given 会议室 id=1
When  GET /api/v1/rooms/1
Then  返回会议室完整信息, 包含当日日程列表
```

### AC-5: 编辑会议室
```
Given 会议室 id=1
When  PUT /api/v1/rooms/1 { capacity:30 }
Then  返回 200, 数据库中 capacity 更新为 30
```

### AC-6: 软删除
```
Given 会议室 id=1
When  DELETE /api/v1/rooms/1
Then  deleted 字段设为 1, 后续查询不可见
And   软删除后名称 "A101" 可被复用
```

### AC-7: 筛选不包含已删除
```
When  GET /api/v1/rooms
Then  返回结果不包含 deleted=1 的记录
```

---

## 3. 产出物清单

- [ ] `RoomController.java` — 6 个端点
- [ ] `RoomService.java` + `RoomServiceImpl.java` — 业务逻辑
- [ ] `RoomRepository.java` — MyBatis-Plus BaseMapper
- [ ] `Room.java` (Entity) — @TableName("t_rooms")
- [ ] `CreateRoomDTO.java` / `UpdateRoomDTO.java` / `RoomPageDTO.java` / `RoomVO.java`
- [ ] `GlobalExceptionHandler.java` — 统一异常处理（如已存在则追加）
- [ ] `V1__create_rooms.sql` — Flyway 迁移脚本
- [ ] 单元测试: RoomServiceTest (覆盖 AC-1 ~ AC-7)

---

## 4. 技术决策

| 决策点 | 方案 | 原因 |
| :--- | :--- | :--- |
| 逻辑删除 | MyBatis-Plus @TableLogic | 数据可恢复,历史预订可追溯 |
| 名称唯一性 | 数据库 UNIQUE(name) + Service 层捕获异常 | 简单可靠 |
| 设备字段 | JSON 类型 | 灵活扩展设备种类,MySQL 8.0 原生支持 |
| 分页 | MyBatis-Plus Page + IPage | 内置分页,免手写 SQL |

---

## 5. 依赖

| 依赖 | 说明 |
| :--- | :--- |
| MySQL 8.0 | 数据存储 |
| 统一认证中心 | JWT → @RequestHeader("Authorization") → 解析 user_id/role |
| Redis | 列表缓存（可选 P1） |

---

## 6. 完成标准

- [ ] 7 个 AC 全部通过
- [ ] 单元测试覆盖率 > 80%
- [ ] Flyway 迁移脚本可独立执行
- [ ] POSTMAN 测试集合导出到项目

---

## 7. 审查签到

| 角色 | 姓名 | 日期 | 签名 |
| :--- | :--- | :--- | :--- |
| 开发 | zs | | |
| 审查 | — | | |
| 验收 | — | | |

---

## ⚠️ 踩坑记录

| 坑点 | 解决 | 预防 |
| :--- | :--- | :--- |
| @TableLogic + UNIQUE(name) 导致软删除行也查重 | 联合索引 (name, deleted) 或 Service 手动查重 | 逻辑删除+唯一约束要双重思考 |
| Redis 缓存后修改不及时 | 写操作后 `redis.delete("rooms:*") ` | 缓存策略: 先写DB,再失效缓存 |
| JSON 字段在 MyBatis-Plus 中需要 TypeHandler | `@TableField(typeHandler = JacksonTypeHandler.class) ` | JSON 字段统一加 TypeHandler |
