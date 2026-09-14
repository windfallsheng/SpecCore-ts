# 迭代层分析强制约束

## 产出目录结构与文档清单

迭代层分析产出位于 `Iteration-NNN/020-specs/` 和 `Task-NNN/00-specs/`，必须生成以下文档：

```
Iteration-NNN/020-specs/
├── overview/                          ← [AI生成] 迭代级全局规格
│   ├── REQUIREMENT.md                 ← 迭代专属需求
│   ├── ANALYSIS.md                    ← 综合分析
│   ├── TECH.md                        ← 技术规格
│   ├── DEV_GUIDE.md                   ← 开发指南
│   └── DEPS.md                        ← 依赖分析
├── {功能模块}/                        ← [AI生成] 按功能模块组织
│   └── {端名}/                        ← [AI生成] 端级规格
│       ├── TECH.md                    ← 技术规格
│       ├── TEST.md                    ← 测试用例
│       ├── UI_SPEC.md                 ← UI 规格（仅前端）
│       └── DEV_GUIDE.md               ← 开发指南
└── requirements/                      ← [AI生成] 黄金需求（clarify 输出）
    └── *.md

Task-NNN/00-specs/                     ← [AI生成] 模块级核心规格
├── REQ.md                             ← 需求规格
├── TECH.md                            ← 技术规格
├── SCHEMA.md                          ← 数据模型（条件创建）
├── CHANGELOG.md                       ← 变更记录
└── CONTEXT.md                         ← 任务上下文
```

## 产出文档完整性

- **每端必须输出 4 份文档**：`TECH.md` + `TEST.md` + `UI_SPEC.md` + `DEV_GUIDE.md`，缺一不可
- **禁止输出空表格** — 每个 Markdown 表格必须有至少 1 行数据，只有表头的表格视为未完成
- **禁止输出占位符** — 不允许写「待填充」、「TODO」、「...」、「xxx」等占位内容
- **自检规则**：生成完成后检查每个文档，如果仍含 `<!-- SPEC-SKELETON -->` 或空表格只有表头 → 必须重新填充

## DEV_GUIDE.md 最低标准

- 改造范围表格 ≥ 3 行（具体到文件/目录路径）
- 实施步骤 ≥ 3 步（按依赖排序，具体到文件/函数级）
- 验证方式表格 ≥ 3 行（可执行的命令/操作 + 通过标准）
- 坑点 ≥ 2 条

## 其他文档要求

- **MONITOR.md**：必须按 Fatal/Critical/Warning/Info 四级定义告警规则，不能只列指标名称
- **REVIEW.md**：安全检查必须逐接口列出鉴权需求，不能笼统写"需要鉴权"
