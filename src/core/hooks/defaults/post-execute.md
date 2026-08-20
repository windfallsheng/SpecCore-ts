# post-execute 钩子

> 在 `speccore execute` 执行后触发

## 检查项

- [ ] 代码编译是否通过
- [ ] 测试是否全部通过
- [ ] 质量门禁是否达标
- [ ] 文档是否同步更新

## 自动操作

```
if (compileFailed) {
  BLOCK: 代码编译失败，请修复后重新执行
}

if (testFailed) {
  WARN: 测试未全部通过，请检查测试用例
}
```
