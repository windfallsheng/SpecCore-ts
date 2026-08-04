---
name: speccore
description: SpecCore v5.24 spec-driven development CLI. AI-enhanced analysis, smart task splitting, per-platform requirements, STAFFING management, multi-branch support.
version: 5.24.0
triggers:
  - speccore
  - spec
  - 需求分析
  - 任务拆分
  - 迭代管理
  - 期次
---

# SpecCore Skill

## Workflow
init → iteration create → doc2spec → analyze → split → plan → execute → pr → done

## Key Commands
| Command | Purpose |
|---------|---------|
| `speccore init` | Initialize project (auto-detect git + project info) |
| `speccore analyze --scope global --src dir1,dir2` | Global analysis with TECH_STACK detection |
| `speccore analyze -I Q1` | AI analysis (reads 00-产品需求/ per-platform) |
| `speccore iteration split -i Q1 --interactive` | Smart split (complexity + STAFFING + deps) |
| `speccore execute -i Q1 --all` | Execute with auto-branch + dependency-aware |
| `speccore status-panel` | Dashboard with team details |

## Directory (v5.24)
```
项目/
├── .speccore/CONSTITUTION.md (auto-detected)
└── 期次-Q1/
    ├── STAFFING.md
    ├── 00-产品需求/ (APP/H5/小程序/管理后台/_shared)
    ├── 00-需求文档/ (ANALYSIS+TECH+TEST+...)
    └── Task-001/ (含优先级+工时+负责人+复杂度)
```
