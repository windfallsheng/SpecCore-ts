# pre-execute 钩子

> 在 `speccore execute` 执行前触发

## 检查项

- [ ] 当前分支是否为任务分支（feature/Task-XXX）
- [ ] 代码基线是否与迭代最新状态一致
- [ ] 相邻任务的接口契约是否已确认
- [ ] 是否有未提交的本地变更

## 自动操作

```
if (branch !== 'feature/{taskId}') {
  BLOCK: 当前分支不是任务分支，请先切换到正确的任务分支
}
```
