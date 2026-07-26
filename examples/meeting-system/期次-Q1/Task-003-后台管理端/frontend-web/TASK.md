# Task-003: 后台管理端

> **来源**: `00-需求文档/frontend-web需求.md` | **原型**: `prototype-admin.html`
> **平台**: frontend-web | **优先级**: P0
> **框架**: Vue 3 + TypeScript + Element Plus + Vite | **预估工时**: 10h

---

## 1. 页面架构

```
src/
├── api/
│   ├── room.ts           # 会议室 API 封装
│   └── booking.ts        # 预订 API 封装
├── views/
│   ├── rooms/
│   │   ├── RoomList.vue      # 列表 + 搜索 + CRUD
│   │   └── RoomDetail.vue    # 详情 + 当日日程
│   ├── bookings/
│   │   └── BookingManage.vue # 预订管理列表
│   └── dashboard/
│       └── Dashboard.vue     # 数据看板
├── components/
│   ├── RoomFormDialog.vue    # 新增/编辑弹窗
│   └── RoomTable.vue         # 会议室表格组件
└── router/index.ts           # 路由配置
```

---

## 2. 详细 AC

### AC-1: 会议室列表页
```
Given 数据库有 15 个会议室
When  打开 /rooms
Then  默认展示第 1 页 10 条 · 表格列: 名称/容量/楼层/设备/状态/操作
And   搜索栏包含: 楼层下拉·状态下拉·关键词搜索框·「搜索」「重置」按钮
```

### AC-2: 新增会议室
```
Given 点击「新增会议室」
When  填写: 名称="A101"·容量=20·楼层=1F·设备=投影仪,白板
And   点击「确定」
Then  调用 POST /api/v1/rooms · 成功后关闭弹窗 + 刷新列表 + toast"新增成功"
And   名称重复时 toast"会议室名称已存在"
```

### AC-3: 编辑会议室
```
Given 点击会议室行的「编辑」
When  弹窗回显当前数据 · 修改容量=30
And   点击「确定」
Then  调用 PUT /api/v1/rooms/1 · 成功后关闭弹窗 + 刷新列表
```

### AC-4: 删除会议室
```
Given 点击「删除」
When  弹出确认框"确定删除会议室 A101？"
And   点击「确定」
Then  调用 DELETE /api/v1/rooms/1 · 成功后列表移除该行 + toast"已删除"
```

### AC-5: 预订管理页
```
Given 打开 /bookings
When  选择日期"2026-07-26"·状态"有效"
Then  展示符合筛选的预订列表
And   取消操作: 点击「取消」→ 确认 → 列表刷新
```

### AC-6: 会议室详情+日程
```
Given 点击「查看」
When  打开 /rooms/1
Then  展示会议室信息 + 当日时间轴(Visual Schedule)
```

---

## 3. 产出物清单

- [ ] `src/api/room.ts` — 6 个 API 函数
- [ ] `src/api/booking.ts` — 3 个 API 函数
- [ ] `src/views/rooms/RoomList.vue` — 列表页
- [ ] `src/views/rooms/RoomDetail.vue` — 详情页
- [ ] `src/views/bookings/BookingManage.vue` — 预订管理
- [ ] `src/components/RoomFormDialog.vue` — 复用弹窗
- [ ] `src/router/index.ts` — 路由配置（追加）

---

## 4. 技术决策

| 决策点 | 方案 | 原因 |
| :--- | :--- | :--- |
| 状态管理 | 组件内 reactive,不使用 Vuex/Pinia | 页面间数据独立,无需全局共享 |
| API 封装 | axios 实例 + 拦截器统一处理 401/500 | 所有页面共用 |
| 表格 | Element Plus el-table + el-pagination | 文档完善,稳定 |
| 表单校验 | Element Plus Form Rules | 内置校验,免手写逻辑 |

---

## 5. 完成标准

- [ ] 6 个 AC 全部通过
- [ ] Chrome 90+ / Edge 90+ 兼容
- [ ] 权限控制: admin 可编辑,user 只读

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
| el-table 列宽不自适应 | `min-width` 替代 `width` | 表格列宽统一用 min-width |
| 弹窗关闭表单残留 | `@closed` 中 `formRef.resetFields()` | 弹窗关闭钩子中重置所有状态 |
