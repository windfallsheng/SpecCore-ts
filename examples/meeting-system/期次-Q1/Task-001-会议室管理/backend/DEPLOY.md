# 部署检查清单: Task-001 会议室管理服务

## 环境要求
- [ ] Java 17+
- [ ] MySQL 8.0（已执行 V1__create_rooms.sql）
- [ ] Redis 7+（可选，P1 缓存）

## 配置检查
- [ ] application.yml: 数据库连接 + Redis 连接
- [ ] 统一认证中心 JWT 公钥配置
- [ ] 日志级别: INFO（生产）/ DEBUG（开发）

## 部署步骤
1. [ ] 执行 Flyway 迁移: `mvn flyway:migrate`
2. [ ] 构建: `mvn clean package -DskipTests`
3. [ ] 部署 jar 包到目标服务器
4. [ ] 健康检查: `GET /actuator/health` → 200
5. [ ] 冒烟测试: `POST /api/v1/rooms` → 200

## 回滚方案
1. [ ] 停止新版本
2. [ ] 还原上一版本 jar
3. [ ] 如 Schema 有变更: 执行 Flyway undo 或手动回滚

## 监控
- [ ] 接口响应时间 < 200ms (P99)
- [ ] 错误率 < 1%
- [ ] 数据库连接池使用率 < 80%
