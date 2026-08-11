/**
 * syncCapabilities — 同步项目能力注册表
 * 参考 WorkBuddy Skill 元数据机制：AI 一眼看清项目有什么
 */
import { readFile, writeFile, pathExists, readdir } from 'fs-extra';
import { join } from 'path';

const CAP_PATH = join(process.cwd(), '.speccore', 'CAPABILITIES.md');

export async function syncCapabilities(options?: {
  importProject?: string;
  importType?: string;
  importApis?: number;
  newRule?: string;
  newRuleDesc?: string;
}): Promise<void> {
  if (!(await pathExists(CAP_PATH))) return;

  let content = await readFile(CAP_PATH, 'utf-8');

  // 导入项目后更新
  if (options?.importProject) {
    const entry = `| ${options.importProject} | ${options.importType} | ${options.importApis || 0} 个 | ✅ 已导入 |`;
    content = content.replace(
      '| _待导入_ | - | - | - |',
      entry
    );
  }

  // 新增规则后更新
  if (options?.newRule) {
    const tableIdx = content.indexOf('## 可用规则');
    const insertIdx = content.indexOf('\n', content.indexOf('| :--- | :--- | :--- |', tableIdx + 1)) + 1;
    content = 
      content.slice(0, insertIdx) +
      `| ${options.newRule} | ${options.newRuleDesc || '自定义'}} | 用户自定义 |\n` +
      content.slice(insertIdx);
  }

  await writeFile(CAP_PATH, content);
}

/**
 * 生成 Spec 渐进加载指引（让 AI 先看索引，再按需加载）
 */
export function progressiveSpecGuide(taskDir: string): string {
  return `# 渐进加载指引
> AI 应按此顺序读取，避免一次性加载全部文件浪费上下文。

## Step 1: 能力速览（必读，~500 token）
- \`.speccore/CAPABILITIES.md\` — 项目有什么能力

## Step 2: 任务索引（必读，~500 token）
- \`${taskDir}/INDEX.md\` — 这个 Task 涉及哪些文件

## Step 3: 核心 Spec（按需，~2000 token each）
- \`${taskDir}/00-specs/TASK.md\` — 任务执行追踪
- \`${taskDir}/00-specs/REQ.md\` — 需求描述
- \`${taskDir}/00-specs/TECH.md\` — 技术方案（如有）

## Step 4: 规则参考（按需，~1000 token each）
- \`.speccore/RULES/CODE_REVIEW.md\`
- \`.speccore/RULES/POST_COMPLETION.md\`

---
💡 优先完成 Step 1-3，Step 4 仅在需要时查阅。
`;
}
