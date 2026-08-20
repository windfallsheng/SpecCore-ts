/**
 * module-analyzer — 功能模块级全局分析引擎（v6.76.0）
 *
 * 核心能力：
 * 1. 在全局层对单个功能模块进行分析（区别于 --feature 的局部分析）
 * 2. 模块已存在 → 重新分析该模块，更新全局层 + 各端相关文档
 * 3. 模块不存在 → 从需求文档中提取该模块，按全局标准分析
 * 4. 自动识别模块涉及的端，只更新相关端文档
 *
 * 与 --feature 的区别：
 * - --feature: 局部分析 → 只生成 020-specs/features/{name}.md
 * - --module: 全局视角 → 更新 FUNCTION_MAP / INTERACTION_MAP / API_CONTRACT / 各端文档
 */

import { join } from 'path';
import { pathExists, readFile, readdir } from 'fs-extra';
import { logger } from '../utils/logger';
import { parsePlatformList, parsePlatformTypes } from './spec-paths';

// ── 类型定义 ──

export interface ModuleAnalysisResult {
  moduleName: string;
  exists: boolean;
  involvedPlatforms: string[];
  isBackend: boolean[];
  globalUpdates: ModuleGlobalUpdate[];
  platformUpdates: ModulePlatformUpdate[];
  crossPlatformChecks: CrossPlatformCheck[];
}

export interface ModuleGlobalUpdate {
  file: string;
  action: 'update-section' | 'append-row' | 'replace-sequence' | 'update-contract';
  description: string;
}

export interface ModulePlatformUpdate {
  platform: string;
  files: string[];
  description: string;
}

export interface CrossPlatformCheck {
  category: 'api-consistency' | 'field-mapping' | 'enum-consistency' | 'auth-alignment';
  platforms: string[];
  description: string;
}

export interface ModuleInfo {
  name: string;
  involvedPlatforms: string[];
  description: string;
  sourceFile?: string;
}

// ── 核心函数 ──

/**
 * 执行功能模块级全局分析
 * @param iterDir 迭代目录
 * @param moduleName 功能模块名
 */
export async function analyzeModule(
  iterDir: string,
  moduleName: string
): Promise<ModuleAnalysisResult> {
  const result: ModuleAnalysisResult = {
    moduleName,
    exists: false,
    involvedPlatforms: [],
    isBackend: [],
    globalUpdates: [],
    platformUpdates: [],
    crossPlatformChecks: [],
  };

  // 1. 检查模块是否已存在于全局 FUNCTION_MAP
  const existingModule = await findModuleInFunctionMap(iterDir, moduleName);
  if (existingModule) {
    result.exists = true;
    result.involvedPlatforms = existingModule.involvedPlatforms;
  } else {
    // 从需求文档中查找模块
    const moduleFromReq = await findModuleInRequirements(iterDir, moduleName);
    if (moduleFromReq) {
      result.involvedPlatforms = moduleFromReq.involvedPlatforms;
    }
  }

  // 2. 确定各端类型
  const platformTypes = await parsePlatformTypes();
  for (const p of result.involvedPlatforms) {
    const pt = (platformTypes.get(p) || '').toLowerCase();
    const isBack = pt.includes('service') || pt.includes('java') || pt.includes('node') || pt.includes('go') || pt.includes('python') || pt.includes('后端');
    result.isBackend.push(isBack);
  }

  // 3. 生成全局文档更新计划
  result.globalUpdates = buildGlobalUpdatePlan(moduleName, result.exists);

  // 4. 生成各端文档更新计划
  result.platformUpdates = await buildPlatformUpdatePlan(iterDir, moduleName, result.involvedPlatforms, result.isBackend);

  // 5. 跨端一致性检查项
  result.crossPlatformChecks = buildCrossPlatformChecks(moduleName, result.involvedPlatforms);

  return result;
}

/**
 * 生成模块级分析 Prompt
 */
export function buildModuleAnalysisPrompt(
  iterDir: string,
  result: ModuleAnalysisResult,
  iteration: string
): string {
  const { moduleName, exists, involvedPlatforms } = result;

  let prompt = `\n# 任务: 功能模块级全局分析 — ${moduleName}\n\n`;

  // 模块状态
  if (exists) {
    prompt += `## 模块状态：已存在（重新分析）\n\n`;
    prompt += `功能模块 **${moduleName}** 已在全局文档中存在，本次分析将：\n`;
    prompt += `1. 读取该模块当前的全局分析结果\n`;
    prompt += `2. 对比最新需求，识别变更点\n`;
    prompt += `3. 更新全局层文档中该模块的相关内容\n`;
    prompt += `4. 更新各端文档中该模块的相关内容\n\n`;
  } else {
    prompt += `## 模块状态：新增（首次分析）\n\n`;
    prompt += `功能模块 **${moduleName}** 尚未在全局文档中分析，本次分析将：\n`;
    prompt += `1. 从需求文档中提取该模块的完整需求\n`;
    prompt += `2. 按全局分析标准，分析该模块涉及的所有端\n`;
    prompt += `3. 在全局层文档中追加该模块\n`;
    prompt += `4. 在各端文档中追加该模块的相关内容\n\n`;
  }

  // 涉及端
  prompt += `## 涉及端（${involvedPlatforms.length} 个）\n\n`;
  for (let i = 0; i < involvedPlatforms.length; i++) {
    const p = involvedPlatforms[i];
    const isBack = result.isBackend[i];
    prompt += `- **${p}** (${isBack ? '后端' : '前端'})\n`;
  }
  prompt += `\n`;

  // 需要更新的全局文档
  prompt += `## 全局文档更新计划\n\n`;
  for (const update of result.globalUpdates) {
    const actionLabels: Record<string, string> = {
      'update-section': '更新章节',
      'append-row': '追加行',
      'replace-sequence': '替换时序图',
      'update-contract': '更新契约',
    };
    prompt += `- **${actionLabels[update.action]}** \`${update.file}\`：${update.description}\n`;
  }
  prompt += `\n`;

  // 各端文档更新
  prompt += `## 各端文档更新计划\n\n`;
  for (const pu of result.platformUpdates) {
    prompt += `### ${pu.platform}\n`;
    prompt += `${pu.description}\n`;
    for (const f of pu.files) {
      prompt += `- \`${f}\`\n`;
    }
    prompt += `\n`;
  }

  // 跨端一致性检查
  if (result.crossPlatformChecks.length > 0) {
    prompt += `## 跨端一致性检查\n\n`;
    for (const check of result.crossPlatformChecks) {
      prompt += `- **${check.category}** (${check.platforms.join(' ↔ ')}): ${check.description}\n`;
    }
    prompt += `\n`;
  }

  // 执行步骤
  prompt += `## 执行步骤\n\n`;

  prompt += `### Step 1: 读取当前全局文档\n`;
  if (exists) {
    prompt += `- Read \`020-specs/overview/FUNCTION_MAP.md\` → 找到 "${moduleName}" 当前定义\n`;
    prompt += `- Read \`020-specs/overview/INTERACTION_MAP.md\` → 找到 "${moduleName}" 当前时序图\n`;
    prompt += `- Read \`020-specs/overview/API_CONTRACT.yaml\` → 找到 "${moduleName}" 相关接口\n`;
    prompt += `- Read \`020-specs/overview/REQUIREMENT.md\` → 找到 "${moduleName}" 当前章节\n`;
  } else {
    prompt += `- Read \`020-specs/overview/FUNCTION_MAP.md\` → 了解现有功能单元格式\n`;
    prompt += `- Read \`020-specs/overview/REQUIREMENT.md\` → 了解需求文档格式\n`;
  }
  prompt += `\n`;

  prompt += `### Step 2: 读取需求文档\n`;
  prompt += `- Read \`010-requirements/features/${moduleName}/README.md\`（如存在）\n`;
  prompt += `- 在 \`010-requirements/converted/*.md\` 中搜索 "${moduleName}" 相关内容\n`;
  prompt += `- 在 \`010-requirements/INDEX.md\` 中定位该模块来源\n\n`;

  prompt += `### Step 3: 读取各端当前文档\n`;
  for (const p of involvedPlatforms) {
    prompt += `- Read \`020-specs/${p}/TECH.md\` → 了解 ${p} 当前技术方案\n`;
  }
  prompt += `\n`;

  prompt += `### Step 4: 重新分析该模块\n`;
  prompt += `基于最新需求，重新分析 **${moduleName}**：\n\n`;
  prompt += `#### 全局层分析\n`;
  prompt += `- 功能描述、用户故事、验收标准\n`;
  prompt += `- 涉及端、共享能力、依赖关系\n`;
  prompt += `- 跨端交互时序（Mermaid sequenceDiagram）\n`;
  prompt += `- API 接口契约（路径/方法/参数/响应）\n\n`;

  prompt += `#### 各端分析\n`;
  for (let i = 0; i < involvedPlatforms.length; i++) {
    const p = involvedPlatforms[i];
    const isBack = result.isBackend[i];
    if (isBack) {
      prompt += `- **${p}（后端）**: API 接口设计、数据模型、业务规则实现\n`;
    } else {
      prompt += `- **${p}（前端）**: 页面设计、字段映射、交互流程、API 调用\n`;
    }
  }
  prompt += `\n`;

  prompt += `### Step 5: 更新文档\n`;
  prompt += `按「全局文档更新计划」和「各端文档更新计划」写入更新后的内容。\n\n`;

  prompt += `## 写入方式\n`;
  prompt += `\`\`\`bash\n`;
  prompt += `# 全局文档\n`;
  prompt += `speccore analyze --apply '{"overview/FUNCTION_MAP.md":"更新后的内容","overview/INTERACTION_MAP.md":"更新后的内容","overview/API_CONTRACT.yaml":"更新后的内容","overview/REQUIREMENT.md":"更新后的内容"}' -I ${iteration}\n`;
  prompt += `\n# 各端文档（示例）\n`;
  for (const p of involvedPlatforms) {
    prompt += `speccore analyze --apply '{"${p}/TECH.md":"更新后的内容"}' -I ${iteration}\n`;
  }
  prompt += `\`\`\`\n`;

  return prompt;
}

// ── 内部函数 ──

/** 在 FUNCTION_MAP.md 中查找模块 */
async function findModuleInFunctionMap(iterDir: string, moduleName: string): Promise<ModuleInfo | null> {
  const functionMapPath = join(iterDir, '020-specs', 'global', 'FUNCTION_MAP.md');
  if (!(await pathExists(functionMapPath))) return null;

  const content = await readFile(functionMapPath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    if (line.includes('功能单元') || line.includes('---')) continue;

    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    // 功能单元通常在第二列
    if (cells.length > 1) {
      const funcUnit = cells[1];
      if (funcUnit && (funcUnit === moduleName || funcUnit.includes(moduleName))) {
        // 提取涉及端（通常在第三列）
        const platformsStr = cells[2] || '';
        const platforms = platformsStr.split(/[,，]/).map(p => p.trim()).filter(Boolean);
        return {
          name: funcUnit,
          involvedPlatforms: platforms,
          description: cells[cells.length - 1] || '',
        };
      }
    }
  }

  return null;
}

/** 在需求文档中查找模块 */
async function findModuleInRequirements(iterDir: string, moduleName: string): Promise<ModuleInfo | null> {
  // 1. 检查 features/ 目录
  const featuresDir = join(iterDir, '010-requirements', 'features', moduleName);
  if (await pathExists(featuresDir)) {
    const readmePath = join(featuresDir, 'README.md');
    if (await pathExists(readmePath)) {
      const content = await readFile(readmePath, 'utf-8');
      // 尝试从内容中提取涉及端
      const platforms = extractPlatformsFromContent(content);
      return {
        name: moduleName,
        involvedPlatforms: platforms,
        description: `来自 features/${moduleName}/README.md`,
        sourceFile: `010-requirements/features/${moduleName}/README.md`,
      };
    }
  }

  // 2. 在 REQUIREMENT.md 中搜索
  const reqPath = join(iterDir, '010-requirements', 'REQUIREMENT.md');
  if (await pathExists(reqPath)) {
    const content = await readFile(reqPath, 'utf-8');
    if (content.includes(moduleName)) {
      const platforms = extractPlatformsFromContent(content);
      return {
        name: moduleName,
        involvedPlatforms: platforms,
        description: '来自 REQUIREMENT.md',
        sourceFile: '010-requirements/REQUIREMENT.md',
      };
    }
  }

  // 3. 在 converted/ 中搜索
  const convertedDir = join(iterDir, '010-requirements', 'converted');
  if (await pathExists(convertedDir)) {
    const files = await readdir(convertedDir);
    for (const f of files.filter(f => f.endsWith('.md'))) {
      const content = await readFile(join(convertedDir, f), 'utf-8');
      if (content.includes(moduleName)) {
        const platforms = extractPlatformsFromContent(content);
        return {
          name: moduleName,
          involvedPlatforms: platforms,
          description: `来自 converted/${f}`,
          sourceFile: `010-requirements/converted/${f}`,
        };
      }
    }
  }

  return null;
}

/** 从内容中提取涉及端 */
function extractPlatformsFromContent(content: string): string[] {
  const platforms = new Set<string>();
  // 匹配常见端名
  const platformPatterns = [
    /h5[-\w]*/gi, /admin[-\w]*/gi, /web[-\w]*/gi,
    /mini[\w]*/gi, /android/gi, /ios/gi,
    /[\w]+-service/gi, /backend/gi, /frontend/gi,
    /app/gi, /pc/gi, /desktop/gi,
  ];

  for (const pattern of platformPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      for (const m of matches) {
        const clean = m.toLowerCase().trim();
        if (clean.length > 1) platforms.add(clean);
      }
    }
  }

  return [...platforms];
}

/** 构建全局文档更新计划 */
function buildGlobalUpdatePlan(moduleName: string, exists: boolean): ModuleGlobalUpdate[] {
  const updates: ModuleGlobalUpdate[] = [];

  if (exists) {
    updates.push({
      file: 'overview/FUNCTION_MAP.md',
      action: 'append-row',
      description: `更新 "${moduleName}" 行的涉及端、共享能力、依赖关系`,
    });
    updates.push({
      file: 'overview/INTERACTION_MAP.md',
      action: 'replace-sequence',
      description: `替换 "${moduleName}" 的 Mermaid 时序图`,
    });
    updates.push({
      file: 'overview/API_CONTRACT.yaml',
      action: 'update-contract',
      description: `更新 "${moduleName}" 相关的接口契约`,
    });
    updates.push({
      file: 'overview/REQUIREMENT.md',
      action: 'update-section',
      description: `更新 "${moduleName}" 章节的详细需求`,
    });
  } else {
    updates.push({
      file: 'overview/FUNCTION_MAP.md',
      action: 'append-row',
      description: `追加 "${moduleName}" 功能单元到表格`,
    });
    updates.push({
      file: 'overview/INTERACTION_MAP.md',
      action: 'append-row',
      description: `追加 "${moduleName}" 的 Mermaid 时序图`,
    });
    updates.push({
      file: 'overview/API_CONTRACT.yaml',
      action: 'update-contract',
      description: `追加 "${moduleName}" 相关的接口契约`,
    });
    updates.push({
      file: 'overview/REQUIREMENT.md',
      action: 'update-section',
      description: `追加 "${moduleName}" 章节到需求文档`,
    });
  }

  return updates;
}

/** 构建各端文档更新计划 */
async function buildPlatformUpdatePlan(
  iterDir: string,
  moduleName: string,
  platforms: string[],
  isBackends: boolean[]
): Promise<ModulePlatformUpdate[]> {
  const updates: ModulePlatformUpdate[] = [];

  for (let i = 0; i < platforms.length; i++) {
    const p = platforms[i];
    const isBack = isBackends[i];
    const files: string[] = [];

    if (isBack) {
      files.push(`${p}/API_INVENTORY.md`);
      files.push(`${p}/DATA_MODEL.md`);
      files.push(`${p}/BUSINESS_RULES.md`);
    } else {
      files.push(`${p}/FEATURES.md`);
      files.push(`${p}/API_CALL_MAP.md`);
      files.push(`${p}/UI_SPEC.md`);
    }

    updates.push({
      platform: p,
      files,
      description: `更新 ${p} 中 "${moduleName}" 模块的相关内容`,
    });
  }

  return updates;
}

/** 构建跨端一致性检查 */
function buildCrossPlatformChecks(moduleName: string, platforms: string[]): CrossPlatformCheck[] {
  const checks: CrossPlatformCheck[] = [];

  if (platforms.length >= 2) {
    checks.push({
      category: 'api-consistency',
      platforms: [...platforms],
      description: `前端调用的接口路径必须与后端提供的接口路径完全一致`,
    });
    checks.push({
      category: 'field-mapping',
      platforms: [...platforms],
      description: `前端 UI 字段必须与后端 API 响应字段一一对应`,
    });
    checks.push({
      category: 'enum-consistency',
      platforms: [...platforms],
      description: `状态枚举值必须前后端一致`,
    });
  }

  return checks;
}

/**
 * 列出所有已分析的功能模块（从 FUNCTION_MAP 提取）
 */
export async function listAnalyzedModules(iterDir: string): Promise<string[]> {
  const functionMapPath = join(iterDir, '020-specs', 'global', 'FUNCTION_MAP.md');
  if (!(await pathExists(functionMapPath))) return [];

  const content = await readFile(functionMapPath, 'utf-8');
  const lines = content.split('\n');
  const modules: string[] = [];

  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    if (line.includes('功能单元') || line.includes('---')) continue;

    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length > 1) {
      modules.push(cells[1]);
    }
  }

  return modules;
}

/**
 * 列出需求文档中所有功能模块（从 features/ 目录提取）
 */
export async function listRequirementModules(iterDir: string): Promise<string[]> {
  const featuresDir = join(iterDir, '010-requirements', 'features');
  if (!(await pathExists(featuresDir))) return [];

  const entries = await readdir(featuresDir, { withFileTypes: true });
  return entries.filter(e => e.isDirectory()).map(e => e.name);
}
