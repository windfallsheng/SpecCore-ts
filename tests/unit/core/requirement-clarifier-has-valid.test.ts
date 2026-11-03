/**
 * hasValidClarifiedDocs 骨架过滤测试（v8.3.352+）
 *
 * 回归背景：analyze 预建骨架会写出带 <!-- SPEC-SKELETON --> 标记的 CLARIFY.md；
 * 旧实现仅查文件存在性，纯 prompt 模式（非 --auto）重跑 analyze 时骨架被误计为
 * 已澄清 → 澄清被静默跳过。本组用例验证「存在且非骨架」才计有效产物。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { hasValidClarifiedDocs } from '../../../src/core/requirement-clarifier';

const SKELETON = '<!-- SPEC-SKELETON -->';

let tmp: string;
let iterDir: string;
let featuresDir: string;
let specsDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'clarify-has-valid-'));
  iterDir = join(tmp, 'Iteration-T1');
  featuresDir = join(iterDir, '010-requirements', 'features');
  specsDir = join(iterDir, '020-specs');
  mkdirSync(join(iterDir, '010-requirements', 'sources'), { recursive: true });
  mkdirSync(featuresDir, { recursive: true });
  mkdirSync(specsDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** 写源文档并把 mtime 拨回过去（保证澄清产物 mtime 更新） */
function writeSource(mtimeSecsAgo = 3600): void {
  const p = join(iterDir, '010-requirements', 'sources', 'a.md');
  writeFileSync(p, '# 源需求\n这是原始需求描述。');
  const past = new Date(Date.now() - mtimeSecsAgo * 1000);
  utimesSync(p, past, past);
}

function writeClarify(rel: string, content: string): void {
  const p = join(specsDir, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content);
}

function writeUnit(unit: string): void {
  const dir = join(featuresDir, unit);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SOURCE.md'), `# ${unit}\n需求原文。`);
}

describe('hasValidClarifiedDocs', () => {
  it('无任何澄清文件 → false', async () => {
    writeSource();
    writeUnit('unit-a');
    expect(await hasValidClarifiedDocs(iterDir)).toBe(false);
  });

  it('骨架 CLARIFY.md（全局 + 单元级）不被误计为已澄清 → false', async () => {
    writeSource();
    writeUnit('unit-a');
    // 骨架 mtime 比源文档新（analyze 预建骨架的典型时序）——旧实现正是被这手骗过
    writeClarify('overview/CLARIFY.md', `${SKELETON}\n# 全局澄清记录\n待填充`);
    writeClarify('unit-a/overview/CLARIFY.md', `${SKELETON}\n# 单元澄清记录\n待填充`);
    expect(await hasValidClarifiedDocs(iterDir)).toBe(false);
  });

  it('真实单元级澄清（覆盖过半且新于源文档）→ true', async () => {
    writeSource();
    writeUnit('unit-a');
    // v8.3.374: 内容必须 >= 100 字才能通过 isSkeletonContent 检测
    writeClarify('unit-a/overview/CLARIFY.md', '# 澄清记录\n\n## 背景与目标\n本单元实现用户认证功能，支持手机号和邮箱两种登录方式。\n\n## 功能规格\nG-Q001 | 问题 | 回答\n\n## 验收标准\n- [ ] 用户可以通过手机号登录\n- [ ] 用户可以通过邮箱登录');
    expect(await hasValidClarifiedDocs(iterDir)).toBe(true);
  });

  it('两单元一真实一骨架：骨架不计入，真实覆盖刚好过半 → true', async () => {
    writeSource();
    writeUnit('unit-a');
    writeUnit('unit-b');
    // v8.3.374: 内容必须 >= 100 字才能通过 isSkeletonContent 检测
    writeClarify('unit-a/overview/CLARIFY.md', '# 澄清记录\n\n## 背景与目标\n本单元实现用户认证功能，支持手机号和邮箱两种登录方式。\n\n## 功能规格\nG-Q001 | 问题 | 回答\n\n## 验收标准\n- [ ] 用户可以通过手机号登录\n- [ ] 用户可以通过邮箱登录');
    writeClarify('unit-b/overview/CLARIFY.md', `${SKELETON}\n# 单元澄清记录\n待填充`);
    expect(await hasValidClarifiedDocs(iterDir)).toBe(true);
  });

  it('真实澄清存在但内容陈旧于源文档 → false（mtime 防线仍生效）', async () => {
    writeUnit('unit-a');
    // v8.3.374: 内容必须 >= 100 字才能通过 isSkeletonContent 检测
    writeClarify('unit-a/overview/CLARIFY.md', '# 澄清记录\n\n## 背景与目标\n本单元实现用户认证功能，支持手机号和邮箱两种登录方式。\n\n## 功能规格\nG-Q001 | 问题 | 回答\n\n## 验收标准\n- [ ] 用户可以通过手机号登录\n- [ ] 用户可以通过邮箱登录');
    // 澄清产物 mtime 拨回更早，源文档 mtime 更新（需求更新后未重新澄清的场景）
    const old = new Date(Date.now() - 7200 * 1000);
    utimesSync(join(specsDir, 'unit-a', 'overview', 'CLARIFY.md'), old, old);
    writeSource(60);
    expect(await hasValidClarifiedDocs(iterDir)).toBe(false);
  });
});
