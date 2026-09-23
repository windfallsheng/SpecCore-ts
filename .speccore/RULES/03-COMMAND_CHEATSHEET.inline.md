## 常用命令速查

```bash
speccore status                          # 当前迭代状态面板
speccore global analyze --layer 1-4      # 全局层源码分析（四层推进，产物 .speccore/GLOBAL/）
speccore global from-source --src <dirs> # 全局层源码反推需求文档
speccore unitize --file <md路径> --iter <迭代名>   # 切分需求文档 → 功能单元（features/）
speccore analyze -I <迭代名> --auto      # 迭代层全量分析（产物 020-specs/）
speccore taskify -i <迭代名>             # 拆功能单元 → 开发任务（v8.3.231+ 替代 split）
speccore execute -i <迭代名> --all       # 执行所有任务
speccore verify                          # 测试验证（冒烟/回归）
speccore pr                              # 代码提交 + 创建 Pull Request
```
