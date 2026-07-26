# 代码审查清单: Task-001 会议室管理服务

## 规范遵循
- [ ] 所有 Controller 方法返回 `Result<T>`
- [ ] 异常统一使用 `BusinessException`，禁止直接返回 null
- [ ] DTO 使用 JSR-303 校验（@NotBlank/@NotNull）
- [ ] Service 层使用接口+实现分离
- [ ] repository extends BaseMapper<Room>，无手写 SQL

## 代码质量
- [ ] 无重复代码（相同逻辑已抽取到公共方法）
- [ ] 方法长度 < 30 行（除表格生成代码）
- [ ] 日志记录: 所有写操作有 `log.info()` + 参数
- [ ] 无 System.out.println
- [ ] 变量命名符合宪法规范（camelCase）

## 安全
- [ ] 涉及 RBAC 的端点有 `@PreAuthorize` 注解
- [ ] 输入参数已防 SQL 注入（MyBatis-Plus 自动）
- [ ] 无敏感信息（密码/Token）出现在日志中

## 性能
- [ ] 列表查询使用分页（Page<Room>），无全量查询
- [ ] 列表查询 < 200ms
- [ ] 无 N+1 查询

## 测试
- [ ] 单元测试覆盖所有 AC
- [ ] 异常路径有测试用例
- [ ] 软删除逻辑有测试

---

| 检查人 | 日期 | 结果 | 签名 |
| :--- | :--- | :--- | :--- |
| — | | | |
