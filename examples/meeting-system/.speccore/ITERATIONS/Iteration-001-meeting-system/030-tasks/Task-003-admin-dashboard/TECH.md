# Task-003: Admin Dashboard — 技术方案

## 技术选型

| 组件 | 选型 | 说明 |
|------|------|------|
| 构建工具 | Vite 5 | 快速 HMR |
| 框架 | Vue 3.4 + Composition API | <script setup> |
| 语言 | TypeScript 5.5 | 类型安全 |
| UI 库 | Element Plus 2.8 | 企业级组件库 |
| 路由 | Vue Router 4 | SPA 路由 |
| 状态管理 | Pinia 2.2 | 轻量状态管理 |
| HTTP | Axios 1.7 | 拦截器+Token |
| 图表 | ECharts 5.5 | 数据可视化 |
| 图标 | @element-plus/icons-vue | Element 图标集 |
| CSS | SCSS + Element Plus 变量 | 主题定制 |

## 项目结构

```
src/
├── api/
│   ├── auth.ts              # 认证 API
│   ├── rooms.ts             # 会议室 API
│   ├── bookings.ts          # 预订 API
│   ├── notifications.ts     # 通知 API
│   └── statistics.ts        # 统计 API
├── assets/
│   └── styles/
│       ├── variables.scss   # 主题变量
│       └── global.scss      # 全局样式
├── components/
│   ├── layout/
│   │   ├── AppLayout.vue    # 主布局
│   │   ├── Sidebar.vue      # 侧边栏
│   │   └── HeaderBar.vue    # 顶栏
│   ├── room/
│   │   ├── RoomCard.vue     # 会议室卡片
│   │   ├── RoomForm.vue     # 会议室表单
│   │   └── DeviceList.vue   # 设备列表
│   ├── booking/
│   │   ├── BookingTable.vue # 预订表格
│   │   └── ApprovalDialog.vue # 审批对话框
│   └── common/
│       ├── StatusTag.vue    # 状态标签
│       └── ConfirmDialog.vue # 确认弹窗
├── composables/
│   ├── useAuth.ts           # 认证逻辑
│   └── usePagination.ts     # 分页逻辑
├── router/
│   └── index.ts             # 路由配置+导航守卫
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
│   ├── Dashboard.vue        # 仪表盘
│   ├── RoomList.vue         # 会议室列表
│   ├── RoomDetail.vue       # 会议室详情
│   ├── RoomCreate.vue       # 新增会议室
│   ├── BookingList.vue      # 预订列表
│   ├── BookingDetail.vue    # 预订详情
│   └── NotificationCenter.vue # 通知中心
├── App.vue
├── main.ts
└── env.d.ts
```

## Axios 封装

```typescript
// utils/request.ts
import axios from 'axios';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth';

const request = axios.create({
  baseURL: '/api/v1',
  timeout: 10000,
});

// 请求拦截器 — 添加 Token
request.interceptors.request.use(config => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器 — 统一错误处理
request.interceptors.response.use(
  response => response.data,
  error => {
    if (error.response?.status === 401) {
      // Token 过期，跳转登录
      localStorage.removeItem('accessToken');
      window.location.href = '/login';
    }
    ElMessage.error(error.response?.data?.message || '请求失败');
    return Promise.reject(error);
  }
);

export default request;
```

## 路由守卫

```typescript
// router/index.ts
router.beforeEach((to, _from, next) => {
  const token = localStorage.getItem('accessToken');
  if (to.path !== '/login' && !token) {
    next('/login');
  } else if (to.path === '/login' && token) {
    next('/dashboard');
  } else {
    next();
  }
});
```

## 核心依赖

```json
{
  "dependencies": {
    "vue": "^3.4.0",
    "vue-router": "^4.4.0",
    "pinia": "^2.2.0",
    "axios": "^1.7.0",
    "element-plus": "^2.8.0",
    "@element-plus/icons-vue": "^2.3.0",
    "echarts": "^5.5.0",
    "vue-echarts": "^7.0.0"
  },
  "devDependencies": {
    "vite": "^5.4.0",
    "typescript": "^5.5.0",
    "@vitejs/plugin-vue": "^5.1.0",
    "sass": "^1.77.0",
    "unplugin-auto-import": "^0.18.0",
    "unplugin-vue-components": "^0.27.0"
  }
}
```
