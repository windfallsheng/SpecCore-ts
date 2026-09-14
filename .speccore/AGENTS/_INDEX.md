# AGENTS 注册表

> 本文件定义各命令/阶段下激活的 Agent 列表。
> 新增角色后，在本文件中添加一行即可挂载到对应流程。

---

## analyze / clarify

| 角色 | 优先级 | 条件 | 说明 |
|------|--------|------|------|
| product-analyst | 100 | — | 业务流程完整性、遗漏识别、术语统一 |
| interaction-designer | 90 | — | 交互状态矩阵、前后端一致性、用户路径（叠加 RULES/ 技术栈交互约束） |
| security-reviewer | 70 | project.securityLevel > 2 | 需求中的安全风险预判（叠加 RULES/ 技术栈安全规则） |

## analyze / confirm-check

| 角色 | 优先级 | 条件 | 说明 |
|------|--------|------|------|
| product-analyst | 100 | — | 最终确认清单 |

## split / default

| 角色 | 优先级 | 条件 | 说明 |
|------|--------|------|------|
| task-decomposer | 100 | — | 任务拆分专家 |
| dependency-analyst | 90 | — | 依赖关系分析（叠加 RULES/ 技术栈依赖模式） |
| effort-estimator | 70 | — | 工时估算 |

## plan / default

| 角色 | 优先级 | 条件 | 说明 |
|------|--------|------|------|
| schedule-planner | 100 | — | 排期规划 |
| risk-assessor | 90 | — | 风险评估 |

## execute / quality-gate

| 角色 | 优先级 | 条件 | 说明 |
|------|--------|------|------|
| compiler | 100 | — | 编译可行性检查（叠加 RULES/ 技术栈构建规则） |
| test-engineer | 90 | — | 单元测试执行与覆盖率（叠加 RULES/ 技术栈测试规范） |
| security-reviewer | 80 | — | 安全漏洞扫描（叠加 RULES/ 技术栈安全规则） |
| performance-expert | 50 | — | 性能回归检测（叠加 RULES/ 技术栈性能规范） |
| doc-sync-agent | 40 | — | 文档与实际代码一致性（叠加 RULES/ 技术栈文档格式） |

## change / impact

| 角色 | 优先级 | 条件 | 说明 |
|------|--------|------|------|
| impact-analyst | 100 | — | 变更影响范围分析（叠加 RULES/ 技术栈模块结构） |
| regression-tester | 80 | — | 回归测试范围（叠加 RULES/ 技术栈测试策略） |

## pr / review

| 角色 | 优先级 | 条件 | 说明 |
|------|--------|------|------|
| code-reviewer | 100 | — | 代码质量审查（叠加 RULES/ 技术栈编码规范） |
| security-reviewer | 90 | — | 安全审查（叠加 RULES/ 技术栈安全规则） |
| test-reviewer | 80 | — | 测试完整性审查（叠加 RULES/ 技术栈测试规范） |

## audit / default

| 角色 | 优先级 | 条件 | 说明 |
|------|--------|------|------|
| security-reviewer | 100 | — | 安全审计（叠加 RULES/ 技术栈安全规则） |
| compliance-checker | 90 | project.industry == 'finance' | 合规检查（金融行业） |
| performance-expert | 70 | — | 性能基线审计（叠加 RULES/ 技术栈性能规范） |
