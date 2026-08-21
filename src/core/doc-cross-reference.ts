/**
 * doc-cross-reference — 文档间交叉引用自动生成
 * v7.2.0+
 *
 * 全局分析完成后，自动在所有文档末尾添加「相关文档」章节，
 * 建立文档间的导航链接，避免文档孤岛。
 */
import { readFile, writeFile, pathExists, readdir } from 'fs-extra';
import { join, relative } from 'path';
import { logger } from '../utils/logger';

export interface CrossRefEntry {
  name: string;
  path: string;
  description: string;
}

// 文档描述映射（自动识别常用文档名）
const DOC_DESCRIPTIONS: Record<string, string> = {
  'REQUIREMENT.md': '产品需求总纲，描述用户故事和验收标准',
  'ARCHITECTURE.md': '系统架构全景，服务拓扑和部署关系',
  'FUNCTION_MAP.md': '功能映射总表，各端功能对应关系',
  'DATA_MODEL.md': '全局数据模型，实体关系和数据库设计',
  'API_CONTRACT.yaml': 'API 契约定义，接口规范和鉴权策略',
  'TECH_STACK.md': '技术栈说明，依赖版本和选型理由',
  'DATA_FLOW.md': '数据流图，跨服务数据传递链路',
  'SECURITY_AUDIT.md': '安全审计，鉴权方案和漏洞清单',
  'DEPLOYMENT.md': '部署指南，环境配置和 CI/CD 流程',
  'PERFORMANCE.md': '性能基线，瓶颈分析和优化建议',
  'MIGRATION.md': '迁移方案，数据迁移和兼容性处理',
  'INDEX.md': '文档索引，快速导航全局分析产出',
  '_INDEX.md': '端内索引，该端所有文档的导航页',
  '_ASSOCIATION.md': '跨端关联图，端间接口和事件映射',
  '_MODULES.md': '模块清单，各端功能模块详细列表',
  'API_INVENTORY.md': 'API 清单，该端所有接口的详细文档',
  'UI_FLOW.md': 'UI 流程图，页面跳转和交互状态',
  'COMPONENT_TREE.md': '组件树，前端组件层级和依赖关系',
  'STATE_MANAGEMENT.md': '状态管理，全局状态设计和更新规则',
};

function getDocDescription(filename: string): string {
  return DOC_DESCRIPTIONS[filename] || '相关技术文档';
}

/**
 * 为指定目录下的所有 Markdown 文档生成交叉引用
 */
export async function generateCrossReferences(globalDir?: string): Promise<void> {
  const dir = globalDir || join(process.cwd(), '.speccore', 'GLOBAL');
  if (!(await pathExists(dir))) return;

  // 收集所有文档路径
  const allDocs: { absPath: string; relPath: string; filename: string }[] = [];

  const scanDir = async (targetDir: string, baseRel: string) => {
    if (!(await pathExists(targetDir))) return;
    const entries = await readdir(targetDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await scanDir(join(targetDir, entry.name), join(baseRel, entry.name));
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
        allDocs.push({
          absPath: join(targetDir, entry.name),
          relPath: join(baseRel, entry.name),
          filename: entry.name,
        });
      }
    }
  };

  await scanDir(dir, '');

  if (allDocs.length === 0) return;

  // 为每个文档添加相关文档章节
  let updatedCount = 0;
  for (const doc of allDocs) {
    const content = await readFile(doc.absPath, 'utf-8');

    // 如果已有相关文档章节，跳过
    if (/## 相关文档|## 参考文档|## Related Documents/i.test(content)) continue;

    // 收集同目录下的其他文档作为相关文档
    const docDir = doc.relPath.split('/').slice(0, -1).join('/');
    const related = allDocs
      .filter(d => d.relPath !== doc.relPath)
      .map(d => {
        // 计算相对路径
        const fromDir = docDir || '.';
        const toPath = d.relPath;
        const rel = relative(fromDir, toPath).replace(/\\/g, '/');
        return {
          path: rel.startsWith('.') ? rel : './' + rel,
          name: d.filename.replace(/\.(md|yaml|yml)$/, ''),
          description: getDocDescription(d.filename),
        };
      })
      .filter(d => d.path !== doc.filename); // 排除自己

    if (related.length === 0) continue;

    // 生成相关文档章节（最多 8 个）
    const topRelated = related.slice(0, 8);
    let refSection = '\n\n---\n\n';
    refSection += '## 相关文档\n\n';
    refSection += '> 以下文档与本文档相关，建议交叉阅读以获取完整上下文。\n\n';
    for (const r of topRelated) {
      refSection += `- [${r.name}](${r.path}) — ${r.description}\n`;
    }

    await writeFile(doc.absPath, content + refSection);
    updatedCount++;
  }

  if (updatedCount > 0) {
    logger.info(`🔗 已为 ${updatedCount} 份文档添加交叉引用`);
  }
}
