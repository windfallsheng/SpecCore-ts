# SpecCore Agent 角色定义

本目录存放 SpecCore 的专用 Agent 角色定义。

## 设计原则

- **Agent 是角色，Skill 是能力**：Agent 定义"你是谁、做什么、不做什么"，Skill 定义"具体怎么做"
- **一个 Agent 专注一个领域**：不追求大而全，追求职责单一
- **Skill 引用 Agent**：Skill 文件开头引用所属 Agent，不重复定义角色

## Agent 列表

按优先级排序：

### P0 — 核心角色（必须）

| Agent | 职责 | 对应 Skill |
|:---|:---|:---|
| `spec-clarifier` | 需求澄清：识别模糊点、缺失信息、向用户提问 | （新角色，analyze 前置） |
| `spec-global-analyzer` | 全局源码分析：扫描工程、生成 GLOBAL/、提取 PATTERNS | spec-analyze（global 模式） |
| `spec-analyzer` | 迭代需求分析：读需求、识别功能模块、生成 Spec | spec-analyze, spec-split, spec-plan |
| `spec-executor` | 开发执行：按 Spec 生成代码、编写测试、交付 | spec-execute, spec-dev, spec-done, spec-pr |

### P1 — 质量保障（重要）

| Agent | 职责 | 对应 Skill |
|:---|:---|:---|
| `spec-gatekeeper` | 质量门禁：编译/测试/lint/Spec-代码一致性检查 | （新角色，execute 后置） |
| `spec-tester` | 测试专项：测试策略、用例生成、覆盖率评估 | （新角色，execute 内嵌） |
| `spec-reviewer` | 代码审查：对照 Spec 检查业务逻辑、边界、风险 | （已有，人工审查） |

### P2 — 运维增强（增值）

| Agent | 职责 | 对应 Skill |
|:---|:---|:---|
| `spec-knowledge-curator` | 知识沉淀：更新 PATTERNS/、GLOSSARY.md、RULES/ | （新角色，done 后置） |
| `spec-change-detector` | 变更感知：监听代码变更、分析影响范围 | spec-change |
| `spec-security-auditor` | 安全审计：漏洞扫描、敏感数据、鉴权矩阵 | （新角色，audit 命令） |

### P3 — 架构治理（长期）

| Agent | 职责 | 对应 Skill |
|:---|:---|:---|
| `spec-architect` | 架构守护：架构一致性、技术债务、演进建议 | （新角色，季度巡检） |

## Agent 协作流程

```
需求输入
  └── spec-clarifier（澄清）
        └── spec-global-analyzer（全局分析）
              └── spec-analyzer（迭代分析）
                    ├── spec-split（拆分）
                    └── spec-plan（计划）
                          └── spec-executor（执行）
                                ├── spec-tester（测试）
                                ├── spec-gatekeeper（门禁）
                                └── spec-reviewer（审查）
                                      └── spec-knowledge-curator（沉淀）

运维阶段
  └── spec-change-detector（变更感知）
        └── spec-security-auditor（安全审计）
              └── spec-architect（架构巡检）
```

## 与 Skill 的关系

```
Agent（角色定义）
  └── 调用 Skill（能力模块）
        └── 执行具体工作流程
```

## 注意事项

- Agent 不自动加载，需显式激活或引用
- Subagent 体系待 Qoder 支持后再扩展
- P0/P1 角色建议现在补齐，P2/P3 角色可逐步完善
