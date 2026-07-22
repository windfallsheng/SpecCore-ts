# 会议预订系统 (MeetBook) — 产品需求文档 (PRD)

> **文档编号**: PRD-MB-2026-001  
> **版本**: v1.0  
> **日期**: 2026-07-22  
> **作者**: 产品部  
> **状态**: 已评审  

---

## 1. 版本历史

| 版本 | 日期 | 作者 | 变更说明 |
| :--- | :--- | :--- | :--- |
| v1.0 | 2026-07-22 | 产品部 | 初版，覆盖 MVP 范围 |

---

## 2. 项目概述

### 2.1 产品定位

MeetBook 是一款面向企业内部员工的会议室预订系统，解决会议室资源调度混乱、预订流程繁琐、信息不透明的问题。产品覆盖 Web 管理端（PC）和 H5 移动端，支持 4 个独立服务：会议室管理服务、预订订单服务、Web 管理端、H5 移动端。

### 2.2 核心价值

- **管理员**：可视化管控会议室资源，数据大屏实时掌握利用率
- **员工**：手机端一键预订，扫码签到，冲突自动检测
- **运维**：4 个服务独立部署，弹性扩容，Redis 缓存实时状态

### 2.3 角色定义

| 角色 | 描述 | 权限范围 |
| :--- | :--- | :--- |
| 超级管理员 | 系统最高权限 | 全部功能 |
| 普通管理员 | 日常运维 | 会议室管理 + 预订管理 + 数据查看 |
| 普通员工 | 会议室使用者 | 预订 + 签到 + 查看我的预订 |

---

## 后台管理端（Web 管理端）需求

平台：Vue 3 + Element Plus，PC 端浏览器访问。

### 1. 会议室管理（CRUD）

**用户故事**: 作为管理员，我希望增删改查会议室信息，以便统一管理所有会议室资源。

**功能描述**:

| POST | /api/admin/rooms | 新增会议室 |
| GET | /api/admin/rooms | 会议室列表（分页+按楼层/容量筛选） |
| GET | /api/admin/rooms/:id | 会议室详情 |
| PUT | /api/admin/rooms/:id | 编辑会议室 |
| DELETE | /api/admin/rooms/:id | 软删除会议室 |

**验收标准**:
- 列表默认分页 10 条，支持关键字搜索
- 新增/编辑表单校验：名称必填、容量 ≥1 人、楼层必选
- 删除为软删除，已删除的不在列表中显示
- 设备选型支持多选：投影仪、白板、视频会议、音响、电话

**参考原型**: `prototype-admin.html → 会议室管理卡片`

---

### 2. 预订管理

**用户故事**: 作为管理员，我需要查看和管控所有会议预订，以便处理违规占用和资源冲突。

**功能描述**:

| GET | /api/admin/bookings | 所有预订列表（按日期/会议室/状态筛选） |
| GET | /api/admin/bookings/:id | 预订详情 |
| DELETE | /api/admin/bookings/:id | 取消预订（管理员强制取消） |

**验收标准**:
- 列表按时间倒序排列
- 支持按日期范围筛选
- 管理员取消预订需填写取消原因
- 被取消的预订自动通知预订人

**参考原型**: `prototype-admin.html → 今日预订表格`

---

### 3. 用户权限管理（RBAC）

**用户故事**: 作为超级管理员，我希望管理用户及其角色权限，以便控制系统访问范围。

**功能描述**:

| POST | /api/admin/users | 新增用户 |
| GET | /api/admin/users | 用户列表 |
| PUT | /api/admin/users/:id | 编辑用户信息 |
| PUT | /api/admin/users/:id/role | 变更用户角色 |
| DELETE | /api/admin/users/:id | 禁用/启用用户 |

**验收标准**:
- 角色枚举：super_admin / admin / user
- 禁用用户后该用户无法登录和预订
- 支持按角色/部门筛选
- 变更角色需超级管理员权限

---

### 4. 数据统计看板

**用户故事**: 作为管理员，我需要查看会议室使用数据报表，以便优化资源配置。

**功能描述**:

| GET | /api/admin/dashboard/stats | 核心统计：总会议室、今日预订、使用率、热门时段 |
| GET | /api/admin/dashboard/trends | 近30天预订趋势图数据 |
| GET | /api/admin/dashboard/hot-rooms | 使用率TOP10会议室排行 |

**验收标准**:
- 数据实时更新（Redis 缓存，5 分钟刷新）
- 趋势图支持折线图展示
- 热门排行支持柱状图展示

**参考原型**: `prototype-admin.html → 统计卡片`

---

## H5 移动端需求

平台：Vue 3 + Vant UI，微信/浏览器 H5 访问。

### 1. 会议室浏览与搜索

**用户故事**: 作为员工，我希望在手机上快速浏览可用会议室，以便当场预订。

**功能描述**:

| GET | /api/h5/rooms | 可用会议室列表（默认按楼层排序） |
| GET | /api/h5/rooms/:id | 会议室详情 + 今日时间轴 |

**验收标准**:
- 列表显示：名称、容量、设备图标、今日剩余时段数
- 支持按楼层/容量筛选
- 已满的会议室灰色置底

**参考原型**: `prototype-h5.html → 可用会议室卡片列表`

---

### 2. 快速预订

**用户故事**: 作为员工，我希望选择时段后自动匹配可用会议室完成预订。

**功能描述**:

| POST | /api/h5/bookings | 创建预订（含冲突自动检测） |
| GET | /api/h5/bookings/mine | 我的预订列表 |
| DELETE | /api/h5/bookings/:id | 取消我的预订（开始前30分钟可取消） |

**验收标准**:
- 预订时自动检测时段冲突，冲突时提示推荐时段
- 预订成功推送通知
- 会议开始前30分钟内不可取消
- 单人单日最多预订 4 个时段

**参考原型**: `prototype-h5.html → 快速预订弹窗`

---

### 3. 会议签到

**用户故事**: 作为参会人，我希望扫码或手动签到，以便记录实际参会情况。

**功能描述**:

| POST | /api/h5/checkin/:bookingId | 会议签到（仅预订人与管理员） |
| GET | /api/h5/checkin/:bookingId | 签到状态查询 |

**验收标准**:
- 签到时间窗：会议开始前15分钟 ~ 开始后 30 分钟
- 超时未签到自动标记为"缺席"
- 支持二维码扫码签到

---

### 4. 消息通知

**用户故事**: 作为用户，我希望及时收到预订状态变更通知。

**功能描述**:

| GET | /api/h5/notifications | 我的通知列表 |
| PUT | /api/h5/notifications/:id/read | 标记已读 |

**验收标准**:
- 通知类型：预订成功、预订取消、会议提醒、签到提醒
- 支持批量标记已读
- 未读通知红色角标提示

---

## 后台服务 1：会议室管理服务 (room-service)

技术栈：Spring Boot 3 + MyBatis-Plus + MySQL

| POST | /api/rooms | 新增会议室 |
| GET | /api/rooms | 会议室列表 |
| GET | /api/rooms/:id | 会议室详情 |
| PUT | /api/rooms/:id | 更新会议室 |
| DELETE | /api/rooms/:id | 删除会议室 |
| GET | /api/rooms/:id/schedule | 该会议室今日时间安排 |

---

## 后台服务 2：预订订单服务 (booking-service)

技术栈：Spring Boot 3 + MyBatis-Plus + MySQL + Redis

| POST | /api/bookings | 创建预订（含冲突检测） |
| GET | /api/bookings | 预订列表 |
| GET | /api/bookings/:id | 预订详情 |
| DELETE | /api/bookings/:id | 取消预订 |
| POST | /api/bookings/check-conflict | 检查时段冲突 |
| POST | /api/checkin/:bookingId | 签到 |
| GET | /api/notifications | 通知列表 |

**冲突检测规则**:
- 同一会议室、同一时段不允许重复预订
- 检测精度：分钟级
- 检测范围：start_time ≤ 预订结束时间 AND end_time ≥ 预订开始时间

---

## 数据库设计

### rooms 会议室表

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | BIGINT | 主键自增 |
| name | VARCHAR(100) | 会议室名称 |
| capacity | INT | 容纳人数 |
| floor | VARCHAR(20) | 所在楼层 |
| equipment | JSON | 设备列表（投影仪/白板/视频会议/音响/电话） |
| status | TINYINT | 0=空闲 1=使用中 2=维护中 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

### bookings 预订表

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | BIGINT | 主键自增 |
| room_id | BIGINT | 会议室ID（外键） |
| user_id | BIGINT | 预订人ID（外键） |
| title | VARCHAR(200) | 会议主题 |
| start_time | DATETIME | 开始时间 |
| end_time | DATETIME | 结束时间 |
| status | TINYINT | 0=已确认 1=进行中 2=已完成 3=已取消 4=缺席 |
| cancel_reason | VARCHAR(500) | 取消原因 |
| checkin_at | DATETIME | 签到时间 |
| created_at | DATETIME | 创建时间 |

### users 用户表

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | BIGINT | 主键自增 |
| name | VARCHAR(50) | 姓名 |
| email | VARCHAR(100) | 邮箱（登录账号） |
| role | VARCHAR(20) | super_admin/admin/user |
| status | TINYINT | 0=正常 1=禁用 |
| created_at | DATETIME | 创建时间 |

### notifications 通知表

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | BIGINT | 主键自增 |
| user_id | BIGINT | 用户ID（外键） |
| type | VARCHAR(20) | booking_success/booking_cancel/meeting_remind/checkin_remind |
| title | VARCHAR(200) | 通知标题 |
| content | TEXT | 通知内容 |
| is_read | TINYINT | 0=未读 1=已读 |
| created_at | DATETIME | 创建时间 |

---

## 非功能需求

| 类别 | 要求 |
| :--- | :--- |
| 性能 | 会议室列表查询 < 200ms，预订冲突检测 < 500ms |
| 并发 | 支持 500 TPS 预订请求 |
| 可用性 | 99.9%，Redis 哨兵模式保障 |
| 安全 | 接口 JWT 认证 + RBAC 权限校验，敏感操作记录审计日志 |
| 兼容性 | Web 支持 Chrome/Edge/Safari 最新 2 个版本，H5 支持 iOS 14+ / Android 10+ |

---

## 原型参考

| 页面 | 原型文件 |
| :--- | :--- |
| Web 管理端（仪表盘 + 会议室 + 预订） | `prototype-admin.html` |
| H5 移动端（会议室浏览 + 快速预订 + 我的会议） | `prototype-h5.html` |
