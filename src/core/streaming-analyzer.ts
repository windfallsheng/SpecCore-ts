/**
 * streaming-analyzer — 流式全局分析引擎（v6.74.0）
 *
 * 把"四层批处理"升级为"七阶段流处理"：
 * Phase 0: 快速全局扫描（所有端并行索引）
 * Phase 1: 后端拓扑排序分析（从依赖源头开始，逐模块深入）
 * Phase 2: 后端完成后全局实时更新
 * Phase 3: 前端逐个分析
 * Phase 4: 横向关联检查（前后端字段/接口一致性）
 * Phase 5: 纵向关联检查（功能模块跨端完整性）
 * Phase 6: 最终核对检查（完整性 + 一致性 + 遗漏检测）
 *
 * 核心机制：
 * - 每 Phase 产出写入文件，作为后续 Phase 的输入
 * - 实时关联调整：当前 Phase 发现与前期文档冲突时，提示回退修正
 * - 知识图谱实时刷新：每 Phase 完成后刷新图谱
 */

import { join, dirname } from 'path';
import { pathExists, readFile, readdir } from 'fs-extra';
import { logger } from '../utils/logger';
import { parsePlatformList, parsePlatformTypes } from './spec-paths';
import { formatUnifiedContext, unifiedSearch } from './unified-retrieval';

// ── 类型定义 ──

export type AnalyzePhase =
  | 'phase0-scan'      // 快速全局扫描
  | 'phase1-backend'   // 后端拓扑排序分析
  | 'phase2-global-update' // 后端完成后全局更新
  | 'phase3-frontend'  // 前端逐个分析
  | 'phase4-cross-check'   // 横向关联检查
  | 'phase5-vertical-check' // 纵向关联检查
  | 'phase6-final-audit';  // 最终核对检查

export interface PhaseContext {
  iteration: string;
  phase: AnalyzePhase;
  platforms: string[];
  platformTypes: Map<string, string>;
  completedPhases: AnalyzePhase[];
  backtrackNeeded?: boolean;
  backtrackTargets?: string[];
  auditIssues?: AuditIssue[];
}

export interface AuditIssue {
  severity: 'error' | 'warning' | 'info';
  category: 'missing-doc' | 'inconsistent-field' | 'missing-api' | 'missing-test' | 'orphan-code' | 'stale-global';
  description: string;
  affectedFiles: string[];
  suggestion: string;
}

export interface StreamingConfig {
  enableRealtimeUpdate: boolean;
  enableBacktrack: boolean;
  enableFinalAudit: boolean;
  backendFirst: boolean;
}

export const DEFAULT_STREAMING_CONFIG: StreamingConfig = {
  enableRealtimeUpdate: true,
  enableBacktrack: true,
  enableFinalAudit: true,
  backendFirst: true,
};

// ── Phase Prompt 生成 ──

/**
 * 生成指定 Phase 的 Prompt
 */
export async function buildPhasePrompt(ctx: PhaseContext): Promise<string> {
  switch (ctx.phase) {
    case 'phase0-scan':
      return buildPhase0Prompt(ctx);
    case 'phase1-backend':
      return buildPhase1Prompt(ctx);
    case 'phase2-global-update':
      return buildPhase2Prompt(ctx);
    case 'phase3-frontend':
      return buildPhase3Prompt(ctx);
    case 'phase4-cross-check':
      return buildPhase4Prompt(ctx);
    case 'phase5-vertical-check':
      return buildPhase5Prompt(ctx);
    case 'phase6-final-audit':
      return buildPhase6Prompt(ctx);
    default:
      return '';
  }
}

/** Phase 0: 快速全局扫描 — 所有端并行，只提取索引 */
function buildPhase0Prompt(ctx: PhaseContext): string {
  const { platforms, platformTypes } = ctx;
  let prompt = `\n# Phase 0: 快速全局扫描（建立全局视野）\n\n`;
  prompt += `## 目标\n`;
  prompt += `快速扫描所有端，建立全局索引，不深入代码逻辑。产出各端 \_INDEX.md。\n\n`;
  prompt += `## 扫描范围\n`;
  prompt += `项目共有 ${platforms.length} 个端: ${platforms.join(', ')}\n\n`;

  for (const platform of platforms) {
    const pType = platformTypes.get(platform) || 'unknown';
    const isBackend = pType.includes('service') || pType.includes('Java') || pType.includes('Node') || pType.includes('Go') || pType.includes('Python');
    const isFrontend = !isBackend;

    prompt += `### ${platform} (${pType})\n`;
    if (isBackend) {
      prompt += `- 读取 Controller/Handler/Resource 目录文件列表 → 提取接口类名、接口路径\n`;
      prompt += `- 读取 Entity/Model/Schema 目录文件列表 → 提取实体名称、表名\n`;
      prompt += `- 读取 Service/UseCase 目录文件列表 → 提取服务类名\n`;
      prompt += `- 读取依赖配置文件 → 提取技术栈和外部依赖\n`;
    } else {
      prompt += `- 读取 router/routes 配置文件 → 提取页面路径、页面名称\n`;
      prompt += `- 读取 pages/views 目录文件列表 → 提取页面名称、主要功能\n`;
      prompt += `- 搜索 API 调用模式 → 提取调用的接口路径列表\n`;
      prompt += `- 读取状态管理目录 → 提取全局状态名称\n`;
    }
    prompt += `\n`;
  }

  prompt += `## 输出要求\n`;
  prompt += `每个端一个 \_INDEX.md，只含名称和路径列表：\n`;
  prompt += `- 后端端：接口列表、实体列表、服务列表、依赖列表\n`;
  prompt += `- 前端端：页面列表、API调用列表、状态列表、组件列表\n`;
  prompt += `**存放**: \`.speccore/GLOBAL/platforms/{端名}/_INDEX.md\`\n\n`;
  prompt += `## 回写命令\n`;
  prompt += `\`\`\`bash\n`;
  for (const platform of platforms) {
    prompt += `speccore analyze --apply '{"${platform}/_INDEX.md":"..."}' -I ${ctx.iteration} --global\n`;
  }
  prompt += `\`\`\`\n\n`;
  prompt += `> ⚠️ 注意：Phase 0 只提取索引，不写详细逻辑。详细分析在后续 Phase 中进行。\n`;

  return prompt;
}

/** Phase 1: 后端拓扑排序分析 — 从依赖源头开始，逐模块深入 */
function buildPhase1Prompt(ctx: PhaseContext): string {
  const { platforms, platformTypes, iteration } = ctx;
  const backendPlatforms = platforms.filter(p => {
    const t = platformTypes.get(p) || '';
    return t.includes('service') || t.includes('Java') || t.includes('Node') || t.includes('Go') || t.includes('Python') || t.includes('后端');
  });

  let prompt = `\n# Phase 1: 后端深度分析（拓扑排序，从依赖源头开始）\n\n`;
  prompt += `## 目标\n`;
  prompt += `深入分析每个后端端，从依赖关系最源头的服务开始，逐个模块分析。\n\n`;

  if (backendPlatforms.length === 0) {
    prompt += `> 未检测到后端端，跳过 Phase 1，直接进入 Phase 3（前端分析）。\n`;
    return prompt;
  }

  prompt += `## 后端端列表（${backendPlatforms.length} 个）\n`;
  for (const p of backendPlatforms) {
    prompt += `- ${p} (${platformTypes.get(p) || 'unknown'})\n`;
  }
  prompt += `\n`;

  prompt += `## 分析顺序原则\n`;
  prompt += `1. **先分析不依赖其他后端服务的端**（最源头的服务，如 user-service、auth-service）\n`;
  prompt += `2. **再分析依赖已分析服务的端**（如 booking-service 依赖 room-service，则 room-service 先分析）\n`;
  prompt += `3. **最后分析网关/聚合层**（如 api-gateway、BFF 层）\n`;
  prompt += `4. 如果无法确定依赖关系，按字母顺序分析\n\n`;

  prompt += `## 每个后端端的分析内容（必须深入）\n`;
  prompt += `基于 Phase 0 的 \_INDEX.md，逐个端深入分析：\n\n`;
  prompt += `### 1. API 详细设计\n`;
  prompt += `- 每个接口：路径、HTTP方法、请求参数（名称/类型/必填/校验规则）、响应结构\n`;
  prompt += `- 状态码定义（200/400/401/403/404/409/500 等场景）\n`;
  prompt += `- 错误码定义（统一格式，跨端一致）\n`;
  prompt += `- 鉴权要求（哪些接口需要登录/权限）\n\n`;

  prompt += `### 2. 数据模型设计\n`;
  prompt += `- 每个实体：表名、字段（名称/类型/长度/约束/默认值/注释）\n`;
  prompt += `- 索引设计（主键、唯一索引、普通索引、联合索引及理由）\n`;
  prompt += `- 实体关系（一对一/一对多/多对多，外键约束）\n`;
  prompt += `- 与全局层已有数据模型的对比（新增/扩展/重构/复用）\n\n`;

  prompt += `### 3. 业务规则实现\n`;
  prompt += `- 核心业务流程的伪代码或流程图\n`;
  prompt += `- 边界条件处理（空值、越界、并发、超时）\n`;
  prompt += `- 状态机定义（如订单状态流转）\n`;
  prompt += `- 事务边界（哪些操作需要原子性）\n\n`;

  prompt += `### 4. 技术专项（按端类型选择）\n`;
  for (const p of backendPlatforms) {
    const t = platformTypes.get(p) || '';
    prompt += `- **${p} (${t})**: `;
    if (t.includes('Java')) {
      prompt += `Spring Boot 版本、JPA/MyBatis 选型、缓存策略（Redis/Caffeine）、消息队列（Kafka/RabbitMQ）、线程池配置、JVM 参数\n`;
    } else if (t.includes('Node')) {
      prompt += `NestJS/Express 选型、TypeORM/Prisma 选型、异步处理（Bull/议程）、内存管理、集群模式\n`;
    } else if (t.includes('Go')) {
      prompt += `Gin/Echo 选型、GORM 选型、协程模式、微服务框架（go-micro/gRPC）、性能优化\n`;
    } else if (t.includes('Python')) {
      prompt += `FastAPI/Django 选型、SQLAlchemy 选型、Celery 任务队列、GIL 影响、AI/ML 集成\n`;
    } else {
      prompt += `API 框架、ORM 选型、缓存、消息队列、并发处理\n`;
    }
  }
  prompt += `\n`;

  prompt += `## 输出文档\n`;
  for (const p of backendPlatforms) {
    prompt += `- \`${p}/API_INVENTORY.md\`：完整接口清单\n`;
    prompt += `- \`${p}/DATA_MODEL.md\`：数据模型设计\n`;
    prompt += `- \`${p}/BUSINESS_RULES.md\`：业务规则与状态机\n`;
    prompt += `- \`${p}/TECH_STACK.md\`：技术栈与架构说明\n`;
  }
  prompt += `\n**存放**: \`.speccore/GLOBAL/platforms/{端名}/\`\n\n`;

  prompt += `## 实时关联调整机制（重要）\n`;
  prompt += `分析当前后端端时，如果发现以下情况，**必须回退修正已分析的端**：\n`;
  prompt += `- 当前端的数据模型字段与已分析端冲突（如 user-service 和 auth-service 都定义了 User 表但字段不一致）\n`;
  prompt += `- 当前端的接口与已分析端重复（如两个服务都提供了 /api/users 接口）\n`;
  prompt += `- 当前端依赖的已分析端接口不存在或参数不匹配\n`;
  prompt += `- 已分析端的技术选型影响当前端（如缓存策略、消息格式）\n\n`;
  prompt += `**回退操作**：\n`;
  prompt += `1. 在 BUSINESS_RULES.md 或 DATA_MODEL.md 中标注冲突点和修正方案\n`;
  prompt += `2. 输出需要修正的已分析端列表和具体修正内容\n`;
  prompt += `3. 执行修正：\`speccore analyze --apply '{"{端名}/DATA_MODEL.md":"修正后的内容"}' -I ${iteration} --global\`\n\n`;

  prompt += `## 回写命令示例\n`;
  prompt += `\`\`\`bash\n`;
  for (const p of backendPlatforms) {
    prompt += `speccore analyze --apply '{"${p}/API_INVENTORY.md":"...","${p}/DATA_MODEL.md":"...","${p}/BUSINESS_RULES.md":"...","${p}/TECH_STACK.md":"..."}' -I ${iteration} --global\n`;
  }
  prompt += `\`\`\`\n`;

  return prompt;
}

/** Phase 2: 后端完成后全局实时更新 */
function buildPhase2Prompt(ctx: PhaseContext): string {
  const { iteration } = ctx;
  let prompt = `\n# Phase 2: 全局实时更新（后端分析完成后）\n\n`;
  prompt += `## 目标\n`;
  prompt += `所有后端端分析完成后，汇总后端分析成果，更新全局文档。\n\n`;

  prompt += `## 读取输入\n`;
  prompt += `1. Read 所有后端端的 API_INVENTORY.md、DATA_MODEL.md、BUSINESS_RULES.md\n`;
  prompt += `2. Read Phase 0 的 _ASSOCIATION.md（如有）\n`;
  prompt += `3. Read 已有的全局层文档（如有）\n\n`;

  prompt += `## 更新内容\n`;
  prompt += `### 1. 更新 overview/API_CONTRACT.yaml\n`;
  prompt += `汇总所有后端端的接口，生成统一契约：\n`;
  prompt += `- 接口路径、方法、消费者端、提供者端\n`;
  prompt += `- 请求/响应参数定义\n`;
  prompt += `- 枚举定义（前后端共享）\n`;
  prompt += `- 事件/消息契约\n\n`;

  prompt += `### 2. 更新 overview/ARCHITECTURE.md\n`;
  prompt += `基于后端分析结果，更新全局架构：\n`;
  prompt += `- 服务拓扑图（哪些服务依赖哪些服务）\n`;
  prompt += `- 数据流图（请求从入口到各服务的流转）\n`;
  prompt += `- 数据库分布（每个服务对应哪些表）\n`;
  prompt += `- 中间件使用（缓存、消息队列、网关等）\n\n`;

  prompt += `### 3. 更新 overview/FUNCTION_MAP.md\n`;
  prompt += `基于后端分析的功能模块，更新功能映射表：\n`;
  prompt += `- 功能单元 × 后端端映射\n`;
  prompt += `- 标注每个功能的数据模型依赖\n`;
  prompt += `- 标注服务间调用关系\n\n`;

  prompt += `### 4. 一致性校验\n`;
  prompt += `- 检查所有后端端的枚举定义是否一致\n`;
  prompt += `- 检查跨服务的实体字段是否冲突\n`;
  prompt += `- 检查接口路径是否重复\n`;
  prompt += `- 输出 CONSISTENCY_CHECK.md 记录发现的问题\n\n`;

  prompt += `## 回写命令\n`;
  prompt += `\`\`\`bash\n`;
  prompt += `speccore analyze --apply '{"overview/API_CONTRACT.yaml":"...","overview/ARCHITECTURE.md":"...","overview/FUNCTION_MAP.md":"...","overview/CONSISTENCY_CHECK.md":"..."}' -I ${iteration} --global\n`;
  prompt += `\`\`\`\n`;

  return prompt;
}

/** Phase 3: 前端逐个分析 */
function buildPhase3Prompt(ctx: PhaseContext): string {
  const { platforms, platformTypes, iteration } = ctx;
  const frontendPlatforms = platforms.filter(p => {
    const t = platformTypes.get(p) || '';
    return t.includes('H5') || t.includes('Web') || t.includes('小程序') || t.includes('Android') || t.includes('iOS') || t.includes('前端') || t.includes('桌面');
  });

  let prompt = `\n# Phase 3: 前端深度分析（逐个端分析，对齐后端契约）\n\n`;
  prompt += `## 目标\n`;
  prompt += `深入分析每个前端端，基于 Phase 2 的全局 API 契约，生成前端专属文档。\n\n`;

  if (frontendPlatforms.length === 0) {
    prompt += `> 未检测到前端端，跳过 Phase 3，直接进入 Phase 4（横向关联检查）。\n`;
    return prompt;
  }

  prompt += `## 前端端列表（${frontendPlatforms.length} 个）\n`;
  for (const p of frontendPlatforms) {
    prompt += `- ${p} (${platformTypes.get(p) || 'unknown'})\n`;
  }
  prompt += `\n`;

  prompt += `## 分析前提（必须读取）\n`;
  prompt += `在开始前端分析前，必须先读取：\n`;
  prompt += `1. \`overview/API_CONTRACT.yaml\` → 后端接口契约（字段名、类型、枚举值）\n`;
  prompt += `2. \`overview/ARCHITECTURE.md\` → 迭代综合架构（服务拓扑）\n`;
  prompt += `3. 相关后端端的 \`API_INVENTORY.md\` → 该前端调用的后端接口详情\n`;
  prompt += `4. Phase 0 的该前端端 \`_INDEX.md\` → 页面和组件索引\n\n`;

  prompt += `## 每个前端端的分析内容（必须深入）\n`;
  prompt += `### 1. 页面详细设计\n`;
  prompt += `- 每个页面的：路径、名称、核心功能、入口位置\n`;
  prompt += `- 页面组件拆分（列表页/表单页/详情页/仪表盘等）\n`;
  prompt += `- 页面间跳转关系（路由配置）\n`;
  prompt += `- 权限控制（哪些页面/按钮需要权限）\n\n`;

  prompt += `### 2. 字段映射设计（前后端契约对齐）\n`;
  prompt += `- 每个页面展示哪些字段\n`;
  prompt += `- 字段来源（后端哪个接口的哪个字段）\n`;
  prompt += `- 字段展示格式（日期格式、金额格式、枚举转标签）\n`;
  prompt += `- 字段校验规则（前端校验 + 后端校验对照）\n\n`;

  prompt += `### 3. 交互流程设计\n`;
  prompt += `- 用户操作流程（步骤流程图）\n`;
  prompt += `- 状态变化（加载中/成功/失败/空状态）\n`;
  prompt += `- 异常提示方式（toast/modal/inline）\n`;
  prompt += `- 与后端状态枚举的映射关系\n\n`;

  prompt += `### 4. API 调用清单\n`;
  prompt += `- 每个页面调用的后端接口（路径+方法+用途）\n`;
  prompt += `- 请求参数映射（前端表单字段 → 后端接口参数）\n`;
  prompt += `- 响应数据处理（字段提取、错误处理、缓存策略）\n\n`;

  prompt += `### 5. 技术专项（按端类型选择）\n`;
  for (const p of frontendPlatforms) {
    const t = platformTypes.get(p) || '';
    prompt += `- **${p} (${t})**: `;
    if (t.includes('微信') || t.includes('公众号')) {
      prompt += `微信 JS-SDK 集成、OAuth 授权流程、分享配置、微信支付、模板消息、JSSDK 权限验证\n`;
    } else if (t.includes('H5') && !t.includes('微信')) {
      prompt += `响应式布局、viewport 适配、触摸交互优化、弱网处理、首屏性能优化（FCP/LCP）、PWA 支持\n`;
    } else if (t.includes('Android')) {
      prompt += `Activity/Fragment 生命周期、权限管理、推送集成、屏幕适配、内存优化、电量优化\n`;
    } else if (t.includes('iOS')) {
      prompt += `Swift/SwiftUI 选型、App Store 审核规范、推送通知、性能优化、内存管理\n`;
    } else if (t.includes('小程序')) {
      prompt += `包体积控制（2MB 限制）、平台 API 使用、setData 优化、页面栈管理、分包加载\n`;
    } else if (t.includes('Web') || t.includes('管理')) {
      prompt += `复杂表单设计、数据表格优化、权限 UI 设计、状态管理（Pinia/Vuex/Redux）、路由守卫\n`;
    } else if (t.includes('桌面')) {
      prompt += `本地存储方案、系统 API 调用、自动更新机制、离线支持、多窗口管理\n`;
    } else {
      prompt += `前端框架选型、状态管理、路由设计、组件库、构建优化\n`;
    }
  }
  prompt += `\n`;

  prompt += `## 输出文档\n`;
  for (const p of frontendPlatforms) {
    prompt += `- \`${p}/FEATURES.md\`：产品视角功能清单（页面+交互+API调用链）\n`;
    prompt += `- \`${p}/UI_FLOW.md\`：页面流转图、用户操作流程\n`;
    prompt += `- \`${p}/API_CALL_MAP.md\`：页面 → 接口 → 后端服务 映射表\n`;
    prompt += `- \`${p}/UI_SPEC.md\`：UI 规格（字段映射必须与后端 API 字段一一对应）\n`;
    prompt += `- \`${p}/TECH_STACK.md\`：前端技术栈\n`;
  }
  prompt += `\n**存放**: \`.speccore/GLOBAL/platforms/{端名}/\`\n\n`;

  prompt += `## 实时关联调整机制（重要）\n`;
  prompt += `分析前端端时，如果发现以下情况，**必须回退修正后端或全局文档**：\n`;
  prompt += `- 前端需要的接口在后端 API_INVENTORY.md 中不存在 → 需要后端补充接口\n`;
  prompt += `- 前端字段映射与后端 API_CONTRACT.yaml 字段不一致（名称/类型/枚举值）\n`;
  prompt += `- 前端状态枚举与后端状态枚举不匹配\n`;
  prompt += `- 前端需要的权限在后端接口中未定义\n\n`;
  prompt += `**回退操作**：\n`;
  prompt += `1. 在前端文档中标注缺失/不一致点\n`;
  prompt += `2. 输出需要修正的后后端端列表和具体修正内容\n`;
  prompt += `3. 执行修正：\`speccore analyze --apply '{"{后端端}/API_INVENTORY.md":"补充后的内容"}' -I ${iteration} --global\`\n\n`;

  prompt += `## 回写命令示例\n`;
  prompt += `\`\`\`bash\n`;
  for (const p of frontendPlatforms) {
    prompt += `speccore analyze --apply '{"${p}/FEATURES.md":"...","${p}/UI_FLOW.md":"...","${p}/API_CALL_MAP.md":"...","${p}/UI_SPEC.md":"...","${p}/TECH_STACK.md":"..."}' -I ${iteration} --global\n`;
  }
  prompt += `\`\`\`\n`;

  return prompt;
}

/** Phase 4: 横向关联检查（前后端字段/接口一致性） */
function buildPhase4Prompt(ctx: PhaseContext): string {
  const { iteration } = ctx;
  let prompt = `\n# Phase 4: 横向关联检查（前后端一致性）\n\n`;
  prompt += `## 目标\n`;
  prompt += `检查所有前端端与后端端之间的一致性，确保前后端契约对齐。\n\n`;

  prompt += `## 读取输入\n`;
  prompt += `1. 所有后端端的 \`API_INVENTORY.md\` 和 \`DATA_MODEL.md\`\n`;
  prompt += `2. 所有前端端的 \`UI_SPEC.md\` 和 \`API_CALL_MAP.md\`\n`;
  prompt += `3. \`overview/API_CONTRACT.yaml\`\n\n`;

  prompt += `## 检查项\n`;
  prompt += `### 1. 字段一致性\n`;
  prompt += `- [ ] 前端 UI_SPEC.md 中的字段名与后端 API 响应字段名完全一致（大小写敏感）\n`;
  prompt += `- [ ] 前端字段类型与后端字段类型兼容（如后端 int → 前端 number）\n`;
  prompt += `- [ ] 前端必填校验与后端必填校验一致\n`;
  prompt += `- [ ] 前端枚举值与后端枚举值完全一致（数值和含义）\n\n`;

  prompt += `### 2. 接口一致性\n`;
  prompt += `- [ ] 前端 API_CALL_MAP.md 中的接口在后端 API_INVENTORY.md 中存在\n`;
  prompt += `- [ ] 接口路径完全一致（包括前缀，如 /api/  vs /api/v1/）\n`;
  prompt += `- [ ] HTTP 方法一致（GET/POST/PUT/DELETE）\n`;
  prompt += `- [ ] 请求参数名称和类型一致\n\n`;

  prompt += `### 3. 状态一致性\n`;
  prompt += `- [ ] 前端状态枚举与后端状态枚举定义一致\n`;
  prompt += `- [ ] 状态流转逻辑一致（前端展示的状态变化 = 后端实体的状态变化）\n\n`;

  prompt += `## 输出\n`;
  prompt += `- \`overview/CROSS_CHECK.md\`：横向关联检查报告\n`;
  prompt += `  - 列出所有不一致项（字段/接口/状态）\n`;
  prompt += `  - 标注严重程度（致命/严重/警告）\n`;
  prompt += `  - 给出修正建议\n\n`;

  prompt += `## 回写命令\n`;
  prompt += `\`\`\`bash\n`;
  prompt += `speccore analyze --apply '{"overview/CROSS_CHECK.md":"..."}' -I ${iteration} --global\n`;
  prompt += `\`\`\`\n`;

  return prompt;
}

/** Phase 5: 纵向关联检查（功能模块跨端完整性） */
function buildPhase5Prompt(ctx: PhaseContext): string {
  const { iteration } = ctx;
  let prompt = `\n# Phase 5: 纵向关联检查（功能模块跨端完整性）\n\n`;
  prompt += `## 目标\n`;
  prompt += `按功能模块维度检查跨端完整性，确保每个功能在各端的实现都齐全。\n\n`;

  prompt += `## 读取输入\n`;
  prompt += `1. \`overview/FUNCTION_MAP.md\` → 功能单元列表\n`;
  prompt += `2. 各端的 \`FEATURES.md\` 或 \`API_INVENTORY.md\`\n`;
  prompt += `3. \`overview/INTERACTION_MAP.md\`（如有）\n\n`;

  prompt += `## 检查项\n`;
  prompt += `### 1. 功能覆盖完整性\n`;
  prompt += `对每个功能单元，检查：\n`;
  prompt += `- [ ] 该功能涉及的所有端都有对应实现文档\n`;
  prompt += `- [ ] 后端端有对应的 API 接口\n`;
  prompt += `- [ ] 前端端有对应的页面/组件\n`;
  prompt += `- [ ] 功能单元间的依赖关系已标注\n\n`;

  prompt += `### 2. 交互链路完整性\n`;
  prompt += `- [ ] 用户操作流程完整（从入口到结果）\n`;
  prompt += `- [ ] 每个用户操作都有对应的后端接口\n`;
  prompt += `- [ ] 后端处理结果都能正确反馈到前端\n`;
  prompt += `- [ ] 异常场景有处理（错误提示、重试、降级）\n\n`;

  prompt += `### 3. 数据流完整性\n`;
  prompt += `- [ ] 数据从前端提交 → 后端处理 → 数据库存储 的链路完整\n`;
  prompt += `- [ ] 数据从数据库读取 → 后端组装 → 前端展示 的链路完整\n`;
  prompt += `- [ ] 跨服务调用的数据传递格式一致\n\n`;

  prompt += `## 输出\n`;
  prompt += `- \`overview/VERTICAL_CHECK.md\`：纵向关联检查报告\n`;
  prompt += `  - 列出功能覆盖缺口（哪些功能在哪些端缺失）\n`;
  prompt += `  - 列出交互链路断裂点\n`;
  prompt += `  - 列出数据流不一致点\n\n`;

  prompt += `## 回写命令\n`;
  prompt += `\`\`\`bash\n`;
  prompt += `speccore analyze --apply '{"overview/VERTICAL_CHECK.md":"..."}' -I ${iteration} --global\n`;
  prompt += `\`\`\`\n`;

  return prompt;
}

/** Phase 6: 最终核对检查 */
function buildPhase6Prompt(ctx: PhaseContext): string {
  const { iteration } = ctx;
  let prompt = `\n# Phase 6: 最终核对检查（完整性 + 一致性 + 遗漏检测）\n\n`;
  prompt += `## 目标\n`;
  prompt += `全面检查所有分析产出，确保没有遗漏和不一致。\n\n`;

  prompt += `## 读取输入\n`;
  prompt += `1. 所有迭代综合文档（overview/ 下的所有 .md 和 .yaml）\n`;
  prompt += `2. 所有端专属文档（platforms/{端名}/ 下的所有 .md）\n`;
  prompt += `3. \`overview/CROSS_CHECK.md\` 和 \`overview/VERTICAL_CHECK.md\`\n\n`;

  prompt += `## 核对清单（必须逐条检查）\n\n`;

  prompt += `### A. 文档完整性检查\n`;
  prompt += `- [ ] 每个后端端都有 API_INVENTORY.md、DATA_MODEL.md、BUSINESS_RULES.md、TECH_STACK.md\n`;
  prompt += `- [ ] 每个前端端都有 FEATURES.md、UI_FLOW.md、API_CALL_MAP.md、UI_SPEC.md\n`;
  prompt += `- [ ] 全局文档齐全：API_CONTRACT.yaml、ARCHITECTURE.md、FUNCTION_MAP.md、CONSISTENCY_CHECK.md\n`;
  prompt += `- [ ] 检查报告齐全：CROSS_CHECK.md、VERTICAL_CHECK.md\n\n`;

  prompt += `### B. 内容完整性检查\n`;
  prompt += `- [ ] 所有文档都没有"待填充"、"_待定_"、"TBD"等占位符\n`;
  prompt += `- [ ] 所有接口都有完整的参数定义和响应定义\n`;
  prompt += `- [ ] 所有数据模型都有完整的字段定义\n`;
  prompt += `- [ ] 所有页面都有字段映射和交互流程\n`;
  prompt += `- [ ] 所有枚举值都有前后端一致的定义\n\n`;

  prompt += `### C. 一致性检查\n`;
  prompt += `- [ ] API_CONTRACT.yaml 中的接口与后端 API_INVENTORY.md 完全一致\n`;
  prompt += `- [ ] API_CONTRACT.yaml 中的枚举与前端 UI_SPEC.md 完全一致\n`;
  prompt += `- [ ] FUNCTION_MAP.md 中的功能单元与 REQUIREMENT.md 的功能模块一一对应\n`;
  prompt += `- [ ] 各端 TECH_STACK.md 的技术选型与 overview/ARCHITECTURE.md 一致\n\n`;

  prompt += `### D. 遗漏检测\n`;
  prompt += `- [ ] 需求文档中的每个功能模块都有对应的分析文档\n`;
  prompt += `- [ ] 需求文档中的每个接口需求都有对应的 API 定义\n`;
  prompt += `- [ ] 需求文档中的每个页面需求都有对应的页面设计\n`;
  prompt += `- [ ] 需求文档中的每个业务规则都有对应的实现说明\n`;
  prompt += `- [ ] 没有"孤儿代码"（后端有接口但前端没调用，或前端有页面但后端没接口）\n\n`;

  prompt += `## 输出\n`;
  prompt += `- \`overview/FINAL_AUDIT.md\`：最终核对报告\n`;
  prompt += `  - 检查项总数、通过数、失败数\n`;
  prompt += `  - 每个失败项的详细说明、影响、修正建议\n`;
  prompt += `  - 按严重程度排序（致命 > 严重 > 警告）\n\n`;

  prompt += `## 回写命令\n`;
  prompt += `\`\`\`bash\n`;
  prompt += `speccore analyze --apply '{"overview/FINAL_AUDIT.md":"..."}' -I ${iteration} --global\n`;
  prompt += `\`\`\`\n`;

  prompt += `> ⚠️ 如果 FINAL_AUDIT.md 中有"致命"或"严重"级别的问题，必须回退到对应 Phase 修正后再重新执行 Phase 6。\n`;

  return prompt;
}

// ── 实时关联调整检测 ──

/**
 * 检测当前分析结果是否需要回退修正已分析的文档
 */
export async function detectBacktrackingNeeds(
  iterDir: string,
  currentPhase: AnalyzePhase,
): Promise<{ needed: boolean; targets: string[]; reasons: string[] }> {
  const targets: string[] = [];
  const reasons: string[] = [];

  const globalDir = await resolveGlobalDir(iterDir);
  const platformsDir = join(globalDir, 'platforms');

  // Phase 1 (后端分析) 完成后，检查是否需要调整 Phase 0 的 _INDEX.md
  if (currentPhase === 'phase1-backend') {
    // 检查：后端深入分析发现的接口/实体是否在 _INDEX.md 中缺失
    // 简化实现：检查文件存在性
    try {
      const platformEntries = await readdir(platformsDir, { withFileTypes: true });
      for (const entry of platformEntries) {
        if (!entry.isDirectory()) continue;
        const platformDir = join(platformsDir, entry.name);
        const indexPath = join(platformDir, '_INDEX.md');
        const apiInventoryPath = join(platformDir, 'API_INVENTORY.md');
        if (await pathExists(apiInventoryPath) && await pathExists(indexPath)) {
          const indexContent = await readFile(indexPath, 'utf-8');
          const apiContent = await readFile(apiInventoryPath, 'utf-8');
          // 简单检查：API_INVENTORY 中的接口路径是否在 _INDEX 中
          const apiPaths = apiContent.match(/\/api\/[a-zA-Z0-9\/\-_]+/g) || [];
          const missingInIndex = apiPaths.filter(p => !indexContent.includes(p));
          if (missingInIndex.length > 0) {
            targets.push(`${entry.name}/_INDEX.md`);
            reasons.push(`${entry.name} 的 API_INVENTORY.md 中有 ${missingInIndex.length} 个接口未在 _INDEX.md 中收录`);
          }
        }
      }
    } catch { /* ignore */ }
  }

  // Phase 3 (前端分析) 完成后，检查是否需要调整后端 API
  if (currentPhase === 'phase3-frontend') {
    try {
      const platforms = await parsePlatformList();
      const types = await parsePlatformTypes();
      const backendPlatforms = platforms.filter(p => {
        const t = types.get(p) || '';
        return t.includes('service') || t.includes('后端');
      });
      const frontendPlatforms = platforms.filter(p => !backendPlatforms.includes(p));

      for (const fp of frontendPlatforms) {
        const apiCallMapPath = join(platformsDir, fp, 'API_CALL_MAP.md');
        if (!(await pathExists(apiCallMapPath))) continue;
        const apiCallContent = await readFile(apiCallMapPath, 'utf-8');
        const frontendApis = apiCallContent.match(/\/api\/[a-zA-Z0-9\/\-_]+/g) || [];

        for (const apiPath of [...new Set(frontendApis)]) {
          let found = false;
          for (const bp of backendPlatforms) {
            const apiInventoryPath = join(platformsDir, bp, 'API_INVENTORY.md');
            if (await pathExists(apiInventoryPath)) {
              const invContent = await readFile(apiInventoryPath, 'utf-8');
              if (invContent.includes(apiPath)) {
                found = true;
                break;
              }
            }
          }
          if (!found) {
            targets.push(`${fp}/API_CALL_MAP.md`);
            reasons.push(`前端 ${fp} 调用的接口 ${apiPath} 在所有后端端中都未找到定义`);
          }
        }
      }
    } catch { /* ignore */ }
  }

  return { needed: targets.length > 0, targets, reasons };
}

// ── 最终核对检查 ──

/**
 * 执行最终核对检查，返回发现的问题列表
 */
export async function runFinalAudit(iterDir: string): Promise<AuditIssue[]> {
  const issues: AuditIssue[] = [];
  const globalDir = await resolveGlobalDir(iterDir);
  const platformsDir = join(globalDir, 'platforms');

  // 1. 检查全局文档完整性
  const requiredGlobalDocs = ['API_CONTRACT.yaml', 'ARCHITECTURE.md', 'FUNCTION_MAP.md'];
  for (const doc of requiredGlobalDocs) {
    if (!(await pathExists(join(globalDir, doc)))) {
      issues.push({
        severity: 'error',
        category: 'missing-doc',
        description: `全局文档缺失: ${doc}`,
        affectedFiles: [join(globalDir, doc)],
        suggestion: `执行对应 Phase 生成 ${doc}`,
      });
    }
  }

  // 2. 检查端文档完整性
  try {
    const platforms = await parsePlatformList();
    const types = await parsePlatformTypes();
    for (const p of platforms) {
      const pDir = join(platformsDir, p);
      const t = types.get(p) || '';
      const isBackend = t.includes('service') || t.includes('后端');

      if (isBackend) {
        for (const doc of ['API_INVENTORY.md', 'DATA_MODEL.md', 'BUSINESS_RULES.md']) {
          if (!(await pathExists(join(pDir, doc)))) {
            issues.push({
              severity: 'error',
              category: 'missing-doc',
              description: `后端端 ${p} 缺失文档: ${doc}`,
              affectedFiles: [join(pDir, doc)],
              suggestion: `执行 Phase 1 生成 ${p}/${doc}`,
            });
          }
        }
      } else {
        for (const doc of ['FEATURES.md', 'UI_FLOW.md', 'API_CALL_MAP.md', 'UI_SPEC.md']) {
          if (!(await pathExists(join(pDir, doc)))) {
            issues.push({
              severity: 'error',
              category: 'missing-doc',
              description: `前端端 ${p} 缺失文档: ${doc}`,
              affectedFiles: [join(pDir, doc)],
              suggestion: `执行 Phase 3 生成 ${p}/${doc}`,
            });
          }
        }
      }
    }
  } catch { /* ignore */ }

  // 3. 检查内容占位符
  try {
    const allMdFiles = await findAllMarkdownFiles(globalDir);
    for (const file of allMdFiles) {
      const content = await readFile(file, 'utf-8');
      const placeholders = ['待填充', '_待定_', 'TBD', 'TODO', 'FIXME'];
      for (const ph of placeholders) {
        if (content.includes(ph)) {
          issues.push({
            severity: 'warning',
            category: 'missing-doc',
            description: `文档中包含占位符 "${ph}"`,
            affectedFiles: [file],
            suggestion: '补充具体内容后移除占位符',
          });
        }
      }
    }
  } catch { /* ignore */ }

  return issues;
}

/** 递归查找所有 markdown 文件 */
async function findAllMarkdownFiles(dir: string): Promise<string[]> {
  const result: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        result.push(...await findAllMarkdownFiles(fullPath));
      } else if (entry.name.endsWith('.md')) {
        result.push(fullPath);
      }
    }
  } catch { /* ignore */ }
  return result;
}

// ── 辅助函数 ──

/**
 * 获取全局文档根目录（优先迭代级 020-specs/overview/，回退旧版 global/，再回退项目级 .speccore/GLOBAL/）
 */
async function resolveGlobalDir(iterDir: string): Promise<string> {
  const iterOverview = join(iterDir, '020-specs', 'overview');
  if (await pathExists(iterOverview)) return iterOverview;
  const iterGlobal = join(iterDir, '020-specs', 'global');
  if (await pathExists(iterGlobal)) return iterGlobal;
  const projectRoot = dirname(iterDir);
  const projectGlobal = join(projectRoot, '.speccore', 'GLOBAL');
  if (await pathExists(projectGlobal)) return projectGlobal;
  return iterGlobal; // 默认返回迭代级路径（即使不存在，后续操作会创建）
}

/**
 * 获取 Phase 顺序
 */
export function getPhaseSequence(): AnalyzePhase[] {
  return [
    'phase0-scan',
    'phase1-backend',
    'phase2-global-update',
    'phase3-frontend',
    'phase4-cross-check',
    'phase5-vertical-check',
    'phase6-final-audit',
  ];
}

/**
 * 获取 Phase 的中文名称
 */
export function getPhaseDisplayName(phase: AnalyzePhase): string {
  const names: Record<AnalyzePhase, string> = {
    'phase0-scan': 'Phase 0: 快速全局扫描',
    'phase1-backend': 'Phase 1: 后端深度分析',
    'phase2-global-update': 'Phase 2: 全局实时更新',
    'phase3-frontend': 'Phase 3: 前端深度分析',
    'phase4-cross-check': 'Phase 4: 横向关联检查',
    'phase5-vertical-check': 'Phase 5: 纵向关联检查',
    'phase6-final-audit': 'Phase 6: 最终核对检查',
  };
  return names[phase] || phase;
}

/**
 * 检测后端端之间的依赖拓扑顺序
 * 简化版：基于 FUNCTION_MAP.md 中的依赖关系排序
 */
export async function detectBackendDependencyOrder(
  iterDir: string,
  backendPlatforms: string[]
): Promise<string[]> {
  // 默认返回字母序，实际实现可以读取 FUNCTION_MAP.md 或 DEPS.md 解析依赖关系
  return [...backendPlatforms].sort();
}
