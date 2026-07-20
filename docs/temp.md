```
模式沉淀：在每个 Feature 的 TASK.md 末尾记录经验

### 踩坑记录
- ⚠️ 坑点: 未处理 ExpiredJwtException，返回HTTP 500
- ✅ 解决: 全局异常处理器统一捕获，返回HTTP 401
- 📝 下次: 所有认证接口需检查 JWT 过期处理
```