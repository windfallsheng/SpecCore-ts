# SDD 框架配置文件

> 本文档控制框架中各功能的启用/禁用及强制程度。
> 修改后，AI 将在下一次执行命令时自动生效。

---

## 1. 执行人追踪（Assignee Tracking）

控制任务执行人与 Git 提交者的关联校验。

| 配置项 | 可选值 | 说明 | 默认值 |
| :--- | :--- | :--- | :--- |
| `assignee.enabled` | `true` / `false` | 是否启用执行人追踪功能 | `true` |
| `assignee.mode` | `strict` / `loose` / `off` | 强制程度 | `loose` |

### 模式说明
| 模式 | 行为 | 适用场景 |
| :--- | :--- | :--- |
| **`strict` (严格)** | 自动校验执行人与 Git 提交者，不一致时**阻断**命令执行 | 正式团队，需要精确追溯 |
| **`loose` (宽松)** | 自动填写 Git 提交者，仅发出警告，允许用户忽略 | **推荐**，适用于大多数团队 |
| **`off` (关闭)** | 不读取、不校验、不推荐任何人 | 个人项目、快速原型 |

## 2. 其他可配置功能

| 配置项 | 可选值 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `archive.auto_cleanup` | `true` / `false` | `false` | 归档时是否自动清理未使用的资源 |
| `plan.parallel_suggest` | `true` / `false` | `true` | 是否自动推荐并行开发策略 |
| `validation.strict_mode` | `true` / `false` | `false` | 合规性检查是否为严格模式 |
| `sync.auto_check` | `true` / `false` | `true` | 开发完成后是否自动检查是否需要反向同步 |
| `review.check_assignee` | `true` / `false` | `false` | 审查时是否检查执行人签名 |

## 3. 配置变更记录

| 日期 | 变更项 | 旧值 | 新值 | 变更人 |
| :--- | :--- | :--- | :--- | :--- |
