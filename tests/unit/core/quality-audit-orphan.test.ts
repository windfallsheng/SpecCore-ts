/**
 * QUALITY_AUDIT 孤儿目录过滤测试（v8.3.352+）
 *
 * 回归背景：features 重切（单元改名/删除）后，020-specs 下旧单元目录残留；
 * 旧实现只排系统目录，孤儿会被当功能模块审计（噪音污染报告）。修复后扫描
 * 循环按 features/ 清单过滤——不在清单内的一级目录不再进入审计。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { generateQualityAudit } from '../../../src/core/quality-audit';

let tmp: string;
let iterDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'quality-audit-orphan-'));
  iterDir = join(tmp, 'Iteration-T1');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** 写一份最小可审计的端级 TECH.md（020-specs/{feature}/{platform}/TECH.md） */
function writeFeatureTech(specDir: string, feature: string, platform: string, tag: string): void {
  mkdirSync(join(specDir, feature, platform), { recursive: true });
  writeFileSync(join(specDir, feature, platform, 'TECH.md'), `# 技术规格 ${tag}\n\n## 技术方案\n${tag} 的技术实现。`);
}

describe('generateQualityAudit 孤儿过滤', () => {
  it('不在功能单元清单内的一级目录不进入审计', async () => {
    // features 清单只含 unit-a；orphan-old 是重切前旧单元残留
    mkdirSync(join(iterDir, '010-requirements', 'features', 'unit-a'), { recursive: true });
    writeFileSync(join(iterDir, '010-requirements', 'features', 'unit-a', 'SOURCE.md'), '# unit-a\n需求原文。');
    const specDir = join(iterDir, '020-specs');
    writeFeatureTech(specDir, 'unit-a', 'admin-web', '当前单元');
    writeFeatureTech(specDir, 'orphan-old', 'admin-web', '孤儿旧单元');

    await generateQualityAudit(specDir, ['admin-web']);

    const report = readFileSync(join(specDir, 'QUALITY_AUDIT.md'), 'utf-8');
    // 报告按 020-specs 相对路径组织章节标题：清单内单元被审计，孤儿被过滤
    expect(report).toContain('unit-a/admin-web');
    expect(report).not.toContain('orphan-old');
  });

  it('无 features/ 目录（老项目）时过滤关闭，所有一级目录照常审计', async () => {
    const specDir = join(iterDir, '020-specs');
    writeFeatureTech(specDir, 'legacy-module', 'admin-web', '老项目模块');

    await generateQualityAudit(specDir, ['admin-web']);

    const report = readFileSync(join(specDir, 'QUALITY_AUDIT.md'), 'utf-8');
    expect(report).toContain('legacy-module/admin-web');
  });
});
