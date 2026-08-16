# 电商系统迭代需求

> 迭代: 001-ecommerce-test  
> 生成时间: 2026-08-15

## 功能模块清单

| # | 功能模块 | 描述 | 涉及端 |
| :--- | :--- | :--- | :--- |
| 1 | 用户认证 | 手机号验证码登录、密码登录、第三方登录 | app, h5, miniapp, admin |
| 2 | 商品浏览 | 商品列表、详情、搜索、分类筛选 | app, h5, miniapp |
| 3 | 购物车 | 添加/删除商品、数量调整、批量结算 | app, h5, miniapp |
| 4 | 订单管理 | 下单、支付、退款、物流跟踪 | app, h5, miniapp, admin |
| 5 | 后台管理 | 商品上架/下架、订单审核、数据统计 | admin |

## APP 端需求

### 1. 用户登录
- **功能**：手机号验证码登录、指纹/面容 ID 快速登录
- **交互**：原生动画过渡、离线缓存用户信息
- **接口**：POST /api/v1/auth/login, POST /api/v1/auth/biometric

### 2. 商品浏览
- **功能**：瀑布流展示、图片懒加载、下拉刷新
- **性能**：首屏加载 < 2s，滑动帧率 ≥ 60fps
- **接口**：GET /api/v1/products?page=1&size=20

## H5 端需求

### 1. 用户登录
- **功能**：手机号验证码登录、微信一键登录
- **适配**：响应式布局，支持手机/平板横竖屏
- **接口**：POST /api/v1/auth/login, GET /api/v1/auth/wechat-oauth

### 2. 商品浏览
- **功能**：无限滚动、骨架屏、图片 CDN 加速
- **SEO**：SSR 渲染商品详情页
- **接口**：GET /api/v1/products?category=electronics

## MiniApp 端需求

### 1. 用户登录
- **功能**：微信授权登录、手机号一键获取
- **限制**：包体积 < 2MB，首屏加载 < 1.5s
- **接口**：POST /api/v1/auth/miniprogram-login

### 2. 商品浏览
- **功能**：虚拟列表、图片压缩、分享卡片
- **体验**：页面切换动画流畅，无白屏
- **接口**：GET /api/v1/products?platform=miniprogram

## Admin 端需求

### 1. 用户管理
- **功能**：用户列表、封禁/解封、行为日志
- **权限**：RBAC 角色控制（超级管理员/运营/客服）
- **接口**：GET /api/v1/admin/users, POST /api/v1/admin/users/{id}/ban

### 2. 商品管理
- **功能**：批量上架/下架、库存预警、价格调整
- **数据**：Excel 导入导出、实时库存同步
- **接口**：POST /api/v1/admin/products/batch-upload, GET /api/v1/admin/products/low-stock

## 后端接口设计

### 认证模块
```yaml
POST /api/v1/auth/login:
  request:
    phone: string
    code: string
  response:
    token: string
    user: { id, name, avatar }

POST /api/v1/auth/wechat-oauth:
  request:
    code: string  # 微信授权码
  response:
    token: string
    openid: string
```

### 商品模块
```yaml
GET /api/v1/products:
  query:
    page: number
    size: number
    category: string
  response:
    total: number
    items: [{ id, name, price, cover }]

GET /api/v1/products/{id}:
  response:
    id: string
    name: string
    price: number
    stock: number
    images: string[]
```

### 订单模块
```yaml
POST /api/v1/orders:
  request:
    items: [{ productId, quantity }]
    addressId: string
  response:
    orderId: string
    amount: number

GET /api/v1/orders/{id}:
  response:
    id: string
    status: pending | paid | shipped | completed
    items: [...]
    logistics: { company, trackingNo }
```

## 数据模型

### 用户表 (users)
```sql
CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  phone VARCHAR(11) UNIQUE,
  name VARCHAR(50),
  avatar VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 商品表 (products)
```sql
CREATE TABLE products (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(200),
  price DECIMAL(10,2),
  stock INT DEFAULT 0,
  category_id VARCHAR(36),
  status TINYINT DEFAULT 1, -- 1:上架 0:下架
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 订单表 (orders)
```sql
CREATE TABLE orders (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36),
  amount DECIMAL(10,2),
  status VARCHAR(20), -- pending/paid/shipped/completed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```
