# SpecCore 框架配置

> 修改后，AI 将在下一次执行命令时自动生效。

---

## 1. 执行人追踪（Assignee Tracking）

| 配置项 | 可选值 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `assignee.enabled` | `true`/`false` | `true` | 是否启用执行人追踪 |
| `assignee.mode` | `strict`/`loose`/`off` | `loose` | 强制程度 |

### 模式说明
| 模式 | 行为 |
| :--- | :--- |
| **`strict`** | 校验执行人与 Git 提交者，不一致时阻断命令执行 |
| **`loose`** | 自动填写 Git 提交者，仅发出警告（推荐） |
| **`off`** | 不读取、不校验、不推荐任何人 |

## 2. 双向追溯配置

| 配置项 | 可选值 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `trace.enabled` | `true`/`false` | `true` | 是否启用双向追溯 |
| `trace.auto_annotate` | `true`/`false` | `true` | 生成代码时是否自动添加 @spec 注释 |

## 3. 其他配置

| 配置项 | 可选值 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `archive.auto_cleanup` | `true`/`false` | `false` | 归档时是否自动清理未使用的资源 |
| `plan.parallel_suggest` | `true`/`false` | `true` | 是否自动推荐并行开发策略 |
| `validation.strict_mode` | `true`/`false` | `false` | 合规性检查是否为严格模式 |
| `sync.auto_check` | `true`/`false` | `true` | 开发完成后是否自动检查反向同步 |
| `review.check_assignee` | `true`/`false` | `false` | 审查时是否检查执行人签名 |

## 4. 配置变更记录

| 日期 | 变更项 | 旧值 | 新值 | 变更人 |
| :--- | :--- | :--- | :--- | :--- |
