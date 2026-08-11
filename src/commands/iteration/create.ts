import { ensureDir, writeFile, pathExists, readFile } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../../utils/logger';
import { updateContext } from '../../core/context';
import { nextIterationId } from '../../core/global-counters';
export interface IterationCreateOptions {
  name?: string;
  topic?: string;
  from?: string;
  to?: string;
  owner?: string;
}

export async function iterationCreateCommand(options: IterationCreateOptions): Promise<void> {
  if (!options.name) {
    logger.error('Iteration name is required. Use --name <name>');
    return;
  }

  const spinner = new Spinner(`Creating iteration: ${options.name}`);
  spinner.start();

  try {
    // Generate globally unique iteration ID
  const rawName = options.name.replace(/^Iteration-/, '');
  const topic = options.topic || undefined;
  const { id: fullName } = await nextIterationId(rawName, topic);
    const iterationDir = fullName;

    // Check if already exists
    if (await pathExists(iterationDir)) {
      spinner.fail(`Iteration already exists: ${options.name}`);
      return;
    }

    // Create directory structure
    await ensureDir(join(iterationDir, '000-overview'));
    await ensureDir(join(iterationDir, '010-requirements', 'sources'));
    await ensureDir(join(iterationDir, '010-requirements', 'converted'));
    await ensureDir(join(iterationDir, '010-requirements', 'features'));
    await ensureDir(join(iterationDir, '010-requirements', 'assets', 'extracted'));
    await ensureDir(join(iterationDir, '010-requirements', 'assets', 'prototypes'));
    await ensureDir(join(iterationDir, '010-requirements', 'assets', 'designs'));
    await ensureDir(join(iterationDir, '010-requirements', 'assets', 'screenshots'));
    await ensureDir(join(iterationDir, '020-specs'));
    await ensureDir(join(iterationDir, '030-tasks'));

    // Create default files
    await createIterationFiles(iterationDir, fullName, options);

    // Update ITERATIONS index
    await updateIterationsIndex(fullName, options);

    // Update GLOBAL index
    await updateGlobalIndex(fullName, options);

    // Update context (store without 迭代- prefix for consistency)
    await updateContext({
      currentIteration: fullName,
      lastUpdated: new Date().toISOString()
    });

    spinner.stop(`迭代创建: ${fullName}`);
    logger.info('');
    logger.info('Next steps:');
    logger.info(`  1. Edit ${iterationDir}/010-requirements/ ← 放需求文档`);
    logger.info(`  2. Run speccore analyze to generate specs`);
    logger.info(`  3. Run: speccore iteration split`);
  } catch (error) {
    spinner.fail(`Failed to create iteration: ${error}`);
    throw error;
  }
}

async function createIterationFiles(iterationDir: string, fullName: string, options: IterationCreateOptions): Promise<void> {
  // 010-requirements/README.md — 目录规范说明
  await writeFile(
    join(iterationDir, '010-requirements', 'README.md'),
    `# 需求文档目录规范

> 本目录存放本期迭代的全部需求相关文档与素材

## 目录结构

\`\`\`
010-requirements/
├── README.md              ← 本文件
├── INDEX.md               ← 需求文档索引（自动生成/维护）
├── sources/               ← [只读] 原始 PRD/Word/PDF，任何人不得修改
│   └── README.md
├── converted/             ← [自动生成] doc2spec 转换后的 Markdown 规格
│   └── *.md
├── features/              ← [手动维护] 按功能模块组织的需求补充
│   └── {feature}/
│       └── README.md
└── assets/
    ├── extracted/         ← doc2spec 提取的图片/媒体文件
    ├── prototypes/        ← 产品原型（Axure/Figma/墨刀等）
    ├── designs/           ← UI 设计稿
    └── screenshots/       ← 参考截图/竞品分析
\`\`\`

## 使用规范

1. **sources/** — 放产品提供的原始文档，不要直接编辑
2. **converted/** — doc2spec 命令自动输出转换后的 MD，人工不修改
3. **features/** — 按功能模块手动补充需求细节，每个模块一个子目录
4. **assets/** — 所有图片/原型/设计稿统一放这里，按子目录分类

## AI 读取规则

> 运行 \`speccore analyze\` 时，AI 会按以下规则自动读取本文档：

### 会被 AI 读到的目录 ✅

| 目录 | 读取范围 | 用途建议 |
|:---|:---|:---|
| \`INDEX.md\` | 整文件 | 登记所有需求文档清单，AI 先读它了解全貌 |
| \`converted/*.md\` | 全部 .md 文件 | doc2spec 转换后的核心规格，AI 分析的主要依据 |
| \`features/*/README.md\` | 每个子目录的 README.md | 按功能模块组织的需求补充，**推荐放自定义文档** |
| \`assets/prototypes/\` | 原型文件 | 产品原型参考 |
| \`assets/designs/\` | 设计稿 | UI 设计稿参考 |

### 不会被 AI 读到的目录 ❌

| 目录 | 说明 |
|:---|:---|
| \`sources/\` | 只存放原始 PRD/Word/PDF，AI 不直接读取 |
| \`020-specs/\` | analyze 的**输出**目录，存放分析结果 |
| \`030-tasks/\` | 开发任务目录，execute 阶段使用 |
| \`030-tasks/*/99-artifacts/\` | 执行产出目录（测试/评审/部署报告） |

### 如何让 AI 读到你手写的文档？

**推荐做法：** 在 \`features/\` 下按功能模块创建子目录：

\`\`\`
features/
  支付模块/
    README.md    (AI 会读到)
  订单模块/
    README.md    (AI 会读到)
  权限管理/
    README.md    (AI 会读到)
\`\`\`

然后在 \`INDEX.md\` 中登记这些文档，AI 第一步就会从索引中发现它们。

**注意：** \`converted/\` 也可以放手写文档，但这个目录的语义是「doc2spec 自动转换产出」，建议优先使用 \`features/\`。
`
  );

  // 010-requirements/INDEX.md — 需求文档索引
  await writeFile(
    join(iterationDir, '010-requirements', 'INDEX.md'),
    `# 本期需求文档索引

> 迭代：${fullName}
> 更新：${new Date().toISOString().split('T')[0]}

## 文档清单

| 类型 | 路径 | 状态 | 说明 |
| :--- | :--- | :--- | :--- |
| 原始文档 | sources/ | 待补充 | 放 PRD/Word/PDF |
| 转换规格 | converted/ | 待生成 | doc2spec 输出 |
| 功能补充 | features/ | 待补充 | 按模块组织 |
| 原型素材 | assets/prototypes/ | 待补充 | 产品原型 |
| 设计素材 | assets/designs/ | 待补充 | UI 设计稿 |

## 分析配置

- **默认读取**：converted/*.md + features/*/README.md
- **指定文档**：speccore analyze -I ${options.name} --req converted/login.md
- **全部文档**：speccore analyze -I ${options.name} --scope all
`
  );

  // REQUIREMENT.md
  await writeFile(
    join(iterationDir, '020-specs', 'REQUIREMENT.md'),
    `# 本期需求文档

> 迭代：${fullName}
> 时间范围：${options.from || '未指定'} ~ ${options.to || '未指定'}

## 1. 需求概述

### 1.1 背景

### 1.2 目标

### 1.3 范围

## 2. 功能需求

### 2.1 功能模块一

### 2.2 功能模块二

## 3. 非功能需求

### 3.1 性能

### 3.2 安全

### 3.3 兼容性

## 4. 验收标准

## 5. 附录
`
  );

  // ARCHITECTURE.md → write to 000-overview
  await writeFile(
    join(iterationDir, '000-overview', 'ARCHITECTURE.md'),
    `# 本期技术文档

> 迭代：${fullName}

## 1. 技术架构

### 1.1 整体架构

### 1.2 技术选型

## 2. 接口设计

## 3. 数据库设计

## 4. 部署方案

## 5. 风险与应对
`
  );

  // PROJECT_GRAPH.md
  await writeFile(
    join(iterationDir, '000-overview', 'PROJECT_GRAPH.md'),
    `# 本期任务总览

> 迭代：${fullName}
> 时间范围：${options.from || '未指定'} ~ ${options.to || '未指定'}
> 迭代状态：🔄 进行中
> 负责人：${options.owner || '未指定'}
> 默认分支: 继承全局配置

## 任务列表

| 任务编号 | 任务名称 | 类型 | 进度 | 状态 | 负责人 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| | | | | | |

## 依赖图谱

\`\`\`mermaid
graph TD
  A[Task-001] --> B[Task-002]
\`\`\`

## 状态看板

| 待开发 | 进行中 | 已完成 | 已归档 |
| :--- | :--- | :--- | :--- |
| | | | |
`
  );

  // STAFFING.md — 人员排期配置
  await writeFile(
    join(iterationDir, 'STAFFING.md'),
    `# ${options.name} 人员排期配置

> 迭代: ${options.name}${options.owner ? ` | 负责人: ${options.owner}` : ''}

## 人员列表

| 成员 | 平台方向 | 投入比例 |
| :--- | :--- | :--- |
| | | |

> 说明:
> - **平台方向**: 后台 / 小程序 / Web / APP，多个用逗号分隔
> - **投入比例**: 0-100%，用于 split 时自动分配和负荷均衡
> - 编辑此文件后重新运行 split 即可更新默认分配
`
  );
}

async function updateIterationsIndex(name: string, options: IterationCreateOptions): Promise<void> {
  const indexPath = join('.speccore', 'ITERATIONS', 'README.md');
  
  let content = '';
  if (await pathExists(indexPath)) {
    content = await readFile(indexPath, 'utf-8');
  } else {
    content = '# 迭代索引\n\n| 迭代名称 | 时间范围 | 状态 | 负责人 | 备注 |\n| :--- | :--- | :--- | :--- | :--- |\n';
  }

  // Add new iteration entry
  const dateRange = `${options.from || '未指定'} ~ ${options.to || '未指定'}`;
  const newEntry = `| ${name} | ${dateRange} | 🔄 进行中 | | |\n`;
  
  content += newEntry;
  await writeFile(indexPath, content);
}

async function updateGlobalIndex(name: string, options: IterationCreateOptions): Promise<void> {
  const globalIndexPath = join('.speccore', 'GLOBAL', 'INDEX.md');

  if (!(await pathExists(globalIndexPath))) return;
  let content = await readFile(globalIndexPath, 'utf-8');

  // 避免重复
  if (content.includes(`| ${name} |`)) return;

  const dateRange = `${options.from || '未指定'} ~ ${options.to || '未指定'}`;
  const today = new Date().toISOString().split('T')[0];
  const newEntry = `| ${name} | - | 🔄 进行中 | ${today} |`;

  // 找到迭代关联表格并追加
  if (content.includes('## 迭代关联')) {
    // 在 "## 迭代关联" 之后的表格末尾插入
    const lines = content.split('\n');
    const sectionIdx = lines.findIndex(l => l.startsWith('## 迭代关联'));
    if (sectionIdx >= 0) {
      // 找到表格的最后一行数据（非标题非分隔线）
      let insertIdx = sectionIdx + 3; // 跳过标题+表头+分隔线
      for (let i = insertIdx; i < lines.length; i++) {
        if (lines[i].startsWith('|')) insertIdx = i + 1;
        else if (lines[i].startsWith('##') || lines[i].startsWith('---')) break;
      }
      lines.splice(insertIdx, 0, newEntry);
      content = lines.join('\n');
    }
  } else {
    // 没有迭代关联章节，追加简单条目
    content += `\n## 迭代创建日期 |\n| :--- | :--- | :--- | :--- |\n${newEntry}\n`;
  }

  await writeFile(globalIndexPath, content);
}
