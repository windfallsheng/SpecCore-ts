# 部署检查清单: Task-002 预订订单服务

## 环境
- [ ] Java 17+ · MySQL 8.0 (V1+V2 scripts) · Redis 7+

## 部署
1. [ ] `mvn flyway:migrate` — 执行 V2__create_bookings.sql
2. [ ] `mvn clean package -DskipTests`
3. [ ] 部署 jar + 健康检查 `GET /actuator/health`
4. [ ] 冒烟: `POST /api/v1/bookings/check-conflict`

## 依赖健康检查
- [ ] room-service 可访问（会议室存在性校验）
- [ ] Redis 可连接（缓存/消息队列）
- [ ] 统一认证中心 JWT 验签正常

## 监控
- [ ] 冲突检测接口响应 < 100ms (高频调用)
- [ ] 并发预订成功率 > 99%（唯一索引防脏写）
