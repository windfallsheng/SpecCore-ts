# P-002: 防暴力破解机制

## 1. 适用场景
- 登录接口需要防止暴力破解
- 验证码发送接口需要频率限制
- 任何需要基于用户标识（手机号/IP）计数的场景

## 2. 技术栈锁定
- Redis 7.0
- Spring Data Redis (`RedisTemplate`)

## 3. 核心实现片段（可复用）

### 失败计数与锁定
```java
@Service
public class LoginAttemptService {
    
    private static final int MAX_ATTEMPTS = 5;
    private static final int LOCK_DURATION_MINUTES = 15;
    private static final String KEY_PREFIX = "login:fail:";
    
    @Autowired
    private RedisTemplate<String, Integer> redisTemplate;
    
    /**
     * 检查是否已锁定
     */
    public boolean isLocked(String phone) {
        Integer attempts = redisTemplate.opsForValue().get(KEY_PREFIX + phone);
        return attempts != null && attempts >= MAX_ATTEMPTS;
    }
    
    /**
     * 获取剩余尝试次数
     */
    public int getRemainingAttempts(String phone) {
        Integer attempts = redisTemplate.opsForValue().get(KEY_PREFIX + phone);
        if (attempts == null) return MAX_ATTEMPTS;
        return Math.max(0, MAX_ATTEMPTS - attempts);
    }
    
    /**
     * 记录失败尝试
     */
    public void recordFailedAttempt(String phone) {
        String key = KEY_PREFIX + phone;
        redisTemplate.opsForValue().increment(key);
        redisTemplate.expire(key, Duration.ofMinutes(LOCK_DURATION_MINUTES));
    }
    
    /**
     * 登录成功后清除计数
     */
    public void clearAttempts(String phone) {
        redisTemplate.delete(KEY_PREFIX + phone);
    }
}
```

## 4. 踩坑记录（⚠️ 必读）

| 坑点 | 现象 | 解决方案 |
| :--- | :--- | :--- |
| Redis 不可用时接口熔断 | 正常用户无法登录 | 增加 `@Retryable` 重试机制，降级为"允许登录但不计数"，并记录监控告警 |
| 未设置 Key 过期时间 | 失败次数永久保留，用户永远被锁定 | 每次 `increment` 操作后必须设置 `expire` |

## 5. 复用 Checklist

- [ ] 确认 Redis 连接池配置正确
- [ ] 确认 `LOCK_DURATION_MINUTES` 值符合业务需求
- [ ] 实现 Redis 不可用时的降级策略
- [ ] 添加 Redis Key 的过期机制

---

| 版本 | 日期 | 变更说明 | 作者 |
| :--- | :--- | :--- | :--- |
| v1.0 | 2026-06-29 | 基于 Feature-001 用户登录沉淀 | AI-Assistant |
