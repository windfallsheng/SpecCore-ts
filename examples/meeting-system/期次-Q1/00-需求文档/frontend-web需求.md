# frontend-web需求

> 来源: `docs/需求-后台管理端.md` | 原型: `prototype-admin.html`

**平台**: PC Web | 框架: Vue 3 + TypeScript + Element Plus + Vite

## 页面清单

| 页面 | 路由 | 路径 | 用途 | 优先级 |
| :--- | :--- | :--- | :--- | :--- |
| 会议室管理 | `/rooms` | views/rooms/RoomList.vue | CRUD 列表 + 弹窗表单 | P0 |
| 会议室详情 | `/rooms/:id` | views/rooms/RoomDetail.vue | 详情 + 当日日程 | P0 |
| 预订管理 | `/bookings` | views/bookings/BookingManage.vue | 查看/取消所有预订 | P0 |
| 用户管理 | `/users` | views/users/UserManage.vue | RBAC 角色分配 | P0 |
| 数据统计 | `/dashboard` | views/dashboard/Dashboard.vue | 图表看板 | P1 |

## 会议室管理页

**列表区域**: 分页表格（名称/容量/楼层/设备/状态/操作）、搜索栏（楼层+状态下拉筛选+搜索框）、顶部「新增会议室」按钮

**新增/编辑弹窗**:
- 表单字段: 名称(必填, max 100) / 容量(1-200) / 楼层(≥1) / 设备多选(投影仪/白板/视频会议/音响/电话)
- 校验: 前端非空校验 + 后端返回错误前端展示
- 提交: loading 状态 + 成功后关闭弹窗刷新列表 + 失败 toast 提示
- 名称重复: 后端返回 409 → toast "会议室名称已存在"

**删除**: 二次确认弹窗 → 调用 DELETE → 列表移除 → toast "已删除"

## 预订管理页

- 表格: 预订人/会议室/日期/时间段/主题/状态/操作
- 搜索: 按日期筛选 + 状态筛选(有效/已取消)
- 操作: 查看详情 / 取消预订(二次确认)

## RBAC 权限

| 角色 | 权限 |
| :--- | :--- |
| super_admin | 全部 |
| admin | 会议室管理 / 预订管理 |
| user | 仅查看 |

## 非功能要求

| 类别 | 要求 |
| :--- | :--- |
| 兼容 | Chrome 90+ / Edge 90+ / Safari 14+ |
| 性能 | 首屏加载 < 2s |
| 响应式 | 最小宽度 1024px（不要求移动端） |
