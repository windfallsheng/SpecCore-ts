/**
 * v8.3.371: 实体/术语形态过滤回归测试。
 * 背景：旧启发式把 generateGraphReport（函数）、ReportOptions（选项类型）当实体，
 * 把 core/commands/index.ts（目录名/文件名）当术语，信噪比极低。
 */
import { describe, it, expect } from 'vitest';
import { isBusinessEntitySymbol, isGlossaryCandidate } from '../../../src/core/global-artifacts';

describe('isBusinessEntitySymbol 业务实体判定', () => {
  it('保留 PascalCase 领域名词', () => {
    expect(isBusinessEntitySymbol('FeatureGroup')).toBe(true);
    expect(isBusinessEntitySymbol('PlatformGroup')).toBe(true);
    expect(isBusinessEntitySymbol('OrderItem')).toBe(false); // Item 元类型后缀
    expect(isBusinessEntitySymbol('BookingUnit')).toBe(true);
  });

  it('排除小写开头函数与变量', () => {
    expect(isBusinessEntitySymbol('generateGraphReport')).toBe(false);
    expect(isBusinessEntitySymbol('buildTitleOutline')).toBe(false);
  });

  it('排除元类型后缀（Config/Options/Report）', () => {
    expect(isBusinessEntitySymbol('VisualModelConfig')).toBe(false);
    expect(isBusinessEntitySymbol('ReportOptions')).toBe(false);
    expect(isBusinessEntitySymbol('TaskReport')).toBe(false);
  });

  it('排除全大写常量与动词开头', () => {
    expect(isBusinessEntitySymbol('UNITS_CACHE_DIR')).toBe(false);
    expect(isBusinessEntitySymbol('BuildGraphReport')).toBe(false);
    expect(isBusinessEntitySymbol('')).toBe(false);
  });
});

describe('isGlossaryCandidate 术语候选判定', () => {
  it('保留 PascalCase 领域名词', () => {
    expect(isGlossaryCandidate('IterationUnit')).toBe(true);
    expect(isGlossaryCandidate('UnitAnalysis')).toBe(true);
  });

  it('排除文件名与路径片段', () => {
    expect(isGlossaryCandidate('index.ts')).toBe(false);
    expect(isGlossaryCandidate('booking.service.ts')).toBe(false);
    expect(isGlossaryCandidate('src/core')).toBe(false);
  });

  it('排除小写目录名/变量与全大写常量', () => {
    expect(isGlossaryCandidate('core')).toBe(false);
    expect(isGlossaryCandidate('completionCommand')).toBe(false);
    expect(isGlossaryCandidate('SVG_ONBOARD')).toBe(false);
  });

  it('排除 XxxOptions/XxxConfig 选项接口元类型', () => {
    expect(isGlossaryCandidate('ArchiveOptions')).toBe(false);
    expect(isGlossaryCandidate('ConfigOptions')).toBe(false);
    expect(isGlossaryCandidate('PromptTemplate')).toBe(true);
    expect(isGlossaryCandidate('TaskPlan')).toBe(true);
  });
});
