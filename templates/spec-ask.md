---
name: spec-ask
description: SpecCore AI Router
---
## ⛔ 核心铁律
1. 用户说"重新/再/重跑"禁止用"未变/已完成"拒绝，可确认后执行
2. 分析结果必须落盘 020-specs/，禁止只输出聊天文字
3. 当用户说"全流程/自主完成/全自动"时，analyze 完成后**必须自动继续** split → plan → execute，不得中断等待

## 执行
1. Read .speccore/CONSTITUTION.md 和 context.json
2. Read .agents/skills/spec-ask/SKILL.md 获取完整规则
3. Execute: speccore ask "${1:描述你的需求}"

## v7.2.0+ 典型 ask 场景

### 全局分析场景
| 用户说法 | 触发的命令 |
|----------|-----------|
| "全局分析一下这个项目" | `speccore analyze --scope global` |
| "深度分析全局架构，带代码" | `speccore analyze --scope global --deep --with-code` |
| "全局深度分析 ARCHITECTURE.md，先出大纲" | `speccore analyze --scope global --deep ARCHITECTURE.md --iterative` |
| "只分析订单和支付模块" | `speccore analyze --scope global --filter "订单,支付"` |
| "全局分析，但只看后端" | `speccore analyze --scope global --filter "backend"` |

### 迭代分析场景
| 用户说法 | 触发的命令 |
|----------|-----------|
| "分析当前迭代需求" | `speccore analyze -I <current>` |
| "迭代深度分析 TECH.md" | `speccore analyze -I <current> --deep TECH.md` |
| "逐节分析 REQUIREMENT.md" | `speccore analyze -I <current> --deep REQUIREMENT.md --iterative` |
| "只分析用户认证模块，结合源码" | `speccore analyze -I <current> --filter "用户认证" --with-code` |
| "分析 TECH.md 中的订单模块" | `speccore analyze -I <current> --doc TECH.md --feature "订单模块" --with-code` |

### 任务级分析场景
| 用户说法 | 触发的命令 |
|----------|-----------|
| "分析 Task-001" | `speccore analyze --task Task-001` |
| "深度分析这个任务" | `speccore analyze --task <current> --deep` |
| "补充分析，代码有变动" | `speccore analyze -I <current> --supplement --with-code` |

### Pipeline 场景（全自动）
| 用户说法 | 触发的命令链 |
|----------|-------------|
| "全自动完成登录功能" | `analyze → split → plan → execute → pr → done` |
| "分析完自动拆分和计划" | `analyze → split → plan` |
| "深度分析订单模块然后开发" | `analyze --deep --filter "订单" → split → plan → execute` |

### 其他常用场景
| 用户说法 | 触发的命令 |
|----------|-----------|
| "查看项目状态" | `speccore dashboard` |
| "查看全局分析进度" | `speccore status --scope global` |
| "代码变更了重新分析" | `speccore analyze --supplement` |
| "生成开发指南" | `speccore analyze --dev-guide` |
| "知识图谱可视化" | `speccore knowledge` |
| "查询订单相关代码" | `speccore graph query "订单相关代码"` |
