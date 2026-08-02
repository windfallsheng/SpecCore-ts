# 技术宪法 — 会议预订系统

> v5.20.0 | speccore init 生成 | AI 全局约束

---

## 技术栈

### 后端 (backend)
- 语言: Java 17
- 框架: Spring Boot 3 + Spring Data JPA
- 数据库: MySQL 8.0
- 缓存: Redis 7.0
- API 风格: RESTful

### 前端 (frontend)
- Web 管理端: React 18 + Ant Design 5
- H5 移动端: Vue 3 + Vant 4

---

## 编码规范

### API 规范
- URL 前缀: /api/v1/
- 响应格式: { code, data, message }
- HTTP 方法: GET(查询) POST(新增) PUT(修改) DELETE(删除)

### 异常处理
- 统一使用 @ControllerAdvice 全局异常处理
- 业务异常: BusinessException(code, message)
- 错误码: 4位数字, 模块前缀

### 命名规范
- 类: PascalCase 
- 方法/变量: camelCase
- 包: com.example.{module}
- 服务: {domain}-service

### 数据库规范
- 表名: 复数小写 (rooms, bookings)
- 主键: BIGINT 自增
- 乐观锁: @Version 字段
- 索引: 外键 + 查询条件字段

### 日志规范
- 使用 SLF4J + Logback
- 请求入口记录 traceId
- 异常记录上下文信息
