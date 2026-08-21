/**
 * platform-addition — 新增端分析引擎（v6.75.0）
 *
 * 核心能力：
 * 1. 单独分析新端（读取源码、建立索引、深入分析）
 * 2. 自动分析新端与已有端的关系（接口调用、数据依赖、功能重叠）
 * 3. 更新全局层文档（FUNCTION_MAP、API_CONTRACT、ARCHITECTURE、INTERACTION_MAP）
 * 4. 检查新端与已有端的接口一致性
 *
 * 使用场景：
 * - 迭代中新增了一个端（如新增 admin-web、小程序端）
 * - 项目后期扩展新平台
 */

import { join } from 'path';
import { pathExists, readFile, readdir } from 'fs-extra';
import { logger } from '../utils/logger';
import { parsePlatformList, parsePlatformTypes } from './spec-paths';

// ── 类型定义 ──

export interface NewPlatformAnalysis {
  platform: string;
  platformType: string;
  isBackend: boolean;
  existingPlatforms: string[];
  /** 新端与已有端的关系分析 */
  crossPlatformRelations: CrossPlatformRelation[];
  /** 需要更新的全局文档 */
  globalUpdates: GlobalUpdate[];
  /** 新端自身分析产出 */
  newPlatformOutputs: string[];
  /** 一致性检查项 */
  consistencyChecks: ConsistencyCheck[];
}

export interface CrossPlatformRelation {
  fromPlatform: string;
  toPlatform: string;
  relationType: 'api-consumer' | 'api-provider' | 'shared-data' | 'event-pub' | 'event-sub' | 'auth-dependency';
  description: string;
  interfaces?: string[];
}

export interface GlobalUpdate {
  file: string;
  action: 'append' | 'modify' | 'create';
  description: string;
  content: string;
}

export interface ConsistencyCheck {
  category: 'api-path' | 'enum-value' | 'data-model' | 'auth' | 'naming';
  status: 'pass' | 'fail' | 'warning';
  description: string;
  suggestion: string;
}

// ── 核心函数 ──

/**
 * 执行新增端分析
 * @param iterDir 迭代目录
 * @param newPlatform 新增端名
 */
export async function analyzeNewPlatform(
  iterDir: string,
  newPlatform: string
): Promise<NewPlatformAnalysis> {
  const platforms = await parsePlatformList();
  const platformTypes = await parsePlatformTypes();

  const result: NewPlatformAnalysis = {
    platform: newPlatform,
    platformType: platformTypes.get(newPlatform) || 'unknown',
    isBackend: false,
    existingPlatforms: platforms.filter(p => p !== newPlatform),
    crossPlatformRelations: [],
    globalUpdates: [],
    newPlatformOutputs: [],
    consistencyChecks: [],
  };

  // 判断端类型
  const pt = result.platformType.toLowerCase();
  result.isBackend = pt.includes('service') || pt.includes('java') || pt.includes('node') || pt.includes('go') || pt.includes('python') || pt.includes('后端');

  // 1. 分析新端与已有端的关系
  result.crossPlatformRelations = await analyzeCrossPlatformRelations(iterDir, newPlatform, result.existingPlatforms, result.isBackend);

  // 2. 生成全局文档更新建议
  result.globalUpdates = await buildGlobalUpdates(iterDir, newPlatform, result);

  // 3. 确定新端自身产出
  result.newPlatformOutputs = buildNewPlatformOutputs(newPlatform, result.isBackend);

  // 4. 一致性检查
  result.consistencyChecks = await runConsistencyChecks(iterDir, newPlatform, result);

  return result;
}

/**
 * 生成新增端分析 Prompt
 */
export function buildNewPlatformPrompt(
  iterDir: string,
  analysis: NewPlatformAnalysis,
  iteration: string
): string {
  let prompt = `\n# 任务: 新增端分析 — ${analysis.platform} (${analysis.platformType})\n\n`;

  prompt += `## 背景\n\n`;
  prompt += `本项目新增了一个端 **${analysis.platform}**（类型: ${analysis.platformType}），需要：\n`;
  prompt += `1. 单独分析该端的源码和架构\n`;
  prompt += `2. 分析该端与已有端（${analysis.existingPlatforms.join(', ')}）的关系\n`;
  prompt += `3. 更新全局层文档，纳入新端\n\n`;

  // 已有端信息
  prompt += `## 已有端信息\n\n`;
  prompt += `| 端名 | 类型 | 已有产出 |\n`;
  prompt += `| :--- | :--- | :--- |\n`;
  for (const p of analysis.existingPlatforms) {
    prompt += `| ${p} | ${analysis.existingPlatforms.includes(p) ? '已有' : '新'} | 参见 platforms/${p}/ |\n`;
  }
  prompt += `\n`;

  // 跨端关系
  if (analysis.crossPlatformRelations.length > 0) {
    prompt += `## 已识别的跨端关系\n\n`;
    prompt += `| 关系 | 从端 | 到端 | 说明 |\n`;
    prompt += `| :--- | :--- | :--- | :--- |\n`;
    for (const r of analysis.crossPlatformRelations) {
      const typeLabels: Record<string, string> = {
        'api-consumer': 'API消费者',
        'api-provider': 'API提供者',
        'shared-data': '共享数据',
        'event-pub': '事件发布',
        'event-sub': '事件订阅',
        'auth-dependency': '认证依赖',
      };
      prompt += `| ${typeLabels[r.relationType] || r.relationType} | ${r.fromPlatform} | ${r.toPlatform} | ${r.description} |\n`;
    }
    prompt += `\n`;
  }

  // 新端分析要求
  prompt += `## 新端分析要求\n\n`;
  if (analysis.isBackend) {
    prompt += `### 后端端分析（${analysis.platform}）\n\n`;
    prompt += `1. **源码扫描**：Read ${analysis.platform} 的源码目录，提取：\n`;
    prompt += `   - Controller/Handler 接口列表（路径/方法/参数）\n`;
    prompt += `   - Entity/Model 数据模型（字段/类型/关系）\n`;
    prompt += `   - Service 业务逻辑\n\n`;
    prompt += `2. **API 设计**：\n`;
    prompt += `   - 接口路径必须与已有后端端遵循同一命名规范\n`;
    prompt += `   - 枚举值必须与已有端一致（如状态码、类型值）\n`;
    prompt += `   - 鉴权机制必须与全局认证体系兼容\n\n`;
    prompt += `3. **数据模型**：\n`;
    prompt += `   - 如果与已有端共享实体，字段定义必须完全一致\n`;
    prompt += `   - 如果是新实体，需在全局 ARCHITECTURE.md 中标注\n\n`;
  } else {
    prompt += `### 前端端分析（${analysis.platform}）\n\n`;
    prompt += `1. **源码扫描**：Read ${analysis.platform} 的源码目录，提取：\n`;
    prompt += `   - 页面路由表（路径/组件/权限）\n`;
    prompt += `   - API 调用清单（调用哪些后端接口）\n`;
    prompt += `   - 状态管理设计\n\n`;
    prompt += `2. **前后端对齐**：\n`;
    prompt += `   - 调用的后端接口必须在已有后端端中存在\n`;
    prompt += `   - 字段映射必须与后端 API 响应一致\n`;
    prompt += `   - 状态枚举必须与后端一致\n\n`;
    prompt += `3. **端特性**：\n`;
    const pt = analysis.platformType.toLowerCase();
    if (pt.includes('微信') || pt.includes('公众号')) {
      prompt += `   - 微信 JS-SDK 集成、OAuth 授权、分享、支付\n`;
    } else if (pt.includes('小程序')) {
      prompt += `   - 包体积控制、平台 API、页面栈管理\n`;
    } else if (pt.includes('h5')) {
      prompt += `   - 响应式布局、触摸交互、弱网处理\n`;
    } else if (pt.includes('web') || pt.includes('admin')) {
      prompt += `   - 复杂表单、数据表格、权限 UI\n`;
    }
    prompt += `\n`;
  }

  // 全局文档更新
  prompt += `## 全局文档更新要求\n\n`;
  prompt += `新端分析完成后，必须更新以下全局文档：\n\n`;
  for (const update of analysis.globalUpdates) {
    const actionLabels: Record<string, string> = { append: '追加', modify: '修改', create: '创建' };
    prompt += `- **${actionLabels[update.action]}** \`${update.file}\`：${update.description}\n`;
  }
  prompt += `\n`;

  // 一致性检查
  if (analysis.consistencyChecks.length > 0) {
    prompt += `## 一致性检查清单\n\n`;
    for (const check of analysis.consistencyChecks) {
      const statusIcon = check.status === 'pass' ? '✅' : check.status === 'fail' ? '❌' : '⚠️';
      prompt += `- ${statusIcon} **${check.category}**: ${check.description}\n`;
      if (check.status !== 'pass') {
        prompt += `  → 建议: ${check.suggestion}\n`;
      }
    }
    prompt += `\n`;
  }

  // 执行步骤
  prompt += `## 执行步骤\n\n`;
  prompt += `### Step 1: 读取已有全局文档\n`;
  prompt += `- Read \`.speccore/GLOBAL/global/FUNCTION_MAP.md\` → 了解已有功能单元\n`;
  prompt += `- Read \`.speccore/GLOBAL/global/API_CONTRACT.yaml\` → 了解已有接口契约\n`;
  prompt += `- Read \`.speccore/GLOBAL/global/ARCHITECTURE.md\` → 了解全局架构\n`;
  prompt += `- Read 已有端的 \`platforms/{端}/_INDEX.md\` → 了解已有端的能力\n\n`;

  prompt += `### Step 2: 读取新端源码\n`;
  prompt += `- Read \`.speccore/CONSTITUTION.md\` → 获取 ${analysis.platform} 的源码路径\n`;
  prompt += `- 扫描 ${analysis.platform} 的源码目录，建立 _INDEX.md\n\n`;

  prompt += `### Step 3: 深入分析新端\n`;
  if (analysis.isBackend) {
    prompt += `- 生成 API_INVENTORY.md、DATA_MODEL.md、BUSINESS_RULES.md、TECH_STACK.md\n`;
  } else {
    prompt += `- 生成 FEATURES.md、UI_FLOW.md、API_CALL_MAP.md、UI_SPEC.md、TECH_STACK.md\n`;
  }
  prompt += `\n`;

  prompt += `### Step 4: 更新全局文档\n`;
  prompt += `- 在 FUNCTION_MAP.md 中追加新端涉及的功能单元\n`;
  prompt += `- 在 API_CONTRACT.yaml 中追加新端相关的接口契约\n`;
  prompt += `- 在 ARCHITECTURE.md 中更新服务拓扑，加入 ${analysis.platform}\n`;
  prompt += `- 在 INTERACTION_MAP.md 中追加涉及 ${analysis.platform} 的交互时序\n\n`;

  prompt += `## 写入方式\n`;
  prompt += `\`\`\`bash\n`;
  prompt += `# 新端文档\n`;
  if (analysis.isBackend) {
    prompt += `speccore analyze --apply '{"${analysis.platform}/API_INVENTORY.md":"...","${analysis.platform}/DATA_MODEL.md":"...","${analysis.platform}/BUSINESS_RULES.md":"...","${analysis.platform}/TECH_STACK.md":"..."}' -I ${iteration} --global\n`;
  } else {
    prompt += `speccore analyze --apply '{"${analysis.platform}/FEATURES.md":"...","${analysis.platform}/UI_FLOW.md":"...","${analysis.platform}/API_CALL_MAP.md":"...","${analysis.platform}/UI_SPEC.md":"...","${analysis.platform}/TECH_STACK.md":"..."}' -I ${iteration} --global\n`;
  }
  prompt += `\n# 全局文档更新\n`;
  prompt += `speccore analyze --apply '{"overview/FUNCTION_MAP.md":"更新后的内容","overview/API_CONTRACT.yaml":"更新后的内容","overview/ARCHITECTURE.md":"更新后的内容","overview/INTERACTION_MAP.md":"更新后的内容"}' -I ${iteration} --global\n`;
  prompt += `\`\`\`\n`;

  return prompt;
}

// ── 内部函数 ──

/** 分析新端与已有端的关系 */
async function analyzeCrossPlatformRelations(
  iterDir: string,
  newPlatform: string,
  existingPlatforms: string[],
  isBackend: boolean
): Promise<CrossPlatformRelation[]> {
  const relations: CrossPlatformRelation[] = [];

  const platformsDir = join(iterDir, '..', '.speccore', 'GLOBAL', 'platforms');

  if (isBackend) {
    // 新后端端：检查哪些前端端会调用它
    for (const ep of existingPlatforms) {
      const isFrontend = !(await isBackendPlatform(ep));
      if (isFrontend) {
        const apiCallMapPath = join(platformsDir, ep, 'API_CALL_MAP.md');
        if (await pathExists(apiCallMapPath)) {
          const content = await readFile(apiCallMapPath, 'utf-8');
          // 简单检查：前端是否调用了新端的路径（假设新端路径有特定前缀）
          // 实际实现可以更精确
          relations.push({
            fromPlatform: ep,
            toPlatform: newPlatform,
            relationType: 'api-consumer',
            description: `${ep} 可能调用 ${newPlatform} 提供的接口（需进一步确认）`,
          });
        }
      }
    }
  } else {
    // 新前端端：检查它调用哪些已有后端端
    for (const ep of existingPlatforms) {
      const isBack = await isBackendPlatform(ep);
      if (isBack) {
        relations.push({
          fromPlatform: newPlatform,
          toPlatform: ep,
          relationType: 'api-consumer',
          description: `${newPlatform} 需要调用 ${ep} 的后端接口`,
        });
      }
    }
  }

  // 认证依赖：所有新端都依赖认证服务（如果有）
  const authPlatform = existingPlatforms.find(p => p.toLowerCase().includes('auth') || p.toLowerCase().includes('user'));
  if (authPlatform) {
    relations.push({
      fromPlatform: newPlatform,
      toPlatform: authPlatform,
      relationType: 'auth-dependency',
      description: `${newPlatform} 的认证依赖 ${authPlatform}`,
    });
  }

  return relations;
}

/** 生成全局文档更新建议 */
async function buildGlobalUpdates(
  iterDir: string,
  newPlatform: string,
  analysis: NewPlatformAnalysis
): Promise<GlobalUpdate[]> {
  const updates: GlobalUpdate[] = [];

  updates.push({
    file: 'overview/FUNCTION_MAP.md',
    action: 'modify',
    description: `追加 ${newPlatform} 涉及的功能单元和涉及端列`,
    content: `在 FUNCTION_MAP.md 表格中，为每个涉及 ${newPlatform} 的功能单元追加「${newPlatform}」到「涉及端」列`,
  });

  updates.push({
    file: 'overview/API_CONTRACT.yaml',
    action: 'modify',
    description: `追加 ${newPlatform} 相关的接口契约定义`,
    content: `在 API_CONTRACT.yaml 中追加 ${newPlatform} 提供或消费的接口`,
  });

  updates.push({
    file: 'overview/ARCHITECTURE.md',
    action: 'modify',
    description: `更新服务拓扑图，加入 ${newPlatform}`,
    content: `在 ARCHITECTURE.md 的服务拓扑和数据流图中加入 ${newPlatform}`,
  });

  updates.push({
    file: 'overview/INTERACTION_MAP.md',
    action: 'append',
    description: `追加涉及 ${newPlatform} 的交互时序图`,
    content: `为涉及 ${newPlatform} 的功能单元追加 Mermaid sequenceDiagram`,
  });

  return updates;
}

/** 构建新端自身产出列表 */
function buildNewPlatformOutputs(platform: string, isBackend: boolean): string[] {
  if (isBackend) {
    return [
      `platforms/${platform}/_INDEX.md`,
      `platforms/${platform}/API_INVENTORY.md`,
      `platforms/${platform}/DATA_MODEL.md`,
      `platforms/${platform}/BUSINESS_RULES.md`,
      `platforms/${platform}/TECH_STACK.md`,
    ];
  }
  return [
    `platforms/${platform}/_INDEX.md`,
    `platforms/${platform}/FEATURES.md`,
    `platforms/${platform}/UI_FLOW.md`,
    `platforms/${platform}/API_CALL_MAP.md`,
    `platforms/${platform}/UI_SPEC.md`,
    `platforms/${platform}/TECH_STACK.md`,
  ];
}

/** 运行一致性检查 */
async function runConsistencyChecks(
  iterDir: string,
  newPlatform: string,
  analysis: NewPlatformAnalysis
): Promise<ConsistencyCheck[]> {
  const checks: ConsistencyCheck[] = [];
  const platformsDir = join(iterDir, '..', '.speccore', 'GLOBAL', 'platforms');

  // 1. API 路径命名规范
  checks.push({
    category: 'api-path',
    status: 'warning',
    description: `新端 ${newPlatform} 的 API 路径需遵循项目统一规范（如 /api/v1/ 前缀）`,
    suggestion: '在 API_INVENTORY.md 中确认路径前缀与已有端一致',
  });

  // 2. 枚举值一致性
  const apiContractPath = join(iterDir, '..', '.speccore', 'GLOBAL', 'API_CONTRACT.yaml');
  if (await pathExists(apiContractPath)) {
    checks.push({
      category: 'enum-value',
      status: 'warning',
      description: `新端使用的枚举值必须与 overview/API_CONTRACT.yaml 中定义的一致`,
      suggestion: '对比新端的枚举定义与全局契约',
    });
  }

  // 3. 数据模型一致性（如果共享实体）
  if (analysis.isBackend) {
    checks.push({
      category: 'data-model',
      status: 'warning',
      description: `新端 ${newPlatform} 的数据模型如果与已有端共享实体，字段定义必须一致`,
      suggestion: '对比 DATA_MODEL.md 与已有后端端的实体定义',
    });
  }

  // 4. 认证一致性
  checks.push({
    category: 'auth',
    status: 'warning',
    description: `新端的认证机制必须与全局认证体系兼容`,
    suggestion: '确认使用统一的鉴权方式（如 JWT/OAuth2）',
  });

  // 5. 命名规范
  checks.push({
    category: 'naming',
    status: 'warning',
    description: `新端的文件/类/接口命名需遵循项目规范`,
    suggestion: '参考 .speccore/PATTERNS/ 中的命名模式',
  });

  return checks;
}

/** 判断端是否为后端 */
async function isBackendPlatform(platform: string): Promise<boolean> {
  const types = await parsePlatformTypes();
  const t = (types.get(platform) || '').toLowerCase();
  return t.includes('service') || t.includes('java') || t.includes('node') || t.includes('go') || t.includes('python') || t.includes('后端');
}
