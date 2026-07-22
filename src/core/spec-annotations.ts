/**
 * spec-annotations — 代码注释标记系统
 * 
 * 开发者在代码中加注释标记，SpecCore 识别后精准定位模块边界和接口归属。
 * 
 * 支持的注释格式:
 *   Java:   @spec-module 订单管理  |  @spec-api POST /api/orders |  @spec-entity Order
 *   TS/JS:  [at]spec-module 订单管理 | [at]spec-api GET /api/users
 *   Python: # @spec-module 订单管理 | # @spec-api POST /api/orders
 *   Go:     // @spec-module 订单管理 | // @spec-api GET /api/users
 */
import { readFile, pathExists } from 'fs-extra';
import { join } from 'path';

export interface SpecAnnotation {
  type: 'module' | 'api' | 'entity' | 'dependency' | 'scope';
  value: string;
  file: string;
  line: number;
}

export interface ModuleGroup {
  name: string;           // 模块名（中文）
  directory: string;      // 所在目录
  files: string[];        // 包含的文件
  apis: string[];         // 模块内 API
  entities: string[];     // 模块内实体
  dependencies: string[]; // 依赖的其他模块
}

const ANNOTATION_PATTERNS: { comment: string; regex: RegExp }[] = [
  // Java: @spec-module 订单管理
  { comment: '//', regex: /@spec-(module|api|entity|dependency|scope)\s+(.+)/ },
  // Java doc: * @spec-module 订单管理
  { comment: '*',  regex: /@spec-(module|api|entity|dependency|scope)\s+(.+)/ },
  // TS/JS block: /** @spec-module 订单管理 */
  { comment: '/**', regex: /@spec-(module|api|entity|dependency|scope)\s+(.+)/ },
  // Python: # @spec-module 订单管理
  { comment: '#',  regex: /@spec-(module|api|entity|dependency|scope)\s+(.+)/ },
  // Go: // @spec-module 订单管理
  { comment: '//', regex: /@spec-(module|api|entity|dependency|scope)\s+(.+)/ },
  // YAML: # @spec-module 订单管理
  { comment: '#',  regex: /@spec-(module|api|entity|dependency|scope)\s+(.+)/ },
];

/**
 * 扫描单个文件的 Spec 注释标记
 */
export async function extractAnnotations(filePath: string): Promise<SpecAnnotation[]> {
  if (!(await pathExists(filePath))) return [];
  
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const annotations: SpecAnnotation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    for (const { regex } of ANNOTATION_PATTERNS) {
      const match = line.match(regex);
      if (match) {
        annotations.push({
          type: match[1] as SpecAnnotation['type'],
          value: match[2].trim(),
          file: filePath,
          line: i + 1,
        });
        break;
      }
    }
  }

  return annotations;
}

/**
 * 从注释标记构建模块分组
 */
export function buildModuleGroups(annotations: SpecAnnotation[]): ModuleGroup[] {
  const moduleMap = new Map<string, ModuleGroup>();
  const scopeFiles = new Set<string>();

  // 收集 scope 标记
  for (const a of annotations) {
    if (a.type === 'scope') {
      scopeFiles.add(a.file);
    }
  }

  // 构建模块
  for (const a of annotations) {
    if (a.type !== 'module') continue;

    const dir = a.file.substring(0, a.file.lastIndexOf('/'));
    const key = `${a.value}@${dir}`;

    if (!moduleMap.has(key)) {
      moduleMap.set(key, {
        name: a.value,
        directory: dir,
        files: [a.file],
        apis: [],
        entities: [],
        dependencies: [],
      });
    }
  }

  // 补充 API、Entity、依赖
  for (const a of annotations) {
    if (a.type === 'module') continue;

    const dir = a.file.substring(0, a.file.lastIndexOf('/'));
    // 找到同目录的模块
    for (const [key, group] of moduleMap) {
      if (a.file.startsWith(group.directory) || dir === group.directory) {
        switch (a.type) {
          case 'api': group.apis.push(a.value); break;
          case 'entity': group.entities.push(a.value); break;
          case 'dependency': group.dependencies.push(a.value); break;
        }
        if (!group.files.includes(a.file)) group.files.push(a.file);
        break;
      }
    }
  }

  return [...moduleMap.values()];
}

/**
 * 根据需求描述查找对应模块（用于精准读取）
 */
export function matchModule(
  requirement: string,
  modules: ModuleGroup[]
): ModuleGroup | null {
  let best: ModuleGroup | null = null;
  let bestScore = 0;

  for (const mod of modules) {
    let score = 0;
    if (requirement.includes(mod.name)) score += 30;
    for (const api of mod.apis) {
      if (requirement.includes(api)) score += 20;
    }
    for (const entity of mod.entities) {
      if (requirement.toLowerCase().includes(entity.toLowerCase())) score += 15;
    }
    if (score > bestScore) {
      bestScore = score;
      best = mod;
    }
  }

  return bestScore >= 20 ? best : null;
}

/**
 * 自动发现项目根目录（多工程场景）
 */
export async function discoverProjectRoots(cwd: string): Promise<string[]> {
  const roots: string[] = [];
  const { readdirSync } = require('fs');
  const { existsSync } = require('fs');

  const projectFiles = [
    'package.json', 'pom.xml', 'go.mod', 'Cargo.toml',
    'requirements.txt', 'setup.py', 'build.gradle', 'Makefile'
  ];

  // 当前目录
  for (const pf of projectFiles) {
    if (existsSync(join(cwd, pf))) {
      roots.push(cwd);
      break;
    }
  }

  // 子目录（monorepo 场景）
  try {
    const entries = readdirSync(cwd, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      
      const subPath = join(cwd, entry.name);
      for (const pf of projectFiles) {
        if (existsSync(join(subPath, pf))) {
          if (!roots.includes(subPath)) roots.push(subPath);
          break;
        }
      }
    }
  } catch {}

  return roots.length > 0 ? roots : [cwd];
}

/**
 * 生成模块清单报告
 */
export function generateModuleReport(modules: ModuleGroup[]): string {
  if (modules.length === 0) return '# 暂无模块标记\n\n在代码中添加 `@spec-module 模块名` 注释来建立模块索引。';

  let report = '# 代码模块清单\n\n';
  report += `> 通过 @spec-* 注释自动识别 | ${new Date().toISOString().split('T')[0]}\n\n`;

  for (const mod of modules) {
    report += `## ${mod.name}\n\n`;
    report += `- **目录**: \`${mod.directory}\`\n`;
    report += `- **文件数**: ${mod.files.length}\n`;
    if (mod.apis.length > 0) report += `- **API**: ${mod.apis.join(', ')}\n`;
    if (mod.entities.length > 0) report += `- **实体**: ${mod.entities.join(', ')}\n`;
    if (mod.dependencies.length > 0) report += `- **依赖**: ${mod.dependencies.join(', ')}\n`;
    report += '\n';
  }

  return report;
}
