# 数据库设计规范示例

> 本文件为数据库设计规范示例，涵盖命名、字段、索引、分表等经典规则。
> 复制到项目后按需修改，或作为 `.speccore/RULES/database.md` 的素材。

---

## 1. 命名规范

### 1.1 表命名

| 规则 | 示例 | 说明 |
|:---|:---|:---|
| 小写 + 下划线 | `user_profile` | 全部小写，单词间用 `_` 分隔 |
| 复数形式 | `orders` `users` | 表名用复数 |
| 业务前缀 | `oms_order` `cms_article` | 多模块项目加前缀区分 |
| 禁用保留字 | — | 不要用 `order` `group` `key` 等 SQL 保留字 |

### 1.2 字段命名

| 规则 | 正例 | 反例 |
|:---|:---|:---|
| 小写 + 下划线 | `created_at` | `createdAt` `Created_At` |
| 外键格式 | `user_id` `order_id` | `uid` `oid` |
| 布尔字段 | `is_deleted` `is_active` | `deleted` `active` |
| 状态字段 | `status` + 枚举说明 | `state`（模糊） |
| 时间字段 | `created_at` `updated_at` | `create_time`（不一致） |

### 1.3 索引命名

| 类型 | 命名格式 | 示例 |
|:---|:---|:---|
| 主键 | `pk_表名` | `pk_users` |
| 唯一索引 | `uk_表名_字段` | `uk_users_phone` |
| 普通索引 | `idx_表名_字段` | `idx_orders_user_id` |
| 联合索引 | `idx_表名_字段1_字段2` | `idx_orders_user_id_status` |

---

## 2. 字段设计规范

### 2.1 必备字段（每张表必须有）

| 字段名 | 类型 | 默认值 | 说明 |
|:---|:---|:---|:---|
| `id` | `BIGINT UNSIGNED` | 自增 | 主键，建议使用雪花 ID |
| `created_at` | `DATETIME(3)` | `CURRENT_TIMESTAMP(3)` | 创建时间，毫秒精度 |
| `updated_at` | `DATETIME(3)` | `CURRENT_TIMESTAMP(3)` | 更新时间，ON UPDATE 自动更新 |
| `created_by` | `BIGINT UNSIGNED` | `NULL` | 创建人 ID |
| `updated_by` | `BIGINT UNSIGNED` | `NULL` | 更新人 ID |
| `deleted_at` | `DATETIME(3)` | `NULL` | 软删除时间，NULL 表示未删除 |
| `deleted_by` | `BIGINT UNSIGNED` | `NULL` | 删除人 ID |
| `version` | `INT UNSIGNED` | `0` | 乐观锁版本号 |

### 2.2 常用字段类型选择

| 场景 | 推荐类型 | 不推荐 | 说明 |
|:---|:---|:---|:---|
| 主键 | `BIGINT UNSIGNED` | `INT` | 防止溢出 |
| 金额 | `BIGINT`（分） | `DECIMAL` `FLOAT` | 整数存储，避免精度问题 |
| 手机号 | `VARCHAR(20)` | `BIGINT` | 支持国际号码、国家码 |
| 邮箱 | `VARCHAR(128)` | `TEXT` | 有长度限制，可建索引 |
| 用户名 | `VARCHAR(64)` | `TEXT` | — |
| 密码 | `VARCHAR(255)` | `CHAR(32)` | 需兼容 bcrypt 等哈希长度 |
| 状态枚举 | `TINYINT UNSIGNED` | `VARCHAR` | 节省空间，配合代码枚举 |
| 大文本 | `TEXT` | `VARCHAR(65535)` | 文章、评论等内容 |
| JSON 数据 | `JSON` | `TEXT` | MySQL 5.7+ / PostgreSQL 原生支持 |
| IP 地址 | `VARBINARY(16)` | `VARCHAR(45)` | 兼容 IPv4/IPv6 |
| 时间戳 | `DATETIME(3)` | `TIMESTAMP` | DATETIME 无时区歧义，范围更大 |

### 2.3 字段约束

- **NOT NULL 优先：** 尽量不让字段为 NULL，用默认值代替
- **状态字段必须有注释：** 说明每个值的含义
- **JSON 字段必须定义结构：** 即使类型是 JSON，也要在文档中定义字段结构
- **大字段单独表：** TEXT/BLOB 超过 1KB 建议拆到副表

---

## 3. 索引设计规范

### 3.1 索引原则

1. **where 条件字段必建索引** — 特别是高频查询条件
2. **联合索引最左前缀** — `(a, b, c)` 可以覆盖 `a` `a,b` `a,b,c`，但不能覆盖 `b` `c`
3. **覆盖索引优先** — 查询字段都在索引中，避免回表
4. **索引不是越多越好** — 单表索引不超过 5 个，联合索引字段不超过 4 个
5. **区分度低的字段放前面** — 性别（区分度 2）放前面，创建时间（区分度高）放后面
6. **冗余索引清理** — `(a)` 和 `(a,b)` 并存时，`(a)` 是冗余的

### 3.2 索引示例

```sql
-- 用户表
CREATE TABLE users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(128),
  username VARCHAR(64) NOT NULL,
  status TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1-正常 2-冻结 3-注销',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) DEFAULT NULL,
  
  UNIQUE KEY uk_users_phone (phone),
  UNIQUE KEY uk_users_email (email),
  UNIQUE KEY uk_users_username (username),
  KEY idx_users_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';
```

### 3.3 索引禁忌

- ❌ 不要在低区分度字段上单独建索引（如 `status` 只有 2 个值）
- ❌ 不要对频繁更新的字段建索引（更新成本 = 数据更新 + 索引更新）
- ❌ 不要在 WHERE 条件中对字段做函数运算（如 `WHERE DATE(created_at) = '2026-09-10'`）
- ❌ 不要用 `SELECT *`，只查需要的字段，尽量覆盖索引

---

## 4. 分表分库策略

### 4.1 何时分表

| 条件 | 策略 |
|:---|:---|
| 单表数据 > 500 万 | 水平分表 |
| 单表数据 > 1 亿 | 水平分库 + 分表 |
| 字段数 > 50 | 垂直拆分（大字段拆副表） |
| 冷热数据明显 | 归档表（近 3 个月热数据 + 历史归档表） |

### 4.2 分表路由键选择

| 场景 | 路由键 | 说明 |
|:---|:---|:---|
| 用户相关数据 | `user_id` | 按用户维度分片，查询集中在单分片 |
| 订单数据 | `order_id` 或 `user_id` | 订单号含时间戳可直接路由 |
| 时间序列数据 | `created_at` | 按时间范围分片，便于归档清理 |
| 地理位置数据 | `region_code` | 按地区分片，就近访问 |

### 4.3 分表示例

```sql
-- 订单表按 user_id % 128 分片
-- 物理表：order_000 ~ order_127
-- 路由规则：order_{user_id % 128}

CREATE TABLE order_000 (
  id BIGINT UNSIGNED PRIMARY KEY,
  order_no VARCHAR(32) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  total_amount BIGINT NOT NULL COMMENT '金额（分）',
  status TINYINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  
  UNIQUE KEY uk_order_no (order_no),
  KEY idx_user_id_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 5. 软删除与数据归档

### 5.1 软删除实现

```sql
-- 查询时默认过滤软删除数据
SELECT * FROM users WHERE deleted_at IS NULL;

-- 需要包含已删除数据时显式指定
SELECT * FROM users WHERE deleted_at IS NOT NULL;
```

### 5.2 数据归档策略

| 数据类型 | 保留时间 | 归档方式 |
|:---|:---|:---|
| 操作日志 | 90 天 | 超过后迁移到归档表或 OSS |
| 订单数据 | 3 年 | 冷数据归档到历史库 |
| 系统日志 | 30 天 | ELK 设置过期策略 |
| 审计日志 | 3 年 | 单独存储，不可删除 |

---

## 6. SQL 编写规范

### 6.1 SELECT

- 必须指定字段，禁止 `SELECT *`
- 分页查询必须带 `ORDER BY`，否则结果不稳定
- 大批量查询使用 `LIMIT + 游标`，避免深分页 `OFFSET 1000000`

### 6.2 INSERT/UPDATE/DELETE

- INSERT 必须指定字段名：`INSERT INTO t (a, b) VALUES (?, ?)`
- UPDATE 必须带 WHERE 条件，禁止全表更新
- DELETE 必须带 WHERE 条件，生产环境建议用软删除代替

### 6.3 事务

- 事务尽量短，不要在事务中调外部接口
- 更新多个表时，按相同顺序加锁，避免死锁
- 批量操作使用 `INSERT ... ON DUPLICATE KEY UPDATE` 或 `REPLACE INTO`

---

## 7. 数据库评审清单

新建或修改表时必须检查：

- [ ] 表名符合命名规范（小写 + 下划线 + 复数）
- [ ] 包含必备字段（id, created_at, updated_at, deleted_at, version）
- [ ] 主键使用 BIGINT UNSIGNED
- [ ] 金额字段用 BIGINT（分）存储
- [ ] 状态字段有注释说明每个值的含义
- [ ] 外键字段建立索引
- [ ] WHERE 条件字段建立索引
- [ ] 联合索引符合最左前缀原则
- [ ] 单表索引数量 ≤ 5
- [ ] 表和字段都有 COMMENT 注释
- [ ] 字符集使用 utf8mb4
- [ ] 引擎使用 InnoDB
