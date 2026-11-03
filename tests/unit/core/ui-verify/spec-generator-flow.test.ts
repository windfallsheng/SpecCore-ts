/**
 * spec-generator 流程场景生成单元测试（v8.3.293+/v8.3.355+）
 *
 * 覆盖：元素清单装配 / 动作语义提取（点击类动词 → click 动作）/
 * 输入类步骤不生成动作（值参数不可靠推断）/ 未命中元素降级骨架。
 */

import { describe, it, expect } from 'vitest';
import {
  generateFlowScenariosFromSpec,
  extractElementTestIds,
  type ElementTestIdInfo,
} from '../../../../src/core/ui-verify/spec-generator';
import type { SpecGenerationOptions } from '../../../../src/core/ui-verify/spec-generator';

const options: SpecGenerationOptions = { baseUrl: 'http://localhost:3000', platform: 'admin-web' };

const elementInfo: ElementTestIdInfo = {
  elements: {
    '新增按钮': 'btn-add-user',
    '保存按钮': 'btn-save',
    '用户名': 'input-username',
  },
  pageTestIds: ['users-page'],
};

const specText = [
  '## 业务流程',
  '点击「新增」按钮 → 弹出新增对话框',
  '填写用户名 → 点击保存',
].join('\n');

describe('generateFlowScenariosFromSpec 动作语义提取（v8.3.355+）', () => {
  it('点击类步骤命中元素清单 → 生成 click 动作 + 页面存活断言', () => {
    const scenarios = generateFlowScenariosFromSpec(specText, options, elementInfo);
    const clickScenario = scenarios.find((s) => s.name.includes('点击'));
    expect(clickScenario).toBeDefined();
    const actions = clickScenario!.actions;
    expect(actions.some((a) => a.type === 'click' && a.selector === '[data-testid="btn-add-user"]')).toBe(true);
    // 点击后只断言页面存活（body），不断言原元素可见（关闭类点击后元素消失属误报）
    expect(clickScenario!.assertions).toEqual([
      { type: 'visible', selector: 'body', description: '点击「点击「新增」按钮」后页面存活（未崩溃）' },
    ]);
  });

  it('输入类步骤命中元素清单 → 不生成动作，维持元素可见断言（值参数不可靠推断）', () => {
    const scenarios = generateFlowScenariosFromSpec(specText, options, elementInfo);
    const fillScenario = scenarios.find((s) => s.name.includes('填写用户名'));
    expect(fillScenario).toBeDefined();
    expect(fillScenario!.actions.every((a) => a.type !== 'click' && a.type !== 'fill')).toBe(true);
    expect(fillScenario!.assertions.some((a) => a.selector === '[data-testid="input-username"]')).toBe(true);
  });

  it('未命中元素清单的步骤维持骨架（页面容器 + body 兜底断言）', () => {
    const scenarios = generateFlowScenariosFromSpec(specText, options, elementInfo);
    const skeleton = scenarios.find((s) => s.name.includes('弹出新增对话框'));
    expect(skeleton).toBeDefined();
    expect(skeleton!.actions.some((a) => a.type === 'click')).toBe(false);
    expect(skeleton!.assertions.some((a) => a.selector === 'body')).toBe(true);
  });

  it('无元素清单（elementInfo 缺失）时不生成 click 动作', () => {
    const scenarios = generateFlowScenariosFromSpec(specText, options, undefined);
    for (const s of scenarios) {
      expect(s.actions.some((a) => a.type === 'click')).toBe(false);
    }
  });

  it('单字「点」不误判（重点/地点等非点击语境）；「勾选」动词正常识别', () => {
    const elementInfo2: ElementTestIdInfo = {
      elements: { 同意条款: 'chk-agree' },
      pageTestIds: ['users-page'],
    };
    const text = ['## 交互流程', '重点关注该页面布局 → 勾选同意条款'].join('\n');
    const scenarios = generateFlowScenariosFromSpec(text, options, elementInfo2);
    // 「重点关注该页面布局」不命中元素清单，且「重点」不触发 click
    const focus = scenarios.find((s) => s.name.includes('重点关注'));
    expect(focus).toBeDefined();
    expect(focus!.actions.some((a) => a.type === 'click')).toBe(false);
    // 「勾选同意条款」命中「同意条款」+ 「勾选」动词 → click
    const check = scenarios.find((s) => s.name.includes('勾选同意条款'));
    expect(check).toBeDefined();
    expect(check!.actions.some((a) => a.type === 'click' && a.selector === '[data-testid="chk-agree"]')).toBe(true);
  });
});

describe('extractElementTestIds 与流程装配协作', () => {
  it('从 UI_SPEC 表格提取元素清单后，流程步骤可装配 click', () => {
    const uiSpec = [
      '## 元素标识约定',
      '| 元素 | data-testid |',
      '|------|-------------|',
      '| 新增按钮 | btn-add-user |',
      '',
      '## 业务流程',
      '点击「新增」按钮 → 弹出新增对话框',
    ].join('\n');
    const info = extractElementTestIds(uiSpec);
    const scenarios = generateFlowScenariosFromSpec(uiSpec, options, info);
    const clickScenario = scenarios.find((s) => s.name.includes('点击'));
    expect(clickScenario!.actions.some((a) => a.type === 'click' && a.selector === '[data-testid="btn-add-user"]')).toBe(true);
  });
});
