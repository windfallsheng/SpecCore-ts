# P-001: 用户认证与 JWT 生成模式

## 1. 适用场景
- 新项目需要用户登录功能
- 需要生成包含用户信息的 JWT Token
- 需要在拦截器中校验 Token 有效性

## 2. 技术栈锁定
- Spring Boot 3.2 + jjwt-api 0.11.5
- 密钥存储于环境变量 `JWT_SECRET`
- Token 有效期通过 `JWT_EXPIRATION` 环境变量控制

## 3. 核心实现片段（可复用）

### Token 生成
```java
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;

public String generateToken(Long userId, String role) {
    return Jwts.builder()
        .setSubject(userId.toString())
        .claim("role", role)
        .setIssuedAt(new Date())
        .setExpiration(new Date(System.currentTimeMillis() + 7200000))
        .signWith(getSignKey(), SignatureAlgorithm.HS256)
        .compact();
}
```

### Token 解析
```java
public Claims parseToken(String token) {
    return Jwts.parserBuilder()
        .setSigningKey(getSignKey())
        .build()
        .parseClaimsJws(token)
        .getBody();
}
```

### 签名密钥
```java
private Key getSignKey() {
    byte[] keyBytes = Decoders.BASE64.decode(
        System.getenv("JWT_SECRET")
    );
    return Keys.hmacShaKeyFor(keyBytes);
}
```

## 4. 踩坑记录（⚠️ 必读）

| 坑点 | 现象 | 解决方案 |
| :--- | :--- | :--- |
| 未处理 ExpiredJwtException | Token 过期时返回 HTTP 500 | 全局异常处理器增加统一捕获，返回 HTTP 401 和错误码 2001 |
| 密钥硬编码 | 安全审计不通过 | 从环境变量读取，生产环境使用强随机字符串 |
| jjwt 版本不兼容 | 0.11.x 与 0.9.x API 完全不同 | 统一锁定 jjwt-api 0.11.5 |

## 5. 复用 Checklist

- [ ] 修改 `JWT_SECRET` 环境变量（生产环境）
- [ ] 调整 `setExpiration` 过期时长（当前 2 小时）
- [ ] 确认全局异常处理器已捕获 `ExpiredJwtException`
- [ ] 确认拦截器已排除 `/api/v1/auth/login` 路径

---

| 版本 | 日期 | 变更说明 | 作者 |
| :--- | :--- | :--- | :--- |
| v1.0 | 2026-06-29 | 基于 Feature-001 用户登录沉淀 | AI-Assistant |
