```markdown
 # P-001: 用户认证与JWT生成模式

## 适用场景
新项目需要用户登录功能

## 核心实现片段
 ```java
 public String generateToken(Long userId) {
     return Jwts.builder()
         .setSubject(userId.toString())
         .signWith(getSignKey(), SignatureAlgorithm.HS256)
         .compact();
 }
```


