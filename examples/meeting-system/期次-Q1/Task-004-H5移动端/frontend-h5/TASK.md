# Task-004: H5 移动端

> **来源**: `00-需求文档/frontend-h5需求.md` | **原型**: `prototype-h5.html`
> **平台**: frontend-h5 | **优先级**: P0
> **框架**: Vue 3 + Vant 4 + Vite | **预估工时**: 8h

---

## 1. 页面架构

```
src/
├── api/
│   ├── room.ts              # GET 会议室列表
│   └── booking.ts           # POST 创建预订, GET 列表, DELETE 取消, POST check-conflict
├── views/
│   ├── Home.vue             # 会议室列表(卡片)
│   ├── Book.vue             # 预订确认
│   └── MyBookings.vue       # 我的预订
├── router/index.ts          # 路由(3 条)
└── App.vue                  # 底部 TabBar
```

**Vant 组件使用**:
- `van-nav-bar` — 顶部导航
- `van-calendar` — 日期选择
- `van-card` — 会议室卡片
- `van-datetime-picker` — 时间段选择(popup 模式)
- `van-form` + `van-field` — 表单
- `van-list` — 下拉刷新列表
- `van-swipe-cell` — 左滑操作
- `van-dialog` — 确认弹窗
- `van-toast` — 消息提示
- `van-empty` — 空状态
- `van-tabbar` — 底部导航

---

## 2. 详细 AC

### AC-1: 会议室列表
```
Given 数据库有 10 个会议室
When  打开首页,默认日期=今天
Then  展示 10 张会议室卡片: 名称/楼层/容量/设备图标/占用状态(绿点=空闲,红点=使用中)
And   切换日期后卡片状态更新
And   点击卡片 → 跳转 /book/{roomId}
```

### AC-2: 时间段选择 + 实时冲突检测
```
Given 点击会议室卡片进入预订页
When  选择时段 09:30-10:30
Then  自动调用 POST /api/v1/bookings/check-conflict
And   无冲突: 提交按钮蓝色可点击
And   有冲突: 提交按钮红色禁用,显示"该时段已被预订: 09:00-10:00 周会"
```

### AC-3: 提交预订
```
Given 选择会议室+时段+填写会议主题
When  点击「提交预订」
Then  loading 状态 · 成功后跳转 /my · toast"预订成功"
And   失败 toast 后端错误信息
```

### AC-4: 我的预订列表
```
Given 当前用户有 5 条预订
When  打开 /my
Then  列表展示: 会议主题/日期/时间段/状态标签
And   左滑 → 「取消」→ 确认 → toast"已取消" → 列表刷新
```

### AC-5: 移动端适配
```
Given 设备宽度 375px(iPhone SE)
When  渲染所有页面
Then  布局不错位,文字不溢出,卡片宽度=屏幕宽度-32px
```

---

## 3. 产出物清单

- [ ] `src/api/room.ts` — `getRoomList(date)` / `getRoomDetail(id)`
- [ ] `src/api/booking.ts` — `createBooking` / `getMyBookings` / `cancelBooking` / `checkConflict`
- [ ] `src/views/Home.vue` — 会议室列表
- [ ] `src/views/Book.vue` — 预订确认
- [ ] `src/views/MyBookings.vue` — 我的预订
- [ ] `src/router/index.ts` — 路由

---

## 4. 技术决策

| 决策点 | 方案 | 原因 |
| :--- | :--- | :--- |
| 日期组件 | van-calendar(仅未来7天) | Vant 内置,体验一致 |
| 时间选择 | van-datetime-picker(popup) | 避免 iOS Safari popup 位置异常 |
| 左滑操作 | van-swipe-cell | Vant 原生支持 |
| 冲突检测时机 | @change 事件自动调用 | 实时反馈,不等到提交才发现 |

---

## 5. 完成标准

- [ ] 5 个 AC 全部通过
- [ ] iOS Safari + 微信内置浏览器兼容
- [ ] iPhone SE(375px) 至 iPhone 15 Pro Max(430px) 适配
- [ ] 首屏加载 < 1.5s

---

| 角色 | 姓名 | 日期 | 签名 |
| :--- | :--- | :--- | :--- |
| 开发 | ls | | |
| 审查 | — | | |
| 验收 | — | | |

---

## ⚠️ 踩坑记录

| 坑点 | 解决 | 预防 |
| :--- | :--- | :--- |
| van-datetime-picker iOS Safari 弹出异常 | `popup` 模式包裹 | H5 的时间选择统一用 popup 模式 |
| 微信浏览器 fixed 定位失效 | `position: absolute` + JS 动态高度 | 移动端慎用 fixed |
| 时间段选择时连续触发冲突检测 API | 300ms debounce | 实时检测接口必须加防抖 |
