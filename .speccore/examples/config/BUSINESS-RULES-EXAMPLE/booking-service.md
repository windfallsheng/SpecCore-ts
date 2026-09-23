# booking-service 端业务规则

> 端级规则示例。实际使用时，将内容复制到 `.speccore/GLOBAL/BUSINESS_RULES/booking-service.md`
> 文件名匹配当前端的规则会被自动加载（如 `booking-service.md` 或 `xxx-booking-service.md`）
>
> ⚠️ **命名警告**：文件名必须与 CONSTITUTION.md / PROJECT.yaml 中的工程标识完全一致
> 正确：`booking-service.md` &nbsp;&nbsp;错误：`booking_service.md`、`bookingService.md`、`h5.md`

---

## 1. 预订核心规则

### 1.1 预订时间窗口

- 可预订未来 30 天内的时段
- 同一用户同一时段最多预订 3 个资源
- 预订开始前 2 小时允许免费取消，之后收取 20% 违约金

### 1.2 资源冲突检测

- 同一资源同一时段只能被一个订单占用
- 冲突检测使用数据库唯一索引 `(resource_id, start_time, end_time)`
- 并发冲突时，先下单者优先，后者返回 `BIZ_003` 冲突错误

### 1.3 资源定价规则

- 工作日 vs 周末不同价格
- 高峰期（09:00-18:00）价格上浮 20%
- 会员享受 8 折优惠，折扣不可叠加
