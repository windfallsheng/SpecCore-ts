# Task-001: Room Service — 技术方案

## 技术选型

| 组件 | 选型 | 说明 |
|------|------|------|
| Web 框架 | Spring Boot 3.3 | 最新稳定版 |
| ORM | MyBatis-Plus 3.5 | 简化 CRUD，代码生成 |
| 认证 | Spring Security + jjwt 0.12 | 无状态 JWT 认证 |
| 数据库 | MySQL 8.0 | 主数据库 |
| 缓存 | Redis 7.0 + Spring Cache | 会议室列表缓存 |
| 参数校验 | Hibernate Validator | JSR-380 |
| API 文档 | SpringDoc OpenAPI 2.6 | Swagger UI |
| 数据库迁移 | Flyway | 版本化管理 |

## 模块结构

```
com.example.meeting.system
├── config/
│   ├── SecurityConfig.java          # Spring Security 配置
│   ├── JwtAuthenticationFilter.java # JWT 过滤器
│   └── WebConfig.java               # CORS 等 Web 配置
├── controller/
│   ├── AuthController.java          # 认证接口
│   ├── RoomController.java          # 会议室接口
│   └── UserController.java          # 用户接口
├── service/
│   ├── AuthService.java             # 认证业务
│   ├── RoomService.java             # 会议室业务
│   ├── DeviceService.java           # 设备业务
│   ├── LayoutService.java           # 布局业务
│   └── UserService.java             # 用户业务
├── repository/
│   ├── UserRepository.java
│   ├── MeetingRoomRepository.java
│   ├── RoomDeviceRepository.java
│   └── RoomLayoutRepository.java
├── entity/
│   ├── User.java
│   ├── MeetingRoom.java
│   ├── RoomDevice.java
│   └── RoomLayout.java
├── dto/
│   ├── LoginRequest.java
│   ├── LoginResponse.java
│   ├── RoomRequest.java
│   ├── RoomResponse.java
│   └── PageResult.java
└── exception/
    ├── BusinessException.java
    └── GlobalExceptionHandler.java
```

## 数据库表（本任务涉及）

1. `sys_user` — 用户表
2. `meeting_room` — 会议室表
3. `room_device` — 设备表
4. `room_layout` — 布局表

## 关键设计决策

### JWT Token 结构

```json
{
  "sub": "1001",
  "username": "admin",
  "role": "ADMIN",
  "iat": 1723200000,
  "exp": 1723207200
}
```

- accessToken 有效期: 2小时
- refreshToken 有效期: 7天
- Token 存储在 Redis 中，退出时删除

### 会议室缓存策略

```java
@Cacheable(value = "rooms", key = "#roomId")
public RoomResponse getRoomById(Long roomId) { ... }

@CacheEvict(value = "rooms", key = "#roomId")
public void updateRoom(Long roomId, RoomRequest request) { ... }

@Caching(evict = {
    @CacheEvict(value = "rooms", key = "#roomId"),
    @CacheEvict(value = "rooms:list", allEntries = true)
})
public void deleteRoom(Long roomId) { ... }
```

### 统一异常处理

```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(BusinessException.class)
    public Result handleBusinessException(BusinessException e) {
        return Result.error(e.getCode(), e.getMessage());
    }
}
```

## 依赖项

```xml
<!-- pom.xml 核心依赖 -->
<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-security</artifactId>
    </dependency>
    <dependency>
        <groupId>com.baomidou</groupId>
        <artifactId>mybatis-plus-spring-boot3-starter</artifactId>
        <version>3.5.7</version>
    </dependency>
    <dependency>
        <groupId>io.jsonwebtoken</groupId>
        <artifactId>jjwt-api</artifactId>
        <version>0.12.6</version>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-data-redis</artifactId>
    </dependency>
    <dependency>
        <groupId>org.flywaydb</groupId>
        <artifactId>flyway-mysql</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springdoc</groupId>
        <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
        <version>2.6.0</version>
    </dependency>
</dependencies>
```
