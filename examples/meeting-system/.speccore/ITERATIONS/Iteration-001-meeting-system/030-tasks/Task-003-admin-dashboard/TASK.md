# Task-003: Admin Dashboard — 任务拆解

## 子任务列表

### Subtask 3.1: 项目脚手架搭建
- [ ] 初始化 Vite + Vue 3 + TypeScript 项目
- [ ] 安装核心依赖（Element Plus, Vue Router, Pinia, Axios, ECharts）
- [ ] 配置 Vite 代理（/api → backend:9090）
- [ ] 配置 SCSS 全局变量和 Element Plus 主题
- [ ] 配置 Auto Import（Element Plus 组件按需导入）
- [ ] 创建目录结构

### Subtask 3.2: 基础设施搭建
- [ ] 封装 Axios 请求（拦截器 + Token 管理）
- [ ] 实现 Token 工具函数（存取删）
- [ ] 配置 Vue Router（路由表 + 导航守卫）
- [ ] 创建 Pinia Store（auth, rooms, bookings）
- [ ] 定义 TypeScript 类型（API 响应、业务模型）
- [ ] 创建 AppLayout 主布局（侧边栏 + 顶栏 + 内容区）

### Subtask 3.3: 登录功能
- [ ] 实现 Login.vue 页面（表单 + 验证）
- [ ] 实现 auth Store（login/logout 方法）
- [ ] 登录成功后存储 Token，跳转仪表盘
- [ ] 退出登录功能
- [ ] 记住密码功能（localStorage）

### Subtask 3.4: 仪表盘
- [ ] 实现 Dashboard.vue 页面
- [ ] 数据卡片（今日预订数、使用率、活跃用户）
- [ ] ECharts 使用率趋势图
- [ ] ECharts 热门时段柱状图
- [ ] 对接 Statistics API

### Subtask 3.5: 会议室管理页面
- [ ] 实现 RoomList.vue（Table + 搜索 + 分页）
- [ ] 实现 RoomCreate.vue（表单 + 设备/布局动态添加）
- [ ] 实现 RoomDetail.vue（详情展示 + 编辑模式）
- [ ] 删除会议室（确认弹窗 + 调用 API）
- [ ] 对接 Room API

### Subtask 3.6: 预订管理页面
- [ ] 实现 BookingList.vue（Table + 状态筛选 + 分页）
- [ ] 实现 BookingDetail.vue（详情展示）
- [ ] 实现 ApprovalDialog 审批对话框
- [ ] 取消预订功能
- [ ] 对接 Booking API

### Subtask 3.7: 通知中心
- [ ] 实现 NotificationCenter.vue（消息列表 + 未读标记）
- [ ] 标记已读/全部已读
- [ ] 通知消息自动刷新（定时轮询）
- [ ] 对接 Notification API

### Subtask 3.8: 测试与优化
- [ ] 编写组件单元测试（Vitest）
- [ ] 响应式适配调节
- [ ] 性能优化（路由懒加载、组件按需加载）
- [ ] 构建生产版本并验证

## 验收标准

1. ✅ 所有页面功能正常，与后端 API 对接无误
2. ✅ 登录/Token 过期流程正确
3. ✅ 表单验证完整
4. ✅ 响应式布局正常
5. ✅ 生产构建无错误
6. ✅ 核心组件有单元测试覆盖
