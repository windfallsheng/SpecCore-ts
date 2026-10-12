/**
 * 模块任务聚合模板回归基线（v8.3.310+）
 *
 * --group 聚合模式将关联任务合并为模块任务（像 feature 任务的 Task 目录）：
 * 子任务按 01-{slug}/ 序号平铺在模块目录下（scanTasks 只扫两层，第三层不会被误扫），
 * 模块公共约束 spec 落 00-specs/CONSTRAINTS.md，chain 每次执行子任务前自动注入。
 * 修复历史：用户希望关联任务像 feature 一样按模块组织，共享公共约束前提，
 * 其余单个任务按单个处理。
 */

import { describe, it, expect } from 'vitest';
import {
  buildModuleConstraintsTemplate,
  buildSubtaskTemplate,
} from '../../../src/commands/task/new';

describe('buildModuleConstraintsTemplate', () => {
  it('包含模块组名与自动注入提示', () => {
    const t = buildModuleConstraintsTemplate('翻译任务组');
    expect(t).toContain('# 模块公共约束：翻译任务组');
    expect(t).toContain('共同前提约束');
    expect(t).toContain('每次执行子任务前自动注入');
  });

  it('包含约束三大节（通用纪律/产出要求/验收标准）', () => {
    const t = buildModuleConstraintsTemplate('X');
    expect(t).toContain('## 通用纪律');
    expect(t).toContain('## 产出要求');
    expect(t).toContain('## 验收标准');
  });

  it('提示约束修改后自动生效、子任务无需重复声明', () => {
    const t = buildModuleConstraintsTemplate('X');
    expect(t).toContain('修改本文件后，后续子任务执行自动生效');
    expect(t).toContain('无需逐个子任务重复声明');
  });
});

describe('buildSubtaskTemplate', () => {
  it('包含子任务标题与描述', () => {
    const t = buildSubtaskTemplate({ name: '第一章翻译', desc: '翻译第一章内容' });
    expect(t).toContain('# 第一章翻译');
    expect(t).toContain('翻译第一章内容');
  });

  it('指向模块公共约束位置与 done 更新要求', () => {
    const t = buildSubtaskTemplate({ name: 'A', desc: '' });
    expect(t).toContain('00-specs/CONSTRAINTS.md');
    expect(t).toContain('.meta/status 更新为 done');
  });

  it('空描述时模板不残留空白描述行', () => {
    const t = buildSubtaskTemplate({ name: 'A', desc: '' });
    expect(t).not.toContain('\n\n\n## 执行说明');
  });
});
