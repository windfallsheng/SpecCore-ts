# 会议室管理 Web 端

> **平台**: frontend/web | **框架**: Vue 3 + TypeScript + Element Plus + Vite

## 页面

| 页面 | 路由 | 文件 |
| :--- | :--- | :--- |
| 会议室列表 | `/rooms` | views/rooms/RoomList.vue |

## 列表功能

- 分页表格: 名称/容量/楼层/设备/状态/操作
- 搜索栏: 楼层+状态下拉筛选+关键词
- 顶部「新增会议室」按钮

## 新增/编辑弹窗

- 名称(必填,唯一)/容量(1-200)/楼层/设备多选
- 前端校验+loading+成功刷新列表+失败toast
- 名称重复: 后端409 → toast"已存在"

## 删除

- 二次确认 → DELETE → 列表移除 → toast

## AC

- [ ] 列表分页展示+楼层/状态筛选正常
- [ ] 新增: 校验+重复提示
- [ ] 编辑: 保存后列表刷新
- [ ] 删除: 确认+刷新

## 产出物

- [ ] `views/rooms/RoomList.vue`
- [ ] `components/RoomFormDialog.vue`
- [ ] `api/room.ts`

## ⚠️ 踩坑

el-table min-width代替width | 弹窗@closed重置表单
