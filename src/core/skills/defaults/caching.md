---
tags:
  - cache
  - redis
  - performance
  - memoization
---

# 缓存技能

## 缓存策略

| 策略 | 适用场景 | 缺点 |
|------|---------|------|
| Cache-Aside | 读多写少 | 首次读取慢 |
| Write-Through | 强一致性要求 | 写延迟增加 |
| Write-Behind | 高写入吞吐量 | 数据丢失风险 |
| Read-Through | 简化应用逻辑 | 缓存 miss 时延迟高 |

## Redis 最佳实践

1. **Key 命名空间**：`service:entity:id:field`，如 `user:profile:1234:email`
2. **TTL 设置**：根据数据变化频率设置合理过期时间
3. **序列化**：使用 JSON 或 MessagePack，避免存储对象引用
4. **连接池**：使用连接池管理 Redis 连接
5. **缓存穿透**：对不存在 key 设置空值缓存（短 TTL）
6. **缓存雪崩**：设置随机 TTL 偏移量

## 本地缓存

- Node.js：使用 `lru-cache` 或 `node-cache`
- 前端：使用 `React.memo`、`useMemo`、`useCallback`
- 限制：本地缓存仅存放热点数据，大小不超过 100MB
