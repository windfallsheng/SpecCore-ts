# 预订管理 H5 端

> **平台**: frontend/h5 | **框架**: Vue 3 + Vant 4

## 页面

| 页面 | 路由 | 核心 Vant 组件 |
| :--- | :--- | :--- |
| 会议室列表 | `/` | van-calendar, van-card |
| 预订确认 | `/book/:roomId` | van-datetime-picker(popup), van-form |
| 我的预订 | `/my` | van-list, van-swipe-cell, van-empty |

## 关键交互

**会议室列表**: 日期选择(仅未来7天) · 卡片(名称/容量/设备/占用绿点红点) · 点击跳转预订

**预订确认**: 时间段30min粒度 · 选择后自动调check-conflict → 冲突红色禁用 · 提交→loading→跳转/my

**我的预订**: 列表+左滑取消 · 空状态插画

## AC

- [ ] 日期切换更新卡片占用状态
- [ ] 时间段选择→实时冲突检测(300ms debounce)
- [ ] 提交跳转+toast
- [ ] 我的预订列表+取消
- [ ] 375~414px适配 · 微信内置浏览器兼容

## 产出物

- [ ] `views/Home.vue` / `Book.vue` / `MyBookings.vue`
- [ ] `api/room.ts` / `api/booking.ts`

## ⚠️ 踩坑

iOS Safari datetime-picker → popup模式 | 微信fixed→absolute+JS | debounce=300ms
