# 代码索引

> 本文档记录项目代码的结构和关键位置，帮助 AI 快速定位代码。

## 1. 子工程列表

| 工程名称 | 路径 | 技术栈 | 职责 |
| :--- | :--- | :--- | :--- |
| {后端工程} | `backend/` | Spring Boot | 业务 API |
| {前端工程} | `frontend/` | Vue 3 | Web 应用 |
| {H5 工程} | `h5/` | Vue 3 + Vant | 移动端应用 |

## 2. 后端包结构

```
backend/src/main/java/com/xxx/
├── common/              # 通用工具、异常、响应体
├── config/              # 配置类
├── controller/          # REST API 控制器
├── service/             # 业务逻辑层
│   └── impl/            # 实现类
├── mapper/              # 数据访问层
├── dto/                 # 请求/响应 DTO
├── entity/              # 实体类
└── util/                # 工具类
```

## 3. 前端目录结构

```
frontend/src/
├── api/                 # API 接口定义
├── assets/              # 静态资源
├── components/          # 通用组件
├── composables/         # 组合式函数
├── router/              # 路由配置
├── stores/              # Pinia 状态管理
├── utils/               # 工具函数
└── views/               # 页面组件
```

## 4. 关键文件位置

| 文件类型 | 位置 | 说明 |
| :--- | :--- | :--- |
| 全局配置 | `application.yml` | 后端配置文件 |
| 入口文件 | `main.ts` | 前端入口 |
| 根组件 | `App.vue` | 前端根组件 |

## 5. 与 Feature 的关联

| Feature | 后端代码位置 | 前端代码位置 |
| :--- | :--- | :--- |
| Feature-001 | `backend/src/.../feature001/` | `frontend/src/views/feature001/` |
