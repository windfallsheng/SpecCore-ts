---
tags:
  - log
  - logging
  - monitoring
  - observability
---

# 日志技能

## 结构化日志

所有日志必须使用结构化格式（JSON），包含以下字段：

```json
{
  "timestamp": "2024-01-01T00:00:00.000Z",
  "level": "info|warn|error|debug",
  "service": "user-service",
  "traceId": "uuid",
  "message": "用户登录成功",
  "context": { "userId": "123", "ip": "1.2.3.4" },
  "duration": 45
}
```

## 日志级别使用规范

- **ERROR**：系统异常、业务失败（需要立即处理）
- **WARN**：潜在问题、降级处理（需要关注）
- **INFO**：关键业务流程节点（正常记录）
- **DEBUG**：详细调试信息（仅开发环境）

## 禁止

- 不记录密码、Token、身份证号等敏感信息
- 不在循环中大量打印日志
- 不记录二进制数据或大对象
