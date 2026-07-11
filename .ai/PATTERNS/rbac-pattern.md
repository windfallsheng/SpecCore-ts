# P-003: RBAC 权限模型

## 1. 适用场景
- 需要角色-权限分离管理的系统
- 需要接口级权限控制（`@PreAuthorize`）
- 需要动态分配用户角色

## 2. 技术栈锁定
- Spring Security + `@PreAuthorize` 注解
- 数据库表：`sys_role`、`sys_permission`、`sys_role_permission`、`sys_user_role`

## 3. 核心实现片段（可复用）

### 权限校验注解
```java
// Controller 层
@PreAuthorize("hasRole('ADMIN')")
@DeleteMapping("/roles/{id}")
public ApiResponse<Void> delete(@PathVariable Long id) { ... }

@PreAuthorize("hasAnyRole('ADMIN','EDITOR')")
@PostMapping("/reports/generate")
public ApiResponse<Void> generate(@RequestBody GenerateReq req) { ... }
```

### 角色删除保护
```java
public void deleteRole(Long roleId) {
    // 系统保护角色不可删除
    Role role = roleMapper.selectById(roleId);
    if ("admin".equals(role.getName()) || "user".equals(role.getName())) {
        throw new BusinessException(3003, "系统保护角色不可删除");
    }
    // 检查关联用户
    Long userCount = userRoleMapper.countByRoleId(roleId);
    if (userCount > 0) {
        throw new BusinessException(3002, "该角色下有关联用户，无法删除");
    }
    roleMapper.deleteById(roleId);
}
```

## 4. 踩坑记录

| 坑点 | 现象 | 解决方案 |
| :--- | :--- | :--- |
| 角色删除后用户权限不刷新 | 已登录用户仍拥有旧权限 | 删除角色后需清除关联用户的缓存 Token |
| `hasRole` vs `hasAnyRole` 混淆 | 权限校验不生效 | `hasRole('ADMIN')` 自动加前缀 `ROLE_`，注意大小写 |
| 权限树查询 N+1 问题 | 每次递归查库 | 一次查全量数据，内存中构建树 |

## 5. 复用 Checklist
- [ ] 确认 `@PreAuthorize` 已启用（`@EnableMethodSecurity`）
- [ ] 确认系统保护角色列表（admin / user）
- [ ] 确认删除角色时清除用户缓存 Token

---

| 版本 | 日期 | 变更说明 | 作者 |
| :--- | :--- | :--- | :--- |
| v1.0 | 2026-06-29 | 基于 Feature-004 权限管理沉淀 | AI-Assistant |
