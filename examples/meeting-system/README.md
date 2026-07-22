# MeetBook — 会议预订系统 SpecCore E2E 验证项目

## 文件清单

```
examples/meeting-system/
├── README.md                         本文件
├── INDEX.md                          4 端 → 文件映射
├── docs/
│   ├── PRD-会议室预订系统v1.0.md       专业产品需求文档 (310行)
│   └── CR-需求变更v1.0→v1.1.md         需求变更文档 (模拟上线后变更)
├── prototype-admin.html              Web 管理端交互原型
└── prototype-h5.html                 H5 移动端交互原型
```

## PRD 关键数据

| 维度 | v1.0 | v1.1 (变更后) |
| :--- | :--- | :--- |
| 端 | 4 (管理端+H5+2服务) | 4 |
| API | 27 | 36 (+9) |
| 数据表 | 4 | 4 (3 表有 ALTER) |
| 非功能需求 | 5 项 | 5 项 |

## SpecCore 验证流程

### 第一轮：v1.0 完整流程

```bash
cd examples/meeting-system

# 1. 初始化项目
speccore init

# 2. 导入 PRD（4端）
speccore word2spec --files "docs/PRD-会议室预订系统v1.0.md=后台管理端" --iteration Q1
speccore word2spec --files "docs/PRD-会议室预订系统v1.0.md=H5移动端" --iteration Q1
speccore word2spec --files "docs/PRD-会议室预订系统v1.0.md=会议室管理服务" --iteration Q1
speccore word2spec --files "docs/PRD-会议室预订系统v1.0.md=预订订单服务" --iteration Q1

# 3. 智能引导
speccore dev                          # → 检测阶段，提示 analyze

# 4. 需求分析（含宪法检查）
speccore analyze --iteration=001-Q1
# → 期望: 检测到 27 个 API、4 张表、RBAC 权限

# 5. 拆分任务
speccore iteration split --iteration=001-Q1
# → 期望: 生成 8~12 个 Task，每个含 7+1 文件，IMPACT.md + .env
# → 风险: 用户管理=🔴(权限) 预订=🟢(CRUD)

# 6. 开发执行
speccore dev --force                  # 级联执行
# 或逐个:
speccore execute --task=Task-001 --force

# 7. 检查产物
speccore status-panel                 # 状态面板
ls 期次-001-Q1/Task-001-*/backend/    # 验证 7+ 文档
```

### 第二轮：需求变更验证

```bash
# 模拟 v1.1 需求变更
speccore word2spec --files "docs/CR-需求变更v1.0→v1.1.md=预订订单服务" --iteration Q2
speccore word2spec --files "docs/CR-需求变更v1.0→v1.1.md=后台管理端" --iteration Q2

# 分析变更影响
speccore analyze --iteration=002-Q2
# → 期望: 检测到 9 个新增 API、3 张表 ALTER

# 查看变更追踪
speccore tracker
# → 期望: 显示 v1.0→v1.1 的需求变更历史

# 拆分 + 执行（变更任务）
speccore iteration split --iteration=002-Q2
speccore execute --task=Task-001 --force
```

### 第三轮：高级功能验证

```bash
# 智能入口
speccore spec "新增会议室审批流程"    # → 识别为 new_task
speccore spec "修复预订冲突检测bug"   # → 识别为 bugfix

# Agent 模式（输出上下文给外部 AI）
speccore execute --task=Task-001 --agent=trae
speccore execute --task=Task-001 --agent=copilot

# 状态面板
speccore status-panel

# 合并检查
speccore merge-check --iteration=001-Q1

# 风险文档
cat 期次-001-Q1/Task-001-*/backend/TASK.md | grep -A20 "## 风险评估"
```

## 期望验证点

- [x] word2spec 正确解析 4 端 PRD
- [ ] analyze 检测 27 个 API + 宪法规则
- [ ] split 生成 8+ Task，每 Task 7+1 文件
- [ ] IMPACT.md 含风险评分
- [ ] .env.example 自动生成
- [ ] CONSTITUTION 自动检测技术栈
- [ ] dev 正确检测阶段并引导
- [ ] execute 批量执行成功
- [ ] merge-check 正常显示
- [ ] rollout 回滚正常
- [ ] tracker 变更追踪正常
