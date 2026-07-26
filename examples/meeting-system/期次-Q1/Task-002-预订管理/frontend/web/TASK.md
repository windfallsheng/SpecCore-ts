# 预订管理 Web 端

> **平台**: frontend/web | **框架**: Vue 3 + Element Plus

## 页面

| 页面 | 路由 | 文件 |
| :--- | :--- | :--- |
| 预订管理 | `/bookings` | views/bookings/BookingManage.vue |

## 功能

- 表格: 预订人/会议室/日期/时间段/主题/状态/操作
- 搜索: 按日期+状态筛选
- 操作: 查看详情 / 取消预订(二次确认)

## AC

- [ ] 预订列表展示+按日期/状态筛选
- [ ] 取消操作: 确认→调用DELETE→刷新
- [ ] 查看详情跳转

## 产出物

- [ ] `views/bookings/BookingManage.vue`
- [ ] `api/booking.ts`
