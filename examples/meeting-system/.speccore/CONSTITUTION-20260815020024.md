# CONSTITUTION.md — Project Constitution

## 项目标识

| 属性 | 值 |
|------|-----|
| 项目名 | Meeting System |
| 项目短名 | meeting-system |
| 版本 | 1.0.0 |
| 代码仓库 | git@github.com:example/meeting-system.git |

## 技术栈

### 后台服务端 (Backend Service)
| 技术 | 版本 |
|------|------|
| Java | 17 |
| Spring Boot | 3.3.x |
| Spring Security | 6.3.x |
| JWT (jjwt) | 0.12.x |
| MyBatis-Plus | 3.5.x |
| MySQL | 8.0 |
| Redis | 7.0 |
| RabbitMQ | 3.13 |

### 后台管理端 (Admin Dashboard)
| 技术 | 版本 |
|------|------|
| Vue | 3.4.x |
| TypeScript | 5.5.x |
| Element Plus | 2.8.x |
| Vite | 5.4.x |
| Pinia | 2.2.x |
| Axios | 1.7.x |

### H5 移动端 (Mobile H5)
| 技术 | 版本 |
|------|------|
| Vue | 3.4.x |
| TypeScript | 5.5.x |
| Vant | 4.9.x |
| Vite | 5.4.x |
| Pinia | 2.2.x |

## 命名规范

### Java 后端
- **包名**: 小写，点分隔，如 `com.example.meeting.system`
- **类名**: PascalCase，如 `MeetingRoomService`, `BookingController`
- **方法名**: camelCase，如 `createMeetingRoom`, `findAvailableRooms`
- **常量**: UPPER_SNAKE_CASE，如 `MAX_BOOKING_DURATION`
- **数据库表**: snake_case，如 `meeting_room`, `booking_record`
- **数据库字段**: snake_case，如 `room_name`, `created_at`

### Vue 前端
- **组件文件**: PascalCase，如 `MeetingRoomList.vue`, `BookingForm.vue`
- **路由路径**: kebab-case，如 `/meeting-rooms`, `/booking/new`
- **组件引用**: PascalCase，如 `<MeetingRoomList />`
- **Props**: camelCase，如 `roomId`, `bookingStatus`
- **CSS 类名**: kebab-case，如 `.room-card`, `.booking-form`

## Git 分支策略

- `main` — 生产分支，受保护
- `develop` — 开发分支
- `feature/<feature-name>` — 功能分支
- `bugfix/<bug-name>` — 修复分支
- `release/<version>` — 发布分支

## API 设计规范

- 基础路径: `/api/v1`
- RESTful 风格
- 请求/响应格式: JSON
- 统一响应结构:
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {}
  }
  ```
- 认证方式: Bearer Token (JWT)
