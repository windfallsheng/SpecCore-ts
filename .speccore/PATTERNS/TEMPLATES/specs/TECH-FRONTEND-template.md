# 前端技术方案

<!--
  前端专属 TECH 模板（适用于 H5/Web管理端/小程序/App）
  参考格式，最终内容由 AI 根据实际前端项目自由组织
  覆盖：页面路由、组件设计、状态管理、请求封装、样式方案、构建部署
-->

---

## 修订记录

| 版本 | 日期 | 修订人 | 修订说明 |
|------|------|--------|----------|
| v1.0 | 2026-01-20 | 前端负责人 | 初稿 |

---

## 1. 技术选型

### 1.1 技术栈总览

| 层次 | 技术选型 | 版本 | 说明 |
|------|---------|------|------|
| 框架 | Vue 3 / React 18 | - | 主框架 |
| 语言 | TypeScript | 5.x | 严格模式 |
| 构建工具 | Vite | 5.x | 开发/构建 |
| UI 库 | Element Plus / Ant Design | - | 组件库 |
| 状态管理 | Pinia / Zustand | - | 全局状态 |
| 路由 | Vue Router 4 / React Router 6 | - | 页面路由 |
| HTTP 请求 | Axios | 1.x | 接口请求 |
| CSS 方案 | UnoCSS / Tailwind CSS | - | 原子化 CSS |
| 代码规范 | ESLint + Prettier | - | 代码风格 |

---

## 2. 页面路由结构

### 2.1 路由表

| 路由路径 | 页面名称 | 组件 | 权限 | 缓存 |
|---------|---------|------|------|------|
| / | 首页 | HomePage | 所有用户 | 是 |
| /login | 登录 | LoginPage | 公开 | 否 |
| /dashboard | 数据看板 | DashboardPage | 管理员 | 是 |
| /list | 列表页 | ListPage | 登录用户 | 否 |
| /detail/:id | 详情页 | DetailPage | 登录用户 | 否 |
| /form | 表单页 | FormPage | 登录用户 | 否 |
| /settings | 系统设置 | SettingsPage | 管理员 | 是 |

### 2.2 路由守卫

```typescript
// 路由守卫设计
router.beforeEach(async (to, from) => {
  // 1. 白名单检查（登录页、404 等）
  if (WHITE_LIST.includes(to.path)) return true;
  
  // 2. Token 有效性检查
  const token = useAuthStore().token;
  if (!token) return { path: '/login', query: { redirect: to.fullPath } };
  
  // 3. 权限检查
  const requiredRole = to.meta?.role as string;
  if (requiredRole && !hasRole(requiredRole)) return { path: '/403' };
  
  return true;
});
```

### 2.3 导航结构

- **Web 管理端**: 左侧菜单 + 顶部面包屑 + 标签页缓存
- **H5 移动端**: 底部 TabBar（首页/我的）+ 顶部导航栏
- **小程序**: 底部 TabBar + 页面栈管理

---

## 3. 组件设计

### 3.1 组件分层

```
src/components/
├── common/          ← 通用基础组件
│   ├── AppButton.vue    (按钮：主/次/文字/危险)
│   ├── AppDialog.vue    (弹窗：确认/表单/提示)
│   ├── AppTable.vue     (表格：排序/筛选/分页)
│   ├── AppForm.vue      (表单：校验/联动/动态)
│   ├── AppSearch.vue    (搜索：输入/筛选/快捷)
│   └── AppEmpty.vue     (空态：无数据/无权限/错误)
├── business/        ← 业务组件
│   ├── OrderCard.vue    (订单卡片)
│   ├── UserAvatar.vue   (用户头像)
│   └── StatusTag.vue    (状态标签)
└── layout/          ← 布局组件
    ├── AppLayout.vue    (主布局)
    ├── SideMenu.vue     (侧边菜单)
    └── HeaderBar.vue    (顶部栏)
```

### 3.2 组件规范

| 规范 | 说明 |
|------|------|
| 单文件上限 | 200 行，超出必须拆分 |
| Props 定义 | 必须用 TypeScript interface，标注默认值和必填 |
| 事件命名 | kebab-case，如 `@update:model-value` |
| 插槽设计 | 默认插槽 + 具名插槽（header/footer/extra） |
| 四态齐全 | 加载态 / 空态 / 错误态 / 边界态 |

---

## 4. 状态管理

### 4.1 Store 设计

| Store | 职责 | 持久化 | 关键状态 |
|-------|------|--------|---------|
| useAuthStore | 用户认证 | localStorage | token, userInfo, permissions |
| useAppStore | 全局配置 | - | theme, locale, sidebarCollapsed |
| useXxxStore | 业务状态 | sessionStorage | list, detail, filters |

### 4.2 数据流

```
用户操作 → Component.emit() → Store.action() → API.request()
                                                    ↓
Component.render() ← Store.state ← API.response()
```

---

## 5. 请求封装

### 5.1 Axios 实例

```typescript
// 请求拦截器
axiosInstance.interceptors.request.use(config => {
  // 自动附加 Token
  const token = useAuthStore().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // 请求去重（防重复提交）
  config.headers['X-Request-Id'] = generateUUID();
  return config;
});

// 响应拦截器
axiosInstance.interceptors.response.use(
  response => response.data,
  error => {
    if (error.response?.status === 401) {
      // Token 过期 → 刷新或跳转登录
      useAuthStore().handleTokenExpired();
    }
    // 统一错误提示
    const msg = error.response?.data?.message || '网络异常，请稍后重试';
    showToast(msg);
    return Promise.reject(error);
  }
);
```

### 5.2 API 模块化

```
src/api/
├── auth.ts       ← 登录/注册/Token 刷新
├── user.ts       ← 用户信息/头像/密码
├── order.ts      ← 订单 CRUD
└── common.ts     ← 上传/下载/字典
```

---

## 6. 样式方案

### 6.1 主题配置

| 变量 | 值 | 用途 |
|------|------|------|
| --primary-color | #1890ff | 主色调 |
| --success-color | #52c41a | 成功 |
| --warning-color | #faad14 | 警告 |
| --error-color | #ff4d4f | 错误 |
| --border-radius | 4px | 圆角 |
| --spacing-base | 8px | 基础间距 |

### 6.2 响应式断点

| 断点 | 宽度 | 适用设备 |
|------|------|---------|
| xs | < 576px | 手机竖屏 |
| sm | ≥ 576px | 手机横屏 |
| md | ≥ 768px | 平板 |
| lg | ≥ 992px | 桌面 |
| xl | ≥ 1200px | 大屏 |

---

## 7. 字段→UI 映射

> 这是前后端契约的关键桥梁

| 页面/组件 | UI 字段 | 来源 API | 响应字段 | 格式 |
|-----------|---------|---------|---------|------|
| 列表页 | 名称 | GET /api/xxx | name | 文本 |
| 列表页 | 状态 | GET /api/xxx | status | 枚举→标签颜色 |
| 详情页 | 创建时间 | GET /api/xxx/:id | createdAt | 日期格式化 |
| 表单页 | 金额 | POST /api/xxx | amount | 数字→货币 |

---

## 8. 状态枚举（前后端共享）

| 枚举名 | 值 | 前端显示 | 标签颜色 |
|--------|------|---------|---------|
| status | 0 | 待处理 | default |
| status | 1 | 进行中 | processing |
| status | 2 | 已完成 | success |
| status | 3 | 已取消 | default |
| status | 4 | 已拒绝 | error |

---

## 9. 构建与部署

| 环境 | 命令 | 输出 | CDN |
|------|------|------|-----|
| 开发 | `npm run dev` | localhost:3000 | - |
| 测试 | `npm run build:test` | dist/ | 测试 CDN |
| 生产 | `npm run build:prod` | dist/ | 生产 CDN |

### 性能优化

| 策略 | 实现 | 效果 |
|------|------|------|
| 路由懒加载 | `() => import('./views/Xxx.vue')` | 首屏 JS 减少 60% |
| 图片懒加载 | v-lazy 指令 | 首屏请求减少 40% |
| Gzip 压缩 | Nginx 配置 | 传输体积减少 70% |
| 代码分割 | Vite manualChunks | vendor 独立缓存 |
