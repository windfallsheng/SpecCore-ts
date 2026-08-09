# Task-001: Room Service — 需求文档

## 任务目标

开发会议室管理后端服务，提供会议室 CRUD、设备管理、布局管理、用户认证等核心 API。

## 功能范围

### 1. 用户认证服务
- 用户登录（用户名+密码）
- 短信验证码发送
- JWT Token 生成与刷新
- 退出登录（Token 失效）

### 2. 会议室管理服务
- 会议室分页查询（支持关键词、状态、容量筛选）
- 会议室详情查询
- 会议室增删改
- 设备管理（增删改查）
- 布局管理（增删改查）

### 3. 用户管理服务
- 用户 CRUD（管理员功能）
- 用户角色管理

## 交付物

| 产出 | 说明 |
|------|------|
| Controller 层 | AuthController, RoomController, UserController |
| Service 层 | AuthService, RoomService, DeviceService, LayoutService, UserService |
| Repository 层 | UserRepository, RoomRepository, DeviceRepository, LayoutRepository |
| Entity/DTO | User, MeetingRoom, RoomDevice, RoomLayout + 对应 DTO |
| 单元测试 | Service 层测试覆盖率 ≥ 80% |
| 集成测试 | Controller 层 API 集成测试 |
| 数据库迁移 | Flyway 迁移脚本 |

## 非功能需求

- API 响应时间 P95 < 300ms
- 密码 BCrypt 加密
- 所有端点 JWT 认证（除 /auth/** 外）
- 操作日志记录
