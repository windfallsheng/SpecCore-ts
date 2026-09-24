# 020-specs 目录结构契约

> 本文件由 CLI 自动维护，每次 analyze 骨架生成时刷新

## 分层说明

| 路径 | 性质 | 内容 |
| :--- | :--- | :--- |
| `overview/` | 索引类（全局） | FUNCTION_MAP / PLATFORMS / INTERACTION_MAP / API_CONTRACT / ARCHITECTURE / CLARIFY |
| `{功能单元}/overview/` | 内容类（单元级） | **CLARIFY.md = 澄清产物**；REQUIREMENT / ANALYSIS / TECH / RISK / DEPS / INTERACTION / MONITOR / BUSINESS_RULES = 分析产物 |
| `{功能单元}/{端名}/` | 内容类（端级） | TECH / TEST / UI_SPEC / DEV_GUIDE / API_CONTRACT（端级分析产物） |
| `requirements/` | 兼容目录（旧路径） | 文档级澄清的黄金需求，新项目不再生成 |

## 关键约定

- **澄清与分析不物理分层**：同一功能单元的澄清产物与分析产物共存于 `{功能单元}/overview/`，靠文件名区分（CLARIFY.md vs 其余）。
- **禁止把 overview/GLOBAL_CONTEXT-*.md、features/{单元}/_matrix.md 当功能单元**（它们是全局信息/元数据）。
- 实际目录以 CLI 生成为准，本文件为描述性契约而非机制。
