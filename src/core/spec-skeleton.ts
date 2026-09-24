/**
 * spec-skeleton — 骨架优先架构核心模块 (v8.0.0+)
 *
 * 设计原则：CLI 预创建所有文件骨架（含占位内容），AI 只覆盖内容，不决定路径。
 * 从根本上消除"AI 写错文件位置"的问题。
 *
 * 对比旧架构：
 *   旧: CLI → prompt → AI 决定内容+路径 → sanitize 事后清理（永远不完整）
 *   新: CLI → 预创建骨架 → AI 覆盖内容 → 文件已在正确位置（不需要清理）
 */
import { join, dirname } from 'path';
import { pathExists, ensureDir, readFile, writeFile, readdir, remove } from 'fs-extra';
import { GLOBAL_SPECS_DIR } from './spec-paths';
import { isTimestampBackup } from '../utils/task-utils';
import { logger } from '../utils/logger';

// ================================================================
// 常量
// ================================================================

/** 骨架标记 — 用于检测文件是否仍为占位状态 */
export const SKELETON_MARKER = '<!-- SPEC-SKELETON -->';

/** 判断是否为后端平台（用于骨架模板差异化） */
function isBackendPlatform(platform: string): boolean {
  return platform === 'backend' || platform.startsWith('后台') || platform.includes('服务') || /-(service|api|server|backend)$/i.test(platform);
}

// ================================================================
// 类型定义
// ================================================================

export interface SpecFileEntry {
  /** 相对 020-specs/ 的路径，如 "overview/ANALYSIS.md" */
  relPath: string;
  /** 分类：overview（全局）或 platform（端专属） */
  category: 'overview' | 'platform';
  /** 端名（仅 platform 类） */
  platform?: string;
  /** 文件名 */
  docName: string;
  /** 占位内容（含写作指引） */
  placeholder: string;
}

export interface SkeletonResult {
  /** 新创建的骨架文件 */
  created: string[];
  /** 已存在（保留原内容） */
  skipped: string[];
}

export interface ProgressResult {
  /** 已填充（非骨架） */
  filled: string[];
  /** 仍为骨架 */
  unfilled: string[];
  /** 下一个需要生成的 entry */
  nextUnfilled: SpecFileEntry | null;
  /** 已填充数 */
  filledCount: number;
  /** 总数 */
  totalCount: number;
}

// ================================================================
// Phase 1 文档清单（overview/ 全局文档）
// ================================================================

const PHASE1_DOCS: { name: string; buildPlaceholder: (iter: string) => string }[] = [
  {
    name: 'REQUIREMENT.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# 需求规格

> 迭代: ${iter} | 生成: 待填充

## 写作要求
基于 010-requirements/ 下的需求文档，整理本迭代的功能模块清单。
- 每个功能模块必须标注「涉及端」
- 列出验收标准
- 标注优先级（P0/P1/P2）
`,
  },
  {
    name: 'ANALYSIS.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# 需求分析

> 迭代: ${iter} | 生成: 待填充

## 写作要求
基于需求文档和源码审计，分析本迭代的功能点清单。
- 按优先级分节（P0 必修 / P1 应修 / P2 建议）
- 每个功能点标注编号（F-01, F-02...）和涉及端
- 列出接口变更和数据库变更
`,
  },
  {
    name: 'TECH.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# 技术架构（跨端全局）

> 迭代: ${iter} | 生成: 待填充

## 写作要求
基于源码和依赖分析，描述本迭代的整体技术架构。
- 整体架构图
- 跨端交互（调用方 → 被调方、协议）
- 中间件选型
- 数据库设计（表/字段/索引）
`,
  },
  {
    name: 'DEPS.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# 依赖清单

> 迭代: ${iter} | 生成: 待填充

## 写作要求
列出本迭代涉及的内部服务依赖和外部第三方依赖。
`,
  },
  {
    name: 'RISK.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# 风险评估

> 迭代: ${iter} | 生成: 待填充

## 写作要求
| 风险 | 可能性 | 影响 | 缓解措施 |
|:---|:---|:---|:---|
| | | | |

## 回滚方案
1. 触发条件: _待定_
2. 回滚步骤: _待定_
`,
  },
  {
    name: 'REVIEW.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# Code Review 清单

> 迭代: ${iter} | 生成: 待填充

## 检查项
- [ ] 参数校验完整性
- [ ] 幂等性处理
- [ ] 索引覆盖
- [ ] 迁移脚本可回滚
- [ ] 鉴权配置
- [ ] 日志规范
`,
  },
  {
    name: 'MONITOR.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# 监控指标

> 迭代: ${iter} | 生成: 待填充

## 业务指标
| 指标 | 阈值 | 级别 |
|:---|:---|:---|
| 成功率 | <99.9% | P1 |
| P99延迟 | >1000ms | P2 |

## 告警规则
| 规则 | 条件 | 通知 |
|:---|:---|:---|
| | | |
`,
  },
  {
    name: 'FUNCTION_MAP.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# 功能模块清单

> 迭代: ${iter} | 生成: 待填充

## 写作要求
列出本迭代所有功能模块及其涉及端，供 taskify 命令作「功能×端映射」参考。
> 功能单元的权威来源是 010-requirements/features/ 目录（unitize 产出），本文件仅作映射补充。

| # | 功能模块 | 涉及端 | 优先级 | 来源 |
|:---|:---|:---|:---|:---|
| | | | | |
`,
  },
  {
    name: 'INTERACTION_MAP.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# 跨端交互图谱

> 迭代: ${iter} | 生成: 待填充

## 写作要求
按功能单元组织，展示完整的跨端交互时序。
- 每个功能单元一个 Mermaid sequenceDiagram
- 标注接口路径和调用关系
- 附接口契约索引表
`,
  },
  {
    name: 'DEPENDENCY_MAP.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# 功能依赖图

> 迭代: ${iter} | 生成: 待填充

## 写作要求
列出功能单元之间的依赖关系（谁依赖谁），供 taskify/plan 排执行顺序：
- 每个功能单元一行：依赖的前置功能 + 被依赖的下游功能
- 跨功能共享契约（API/数据模型）在此标注
- 供 030-tasks 的 _shared/CONTEXT.md 与 execute 上下文组装引用
`,
  },
  {
    name: 'DEV_GUIDE.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# 开发者实现指南

> 迭代: ${iter} | 生成: 待填充

## 写作要求
本文档面向开发者，提供**可执行的实现指导**，不是抽象概念。

### 1. 改造范围清单
列出本迭代所有需要修改的文件，按类型分类：
| # | 类型 | 文件/目录 | 说明 |
| :--- | :--- | :--- | :--- |
| | 新增 | | |
| | 修改 | | |
| | 删除 | | |

### 2. 改造顺序与依赖
按依赖关系排列的实施步骤：
- Step 1: ...（为什么先做）
- Step 2: ...（依赖 Step 1 的什么）
- ...

### 3. 关键实现步骤（代码级）
每个功能模块的具体改造方式：
- **文件**: \`xxx.ts\` 第 N 行
- **改造前**: ...
- **改造后**: ...
- **注意**: ...

### 4. 接口契约（前后端对照）
| 接口 | 路径 | 后端实现位置 | 前端调用位置 | 状态 |
| :--- | :--- | :--- | :--- | :--- |

### 5. 每步验证方式
| 步骤 | 验证命令/操作 | 通过标准 |
| :--- | :--- | :--- |

### 6. 回滚方案
- 数据库变更: DOWN migration 文件位置
- 代码回滚: \`git revert\` 或备份分支
- 配置回滚: 原值备份位置

### 7. 常见坑点
- ⚠️ **坑 1**: ...（解决方式）
- ⚠️ **坑 2**: ...（解决方式）
`,
  },
  {
    name: 'ARCHITECTURE.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# 系统架构

> 迭代: ${iter} | 生成: 待填充

## 写作要求
描述本迭代的系统架构（区别于 TECH.md 的技术选型，这里聚焦结构关系）：
- 服务拓扑（Mermaid graph）：本迭代涉及哪些服务/模块，如何组织
- 数据流：请求从哪端进入，经过哪些层
- 跨端交互（调用方 → 被调方、协议）
`,
  },
  {
    name: 'API_CONTRACT.yaml',
    buildPlaceholder: (iter) => `# SPEC-SKELETON
# 跨功能接口契约（被 2+ 功能单元引用的接口，前后端唯一锚点）
# 迭代: ${iter} | 生成: 待填充
# 各端 API_CONTRACT.yaml 从这里派生，保持路径一致

version: "1.0"
iteration: "${iter}"
apis: []
# 示例：
# - name: login
#   method: POST
#   path: /api/auth/login
#   consumer_features: [用户认证]
#   provider: backend
`,
  },
  {
    name: 'PLATFORMS.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# 端列表

> 迭代: ${iter} | 生成: 待填充

## 写作要求
列出本迭代涉及的端（来源：.speccore/CONSTITUTION.md「端列表」章节）：
| 工程标识 | 描述 | 工程类型 |
| :--- | :--- | :--- |
| | | |
`,
  },
  {
    name: 'CLARIFY.md',
    buildPlaceholder: (iter) => `${SKELETON_MARKER}
# 全局澄清记录

> 迭代: ${iter} | 生成: 待填充

## 写作要求
记录跨功能模块的共性问题澄清（影响所有/多个功能单元的决策）：
| ID | 问题 | 回答 | 影响功能 |
|:---|:---|:---|:---|
| G-Q001 | | | |

> 功能单元特有的澄清放 {feature}/overview/CLARIFY.md（引用本文件，不复制）。
`,
  },
];

/** v8.3.238+: Phase 1 全局 overview/ 全部文档名单（无功能模块老项目的步骤完成检查用） */
export const PHASE1_DOC_NAMES: string[] = PHASE1_DOCS.map((doc) => doc.name);

// ================================================================
// v8.3.237+: Phase 1 索引类文档（有功能模块的项目，全局 overview/ 只放索引类）
//
// 修复「骨架预建清单与 v8.3.182+ 路由表不一致」的死锁：
//   - 有 features 的项目：内容类（REQUIREMENT/ANALYSIS/TECH/DEPS/RISK/REVIEW/MONITOR/DEV_GUIDE）
//     必须放 {feature}/overview/，全局 overview/ 只预建索引类骨架，否则单文档模式提示
//     AI 填充 overview/REQUIREMENT.md，但 --apply 按路由表拦截该路径 → 永远无法推进。
//   - 无 features 的老项目：仍用 PHASE1_DOCS 全量清单（内容类唯一容器就是 overview/）。
// ================================================================

/** v8.3.238+: 全局 overview/ 索引类骨架名单（骨架预建与步骤完成检查共用） */
export const PHASE1_INDEX_DOC_NAMES: string[] = [
  'FUNCTION_MAP.md',
  'INTERACTION_MAP.md',
  'DEPENDENCY_MAP.md',
  'PLATFORMS.md',
  'CLARIFY.md',
  'API_CONTRACT.yaml',
  'ARCHITECTURE.md',
];

const PHASE1_INDEX_DOCS: { name: string; buildPlaceholder: (iter: string) => string }[] =
  PHASE1_DOCS.filter((doc) => PHASE1_INDEX_DOC_NAMES.includes(doc.name));

// ================================================================
// Phase 2 文档清单（各端专属文档）
// ================================================================

const PHASE2_DOCS: { name: string; buildPlaceholder: (iter: string, platform: string) => string }[] = [
  {
    name: 'TECH.md',
    buildPlaceholder: (iter, platform) => {
      const backend = isBackendPlatform(platform);
      return `${SKELETON_MARKER}
# ${platform} 技术架构

> 迭代: ${iter} | 端: ${platform} | 生成: 待填充

## 写作要求
基于 overview/TECH.md 的整体架构，细化本端的技术方案：
${backend ? `- 接口定义（路径/参数/响应）
- 数据模型（Entity/DTO/VO）
- 核心业务逻辑与事务约束
- 异常处理与幂等设计` : `- 页面结构与路由设计
- 组件拆分与复用策略
- 状态管理方案
- 与后端接口的对接方式`}
- 与 overview/TECH.md 保持一致
`;
    },
  },
  {
    name: 'TEST.md',
    buildPlaceholder: (iter, platform) => {
      const backend = isBackendPlatform(platform);
      return `${SKELETON_MARKER}
# ${platform} 测试计划

> 迭代: ${iter} | 端: ${platform} | 生成: 待填充

## 写作要求
${backend ? `- 单元测试覆盖（Service/DAO 层）
- API 端到端测试
- 边界测试（异常参数、超时、并发）
- 性能测试方案（QPS/响应时间）` : `- 页面流转测试（路由跳转/权限拦截）
- 交互测试（表单校验/按钮状态/弹窗）
- 视觉与响应式测试
- 四态测试（空/加载/错误/成功）`}
- 测试账号约定（预置账号 + 初始密码策略，供冒烟测试自动登录；密码走环境变量不落库）
`;
    },
  },
  {
    name: 'UI_SPEC.md',
    buildPlaceholder: (iter, platform) => `${SKELETON_MARKER}
# ${platform} UI 规格

> 迭代: ${iter} | 端: ${platform} | 生成: 待填充

## 写作要求
- 页面清单与路由
- 组件拆分
- 交互流程
- 状态管理
- 元素标识约定（关键页面/交互元素加 data-testid，命名 {模块}-{页面}-{元素}，供冒烟测试定位）
`,
  },
  {
    name: 'DEV_GUIDE.md',
    buildPlaceholder: (iter, platform) => `${SKELETON_MARKER}
# ${platform} 开发者实现指南

> 迭代: ${iter} | 端: ${platform} | 生成: 待填充

## 写作要求
本端专属的**可执行实现指导**。

### 1. 本端改造范围
| # | 类型 | 文件/目录 | 说明 |
| :--- | :--- | :--- | :--- |
| | 新增 | | |
| | 修改 | | |

### 2. 本端实施步骤（按依赖排序）
- Step 1: ...
- Step 2: ...（依赖 Step 1）

### 3. 代码级指引
- **文件**: \`xxx.ts\`
- **改造**: 具体改哪几行、改什么
- **代码示例**: 改造后的关键代码片段

### 4. 与后端联调
| # | 接口 | 后端状态 | 联调顺序 | Mock 方案 |
| :--- | :--- | :--- | :--- | :--- |

### 5. 验证方式
| # | 验证项 | 命令/操作 | 通过标准 |
| :--- | :--- | :--- | :--- |

### 6. 本端坑点
- ⚠️ ...
`,
  },
  {
    name: 'API_CONTRACT.yaml',
    buildPlaceholder: (iter, platform) => `# SPEC-SKELETON
# ${platform} 接口契约（本端对外提供的接口，前端引用本文件对齐）
# 迭代: ${iter} | 端: ${platform} | 生成: 待填充

platform: "${platform}"
iteration: "${iter}"
apis: []
# 示例：
# - name: login
#   method: POST
#   path: /api/auth/login
#   request: { phone: string, password: string }
#   response: { token: string }
#   errors: [1001, 1002, 2001]
`,
  },
];

// ================================================================
// 任务级文档清单（split 用）
// ================================================================

const TASK_DOCS: { name: string; buildPlaceholder: (taskName: string, platform: string) => string }[] = [
  {
    name: 'REQ.md',
    buildPlaceholder: (taskName, platform) => `${SKELETON_MARKER}
# 本任务需求规格

> ${taskName} | 端: ${platform} | 生成: 待填充

## 写作要求
根据 split 产出的需求切片，结合全局上下文，重新组织本任务的需求规格：
- 明确本任务的验收标准（可测试的、具体的）
- 细化业务规则和边界条件
- 列出异常场景和处理方式
- 标注与其他 Task 的依赖关系
`,
  },
  {
    name: 'TECH.md',
    buildPlaceholder: (taskName, platform) => {
      const backend = isBackendPlatform(platform);
      return `${SKELETON_MARKER}
# 本任务技术方案

> ${taskName} | 端: ${platform} | 生成: 待填充

## 写作要求
基于 overview/TECH.md 的整体架构，细化到函数/接口级别：
${backend ? `- 具体的接口定义（路径/参数/响应）
- 数据模型设计（Entity/DTO/VO 字段映射）
- 核心业务逻辑的伪代码或流程描述
- 事务边界与异常处理策略` : `- 页面/组件的具体实现方案
- 状态管理设计（Pinia/Redux/Context 等）
- 与后端接口的对接（请求封装/错误处理）
- 交互流程与动画/过渡效果`}
- 必须与 overview/TECH.md 的整体架构保持一致
`;
    },
  },
  {
    name: 'TASK.md',
    buildPlaceholder: (taskName, platform) => `${SKELETON_MARKER}
# 实施计划

> ${taskName} | 端: ${platform} | 生成: 待填充

## 写作要求
根据本任务的需求和技术方案，制定具体实施步骤：
- 按开发顺序列出具体步骤
- 每个步骤有明确的完成标准
- 标注步骤间的依赖关系
- 估算每步的工作量
`,
  },
];

// ================================================================
// 功能模块级 overview 文档清单（v8.3.17+）
// 每个需求文档对应的功能模块目录下的综合文档
// ================================================================

const FEATURE_OVERVIEW_DOCS: { name: string; buildPlaceholder: (iter: string, feature: string) => string }[] = [
  {
    name: 'REQUIREMENT.md',
    buildPlaceholder: (iter, feature) => `${SKELETON_MARKER}
# ${feature} 需求规格

> 迭代: ${iter} | 功能: ${feature} | 生成: 待填充

## 写作要求
基于 010-requirements/ 下所有涉及 ${feature} 的需求文档，整理该功能的完整需求。
- 合并各端视角（web/h5/admin 等）的需求描述
- 标注跨端一致性和差异点
- 列出该功能的验收标准
`,
  },
  {
    name: 'ANALYSIS.md',
    buildPlaceholder: (iter, feature) => `${SKELETON_MARKER}
# ${feature} 需求分析

> 迭代: ${iter} | 功能: ${feature} | 生成: 待填充

## 写作要求
分析 ${feature} 的功能点清单。
- 按优先级分节（P0 必修 / P1 应修 / P2 建议）
- 每个功能点标注编号（F-01, F-02...）和涉及端
- 列出接口变更和数据库变更
`,
  },
  {
    name: 'INTERACTION.md',
    buildPlaceholder: (iter, feature) => `${SKELETON_MARKER}
# ${feature} 跨端交互时序

> 迭代: ${iter} | 功能: ${feature} | 生成: 待填充

## 写作要求
按功能单元组织，展示 ${feature} 的完整跨端交互时序。
- Mermaid sequenceDiagram
- 标注接口路径和调用关系
- 附接口契约索引表
`,
  },
  {
    name: 'CLARIFY.md',
    buildPlaceholder: (iter, feature) => `${SKELETON_MARKER}
# ${feature} 模块澄清记录

> 迭代: ${iter} | 功能: ${feature} | 生成: 待填充

## 依赖的全局澄清（引用，不复制）
| ID | 问题 | 回答 |
|:---|:---|:---|
| G-Q001 | | |

## 本模块澄清
| ID | 问题 | 回答 |
|:---|:---|:---|
| M-Q101 | | |

> 只记录 ${feature} 特有的澄清，跨功能共性问题引用 overview/CLARIFY.md。
`,
  },
  {
    name: 'TECH.md',
    buildPlaceholder: (iter, feature) => `${SKELETON_MARKER}
# ${feature} 综合技术方案

> 迭代: ${iter} | 功能: ${feature} | 生成: 待填充

## 写作要求
${feature} 的架构视角综合方案（跨端），端级细节下放到 {端}/TECH.md：
- 该功能的整体技术设计（跨端协作）
- 端级方案总览（各端做什么、谁先做）
- 关键技术决策与取舍
- 与 overview/TECH.md 保持一致
`,
  },
  {
    name: 'RISK.md',
    buildPlaceholder: (iter, feature) => `${SKELETON_MARKER}
# ${feature} 风险清单

> 迭代: ${iter} | 功能: ${feature} | 生成: 待填充

## 写作要求
记录 ${feature} 的功能模块级风险（跨端视角）：
| 风险 | 可能性 | 影响 | 缓解措施 |
|:---|:---|:---|:---|
| R-01 | 高/中/低 | 高/中/低 | |

> 端级风险下放到 {端}/TECH.md 的风险章节，本文件只记录功能级共性风险。
`,
  },
  {
    name: 'DEPS.md',
    buildPlaceholder: (iter, feature) => `${SKELETON_MARKER}
# ${feature} 依赖清单

> 迭代: ${iter} | 功能: ${feature} | 生成: 待填充

## 写作要求
记录 ${feature} 的功能模块级依赖（供 taskify 提取到子任务 DEPS.md）：
- 内部服务依赖（服务名/用途/接口/SLA）
- 第三方依赖（包名/版本/用途/许可证）
- 集成方式（SDK/API/消息队列）与版本兼容性风险

> 端级依赖下放到 {端}/TECH.md，本文件只记录功能级共性依赖。
`,
  },
  {
    name: 'MONITOR.md',
    buildPlaceholder: (iter, feature) => `${SKELETON_MARKER}
# ${feature} 监控指标

> 迭代: ${iter} | 功能: ${feature} | 生成: 待填充

## 写作要求
记录 ${feature} 的功能模块级监控方案（供 taskify 提取到子任务 MONITOR.md）：
| 指标 | 类型 | 采集方式 | 告警阈值 |
|:---|:---|:---|:---|
| M-01 | 业务/技术 | 日志/埋点/链路 | |

> 大盘看板与告警规则在此定义，端级采集细节放 {端}/TECH.md。
`,
  },
  {
    name: 'BUSINESS_RULES.md',
    buildPlaceholder: (iter, feature) => `${SKELETON_MARKER}
# ${feature} 业务规则

> 迭代: ${iter} | 功能: ${feature} | 生成: 待填充

## 写作要求
记录 ${feature} 特有的业务规则（可执行逻辑，非模糊描述）：
| 规则 | 触发条件 | 行为 | 异常处理 |
|:---|:---|:---|:---|
| R-01 | | | |

> 全局通用规则放 GLOBAL/BUSINESS_RULES/（跨功能），端级规则放 platforms/{端}/BUSINESS_RULES.md。
> 本文件只记录该功能特有的规则，供业务规则三层加载（business-rules.ts Layer3）。
`,
  },
];

/** v8.3.238+: 功能模块 overview/ 骨架名单（feature 步骤完成检查与 prompt 文档集对齐用） */
export const FEATURE_OVERVIEW_DOC_NAMES: string[] = FEATURE_OVERVIEW_DOCS.map((doc) => doc.name);

// ================================================================
// 质量标准（Quality Rubrics）— v8.1.0+
// 每种文档类型的专业质量检查清单，自动注入骨架文件和 prompt
// ================================================================

export const QUALITY_RUBRICS: Record<string, { checklist: string[]; antiPatterns: string[] }> = {
  'REQUIREMENT.md': {
    checklist: [
      '产品愿景与目标用户画像',
      '核心场景地图（按业务场景分章节组织）',
      '每个场景：用户故事 → 操作流程 → 业务规则 → 边界条件',
      '验收标准（Given/When/Then 格式）',
      '功能优先级矩阵（P0/P1/P2）',
      '功能模块清单表（含「涉及端」列，标准端名）',
      '发布里程碑与风险预判',
    ],
    antiPatterns: [
      '按端分章节（应按业务场景组织）',
      '写技术实现细节（应纯产品视角）',
      '功能模块缺少「涉及端」标注',
      '验收标准用模糊描述（如「正常使用」「合理范围」）',
    ],
  },
  'ANALYSIS.md': {
    checklist: [
      '按优先级分节（P0 必修 / P1 应修 / P2 建议）',
      '每个功能点有唯一编号（F-01, F-02...）',
      '每个功能点标注涉及端',
      '接口变更清单（路径/方法/参数变化）',
      '数据库变更清单（新增表/字段/索引）',
      '风险点与缓解策略',
    ],
    antiPatterns: [
      '功能点无编号或无涉及端标注',
      '只列功能名不描述具体行为',
      '缺少接口变更和数据库变更清单',
    ],
  },
  'TECH.md': {
    checklist: [
      '整体架构图（Mermaid graph/flowchart）',
      '跨端交互说明（调用方 → 被调方、协议、接口路径）',
      '中间件选型及理由',
      '数据库设计（表名/字段/类型/索引/约束）',
      '安全方案（鉴权/加密/脱敏/SQL注入防护）',
      '性能指标（QPS预估/缓存策略/慢查询优化）',
      'API 契约（统一响应格式/错误码/分页规范）',
    ],
    antiPatterns: [
      '只列技术栈不解释选型理由',
      '接口定义缺少字段级说明',
      '无安全方案或性能考量',
      '架构图与文字描述不一致',
    ],
  },
  'DEPS.md': {
    checklist: [
      '内部服务依赖清单（服务名/用途/接口/SLA）',
      '第三方依赖清单（包名/版本/用途/许可证）',
      '集成方式说明（SDK/API/消息队列）',
      '版本兼容性风险',
    ],
    antiPatterns: [
      '只列名称不说明用途',
      '缺少版本号',
      '遗漏关键依赖',
    ],
  },
  'RISK.md': {
    checklist: [
      '至少 3 个风险项',
      '每项标注可能性（高/中/低）和影响（高/中/低）',
      '每项有具体缓解措施',
      '回滚方案（触发条件 + 具体步骤）',
      '数据恢复方案（如涉及数据变更）',
    ],
    antiPatterns: [
      '风险描述笼统（如「可能出问题」）',
      '缓解措施为空或「待定」',
      '无回滚方案',
    ],
  },
  'REVIEW.md': {
    checklist: [
      '参数校验完整性',
      '幂等性处理',
      '索引覆盖',
      '迁移脚本可回滚',
      '鉴权配置',
      '日志规范',
      '错误处理',
      '并发安全',
      '至少 8 项检查，每项有具体检查方法',
    ],
    antiPatterns: [
      '检查项过于笼统（如「代码质量」）',
      '缺少具体检查方法',
      '遗漏安全相关检查项',
    ],
  },
  'MONITOR.md': {
    checklist: [
      '业务指标（成功率/响应时间/错误率，含阈值）',
      '系统指标（CPU/内存/连接池/磁盘）',
      '告警规则（条件/级别/通知渠道）',
      '监控大盘（必备指标列表）',
      '至少 3 个业务指标 + 2 条告警规则',
    ],
    antiPatterns: [
      '指标无阈值',
      '告警规则无通知渠道',
      '只有系统指标没有业务指标',
    ],
  },
  'INTERACTION.md': {
    checklist: [
      '跨端交互时序图（Mermaid sequenceDiagram）',
      '接口调用链路（调用方 → 被调方 → 接口路径）',
      '异常分支与重试/降级策略',
      '接口契约索引表',
    ],
    antiPatterns: [
      '只有文字描述无时序图',
      '接口路径与 API_CONTRACT.yaml 不一致',
      '遗漏异常分支',
    ],
  },
  'BUSINESS_RULES.md': {
    checklist: [
      '规则表（规则/触发条件/行为/异常处理）',
      '每条规则可执行（非模糊描述）',
      '规则编号唯一（R-01, R-02...）',
      '与全局/端级业务规则分层不重复',
    ],
    antiPatterns: [
      '规则描述模糊（如「合理校验」）',
      '跨功能通用规则写入模块文件（应放 GLOBAL/BUSINESS_RULES/）',
      '无异常处理列',
    ],
  },
  'FUNCTION_MAP.md': {
    checklist: [
      '表格含所有列：功能单元/涉及端/优先级/全局对比/共享能力/依赖任务/说明',
      '功能单元与 REQUIREMENT.md 一一对应（不允许合并）',
      '涉及端使用标准端名（逗号分隔）',
      '全局对比标注（新增/扩展/重构/复用）',
      '依赖任务标注正确',
      '每行有跨端交互说明',
    ],
    antiPatterns: [
      '将多个功能模块合并为一行',
      '涉及端为空或使用非标准端名',
      '缺少全局对比列',
      '功能单元与 REQUIREMENT.md 不对应',
    ],
  },
  'TEST.md': {
    checklist: [
      '单元测试覆盖（核心函数/方法）',
      '集成测试（API 端到端）',
      '边界测试（异常参数/超时/并发/空值）',
      '性能测试方案（基准/目标/工具）',
      '测试用例含前置条件+操作步骤+预期结果',
      '覆盖所有核心功能的正常流+异常流',
    ],
    antiPatterns: [
      '只列「需要测试」不写具体用例',
      '缺少异常场景测试',
      '无性能测试基准',
      '测试用例缺少预期结果',
    ],
  },
  'UI_SPEC.md': {
    checklist: [
      '页面清单（页面名/路由/核心功能/入口）',
      '组件拆分（组件名/职责/复用级别）',
      '交互流程（关键操作流程+状态变化）',
      '状态管理（全局状态/本地状态/同步策略）',
      '字段映射（前端字段 ↔ 后端 API 响应字段一一对应）',
      '异常状态 UI（空状态/加载态/错误态/骨架屏）',
    ],
    antiPatterns: [
      '字段映射与后端 API 不一致',
      '缺少异常状态 UI 设计',
      '只画正常流程不处理边界',
      '组件拆分粒度过粗或过细',
    ],
  },
  'REQ.md': {
    checklist: [
      '功能描述（本任务的核心职责）',
      '验收标准（Given/When/Then 格式，具体可测试）',
      '业务规则（具体到可执行逻辑）',
      '边界条件（参数范围/时间窗口/并发限制）',
      '异常场景（至少 3 种异常 + 处理方式）',
      '与其他 Task 的依赖关系',
    ],
    antiPatterns: [
      '验收标准不可测试（如「功能正常」）',
      '业务规则模糊（如「合理处理」）',
      '缺少异常场景',
      '未标注依赖关系',
    ],
  },
  'TASK.md': {
    checklist: [
      '按开发顺序列出实施步骤',
      '每步有明确的完成标准（可验证）',
      '标注步骤间依赖关系',
      '估算每步工作量',
    ],
    antiPatterns: [
      '步骤过于笼统（如「实现功能」）',
      '无完成标准',
      '缺少依赖关系',
    ],
  },
  'INTERACTION_MAP.md': {
    checklist: [
      '每个功能单元一个 Mermaid sequenceDiagram',
      '时序图包含：参与方（各端+服务）、消息路径、接口路径',
      '接口契约索引表（接口路径 → 对应文档）',
      '跨端数据流向说明',
      '异常交互流程（超时/重试/降级）',
    ],
    antiPatterns: [
      '时序图缺少参与方标注',
      '只有正常流没有异常流',
      '接口路径与 TECH.md 不一致',
      '缺少接口契约索引表',
    ],
  },
  'DEV_GUIDE.md': {
    checklist: [
      '改造范围清单（新增/修改/删除的文件列表）',
      '改造顺序与依赖（为什么 A 在 B 之前）',
      '关键实现步骤（具体到文件/函数级）',
      '代码示例（改造前后对比或关键片段）',
      '接口契约（前后端对照表）',
      '每步验证方式（可执行的命令/操作 + 通过标准）',
      '回滚方案（数据库/代码/配置）',
      '常见坑点（已知陷阱及解决方式）',
    ],
    antiPatterns: [
      '改造范围模糊（没有具体文件路径）',
      '改造顺序不明确（缺少依赖说明）',
      '实现步骤太笼统（如「实现功能」）',
      '没有代码示例或示例不具体',
      '验证方式不可执行（如「测试通过」）',
      '缺少回滚方案',
    ],
  },
};

/**
 * 根据文档名获取质量标准文本
 * 自动区分 overview 和 platform 文档（TECH.md 后端/前端差异化）
 */
export function buildQualityRubRIC(docName: string, platform?: string): string {
  const rubric = QUALITY_RUBRICS[docName];
  if (!rubric) return '';

  let text = `\n## 📋 质量标准（${docName}）\n\n`;

  // 端特定提示（统一到 isBackendPlatform，消除同文件两套判定）
  if (platform && docName === 'TECH.md') {
    const isBackend = isBackendPlatform(platform);
    if (isBackend) {
      text += `> 🎯 **${platform} 是后端服务**，TECH.md 必须包含：接口签名（路径/方法/参数/响应）、数据模型（表/字段/索引）、业务逻辑、安全方案\n\n`;
    } else {
      text += `> 🎯 **${platform} 是前端端**，TECH.md 必须包含：用户旅程、页面清单与路由、API 调用清单、组件设计、状态管理\n\n`;
    }
  }

  text += `**必含内容**：\n`;
  for (const item of rubric.checklist) {
    text += `- [ ] ${item}\n`;
  }
  text += `\n**禁止**：\n`;
  for (const item of rubric.antiPatterns) {
    text += `- ❌ ${item}\n`;
  }

  return text;
}

/**
 * 校验已填充文档的内容质量
 * 检查：最低字数、必含章节、表格是否有真实数据
 */
export async function validateContentQuality(
  docName: string,
  content: string,
  platform?: string,
): Promise<{ pass: boolean; score: number; issues: string[] }> {
  const issues: string[] = [];
  let score = 100;

  // 1. 最低字数检查（排除标记和空白）
  const cleanContent = content
    .replace(/<!--.*?-->/gs, '')
    .replace(/^#+\s/gm, '')
    .replace(/^>\s/gm, '')
    .trim();
  // v8.3.61+: 提高最低字数标准
  if (cleanContent.length < 500) {
    issues.push(`内容过薄（${cleanContent.length} 字符，最低 500）`);
    score -= 30;
  } else if (cleanContent.length < 1000) {
    issues.push(`内容偏少（${cleanContent.length} 字符，建议 1000+）`);
    score -= 10;
  }

  // 2. 必含章节检查
  const rubric = QUALITY_RUBRICS[docName];
  if (rubric) {
    const sectionMarkers: Record<string, string[]> = {
      'REQUIREMENT.md': ['验收标准', '优先级', '涉及端'],
      'ANALYSIS.md': ['P0', 'F-'],
      'TECH.md': ['接口', '数据模型'],
      'TEST.md': ['单元测试', '边界'],
      'UI_SPEC.md': ['页面', '组件'],
      'RISK.md': ['回滚'],
      'MONITOR.md': ['告警'],
      'FUNCTION_MAP.md': ['功能单元', '涉及端'],
      'REQ.md': ['验收标准', '异常'],
      'TASK.md': ['步骤'],
      'INTERACTION_MAP.md': ['sequenceDiagram', '接口'],
      'DEV_GUIDE.md': ['改造范围', '实施步骤', '验证', '坑点'],
    };
    const markers = sectionMarkers[docName] || [];
    for (const marker of markers) {
      if (!content.includes(marker)) {
        issues.push(`缺少关键内容：「${marker}」`);
        score -= 10;
      }
    }
  }

  // 3. 占位符残留检查
  const placeholders = ['待填充', 'TODO', 'TBD', '_待定_', 'AI-FILL'];
  for (const ph of placeholders) {
    if (content.includes(ph)) {
      issues.push(`含占位符残留：「${ph}」`);
      score -= 5;
    }
  }

  // 4. 表格数据检查（有表头但无数据行）
  const tableHeaders = content.match(/^\|.+\|$/gm);
  if (tableHeaders && tableHeaders.length > 0) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/^\|.+\|$/.test(lines[i]) && lines[i].includes('---')) {
        const nextLine = lines[i + 1] || '';
        if (!/^\|.+\|$/.test(nextLine) || /^\|\s*\|$/.test(nextLine)) {
          issues.push('表格有表头但无数据行');
          score -= 10;
          break;
        }
      }
    }
  }

  // 5. 空洞内容检测（v8.3.0+）
  // 5a. 重复段落检测
  const paragraphs = cleanContent.split(/\n\s*\n/).filter(p => p.trim().length > 20);
  const paragraphSet = new Set(paragraphs);
  if (paragraphs.length > 5 && paragraphSet.size / paragraphs.length < 0.5) {
    issues.push('内容重复度过高（可能为无意义填充）');
    score -= 20;
  }

  // 5b. 章节空洞检测（有标题但无实质内容）
  const headingRegex = /^#{2,3}\s+(.+)$/gm;
  const headings: string[] = [];
  let hm: RegExpExecArray | null;
  while ((hm = headingRegex.exec(content)) !== null) {
    headings.push(hm[1]);
  }
  let emptySections = 0;
  for (let i = 0; i < headings.length; i++) {
    const headingIndex = content.indexOf(headings[i]);
    const nextHeadingIndex = i < headings.length - 1 ? content.indexOf(headings[i + 1], headingIndex + headings[i].length) : content.length;
    const sectionContent = content.slice(headingIndex + headings[i].length, nextHeadingIndex).trim();
    const sectionText = sectionContent.replace(/[#*`>\-|]/g, '').trim();
    if (sectionText.length < 30) {
      emptySections++;
    }
  }
  if (emptySections > 2) {
    issues.push(`${emptySections} 个章节内容空洞（有标题但无实质内容）`);
    score -= emptySections * 5;
  }

  // 5c. 大量无意义填充词检测
  const fillerPatterns = ['待补充', '待确认', '待定', 'TBD', 'TODO', '待完善', '待细化'];
  let fillerCount = 0;
  for (const fp of fillerPatterns) {
    const matches = content.match(new RegExp(fp, 'g'));
    if (matches) fillerCount += matches.length;
  }
  if (fillerCount > 5) {
    issues.push(`含 ${fillerCount} 处无意义填充词（待补充/待定/TBD 等）`);
    score -= Math.min(20, fillerCount * 3);
  }

  return {
    pass: score >= 80 && issues.filter(i => i.includes('过薄')).length === 0,
    score: Math.max(0, score),
    issues,
  };
}

// ================================================================
// Manifest 计算函数
// ================================================================

/**
 * 计算 analyze 命令的文件清单
 * @param platforms 端列表
 * @param phase '1' = Phase 1 (overview), '2' = Phase 2 (各端), undefined = 全部
 * @param iteration 迭代名（用于占位内容）
 */
export function computeAnalyzeManifest(
  platforms: string[],
  phase?: '1' | '2',
  iteration: string = '',
): SpecFileEntry[] {
  const entries: SpecFileEntry[] = [];

  // Phase 1: overview/ 全局文档
  if (!phase || phase === '1') {
    for (const doc of PHASE1_DOCS) {
      entries.push({
        relPath: join(GLOBAL_SPECS_DIR, doc.name),
        category: 'overview',
        docName: doc.name,
        placeholder: doc.buildPlaceholder(iteration),
      });
    }
  }

  // Phase 2: 各端专属文档
  if (!phase || phase === '2') {
    for (const platform of platforms) {
      for (const doc of PHASE2_DOCS) {
        entries.push({
          relPath: join(platform, doc.name),
          category: 'platform',
          platform,
          docName: doc.name,
          placeholder: doc.buildPlaceholder(iteration, platform),
        });
      }
    }
  }

  return entries;
}

/**
 * v8.3.17+: 计算功能模块级 analyze 的文件清单
 * 按需求文档名组织一级目录，每个目录下有 overview/ + 各端子目录
 * @param features 功能模块（需求文档名）列表
 * @param platforms 端列表
 * @param phase '1' = Phase 1 (overview), '2' = Phase 2 (各端), undefined = 全部
 * @param iteration 迭代名（用于占位内容）
 * @param featurePlatforms v8.3.278+: 「单元 → 声明端」映射（_matrix.md platforms 字段）。
 *   声明非空的单元只生成声明端的骨架；未声明的单元全端兜底。
 */
export function computeFeatureBasedAnalyzeManifest(
  features: string[],
  platforms: string[],
  phase?: '1' | '2',
  iteration: string = '',
  featurePlatforms?: Map<string, string[]>,
): SpecFileEntry[] {
  const entries: SpecFileEntry[] = [];

  // Phase 1: 全局 overview/ + 各功能模块 overview/
  if (!phase || phase === '1') {
    // v8.3.237+: 有功能模块时全局 overview/ 只预建索引类骨架（内容类归 {feature}/overview/）
    const globalDocs = features.length > 0 ? PHASE1_INDEX_DOCS : PHASE1_DOCS;
    for (const doc of globalDocs) {
      entries.push({
        relPath: join(GLOBAL_SPECS_DIR, doc.name),
        category: 'overview',
        docName: doc.name,
        placeholder: doc.buildPlaceholder(iteration),
      });
    }
    // 各功能模块 overview 文档
    for (const feature of features) {
      for (const doc of FEATURE_OVERVIEW_DOCS) {
        entries.push({
          relPath: join(feature, 'overview', doc.name),
          category: 'overview',
          docName: doc.name,
          placeholder: doc.buildPlaceholder(iteration, feature),
        });
      }
      // 注：_matrix.md 端覆盖矩阵在需求层 010-requirements/features/{feature}/_matrix.md
      //（doc2spec 生成 + 端推断 Layer2 读取），迭代层 020-specs 不重复生成，避免双写漂移。
    }
  }

  // Phase 2: 各功能模块的各端专属文档
  if (!phase || phase === '2') {
    for (const feature of features) {
      // v8.3.278: 按 _matrix.md 声明端收敛——只生成该单元涉及端的骨架，
      // 不再做「单元 × 全部端」笛卡尔积（未涉及端不生成，从源头消灭空骨架误报）
      let unitPlatforms = platforms;
      if (featurePlatforms) {
        const declared = featurePlatforms.get(feature);
        if (declared && declared.length > 0) {
          unitPlatforms = declared.filter(p => platforms.includes(p));
        }
      }
      for (const platform of unitPlatforms) {
        for (const doc of PHASE2_DOCS) {
          // v8.3.184+: API_CONTRACT.yaml 只在后端端生成（前端引用后端契约，不定义）
          if (doc.name === 'API_CONTRACT.yaml' && !isBackendPlatform(platform)) continue;
          entries.push({
            relPath: join(feature, platform, doc.name),
            category: 'platform',
            platform,
            docName: doc.name,
            placeholder: doc.buildPlaceholder(iteration, platform),
          });
        }
      }
    }
  }

  return entries;
}

/**
 * 计算 split 命令的任务文件清单
 * @param taskName 任务名（如 Task-001-xxx）
 * @param platforms 涉及的端列表
 */
export function computeTaskManifest(
  taskName: string,
  platforms: string[],
): SpecFileEntry[] {
  const entries: SpecFileEntry[] = [];

  for (const platform of platforms) {
    for (const doc of TASK_DOCS) {
      entries.push({
        relPath: join(platform, doc.name),
        category: 'platform',
        platform,
        docName: doc.name,
        placeholder: doc.buildPlaceholder(taskName, platform),
      });
    }
  }

  return entries;
}

// ================================================================
// 端覆盖矩阵（v8.3.278+）
// ================================================================

/**
 * v8.3.278: 解析 _matrix.md 的 platforms 字段（与 taskify readMatrixPlatforms 同格式）。
 * 格式：`platforms:` 后跟随 `  - 端名` 行；`  []`（空标记）或不存在 → 空数组（未声明）。
 */
async function parseMatrixPlatforms(matrixPath: string): Promise<string[]> {
  try {
    if (!(await pathExists(matrixPath))) return [];
    const raw = await readFile(matrixPath, 'utf-8');
    const m = raw.match(/platforms:\s*\n((?:\s*[-\[]?[\s\S]*?))(?=\n(?:dependencies|apis|interfaces|$))/);
    const block = m ? m[1] : '';
    if (!block || /^\s*\[\s*\]\s*$/.test(block.trim())) return [];
    return block.split('\n')
      .map(l => l.replace(/^\s*-\s*/, '').trim())
      .filter(p => p && !p.startsWith('#') && !p.includes(':'));
  } catch {
    return [];
  }
}

/**
 * v8.3.278: 构建「单元 → 声明端」映射。
 * 读取 010-requirements/features/{单元}/_matrix.md 的 platforms 字段，与合法端列表交叉验证。
 * 声明为空/缺失的单元不写入映射 → 调用方按「全端兜底」处理。
 * @param featuresDir 010-requirements/features/ 绝对路径
 * @param features 单元目录名列表（parseFeatureList 产物）
 * @param allPlatforms CONSTITUTION.md 全量端列表（未经 --platform 过滤）
 */
export async function resolveFeaturePlatformMap(
  featuresDir: string,
  features: string[],
  allPlatforms: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!(await pathExists(featuresDir))) return map;
  for (const feature of features) {
    // 备份目录不在 features 清单里，但双保险：跳过时间戳备份目录名
    if (isTimestampBackup(feature)) continue;
    const declared = await parseMatrixPlatforms(join(featuresDir, feature, '_matrix.md'));
    const valid = declared.filter(p => allPlatforms.includes(p));
    if (valid.length > 0) map.set(feature, valid);
  }
  return map;
}

/**
 * v8.3.278: 清理「未涉及端」的空骨架端目录。
 *
 * 背景：v8.3.277 及以前 analyze 按「单元 × 全部端」笛卡尔积预建骨架，
 * 不读 _matrix.md 声明。单元只涉及部分端时，未涉及端的空骨架目录残留，
 * 被 countPlatformSkeletons / detectSkeletonProgress / 质量门禁反复扫到误报。
 *
 * 安全边界：只删除「目录内所有文件均为空骨架（SPEC-SKELETON 或空白）」的端目录；
 * 存在已填充真实内容的端目录不删除，计入 kept 供调用方警告（防 _matrix.md 声明不完整时误删）。
 */
export async function pruneUninvolvedPlatformSkeletons(
  specDir: string,
  features: string[],
  featurePlatforms: Map<string, string[]>,
): Promise<{ removed: string[]; kept: string[] }> {
  const removed: string[] = [];
  const kept: string[] = [];
  for (const feature of features) {
    const declared = featurePlatforms.get(feature);
    if (!declared || declared.length === 0) continue; // 未声明端 → 全端兜底，不清理
    const unitDir = join(specDir, feature);
    if (!(await pathExists(unitDir))) continue;
    const entries = await readdir(unitDir, { withFileTypes: true }).catch(() => [] as import('fs').Dirent[]);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'overview' || entry.name.startsWith('.')) continue;
      if (declared.includes(entry.name)) continue; // 声明内的端目录，保留
      const platformDir = join(unitDir, entry.name);
      const files = await readdir(platformDir, { withFileTypes: true }).catch(() => [] as import('fs').Dirent[]);
      const fileList = files.filter(f => f.isFile());
      // 全部文件为空骨架（或目录为空）→ 可安全删除
      let allSkeleton = true;
      for (const f of fileList) {
        const content = (await readFile(join(platformDir, f.name), 'utf-8').catch(() => '')).trim();
        if (content && !content.includes(SKELETON_MARKER)) {
          allSkeleton = false;
          break;
        }
      }
      if (allSkeleton) {
        await remove(platformDir);
        removed.push(`${feature}/${entry.name}`);
      } else {
        kept.push(`${feature}/${entry.name}`);
      }
    }
  }
  return { removed, kept };
}

/**
 * 预创建文件骨架
 * - 文件不存在 → 创建目录 + 写入占位内容
 * - 文件已存在且非骨架 → 跳过（保留已有内容，不覆盖）
 * - 文件已存在且仍为骨架 → 跳过（等 AI 覆盖）
 */
export async function generateSkeleton(
  specDir: string,
  entries: SpecFileEntry[],
): Promise<SkeletonResult> {
  const result: SkeletonResult = { created: [], skipped: [] };

  for (const entry of entries) {
    const fullPath = join(specDir, entry.relPath);

    if (await pathExists(fullPath)) {
      // 文件已存在 → 跳过（无论是否为骨架，都不覆盖）
      result.skipped.push(entry.relPath);
      continue;
    }

    // 文件不存在 → 创建骨架
    // v8.1.0+: 自动追加质量标准（AI 填充时可见质量要求）
    await ensureDir(dirname(fullPath));
    const rubricSection = buildQualityRubRIC(entry.docName, entry.platform);
    const fullContent = entry.placeholder + rubricSection;
    await writeFile(fullPath, fullContent, 'utf-8');
    result.created.push(entry.relPath);
  }

  // v8.3.240+: 写入结构契约 README——固化「澄清产物与分析产物同一棵树、靠文件名区分」的约定，
  // 消除“020-specs 应否物理分三层”的歧义（requirements/ 仅为旧路径兼容目录）
  await ensureSpecDirReadme(specDir);

  return result;
}

/**
 * 写入/刷新 020-specs/README.md 结构契约（内容固定，每次骨架生成时同步）
 */
async function ensureSpecDirReadme(specDir: string): Promise<void> {
  const readme = [
    '# 020-specs 目录结构契约',
    '',
    '> 本文件由 CLI 自动维护，每次 analyze 骨架生成时刷新',
    '',
    '## 分层说明',
    '',
    '| 路径 | 性质 | 内容 |',
    '| :--- | :--- | :--- |',
    '| `overview/` | 索引类（全局） | FUNCTION_MAP / PLATFORMS / INTERACTION_MAP / API_CONTRACT / ARCHITECTURE / CLARIFY |',
    '| `{功能单元}/overview/` | 内容类（单元级） | **CLARIFY.md = 澄清产物**；REQUIREMENT / ANALYSIS / TECH / RISK / DEPS / INTERACTION / MONITOR / BUSINESS_RULES = 分析产物 |',
    '| `{功能单元}/{端名}/` | 内容类（端级） | TECH / TEST / UI_SPEC / DEV_GUIDE / API_CONTRACT（端级分析产物） |',
    '| `requirements/` | 兼容目录（旧路径） | 文档级澄清的黄金需求，新项目不再生成 |',
    '',
    '## 关键约定',
    '',
    '- **澄清与分析不物理分层**：同一功能单元的澄清产物与分析产物共存于 `{功能单元}/overview/`，靠文件名区分（CLARIFY.md vs 其余）。',
    '- **禁止把 overview/GLOBAL_CONTEXT-*.md、features/{单元}/_matrix.md 当功能单元**（它们是全局信息/元数据）。',
    '- 实际目录以 CLI 生成为准，本文件为描述性契约而非机制。',
    '',
  ].join('\n');
  await writeFile(join(specDir, 'README.md'), readme, 'utf-8');
}

// ================================================================
// 内容验证器
// ================================================================

/**
 * 检测哪些骨架文件已被 AI 填充
 * - 存在且不含 SKELETON_MARKER → filled
 * - 不存在或仍含 SKELETON_MARKER → unfilled
 */
export async function validateFilled(
  specDir: string,
  entries: SpecFileEntry[],
): Promise<{ filled: string[]; unfilled: string[] }> {
  const filled: string[] = [];
  const unfilled: string[] = [];

  for (const entry of entries) {
    const fullPath = join(specDir, entry.relPath);

    if (!(await pathExists(fullPath))) {
      unfilled.push(entry.relPath);
      continue;
    }

    const content = await readFile(fullPath, 'utf-8');
    if (content.includes(SKELETON_MARKER)) {
      unfilled.push(entry.relPath);
    } else {
      filled.push(entry.relPath);
    }
  }

  return { filled, unfilled };
}

// ================================================================
// 进度检测（替代 detectIterationDocsStatus）
// ================================================================

/**
 * 检测骨架填充进度，返回下一个需要生成的文件
 * 用于逐文档链式推进模式
 */
export async function detectSkeletonProgress(
  specDir: string,
  entries: SpecFileEntry[],
): Promise<ProgressResult> {
  const { filled, unfilled } = await validateFilled(specDir, entries);

  // 找到第一个未填充的 entry
  let nextUnfilled: SpecFileEntry | null = null;
  for (const entry of entries) {
    if (unfilled.includes(entry.relPath)) {
      nextUnfilled = entry;
      break;
    }
  }

  return {
    filled,
    unfilled,
    nextUnfilled,
    filledCount: filled.length,
    totalCount: entries.length,
  };
}

// ================================================================
// Prompt 辅助：生成骨架文件列表文本
// ================================================================

/**
 * 生成注入 prompt 的骨架文件列表
 * 用于告诉 AI 哪些文件需要覆盖
 *
 * v8.3.34+: 支持功能模块分组展示（按需求文档名分目录的新结构）
 */
export function buildSkeletonFileList(
  entries: SpecFileEntry[],
  specDir: string,
): string {
  let text = `## 文件清单（CLI 已预创建骨架，请逐个覆盖内容）\n\n`;

  // 提取功能模块前缀："用户管理/overview/X.md" → "用户管理", "overview/X.md" → ""
  function extractFeaturePrefix(relPath: string): string {
    const parts = relPath.split('/');
    if (parts.length >= 2 && parts[0] !== GLOBAL_SPECS_DIR) {
      return parts[0];
    }
    return '';
  }

  const globalOverviewEntries = entries.filter(e => e.category === 'overview' && !e.relPath.includes('/'));
  const featureOverviewEntries = entries.filter(e => e.category === 'overview' && e.relPath.includes('/') && e.relPath.split('/')[1] === GLOBAL_SPECS_DIR);
  const platformEntries = entries.filter(e => e.category === 'platform');

  // 1. 全局 overview 文档（overview/ 下，无功能模块前缀）
  const pureGlobalOverview = entries.filter(e =>
    e.category === 'overview' &&
    (e.relPath.startsWith(`${GLOBAL_SPECS_DIR}/`) || !e.relPath.includes('/'))
  );
  if (pureGlobalOverview.length > 0) {
    text += `### 全局文档（${GLOBAL_SPECS_DIR}/）\n`;
    for (const e of pureGlobalOverview) {
      text += `- \`${e.relPath}\`\n`;
    }
    text += `\n`;
  }

  // 2. 按功能模块分组
  const featureGroups = new Map<string, { overview: SpecFileEntry[]; platforms: Map<string, SpecFileEntry[]> }>();

  // 收集功能模块 overview 文档
  for (const e of entries) {
    if (e.category !== 'overview') continue;
    const prefix = extractFeaturePrefix(e.relPath);
    if (!prefix) continue; // 纯全局文档已处理
    if (!featureGroups.has(prefix)) {
      featureGroups.set(prefix, { overview: [], platforms: new Map() });
    }
    featureGroups.get(prefix)!.overview.push(e);
  }

  // 收集功能模块 platform 文档
  for (const e of entries) {
    if (e.category !== 'platform') continue;
    const prefix = extractFeaturePrefix(e.relPath);
    if (!featureGroups.has(prefix)) {
      featureGroups.set(prefix, { overview: [], platforms: new Map() });
    }
    const group = featureGroups.get(prefix)!;
    const p = e.platform || 'unknown';
    if (!group.platforms.has(p)) group.platforms.set(p, []);
    group.platforms.get(p)!.push(e);
  }

  // 3. 输出功能模块分组
  if (featureGroups.size > 0) {
    for (const [feature, group] of featureGroups) {
      text += `### 功能模块：${feature}\n`;

      // overview 子目录
      if (group.overview.length > 0) {
        text += `\n**${GLOBAL_SPECS_DIR}/**\n`;
        for (const e of group.overview) {
          text += `- \`${e.relPath}\`\n`;
        }
      }

      // 各端子目录
      if (group.platforms.size > 0) {
        for (const [platform, platformEntries] of group.platforms) {
          text += `\n**${platform}/**\n`;
          for (const e of platformEntries) {
            text += `- \`${e.relPath}\`\n`;
          }
        }
      }
      text += `\n`;
    }
  }

  // 已收敛路径：所有 platform 文档必须在功能模块目录下（020-specs/{feature}/{端}/）
  // 当前态：所有 platform 文档必须在功能模块目录下（020-specs/{feature}/{端}/）

  text += `> 完整路径前缀: \`${specDir}/\`\n`;
  text += `> 写入方式: 用 Write 工具直接覆盖上述路径的文件，不要创建新文件\n`;
  text += `> 端声明核对（v8.3.279+）: 若分析发现某单元实际涉及的端与 010-requirements/features/{单元}/_matrix.md 的 platforms 声明不符，用 Write 更新该文件后重跑 analyze，骨架将按声明收敛\n`;

  return text;
}
