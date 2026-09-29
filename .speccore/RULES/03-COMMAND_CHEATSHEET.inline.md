## 常用命令速查

```bash
speccore status                          # 当前迭代状态面板
speccore analyze --scope global --layer 1-4 # 全局层源码分析（四层推进，产物 .speccore/GLOBAL/）
speccore global from-source --src <dirs> # 全局层源码反推需求文档
speccore unitize --file <md路径> --iter <迭代名>   # 切分需求文档 → 功能单元（features/）
speccore analyze -I <迭代名> --auto      # 迭代层全量分析（产物 020-specs/）
speccore taskify -i <迭代名>             # 拆功能单元 → 开发任务（v8.3.231+ 替代 split）
speccore execute -i <迭代名> --all       # 执行所有任务
speccore verify                          # 测试验证（冒烟/回归）
speccore pr                              # 代码提交 + 创建 Pull Request

# ── run 快捷操作（v8.3.290+ 智能续跑 + 语法糖，高频操作不依赖 ask）──
speccore run                             # 无参 = 智能续跑：检测断点面板 + 软停，宿主 AI 经询问用户后按面板命令续跑
speccore run develop                     # preset 直呼
speccore run smoke                       # 单阶段快捷：从验证到部署（别名: split/smoke/code/tasks/ship/…）
speccore run split to execute            # 范围（自然语言式）；run split..execute 等价
speccore run "做用户积分功能"           # 一句话需求，从需求出发全流程
speccore run --demand deploy             # 逃生舱：显式声明是需求（需求文本恰为保留字时）
speccore analyze -g                      # 快捷糖：等价 speccore global analyze
speccore unitize prd.md                  # 文件位置参数；doc2spec prd.docx 同理
speccore verify deploy                   # 测试阶段位置参数（dev/pr/deploy/release）
```
