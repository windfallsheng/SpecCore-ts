# 全局层目录索引

> 本文档是 `.ai/PROJECT/` 目录的索引，帮助 AI 和人快速定位信息。

## 1. 目录结构

```
.ai/PROJECT/
├── INDEX.md              # 本文件：目录索引
├── OVERVIEW.md           # 项目全景：背景、目标、范围
├── REQUIREMENT.md        # 项目级需求清单（功能索引）
├── ARCHITECTURE.md       # 项目级整体架构（跨期次）
├── TECH_STACK.md         # 技术栈详情
├── CODE_INDEX.md         # 代码索引：子工程、包结构
├── PROTOTYPE_INDEX.md    # 原型索引：设计稿位置
├── TEAM.md               # 团队与 Git 账号映射
└── GLOSSARY.md           # 项目术语表
```

## 2. 文件用途速查

| 我要找什么 | 看哪个文件 |
| :--- | :--- |
| 项目是做什么的 | `OVERVIEW.md` |
| 有哪些功能模块 | `REQUIREMENT.md` |
| 整体技术架构 | `ARCHITECTURE.md` |
| 用了什么技术栈 | `TECH_STACK.md` |
| 代码在哪 | `CODE_INDEX.md` |
| 设计稿在哪 | `PROTOTYPE_INDEX.md` |
| 团队成员 | `TEAM.md` |
| 术语定义 | `GLOSSARY.md` |

## 3. 与期次层的关联

| 全局层文件 | 期次层继承文件 |
| :--- | :--- |
| `ARCHITECTURE.md` | `期次-XXX/00-技术文档/ARCHITECTURE.md` |
| `REQUIREMENT.md` | `期次-XXX/00-需求文档/REQUIREMENT.md` |
| `CODE_INDEX.md` | `期次-XXX/00-期次总览/PROJECT_GRAPH.md` |

## 4. 维护原则

- 全局层文档由**架构师/产品经理**维护
- 变更全局层时，需在 `ITERATIONS/README.md` 中记录版本
- 全局层变更后，需评估对活跃期次的影响
