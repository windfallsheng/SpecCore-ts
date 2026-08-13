/**
 * synthesize — 需求文档智能合成命令
 *
 * 将迭代下多端需求文档（converted/*.md）智能合并为一篇原子化的综合需求文档
 * 输出到 010-requirements/REQUIREMENT.md
 *
 * 合成原则：
 *   - 章节需求原子化：一个业务功能一个章节，不按端拆分
 *   - 公共优先：多端共享逻辑只写一次
 *   - 差异标注：端差异用子标题明确标出
 *   - 接口汇总：同一功能的接口放一起，标注所属端
 *   - 冲突标记：需求间矛盾或需求与源码不一致时标注
 *   - 去重合并：相同描述只保留一份
 *   - 统一结构：每个原子章节遵循固定模板
 *
 * 使用方式：
 *   CLI:  speccore synthesize -I <迭代名>
 *   AI:   /spec-ask "合成 Q2 迭代的需求文档"
 */

import { writeFile, pathExists, ensureDir, readFile, readdir } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../utils/logger';
import { getDefaultIteration, getIterationDir } from '../core/context';
import { backupWithTimestamp, isTimestampBackup } from '../utils/task-utils';

export interface SynthesizeOptions {
  iteration?: string;
  withCode?: boolean;
  prompt?: boolean;
  apply?: string;
}

export async function synthesizeCommand(options: SynthesizeOptions): Promise<void> {
  const iter = options.iteration || await getDefaultIteration();
  if (!iter) {
    logger.error('请指定迭代: -I <迭代名>');
    return;
  }

  const iterDir = await getIterationDir(iter);
  const reqDir = join(iterDir, '010-requirements');
  const convDir = join(reqDir, 'converted');
  const outputPath = join(reqDir, 'REQUIREMENT.md');

  // ── Apply 模式：接收 AI 合成结果写入文件 ──
  if (options.apply) {
    await ensureDir(reqDir);

    // 备份旧文件（时间戳命名，不覆盖）
    const bk = await backupWithTimestamp(outputPath);
    if (bk) logger.info(`   📦 旧版已备份: ${bk.split('/').pop()}`);

    await writeFile(outputPath, options.apply);
    logger.success(`✅ 综合需求文档已生成: 010-requirements/REQUIREMENT.md`);
    return;
  }

  // ── Prompt 模式：输出结构化 Prompt 到 stdout ──
  // 收集所有端需求文档
  const sourceDocs: { name: string; content: string }[] = [];

  if (await pathExists(convDir)) {
    const files = await readdir(convDir);
    const mdFiles = files.filter(f => f.endsWith('.md') && !f.startsWith('README') && !isTimestampBackup(f));
    for (const f of mdFiles) {
      const content = await readFile(join(convDir, f), 'utf-8');
      sourceDocs.push({ name: f, content });
    }
  }

  // 也读取 features/ 下的需求补充
  const featuresDir = join(reqDir, 'features');
  if (await pathExists(featuresDir)) {
    const entries = await readdir(featuresDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) {
        const readme = join(featuresDir, e.name, 'README.md');
        if (await pathExists(readme)) {
          const content = await readFile(readme, 'utf-8');
          sourceDocs.push({ name: `features/${e.name}/README.md`, content });
        }
      }
    }
  }

  if (sourceDocs.length === 0) {
    logger.warn('未找到需求文档，请先导入: speccore doc2spec -f <文件> --iter <迭代名>');
    return;
  }

  // 读取现有 REQUIREMENT.md（如果有）
  let existingReq = '';
  if (await pathExists(outputPath)) {
    existingReq = await readFile(outputPath, 'utf-8');
  }

  // 读取 INDEX.md
  let indexContent = '';
  const indexPath = join(reqDir, 'INDEX.md');
  if (await pathExists(indexPath)) {
    indexContent = await readFile(indexPath, 'utf-8');
  }

  const prompt = buildSynthesizePrompt(iter, sourceDocs, existingReq, indexContent, options.withCode);
  process.stdout.write(`[SPECCORE_PROMPT]\n${prompt}`);
  process.exitCode = 10;
}

function buildSynthesizePrompt(
  iteration: string,
  sourceDocs: { name: string; content: string }[],
  existingReq: string,
  indexContent: string,
  withCode?: boolean
): string {
  const docList = sourceDocs.map(d => `### ${d.name}\n\n${d.content}`).join('\n\n---\n\n');

  let prompt = `# 任务: synthesize (需求文档智能合成)\n\n`;
  prompt += `## 目标\n`;
  prompt += `将迭代「${iteration}」的 ${sourceDocs.length} 份需求文档智能合并为一篇原子化的综合需求文档。\n\n`;

  if (existingReq) {
    prompt += `## 现有 REQUIREMENT.md\n`;
    prompt += `以下是当前已有的综合需求文档（可能是旧版或机械拼接版），请在此基础上改进：\n\n`;
    const truncated = existingReq.length > 3000 ? existingReq.slice(0, 3000) + '\n...（内容过长，已截断）' : existingReq;
    prompt += '```markdown\n' + truncated + '\n```\n\n';
  }

  prompt += `## 输入文档\n\n`;
  prompt += docList;
  prompt += `\n\n`;

  if (indexContent) {
    prompt += `## 需求索引\n\n`;
    prompt += '```markdown\n' + indexContent + '\n```\n\n';
  }

  prompt += `## 合成原则\n\n`;
  prompt += `1. **章节需求原子化**：一个业务功能一个章节，不按端拆分。例如"用户管理"是一个章节，admin/h5/小程序的差异放在子节\n`;
  prompt += `2. **公共优先**：多端共享的逻辑只写一次，放在章节开头\n`;
  prompt += `3. **差异标注**：端差异用 \`#### {端名} 端\` 子标题明确标出\n`;
  prompt += `4. **接口汇总**：同一功能的接口放一起，用表格标注所属端（方法|路径|说明|端）\n`;
  prompt += `5. **冲突标记**：需求间矛盾或描述不一致时用 \`⚠️\` 标注，汇总到"待确认事项"章节\n`;
  prompt += `6. **去重合并**：相同描述只保留一份，非功能需求（性能、安全等）各端一样就合并\n`;
  prompt += `7. **统一结构**：每个原子章节遵循：概述 → 功能描述 → 接口定义 → 验收标准 → 端差异\n\n`;

  prompt += `## 输出结构\n\n`;
  prompt += `\`\`\`markdown\n`;
  prompt += `# ${iteration} 迭代综合需求文档\n\n`;
  prompt += `> 由 ${sourceDocs.map(d => d.name).join('、')} 自动合成\n`;
  prompt += `> 合成时间: {当前日期}\n\n`;
  prompt += `## 1. 需求概述\n`;
  prompt += `> 整体业务背景、目标用户、核心场景\n\n`;
  prompt += `## 2. 功能模块\n`;
  prompt += `### 2.1 {功能名}\n`;
  prompt += `> 公共逻辑描述\n\n`;
  prompt += `| 方法 | 路径 | 说明 | 端 |\n|:--|:--|:--|:--|\n\n`;
  prompt += `#### {端名} 端差异\n`;
  prompt += `- 特有功能点\n\n`;
  prompt += `### 2.2 {功能名}\n`;
  prompt += `...\n\n`;
  prompt += `## 3. 非功能需求\n`;
  prompt += `> 合并各端共同的非功能要求（性能、安全、兼容性等）\n\n`;
  prompt += `## 4. ⚠️ 待确认事项\n`;
  prompt += `> 自动检测到的冲突、缺失、不一致\n`;
  prompt += `- {冲突描述}\n`;
  prompt += `\`\`\`\n\n`;

  prompt += `## 要求\n`;
  prompt += `1. 仔细阅读所有输入文档，理解每个功能的完整描述\n`;
  prompt += `2. 按业务模块（而非端）组织章节，同一功能的不同端实现放在同一章节下\n`;
  prompt += `3. 接口表格必须汇总，标注每个接口属于哪个端\n`;
  prompt += `4. 发现矛盾或不一致时，在文档末尾"待确认事项"中列出\n`;
  prompt += `5. 输出完整的 Markdown 文档，不要省略任何内容\n`;
  prompt += `6. 写入: speccore synthesize --apply '{合成的完整Markdown内容}' -I ${iteration}\n\n`;

  prompt += `## 注意\n`;
  prompt += `- 需求以产品文档为准，不要臆造需求\n`;
  prompt += `- 如果某个功能只在某一端出现，仍然作为独立章节，标注"仅 {端名} 端"\n`;
  prompt += `- 保持原文档中的接口定义、字段说明等细节不丢失\n`;

  return prompt;
}
