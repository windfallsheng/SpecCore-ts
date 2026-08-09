# Task-001: Room Service — 任务拆解

## 子任务列表

### Subtask 1.1: 项目脚手架搭建
- [ ] 初始化 Spring Boot 3.3 项目（Maven）
- [ ] 配置 application.yml（数据源、Redis、JWT）
- [ ] 配置 Flyway 数据库迁移
- [ ] 创建初始数据库迁移脚本（sys_user, meeting_room, room_device, room_layout）
- [ ] 配置 Spring Security + JWT 过滤器链
- [ ] 配置 CORS 跨域
- [ ] 添加统一响应结构 `Result<T>`
- [ ] 添加全局异常处理 `GlobalExceptionHandler`
- [ ] 配置 Swagger/OpenAPI 文档

### Subtask 1.2: 用户认证功能实现
- [ ] 创建 User 实体和 UserRepository（MyBatis-Plus BaseMapper）
- [ ] 实现 AuthService: login() 方法
- [ ] 实现 JWT Token 生成（accessToken + refreshToken）
- [ ] 实现密码 BCrypt 加密与校验
- [ ] 实现 AuthController: POST /api/v1/auth/login
- [ ] 实现 AuthController: POST /api/v1/auth/refresh
- [ ] 实现 AuthController: POST /api/v1/auth/logout
- [ ] 实现短信验证码发送接口（POST /api/v1/auth/send-sms）
- [ ] 编写 AuthService 单元测试
- [ ] 编写 AuthController 集成测试

### Subtask 1.3: 会议室 CRUD 实现
- [ ] 创建 MeetingRoom 实体和 MeetingRoomRepository
- [ ] 实现 RoomService: listRooms() — 分页+筛选
- [ ] 实现 RoomService: getRoomDetail() — 含设备和布局
- [ ] 实现 RoomService: createRoom() — 含设备和布局嵌套创建
- [ ] 实现 RoomService: updateRoom()
- [ ] 实现 RoomService: deleteRoom() — 检查关联预订
- [ ] 实现 RoomController 所有端点
- [ ] 添加会议室列表 Redis 缓存
- [ ] 编写 RoomService 单元测试
- [ ] 编写 RoomController 集成测试

### Subtask 1.4: 设备管理功能实现
- [ ] 创建 RoomDevice 实体和 RoomDeviceRepository
- [ ] 实现 DeviceService: 增删改查
- [ ] 实现 RoomController: 设备相关端点
- [ ] 编写单元测试

### Subtask 1.5: 布局管理功能实现
- [ ] 创建 RoomLayout 实体和 RoomLayoutRepository
- [ ] 实现 LayoutService: 增删改查
- [ ] 实现 RoomController: 布局相关端点
- [ ] 编写单元测试

### Subtask 1.6: 权限控制
- [ ] 实现角色权限注解 `@PreAuthorize`
- [ ] 管理员接口保护（新增/编辑/删除会议室）
- [ ] 普通用户接口权限控制
- [ ] 编写权限测试用例

### Subtask 1.7: 集成与文档
- [ ] 编写 API 文档（Swagger 注解）
- [ ] 端到端集成测试
- [ ] 代码审查与重构
- [ ] 补充 README 使用说明

## 验收标准

1. ✅ 所有 API 端点响应正常
2. ✅ 认证流程正确（登录→获取Token→访问受保护资源）
3. ✅ 会议室 CRUD 功能完整，包含设备和布局管理
4. ✅ 删除会议室的约束检查正确（有关联预订时拒绝）
5. ✅ 单元测试覆盖率 ≥ 80%
6. ✅ API 文档可通过 Swagger UI 访问
7. ✅ 所有异常场景有正确的错误响应
