/**
 * v8.3.314+: 升级刷新机制回归测试
 * 覆盖三个升级盲区：
 * 1. RULES/*.inline.md 旧版过时检测（命中型 obsolete + 缺失型 required）
 * 2. update 路径补写 CODE_REVIEW.md / POST_COMPLETION.md（EXTRA_BUILTIN_RULES）
 * 3. AGENTS 旧版角色文件与注册表智能刷新（备份 + 覆盖，用户自定义不受影响）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { initRulesDir, initAgentsDir, syncAgentsMd } from '@/commands/init';

const TEST_DIR = join(process.cwd(), 'tests', '.tmp', 'init-refresh');

function setup() {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(join(TEST_DIR, '.speccore', 'RULES'), { recursive: true });
  mkdirSync(join(TEST_DIR, '.speccore', 'AGENTS'), { recursive: true });
}

function cleanup() {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

describe('init refresh — inline 过时检测（命中型）', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('旧版 02 含「必须开始新对话」应刷新为新文案', async () => {
    const legacy = `## SpecCore 输出标记\n\n| \`[SPECCORE_CONTINUE: <path>]\` | 批次执行完成，需续批 | **必须开始新对话**，先读取 \`<path>\` 恢复上下文，再按提示命令继续下一批次 |`;
    const dest = join(TEST_DIR, '.speccore', 'RULES', '02-OUTPUT_MARKERS.inline.md');
    writeFileSync(dest, legacy);

    await initRulesDir(TEST_DIR);

    const updated = readFileSync(dest, 'utf-8');
    expect(updated).not.toContain('必须开始新对话');
    expect(updated).toContain('优先在同一会话继续');
  });

  it('旧版 01 含「dev 后生成」应刷新为新版结构图', async () => {
    const legacy = `## 项目结构\n\n\`\`\`\n{feature}/\n├── README.md ← dev 后生成\n\`\`\``;
    const dest = join(TEST_DIR, '.speccore', 'RULES', '01-PROJECT_STRUCTURE.inline.md');
    writeFileSync(dest, legacy);

    await initRulesDir(TEST_DIR);

    const updated = readFileSync(dest, 'utf-8');
    expect(updated).not.toContain('dev 后生成');
    expect(updated).toContain('SOURCE.md');
  });
});

describe('init refresh — inline 过时检测（缺失型 required）', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('旧版 03 缺 run 快捷操作应刷新补充', async () => {
    const legacy = `## 常用命令速查\n\n\`\`\`bash\nspeccore status\nspeccore pr\n\`\`\``;
    const dest = join(TEST_DIR, '.speccore', 'RULES', '03-COMMAND_CHEATSHEET.inline.md');
    writeFileSync(dest, legacy);

    await initRulesDir(TEST_DIR);

    const updated = readFileSync(dest, 'utf-8');
    expect(updated).toContain('speccore run');
  });

  it('新版 inline 文件不应被改写（幂等）', async () => {
    const dest = join(TEST_DIR, '.speccore', 'RULES', '03-COMMAND_CHEATSHEET.inline.md');
    writeFileSync(dest, '用户手动微调过的版本，仍含 speccore run                             # 无参');

    await initRulesDir(TEST_DIR);

    // 含 required 关键内容块且无过时标记 → 视为新版，保持不动
    expect(readFileSync(dest, 'utf-8')).toBe('用户手动微调过的版本，仍含 speccore run                             # 无参');
  });
});

describe('init refresh — inline 版本戳驱动刷新（v8.3.315+）', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('旧戳 inline 文件应直接覆盖刷新（不再备份，v8.3.349+）', async () => {
    const dest = join(TEST_DIR, '.speccore', 'RULES', '01-PROJECT_STRUCTURE.inline.md');
    // 旧戳 + 无任何过时标记词的内容 → 纯靠版本戳判定覆盖
    writeFileSync(dest, '<!-- speccore-asset-version: 8.3.300 -->\n## 项目结 构\n\n旧版内容但无过时标记词');
  
    await initRulesDir(TEST_DIR);
  
    const updated = readFileSync(dest, 'utf-8');
    expect(updated).toContain('SOURCE.md');
    expect(updated).toContain('speccore-asset-version');
  
    // 带戳 = CLI 生成物：直接覆盖，不产生时间戳备份文件
    const backups = readdirSync(join(TEST_DIR, '.speccore', 'RULES')).filter(
      (f) => f.startsWith('01-PROJECT_STRUCTURE.inline-') && f.endsWith('.md')
    );
    expect(backups.length).toBe(0);
  });

  it('新版带戳 inline 文件不应被改写（幂等，无备份噪音）', async () => {
    const dest = join(TEST_DIR, '.speccore', 'RULES', '01-PROJECT_STRUCTURE.inline.md');
    writeFileSync(dest, `<!-- speccore-asset-version: ${require('../../../package.json').version} -->\n## 项目结构\n\n新版内容（无过时标记）`);

    await initRulesDir(TEST_DIR);

    expect(readFileSync(dest, 'utf-8')).toContain('新版内容（无过时标记）');
    // 不应产生备份文件
    const backups = readdirSync(join(TEST_DIR, '.speccore', 'RULES')).filter(
      (f) => f.startsWith('01-PROJECT_STRUCTURE.inline-') && f.endsWith('.md')
    );
    expect(backups.length).toBe(0);
  });
});

describe('init refresh — EXTRA_BUILTIN_RULES 补写', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('update 路径（initRulesDir）应补写 CODE_REVIEW.md 与 POST_COMPLETION.md', async () => {
    await initRulesDir(TEST_DIR);

    const rulesDir = join(TEST_DIR, '.speccore', 'RULES');
    expect(existsSync(join(rulesDir, 'CODE_REVIEW.md'))).toBe(true);
    expect(existsSync(join(rulesDir, 'POST_COMPLETION.md'))).toBe(true);
    expect(readFileSync(join(rulesDir, 'CODE_REVIEW.md'), 'utf-8')).toContain('审查维度');
  });

  it('已存在的 CODE_REVIEW.md 不应被覆盖（用户定制保留）', async () => {
    const custom = join(TEST_DIR, '.speccore', 'RULES', 'CODE_REVIEW.md');
    writeFileSync(custom, '# 用户自定义审查规则\n\n我的私有审查清单');

    await initRulesDir(TEST_DIR);

    expect(readFileSync(custom, 'utf-8')).toContain('我的私有审查清单');
  });
});

describe('init refresh — AGENTS 旧版智能刷新', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  const legacyAgent = `---
activations:
  - command: pr
    phase: review
    condition: ""
---

# 角色：代码审查员 (Code Reviewer)

## 职责

- 审查代码质量、可读性、可维护性
`;

  it('旧版角色文件（缺 systemPrompt + # 角色：标题）应备份并刷新', async () => {
    const dest = join(TEST_DIR, '.speccore', 'AGENTS', 'code-reviewer.md');
    writeFileSync(dest, legacyAgent);

    await initAgentsDir(TEST_DIR);

    const updated = readFileSync(dest, 'utf-8');
    expect(updated).toContain('systemPrompt:');
    expect(updated).toContain('name: code-reviewer');

    // 原文件已备份（时间戳重命名）
    const backups = readdirSync(join(TEST_DIR, '.speccore', 'AGENTS')).filter(
      (f) => f.startsWith('code-reviewer-') && f.endsWith('.md')
    );
    expect(backups.length).toBe(1);
    expect(readFileSync(join(TEST_DIR, '.speccore', 'AGENTS', backups[0]), 'utf-8')).toContain('角色：代码审查员');
  });

  it('用户自定义角色文件不应被覆盖', async () => {
    const dest = join(TEST_DIR, '.speccore', 'AGENTS', 'code-reviewer.md');
    const custom = `---
name: code-reviewer
title: 我的审查员
systemPrompt: 我是团队自定义审查员
---

# 团队自定义内容
`;
    writeFileSync(dest, custom);

    await initAgentsDir(TEST_DIR);

    expect(readFileSync(dest, 'utf-8')).toContain('团队自定义内容');
  });

  it('旧版注册表（缺「叠加 RULES/」列）应备份并刷新', async () => {
    const dest = join(TEST_DIR, '.speccore', 'AGENTS', '_INDEX.md');
    const legacyRegistry = `# AGENTS 注册表\n\n> 本文件定义各命令/阶段下激活的 Agent 列表。\n\n## analyze / clarify\n\n| code-reviewer | 90 | — | 审查代码质量 |\n`;
    writeFileSync(dest, legacyRegistry);

    await initAgentsDir(TEST_DIR);

    const updated = readFileSync(dest, 'utf-8');
    expect(updated).toContain('叠加 RULES/');
  });
});

describe('init refresh — 备份文件不污染投影（syncAgentsMd）', () => {
  beforeEach(() => setup());
  afterEach(() => cleanup());

  it('AGENTS 目录中的时间戳备份文件不应进入 AGENTS.md 角色表', async () => {
    const agentsDir = join(TEST_DIR, '.speccore', 'AGENTS');
    // 正常角色文件 + 时间戳备份文件（升级刷新产生的旧版副本）
    writeFileSync(join(agentsDir, 'test-reviewer.md'), `---\nname: test-reviewer\ntitle: 测试审查员\n---\n\n## 职责\n- 检查测试\n`);
    writeFileSync(join(agentsDir, 'test-reviewer-20261015062045.md'), '旧版备份内容');

    await syncAgentsMd(TEST_DIR, true);

    const agentsMd = readFileSync(join(TEST_DIR, 'AGENTS.md'), 'utf-8');
    expect(agentsMd).toContain('测试审查员');
    expect(agentsMd).not.toContain('test-reviewer-20261015062045');
  });

  it('RULES 目录中的时间戳备份文件不应内联进 AGENTS.md（inline 刷新产物）', async () => {
    const rulesDir = join(TEST_DIR, '.speccore', 'RULES');
    writeFileSync(join(rulesDir, '01-PROJECT_STRUCTURE.inline.md'), '## 项目结构\n\n现行版本内容');
    // safeWriteWithBackup 的真实命名：{name}.inline-{14位时间戳}.md
    writeFileSync(join(rulesDir, '01-PROJECT_STRUCTURE.inline-20261015062045.md'), '## 项目结构\n\n旧版备份内容不应出现');

    await syncAgentsMd(TEST_DIR, true);

    const agentsMd = readFileSync(join(TEST_DIR, 'AGENTS.md'), 'utf-8');
    expect(agentsMd).toContain('现行版本内容');
    expect(agentsMd).not.toContain('旧版备份内容不应出现');
  });

  it('inline 内容带版本戳时，投影到 AGENTS.md 应剥除戳', async () => {
    const rulesDir = join(TEST_DIR, '.speccore', 'RULES');
    writeFileSync(
      join(rulesDir, '01-PROJECT_STRUCTURE.inline.md'),
      '<!-- speccore-asset-version: 8.3.315 -->\n## 项目结构\n\n内容不带戳投影'
    );

    await syncAgentsMd(TEST_DIR, true);

    const agentsMd = readFileSync(join(TEST_DIR, 'AGENTS.md'), 'utf-8');
    expect(agentsMd).toContain('内容不带戳投影');
    expect(agentsMd).not.toContain('speccore-asset-version');
  });
});
