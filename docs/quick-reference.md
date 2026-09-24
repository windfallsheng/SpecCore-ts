# SpecCore 速查表

> 常用命令 + 安全规则 + CI 模板 —— 一页看完。

---

## 🔧 CLI 命令（speccore 前缀，终端安全）

```bash
speccore init                         # 初始化项目
speccore iteration create --name=<n>  # 创建迭代
speccore task new --platforms=web,h5  # 创建多端任务
speccore validate                     # 合规检查
speccore dashboard                    # 查看进度
speccore update -t T-001 --status=completed  # 更新状态
speccore sync                         # 反向同步 @spec → TASK.md
speccore diff --source=A --target=B   # 对比迭代
speccore track --req=REQ-001          # 全链路追溯
speccore delete -t Task-005           # 安全删除（回收站 + 清理引用）
speccore search "payment"             # 跨 Spec 搜索
speccore unitize -f <md> -i <迭代名>   # 切分需求文档 → 功能单元（features/）
speccore taskify -i <迭代名>           # 拆功能单元 → 开发任务
```

> 🔄 回退重跑（v8.3.275+）：重分析 `analyze --unit X --apply`（覆盖+备份）；重拆 `taskify --modules "模块A"`（旧任务自动备份 .backup-*，其余保留）；重切 `unitize --on-duplicate overwrite|rename`（同名单元三选一）。

## 🔒 AI 命令（在 AI IDE 中用 @spec-ask：WorkBuddy/Cursor/Trae）

```bash
@spec-ask "execute all tasks with batch size 3"
@spec-ask "analyze Q1 requirements"
@spec-ask "plan execution schedule"
@spec-ask "create PR for Task-001"
@spec-ask "archive completed tasks"
```

## 📁 文件安全规则

```
✅ 安全（直接编辑）      ❌ 危险（用命令）
REQ.md  需求             PROJECT_GRAPH.md 表格
TECH.md 设计             .task-type 类型
*.md    注释             API_CONTRACT.yaml API
                         .json 数据文件
⚠️ 谨慎（编辑后同步）
GLOBAL/REQUIREMENT.md → speccore sync --global
```

## 🏗️ 工作空间

```
workspace/
├── spec-project/       ← Spec 仓库（独立）
├── my-backend/         ← 代码仓库（同级）
│   └── .codebuddy/commands → ../spec-project/.codebuddy/commands
└── my-frontend/
```

## 📊 CI/CD

```yaml
# .github/workflows/speccore-ci.yml
- run: npm install -g speccore
- run: speccore validate --all
- run: speccore doctor
```

## 🔗 关键链接

- [SDD 方法论](sdd-methodology.md)
- [快速开始](quick-start.md)
- [命令参考](command-reference.md)
- [使用指南](usage-guide.md)
- [工作空间布局](workspace-organization.md)
