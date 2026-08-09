# Task-004: H5 Mobile — 技术方案

## 技术选型

| 组件 | 选型 | 说明 |
|------|------|------|
| 构建工具 | Vite 5 | 快速 HMR |
| 框架 | Vue 3.4 + Composition API | <script setup> |
| 语言 | TypeScript 5.5 | 类型安全 |
| UI 库 | Vant 4 | 移动端组件库 |
| 路由 | Vue Router 4 | SPA 路由 |
| 状态管理 | Pinia 2.2 | 轻量状态管理 |
| HTTP | Axios 1.7 | 拦截器+Token |
| CSS | SCSS + Vant CSS 变量 | 主题定制 |

## 项目结构

```
src/
├── api/
│   ├── auth.ts              # 认证 API
│   ├── rooms.ts             # 会议室 API
│   ├── bookings.ts          # 预订 API
│   └── notifications.ts     # 通知 API
├── assets/
│   └── styles/
│       ├── variables.scss   # 主题变量
│       └── global.scss      # 全局样式
├── components/
│   ├── layout/
│   │   ├── AppLayout.vue    # 主布局
│   │   └── Tabbar.vue       # 底部导航栏
│   ├── room/
│   │   ├── RoomCard.vue     # 会议室卡片
│   │   └── RoomFilter.vue   # 筛选条件
│   ├── booking/
│   │   ├── TimeSlotPicker.vue  # 时间段选择器
│   │   └── BookingStepper.vue  # 预订步骤条
│   └── common/
│       ├── EmptyState.vue   # 空状态
│       └── LoadingMore.vue  # 加载更多
├── composables/
│   ├── useAuth.ts           # 认证逻辑
│   └── useBackPress.ts      # 返回键处理
├── router/
│   └── index.ts             # 路由配置
├── stores/
│   ├── auth.ts              # 认证状态
│   ├── rooms.ts             # 会议室状态
│   └── bookings.ts          # 预订状态
├── types/
│   ├── api.ts               # API 响应类型
│   └── models.ts            # 业务模型类型
├── utils/
│   ├── request.ts           # Axios 封装
│   └── token.ts             # Token 管理
├── views/
│   ├── Login.vue            # 登录页
│   ├── Home.vue             # 首页
│   ├── RoomList.vue         # 会议室列表
│   ├── RoomDetail.vue       # 会议室详情
│   ├── BookingCreate.vue    # 快速预订
│   ├── MyBookings.vue       # 我的会议
│   ├── BookingDetail.vue    # 预订详情
│   └── NotificationCenter.vue # 通知中心
├── App.vue
├── main.ts
└── env.d.ts
```

## 快速预订流程设计

```vue
<!-- BookingCreate.vue 步骤式预订 -->
<template>
  <van-steps :active="currentStep" direction="vertical">
    <van-step>
      <h3>选择日期和时间</h3>
      <van-calendar v-model:show="showCalendar" @confirm="onDateConfirm" />
      <TimeSlotPicker v-model="selectedSlot" />
    </van-step>
    <van-step>
      <h3>选择会议室</h3>
      <RoomCard v-for="room in availableRooms" :key="room.roomId"
                :room="room" @select="onRoomSelect" />
    </van-step>
    <van-step>
      <h3>填写会议信息</h3>
      <van-field v-model="form.title" label="会议主题" required />
      <van-field v-model="form.description" label="会议描述" type="textarea" />
    </van-step>
    <van-step>
      <h3>确认提交</h3>
      <!-- 预订信息预览 -->
      <van-button type="primary" @click="onSubmit">确认预订</van-button>
    </van-step>
  </van-steps>
</template>
```

## Vant 组件使用

| 组件 | 用途 |
|------|------|
| `van-nav-bar` | 顶部导航栏 |
| `van-tabbar` | 底部导航栏 |
| `van-tabs` | 标签页切换 |
| `van-card` | 信息卡片 |
| `van-cell` / `van-field` | 表单项 |
| `van-button` | 按钮 |
| `van-calendar` | 日期选择 |
| `van-picker` | 时间选择器 |
| `van-steps` | 步骤条 |
| `van-swipe` | 图片轮播 |
| `van-dialog` | 对话框 |
| `van-toast` | 轻提示 |
| `van-empty` | 空状态 |
| `van-skeleton` | 骨架屏 |
| `van-pull-refresh` | 下拉刷新 |
| `van-list` | 上拉加载更多 |

## 核心依赖

```json
{
  "dependencies": {
    "vue": "^3.4.0",
    "vue-router": "^4.4.0",
    "pinia": "^2.2.0",
    "axios": "^1.7.0",
    "vant": "^4.9.0",
    "@vant/use": "^1.6.0"
  },
  "devDependencies": {
    "vite": "^5.4.0",
    "typescript": "^5.5.0",
    "@vitejs/plugin-vue": "^5.1.0",
    "sass": "^1.77.0",
    "@vant/auto-import-resolver": "^1.2.0",
    "unplugin-auto-import": "^0.18.0",
    "unplugin-vue-components": "^0.27.0",
    "postcss-px-to-viewport-8-plugin": "^1.2.0"
  }
}
```

## 移动端适配

```typescript
// vite.config.ts — viewport 适配
import postcssPxToViewport from 'postcss-px-to-viewport-8-plugin';

export default defineConfig({
  css: {
    postcss: {
      plugins: [
        postcssPxToViewport({
          viewportWidth: 375,       // 设计稿宽度
          unitPrecision: 5,
          viewportUnit: 'vw',
          selectorBlackList: ['.ignore-'],
          minPixelValue: 1,
          mediaQuery: false,
        }),
      ],
    },
  },
});
```
