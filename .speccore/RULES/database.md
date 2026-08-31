---
appliesTo:
  - database
  - mysql
  - postgresql
  - mongodb
priority: 70
---

# 数据库规范

## 命名规范

- **表名**：snake_case，复数形式（如 `users`、`order_items`）。
- **字段名**：snake_case，避免保留字。
- **索引名**：`idx_{表名}_{字段名}`，唯一索引 `uk_{表名}_{字段名}`。
- **外键名**：`fk_{表名}_{引用表名}`。

## 表设计

- **主键**：使用自增 INT/BIGINT 或 UUID，禁止业务字段做主键。
- **时间戳**：每张表必须包含 `created_at` 和 `updated_at`。
- **软删除**：使用 `deleted_at` 或 `is_deleted`，禁止物理删除业务数据。
- **字段注释**：每个字段必须有注释说明用途和取值范围。

## 查询规范

- **SELECT 显式列名**：禁止 `SELECT *`，只查询需要的字段。
- **索引使用**：WHERE、JOIN、ORDER BY 字段必须有索引，定期用 `EXPLAIN` 检查。
- **大表策略**：单表超过 1000 万行必须考虑分表/分区/归档。
- **批量操作**：IN 子句参数不超过 1000 个，大批量使用分批处理。

## 迁移规范

- **版本化**：所有 schema 变更通过迁移脚本执行（如 TypeORM migration、Flyway）。
- **可回滚**：每个迁移必须有 `up()` 和 `down()`。
- **数据安全**：生产环境迁移先备份，禁止直接 `DROP COLUMN`/`DROP TABLE`。
