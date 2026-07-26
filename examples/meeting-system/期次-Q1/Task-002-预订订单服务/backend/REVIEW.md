# 代码审查清单: Task-002 预订订单服务

## 规范
- [ ] 所有 Controller 返回 `Result<T>`
- [ ] 异常统一用 `BusinessException`
- [ ] DTO 有 @NotBlank/@NotNull 校验
- [ ] Service 接口+实现分离

## 关键逻辑审查
- [ ] 冲突检测 SQL 正确: `lt(startTime, endTime).gt(endTime, startTime)`
- [ ] 接壤不冲突: 10:00结束 vs 10:00开始 → 允许预订
- [ ] 并发: 数据库联合唯一索引兜底，防脏写
- [ ] 日期校验: 不可预订过去时间
- [ ] check-conflict 接口无副作用（不创建资源）

## 安全
- [ ] 我的预订只返回当前用户（user_id 来自 JWT）
- [ ] 取消操作校验权限（自己 or admin）

## 性能
- [ ] 冲突检测使用 idx_room_date 索引
- [ ] 我的预订使用 idx_user_id 索引
- [ ] 时间段序列化使用 java.time.LocalTime

| 检查人 | 日期 | 结果 | 签名 |
| :--- | :--- | :--- | :--- |
| — | | | |
