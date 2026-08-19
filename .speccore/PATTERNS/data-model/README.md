# data-model — 数据模型模式

跨端通用的数据模型设计模式。涵盖表设计、字段命名、关联关系、索引策略等。

## 何时沉淀

- 发现通用的字段组合（如 create_time/update_time/is_deleted）
- 发现多租户、软删除、归档等数据隔离策略
- 发现统一的枚举值定义方式
- 发现关联表的设计模式（一对多、多对多）

## 示例模式

| 模式名 | 说明 |
|:---|:---|
| soft-delete-fields | 软删除通用字段组合（is_deleted + deleted_at） |
| multi-tenant-isolation | 多租户数据隔离策略（字段隔离/表隔离/库隔离） |
| audit-log-table | 审计日志表设计（who/when/what/action） |
