# Task-004: H5 Mobile — 任务拆解

## 子任务列表

### Subtask 4.1: 项目脚手架搭建
- [ ] 初始化 Vite + Vue 3 + TypeScript 项目
- [ ] 安装核心依赖（Vant 4, Vue Router, Pinia, Axios）
- [ ] 配置 Vite 代理
- [ ] 配置 SCSS 变量和 Vant CSS 变量定制
- [ ] 配置 postcss-px-to-viewport（移动端适配）
- [ ] 配置 Vant 组件按需导入
- [ ] 创建目录结构

### Subtask 4.2: 基础设施搭建
- [ ] 封装 Axios 请求（同 Task-003 的 utils/request.ts）
- [ ] 实现 Token 工具函数
- [ ] 配置 Vue Router（移动端路由 + 导航守卫）
- [ ] 创建 Pinia Store
- [ ] 定义 TypeScript 类型
- [ ] 创建 AppLayout 布局（NavBar + Tabbar + RouterView）

### Subtask 4.3: 登录功能
- [ ] 实现 Login.vue 页面（手机号+验证码 / 用户名+密码切换）
- [ ] 发送验证码倒计时
- [ ] 登录成功后存储 Token
- [ ] 自动登录检测
- [ ] 对接 Auth API

### Subtask 4.4: 首页
- [ ] 实现 Home.vue 页面
- [ ] 今日概览卡片（可用会议室、我的会议数）
- [ ] 下个会议信息
- [ ] 快速预订入口按钮
- [ ] 骨架屏加载效果

### Subtask 4.5: 会议室浏览
- [ ] 实现 RoomList.vue（Vant Card 列表 + 下拉刷新 + 上拉加载）
- [ ] 实现 RoomFilter 筛选组件（日期/时间/容量）
- [ ] 实现 RoomDetail.vue（Vant Swipe 图片轮播 + 设备列表 + 布局信息）
- [ ] 查看可用时段（日历+时间段展示）
- [ ] 详情页预订按钮 → 跳转 BookingCreate

### Subtask 4.6: 快速预订
- [ ] 实现 BookingCreate.vue（步骤式预订流程）
- [ ] Step 1: 日期选择（van-calendar）
- [ ] Step 2: 时间段选择（TimeSlotPicker）
- [ ] Step 3: 会议室选择（RoomCard 列表，显示匹配的会议室）
- [ ] Step 4: 填写会议信息（van-field 表单）
- [ ] Step 5: 确认页面（信息预览 + 提交按钮）
- [ ] 提交成功/失败提示（van-toast / van-dialog）
- [ ] 对接 Booking API

### Subtask 4.7: 我的会议
- [ ] 实现 MyBookings.vue（van-tabs: 待审批/已确认/已完成/已取消）
- [ ] 实现 BookingDetail.vue（详情信息展示）
- [ ] 取消预订功能（van-dialog 确认）
- [ ] 下拉刷新 + 上拉加载更多

### Subtask 4.8: 通知中心与优化
- [ ] 实现 NotificationCenter.vue（消息列表）
- [ ] 标记已读/全部已读
- [ ] Tabbar 未读数量角标
- [ ] 移动端适配微调
- [ ] 组件单元测试（Vitest）
- [ ] 构建生产版本

## 验收标准

1. ✅ 所有移动端页面在 375px 宽度下显示正常
2. ✅ 引导式预订流程完整可用
3. ✅ 下拉刷新、上拉加载更多正常工作
4. ✅ 登录流程正确
5. ✅ 与后端 API 对接无误
6. ✅ 触摸交互体验良好
7. ✅ 生产构建无错误
