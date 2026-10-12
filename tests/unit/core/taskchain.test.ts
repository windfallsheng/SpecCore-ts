/**
 * TaskChain 泛化层回归基线（v8.3.307）
 *
 * 覆盖三块：
 *   1. task-type-registry — 7 种任务类型注册表（产出/验收/分支/约束声明）
 *   2. constraint-set — 约束集解析 + 加载（共同前提约束声明式注入）
 *   3. parseDeclaredConstraints — spec 中 constraints 声明的三种格式
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  TASK_TYPE_REGISTRY, getTaskTypeDefinition, ALL_TASK_TYPES, BUILTIN_CONSTRAINTS,
  buildGenericDefinition, parseCustomTypeDefinition, parseSpecCodeDeclaration,
  resolveTaskTypeDefinition, CUSTOM_TYPES_DIR,
} from '@/core/task-type-registry';
import {
  parseDeclaredConstraints, loadConstraintSet, formatConstraints, listConstraintSets,
} from '@/core/constraint-set';

const TEST_DIR = join(process.cwd(), 'tests', '.tmp', 'taskchain-test');

describe('task-type-registry — 内置类型单一事实来源（v8.3.308: 8 种）', () => {
  it('注册表包含 4 种代码类型 + 4 种 TaskChain 新类型', () => {
    expect(ALL_TASK_TYPES.sort()).toEqual(
      ['feature', 'bugfix', 'refactor', 'research', 'doc', 'script', 'data', 'presentation'].sort()
    );
  });

  it('代码类型需要端子目录 + 技术规格 + 分支', () => {
    for (const t of ['feature', 'bugfix', 'refactor']) {
      expect(TASK_TYPE_REGISTRY[t].needsPlatforms).toBe(true);
      expect(TASK_TYPE_REGISTRY[t].needsTechSpec).toBe(true);
      expect(TASK_TYPE_REGISTRY[t].needsBranch).toBe(true);
      expect(TASK_TYPE_REGISTRY[t].category).toBe('code');
    }
  });

  it('非代码类型（doc/script/data/presentation）不需要端子目录、技术规格与分支', () => {
    for (const t of ['doc', 'script', 'data', 'presentation']) {
      expect(TASK_TYPE_REGISTRY[t].needsPlatforms).toBe(false);
      expect(TASK_TYPE_REGISTRY[t].needsTechSpec).toBe(false);
      expect(TASK_TYPE_REGISTRY[t].needsBranch).toBe(false);
    }
  });

  it('每种类型都声明了产出目录 / 验收方式 / 默认约束集（branchType 仅代码形态需要）', () => {
    for (const def of Object.values(TASK_TYPE_REGISTRY)) {
      expect(def.outputDir.length).toBeGreaterThan(0);
      expect(def.acceptance.length).toBeGreaterThan(0);
      expect(def.defaultConstraints.length).toBeGreaterThan(0);
      if (def.needsBranch) expect(def.branchType.length).toBeGreaterThan(0);
    }
  });

  it('presentation 默认约束包含 doc-standards 与 presentation-standards', () => {
    const def = TASK_TYPE_REGISTRY.presentation;
    expect(def.defaultConstraints).toEqual(['doc-standards', 'presentation-standards']);
    expect(def.outputDir).toBe('presentations/');
  });

  it('未知类型回退通用非代码定义（不再回退 feature）', () => {
    const def = getTaskTypeDefinition('nonexistent');
    expect(def.type).toBe('nonexistent');
    expect(def.builtin).toBe(false);
    expect(def.needsBranch).toBe(false);
    expect(def.category).toBe('custom');
  });

  it('内置约束集覆盖全部默认约束名', () => {
    const names = new Set<string>();
    for (const def of Object.values(TASK_TYPE_REGISTRY)) {
      for (const c of def.defaultConstraints) names.add(c);
    }
    for (const name of names) {
      expect(BUILTIN_CONSTRAINTS[name]).toBeDefined();
      expect(BUILTIN_CONSTRAINTS[name].length).toBeGreaterThan(50);
    }
  });
});

describe('parseDeclaredConstraints — spec 声明解析（三种格式）', () => {
  it('YAML frontmatter 数组格式', () => {
    const content = '---\ntitle: x\nconstraints: [common-rules, frontend-rules]\n---\n# 正文';
    expect(parseDeclaredConstraints(content)).toEqual(['common-rules', 'frontend-rules']);
  });

  it('YAML frontmatter 列表格式', () => {
    const content = '---\nconstraints:\n  - doc-standards\n  - team-rules\n---\n# 正文';
    expect(parseDeclaredConstraints(content)).toEqual(['doc-standards', 'team-rules']);
  });

  it('行内声明格式（- 约束集: a, b）', () => {
    const content = '# 任务\n\n- 约束集: script-standards, 团队规范\n';
    expect(parseDeclaredConstraints(content)).toEqual(['script-standards', '团队规范']);
  });

  it('无声明返回空数组', () => {
    expect(parseDeclaredConstraints('# 普通任务\n\n## 描述\n')).toEqual([]);
  });

  it('模板变量占位符不当作约束名', () => {
    expect(parseDeclaredConstraints('- 约束集: {constraints}\n')).toEqual([]);
  });
});

describe('loadConstraintSet — 约束集加载（声明 ∪ 类型默认）', () => {
  let origCwd: string;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(join(TEST_DIR, '.speccore', 'GLOBAL', 'CONSTRAINTS'), { recursive: true });
    origCwd = process.cwd();
    process.chdir(TEST_DIR);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  function writeConstraint(name: string, content: string): void {
    writeFileSync(join(TEST_DIR, '.speccore', 'GLOBAL', 'CONSTRAINTS', `${name}.md`), content);
  }

  it('类型默认约束自动加载（doc → doc-standards）', async () => {
    writeConstraint('doc-standards', '# 文档标准\n\n- 无占位符\n');
    const { items, missing } = await loadConstraintSet({ taskType: 'doc' });
    expect(items.map(i => i.name)).toEqual(['doc-standards']);
    expect(missing).toEqual([]);
  });

  it('任务声明优先于类型默认，按声明顺序去重', async () => {
    writeConstraint('common-rules', '# 通用规则\n');
    writeConstraint('doc-standards', '# 文档标准\n');
    const { items } = await loadConstraintSet({ taskType: 'doc', declared: ['common-rules'] });
    // 声明在前，类型默认在后
    expect(items.map(i => i.name)).toEqual(['common-rules', 'doc-standards']);
  });

  it('声明与默认重复时只加载一次', async () => {
    writeConstraint('doc-standards', '# 文档标准\n');
    const { items } = await loadConstraintSet({ taskType: 'doc', declared: ['doc-standards'] });
    expect(items.map(i => i.name)).toEqual(['doc-standards']);
  });

  it('缺失的约束文件记录到 missing，不阻断加载', async () => {
    writeConstraint('doc-standards', '# 文档标准\n');
    const { items, missing } = await loadConstraintSet({ taskType: 'doc', declared: ['not-exist'] });
    // not-exist 被跳过，类型默认 doc-standards 仍正常加载
    expect(items.map(i => i.name)).toEqual(['doc-standards']);
    expect(missing).toEqual(['not-exist']);
  });

  it('约束内容截断至 maxChars', async () => {
    writeConstraint('doc-standards', 'x'.repeat(500));
    const { items } = await loadConstraintSet({ taskType: 'doc', maxChars: 100 });
    expect(items[0].content.length).toBe(100);
  });

  it('listConstraintSets 列出已安装约束集', async () => {
    writeConstraint('a-rules', '# A\n');
    writeConstraint('b-rules', '# B\n');
    writeFileSync(join(TEST_DIR, '.speccore', 'GLOBAL', 'CONSTRAINTS', '_template.md'), '# T\n');
    const names = await listConstraintSets();
    expect(names).toEqual(['a-rules', 'b-rules']); // _ 前缀跳过
  });

  it('formatConstraints 输出注入文本（强调每次重新加载）', async () => {
    writeConstraint('doc-standards', '# 文档标准\n\n- 无占位符\n');
    const { items } = await loadConstraintSet({ taskType: 'doc' });
    const text = formatConstraints(items);
    expect(text).toContain('执行前提约束');
    expect(text).toContain('doc-standards');
    expect(text).toContain('无占位符');
  });
});

// ═══════════════════════════════════════════════════════════
// v8.3.308 开放类型系统：自定义类型 + spec 代码声明
// ═══════════════════════════════════════════════════════════

describe('parseCustomTypeDefinition — 用户自定义类型定义文件', () => {
  it('完整 frontmatter 解析出全部字段', () => {
    const content = '---\nlabel: 总结编写\ncategory: doc\noutputDir: docs/summaries/\nacceptance: 三段式结构\nneedsBranch: false\nneedsPlatforms: false\nneedsTechSpec: false\nconstraints: [doc-standards, team-style]\n---\n正文\n';
    const def = parseCustomTypeDefinition('summary', content);
    expect(def).not.toBeNull();
    expect(def!.type).toBe('summary');
    expect(def!.label).toBe('总结编写');
    expect(def!.outputDir).toBe('docs/summaries/');
    expect(def!.needsBranch).toBe(false);
    expect(def!.defaultConstraints).toEqual(['doc-standards', 'team-style']);
    expect(def!.builtin).toBe(false);
  });

  it('自定义类型显式声明 needsBranch: true（要写代码的泛化任务）', () => {
    const content = '---\nlabel: 工具链开发\nneedsBranch: true\nbranchType: tool\n---\n';
    const def = parseCustomTypeDefinition('toolchain', content);
    expect(def!.needsBranch).toBe(true);
    expect(def!.branchType).toBe('tool');
  });

  it('无 frontmatter 返回 null', () => {
    expect(parseCustomTypeDefinition('x', '# 无 frontmatter')).toBeNull();
  });

  it('部分字段缺失时回退通用默认（不建分支）', () => {
    const content = '---\nlabel: 翻译\n---\n';
    const def = parseCustomTypeDefinition('translation', content)!;
    expect(def.outputDir).toBe('outputs/');
    expect(def.needsBranch).toBe(false);
    expect(def.needsPlatforms).toBe(false);
    expect(def.defaultConstraints).toEqual([]);
  });
});

describe('parseSpecCodeDeclaration — spec 显式「写代码」声明', () => {
  it('frontmatter code: true → 代码形态', () => {
    expect(parseSpecCodeDeclaration('---\ntype: summary\ncode: true\n---\n# 正文')).toBe(true);
  });

  it('frontmatter needsCode: true → 代码形态', () => {
    expect(parseSpecCodeDeclaration('---\nneedsCode: true\n---\n')).toBe(true);
  });

  it('行内「需要写代码: true」→ 代码形态', () => {
    expect(parseSpecCodeDeclaration('# 任务\n\n- 需要写代码: true\n')).toBe(true);
  });

  it('code: false 或无声明 → 非代码形态', () => {
    expect(parseSpecCodeDeclaration('---\ncode: false\n---\n')).toBe(false);
    expect(parseSpecCodeDeclaration('# 普通任务\n')).toBe(false);
  });
});

describe('resolveTaskTypeDefinition — 内置 → 自定义定义文件 → 通用回退', () => {
  let origCwd: string;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(join(TEST_DIR, '.speccore', 'GLOBAL', 'TASK_TYPES'), { recursive: true });
    origCwd = process.cwd();
    process.chdir(TEST_DIR);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('内置类型优先，不读自定义文件', async () => {
    writeFileSync(join(TEST_DIR, '.speccore', 'GLOBAL', 'TASK_TYPES', 'doc.md'), '---\nlabel: 干扰\n---\n');
    const def = await resolveTaskTypeDefinition('doc');
    expect(def.label).toBe('文档编写');
    expect(def.builtin).toBe(true);
  });

  it('自定义类型从定义文件解析', async () => {
    writeFileSync(
      join(TEST_DIR, '.speccore', 'GLOBAL', 'TASK_TYPES', 'summary.md'),
      '---\nlabel: 总结编写\noutputDir: docs/summaries/\nconstraints: [doc-standards]\n---\n',
    );
    const def = await resolveTaskTypeDefinition('summary');
    expect(def.label).toBe('总结编写');
    expect(def.outputDir).toBe('docs/summaries/');
    expect(def.defaultConstraints).toEqual(['doc-standards']);
  });

  it('无定义文件时回退通用非代码定义', async () => {
    const def = await resolveTaskTypeDefinition('translation');
    expect(def.builtin).toBe(false);
    expect(def.needsBranch).toBe(false);
    expect(def.needsPlatforms).toBe(false);
    expect(def.outputDir).toBe('outputs/');
  });

  it('自定义类型的默认约束参与 loadConstraintSet 加载', async () => {
    mkdirSync(join(TEST_DIR, '.speccore', 'GLOBAL', 'CONSTRAINTS'), { recursive: true });
    writeFileSync(join(TEST_DIR, '.speccore', 'GLOBAL', 'CONSTRAINTS', 'team-style.md'), '# 团队风格\n');
    writeFileSync(
      join(TEST_DIR, '.speccore', 'GLOBAL', 'TASK_TYPES', 'summary.md'),
      '---\nlabel: 总结\nconstraints: [team-style]\n---\n',
    );
    const { items } = await loadConstraintSet({ taskType: 'summary' });
    expect(items.map(i => i.name)).toEqual(['team-style']);
  });
});
