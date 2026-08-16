import { ensureDir, writeFile, pathExists, readFile } from 'fs-extra';
import { join } from 'path';
import { logger, Spinner } from '../../utils/logger';
import { updateContext } from '../../core/context';
import { nextIterationId } from '../../core/global-counters';
import { showNextSteps } from '../../core/next-steps';
import { GLOBAL_SPECS_DIR } from '../../core/spec-paths';
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
    await ensureDir(join(iterationDir, '010-requirements', 'bugs'));
    await ensureDir(join(iterationDir, '010-requirements', 'refactors'));
    await ensureDir(join(iterationDir, '010-requirements', 'research'));
    await ensureDir(join(iterationDir, '010-requirements', 'assets', 'extracted'));
    await ensureDir(join(iterationDir, '010-requirements', 'assets', 'prototypes'));
    await ensureDir(join(iterationDir, '010-requirements', 'assets', 'designs'));
    await ensureDir(join(iterationDir, '010-requirements', 'assets', 'screenshots'));
    await ensureDir(join(iterationDir, '020-specs'));
    await ensureDir(join(iterationDir, '020-specs', GLOBAL_SPECS_DIR));
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
    showNextSteps('iteration-create', { iteration: fullName });
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
├── features/              ← [手动维护] feature 型：按功能模块组织（子目录）
│   └── {module}/
│       └── README.md
├── bugs/                  ← [手动维护] bugfix 型：扁平文件
│   └── {bug-slug}.md
├── refactors/             ← [手动维护] refactor 型：扁平文件
│   └── {refactor-slug}.md
├── research/              ← [手动维护] research 型：扁平文件
│   └── {topic-slug}.md
├── prototypes/          ← 原型（HTML/图片/链接，内容不限）
└── assets/
    └── extracted/         ← doc2spec 提取的图片/媒体文件
\`\`\`

## 使用规范

1. **sources/** — 放产品提供的原始文档，不要直接编辑
2. **converted/** — doc2spec 命令自动输出转换后的 MD，人工不修改
3. **features/** — feature 型任务：按功能模块手动补充需求细节，每个模块一个**子目录**
4. **bugs/** — bugfix 型任务：每个 bug 一个扁平 MD 文件（如 \`login-timeout.md\`）
5. **refactors/** — refactor 型任务：每个重构目标一个扁平 MD 文件
6. **research/** — research 型任务：每个研究主题一个扁平 MD 文件
7. **prototypes/** — 原型文件，HTML/图片/链接均可，需求文档中链接到原型的会被主动读取
8. **assets/extracted/** — doc2spec 自动提取的图片，人工不修改

## AI 读取规则

> 运行 \`speccore analyze\` 时，AI 会按以下规则自动读取本文档：

### 会被 AI 读到的目录 ✅

| 目录 | 读取范围 | 用途建议 |
|:---|:---|:---|
| \`INDEX.md\` | 整文件 | 登记所有需求文档清单，AI 先读它了解全貌 |
| \`converted/*.md\` | 全部 .md 文件 | doc2spec 转换后的核心规格，AI 分析的主要依据 |
| \`features/*/README.md\` | 每个子目录的 README.md | feature 型：按功能模块组织的需求补充 |
| \`bugs/*.md\` | 全部 .md 文件 | bugfix 型：bug 描述与影响分析 |
| \`refactors/*.md\` | 全部 .md 文件 | refactor 型：重构目标与方案 |
| \`research/*.md\` | 全部 .md 文件 | research 型：研究主题与对比 |
| \`prototypes/\` | 原型文件 | 原型（HTML/图片/链接），需求文档链接过来会被主动读取 |

### 不会被 AI 读到的目录 ❌

| 目录 | 说明 |
|:---|:---|
| \`sources/\` | 只存放原始 PRD/Word/PDF，AI 不直接读取 |
| \`020-specs/\` | analyze 的**输出**目录，存放分析结果 |
| \`030-tasks/\` | 开发任务目录，execute 阶段使用 |
| \`030-tasks/*/10-backend/*/\` | 后端子任务目录（execute 阶段使用） |

### 如何让 AI 读到你手写的文档？

**feature 型：** 在 \`features/\` 下按功能模块创建子目录：

\`\`\`
features/
  支付模块/
    README.md    (AI 会读到)
  订单模块/
    README.md    (AI 会读到)
\`\`\`

**bugfix / refactor / research 型：** 直接在对应目录放扁平 MD 文件：

\`\`\`
bugs/
  login-timeout.md         (AI 会读到)
  payment-callback-error.md
refactors/
  db-connection-pool.md    (AI 会读到)
research/
  websocket-comparison.md  (AI 会读到)
\`\`\`

然后在 \`INDEX.md\` 中登记这些文档，AI 第一步就会从索引中发现它们。

**注意：** \`converted/\` 也可以放手写文档，但这个目录的语义是「doc2spec 自动转换产出」，建议优先使用类型对应的目录。
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
| 功能需求 | features/ | 待补充 | feature 型：按模块子目录组织 |
| Bug 描述 | bugs/ | 待补充 | bugfix 型：扁平 MD 文件 |
| 重构目标 | refactors/ | 待补充 | refactor 型：扁平 MD 文件 |
| 研究主题 | research/ | 待补充 | research 型：扁平 MD 文件 |
| 原型素材 | prototypes/ | 待补充 | 原型（HTML/图片/链接） |

## 分析配置

- **默认读取**：converted/*.md + features/*/README.md
- **指定文档**：speccore analyze -I ${options.name} --req converted/login.md
- **全部文档**：speccore analyze -I ${options.name} --scope all
`
  );

  // REQUIREMENT.md → 写入 global/ 子目录（v6.41.0+）
  await writeFile(
    join(iterationDir, '020-specs', GLOBAL_SPECS_DIR, 'REQUIREMENT.md'),
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

## Git 配置

> 以下配置覆盖全局 CONSTITUTION.md，任务级 .meta/git-config 又覆盖本处。
> 留空或填"继承全局配置"则使用上一级配置。

| 配置项 | 值 | 说明 |
| :--- | :--- | :--- |
| 默认分支 | 继承全局配置 | 主分支名（main/master） |
| 分支前缀 | | 如 2060708，追加到分支名中 |
| 分支格式 | 继承全局配置 | 模板：{type}/{prefix}{name}-{hash4} |
| 自动拉取 | 继承全局配置 | 创建分支前是否 git pull |
| 远程名称 | 继承全局配置 | 远程仓库名（origin） |

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
