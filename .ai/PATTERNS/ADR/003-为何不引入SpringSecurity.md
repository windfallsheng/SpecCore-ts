# ADR-003: 为何不引入 Spring Security

| 属性 | 值 |
| :--- | :--- |
| **状态** | ✅ 已采纳 |
| **决策日期** | 2026-06-30 |
| **决策者** | 架构团队 |
| **影响范围** | 项目架构设计 |
| **关联决策** | ADR-001（BCrypt）、ADR-002（Redis 防暴力破解） |

---

## 上下文（Context）

在 Feature-001（用户登录）开发时，面临是否引入 Spring Security 全家桶的选择。Spring Security 提供了完整的认证和授权框架，但也带来了较高的配置复杂度和学习成本。

## 决策（Decision）

**不引入 Spring Security，使用以下轻量方案替代：**

1. **密码加密**：直接使用 Spring Security 的 `BCryptPasswordEncoder`（仅依赖 `spring-security-crypto` 模块）。
2. **JWT 认证**：使用 `jjwt` 库自行实现 Token 生成和校验，配合自定义拦截器。
3. **权限控制**：通过 `@PreAuthorize` 注解（后续可按需引入 `spring-security-config`）。

## 理由（Rationale）

1. **控制粒度**：自建拦截器可以根据 `TASK.md` 的精确需求定制认证逻辑，不受 Spring Security 默认行为约束。
2. **调试友好**：Spring Security 的过滤器链在调试时极难追踪，自定义拦截器链路清晰透明。
3. **渐进式引入**：当项目权限需求复杂到需要 RBAC/ABAC 时，可以再按需引入 Spring Security，迁移成本可控。
4. **减少依赖**：避免引入全家桶带来的版本兼容问题和启动时间增加。

## 被拒绝的方案（Rejected Alternatives）

| 方案 | 拒绝理由 |
| :--- | :--- |
| **Spring Security 全家桶** | 配置复杂，Filter Chain 调试困难，对团队学习成本高 |
| **Shiro** | 社区活跃度下降，Spring Boot 3 集成支持不足 |
| **完全不引入任何认证框架** | 安全性不足，无行业标准 |

## 影响（Consequences）

- **正向影响**：
  - 认证逻辑完全可控，调试链路清晰。
  - 项目启动时间更短，依赖更少。
- **负面影响**：
  - 需自行实现 Token 刷新、多设备登录互踢等高级功能。
  - 当权限模型变复杂时，需重新评估是否引入 Spring Security。

## 后续演进（Future Considerations）

- 当项目需要 ABAC（基于属性的访问控制）或 OAuth2 时，重新评估引入 Spring Security。
- 当前方案预留了 `@PreAuthorize` 注解的使用空间，后续可平滑迁移。

## 关联决策

- ADR-001: 密码加密选择 BCrypt（协同工作）
- ADR-002: Redis 防暴力破解方案（协同工作）
