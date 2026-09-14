# 全局分析质量规范（v8.3.62+）

> 以下规范为框架级约束，具体执行要求见 analyze 命令 Prompt。

## 分层执行原则

- **全局分析必须按 4 层递进执行**，禁止跳过任何一层
- 每层完成后**必须自检**，不通过需补全后再进入下一层
- Layer 4 拆分为 4a(产品文档) → 4b(技术核心) → 4c(技术扩展) → 4d(各端技术) 子步骤执行

## 产出目录结构与文档清单

全局分析产出位于 `.speccore/GLOBAL/`，必须生成以下文档：

```
.speccore/GLOBAL/
├── platforms/                          ← Layer 1/2/3/4d
│   ├── {端名}/
│   │   ├── _INDEX.md                   ← Layer 1: 端索引（≥80行）
│   │   ├── modules/
│   │   │   └── *.md                    ← Layer 3: 功能模块深入文档
│   │   └── [Layer 4d 各端技术文档]
│   └── _shared/
│       ├── _ASSOCIATION.md             ← Layer 2: 跨端关联（≥100行）
│       └── _MODULES.md                 ← Layer 2: 功能模块清单（≥50行）
├── requirements/                       ← Layer 4a
│   ├── REQUIREMENT.md                  ← 全局需求总纲（≥500行）
│   └── {前端端名}/
│       └── REQUIREMENT.md              ← 各端产品视角需求（≥500行）
├── overview/                           ← Layer 4b/4c
│   ├── ARCHITECTURE.md                 ← 4b: 系统架构（≥200行）
│   ├── FUNCTION_MAP.md                 ← 4b: 功能映射（≥50行）
│   ├── API_CONTRACT.yaml               ← 4b: 接口契约
│   ├── INTERACTION_MAP.md              ← 4b: 交互时序（≥50行）
│   ├── SECURITY_AUDIT.md               ← 4c: 安全审计（≥80行）
│   ├── PERFORMANCE_BASELINE.md         ← 4c: 性能基线（≥80行）
│   ├── DATA_FLOW.md                    ← 4c: 数据流转（≥150行）
│   ├── DEPLOYMENT.md                   ← 4c: 部署架构（≥100行）
│   └── CONSISTENCY_CHECK.md            ← 4c: 一致性检查（≥50行）
└── PATTERNS/                           ← 可选: 真正独特且可复用的设计模式
    └── {端名}/
        └── {kebab-case模式名}.md
```

**Layer 4d 各端技术文档**（按端类型区分）：
- **后端端**（匹配 `service|server|api|backend`）:
  - `API_INVENTORY.md`（≥150行）
  - `DATA_MODEL.md`（≥100行）
  - `BUSINESS_RULES.md`
- **前端端**（所有非后端端）:
  - `UI_FLOW.md`（≥100行）
  - `API_CALL_MAP.md`（≥80行）
  - `STATE_MANAGEMENT.md`（≥80行）

## 产出文件最小内容标准

- **所有 Markdown 产出文件必须达到最小行数要求**，严禁生成空壳/占位文档
- **所有技术文档必须包含 Mermaid 图表**，图表语法必须正确可渲染
- **需求文档必须按端类型差异化撰写**，严禁一套模板改端名复用
- **多端项目必须标注功能一致性要求和差异化策略**

## 质量自检要求

- 每层分析完成后，AI 必须执行自检 Checklist
- 自检不通过时，必须补充完善后再提交
- CLI 执行后置校验：文件存在性、行数达标、章节完整

## 质量门禁拦截（v8.3.62+）

- **全局分析 `--apply` 写入后，CLI 自动运行质量门禁**
- **存在严重错误（error）时，自动拦截并输出修复 Prompt**，禁止进入下一层
- **AI 必须修复所有 error 后才能继续**，不能跳过
- 修复方式：读取问题文档 → 补充内容 → `speccore analyze --apply '{"文件路径":"修正内容"}' --scope global` 重新写入
