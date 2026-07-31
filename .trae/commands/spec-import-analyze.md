# /spec-import-analyze — AI 反工程分析存量项目

读取 `speccore import` 生成的 ANALYSIS_PROMPT.md，深入源码倒推出完整需求、技术方案、编码规范。

## 执行步骤

### 1. 读取分析指引
```bash
cat .speccore/GLOBAL/PROJECTS/*/ANALYSIS_PROMPT.md
```

### 2. 逐 API 反推需求（REQUIREMENT.md + SCHEMA.md + TECH.md）

对每个 API 端点，**追溯完整调用链**：
1. 读 Controller → 理解入参和响应
2. 跳转 Service → 理解业务逻辑
3. 跳转 Repository/DAO → 理解数据模型
4. 读 Entity/Model → 提取字段、关系、约束
5. 填充 REQUIREMENT.md 的 `<!-- AI-ANALYZE -->` 标记
6. 生成 SCHEMA.md（数据模型文档）
7. 生成 TECH.md（技术方案骨架）

### 3. 提取编码规则（RULES/）

| 文件 | 扫描重点 |
| :--- | :--- |
| API_CONVENTIONS.md | URL 前缀/版本、响应格式、HTTP 方法使用 |
| EXCEPTION_HANDLING.md | 异常基类、@ControllerAdvice、错误码 |
| NAMING.md | 包结构、类名/方法名模式 |
| AUTH.md | JWT/Session/OAuth + 权限注解 |

### 4. 完善全局宪法（CONSTITUTION.md）

- 数据库选型 + ORM 框架
- 缓存策略（Redis/Caffeine）
- 日志规范（SLF4J/Logback）
- 消息队列（Kafka/RabbitMQ 如有）

### 5. 验证完成

在 REQUIREMENT.md 末尾追加完成标记并汇报摘要。
