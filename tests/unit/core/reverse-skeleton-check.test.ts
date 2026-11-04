/**
 * v8.3.394+: 骨架完成度自检回归基线
 *
 * countSkeletonPlaceholders 统计端目录内 UR（REQUIREMENT.md）与 IR（_ir/*.md）
 * 的未填占位符 `_AI 填写`——两跳填充是否完成的唯一硬指标。
 * 此前反推链无自检：骨架生成后即宣称完成，宿主 AI 未接力时文档停留骨架态。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { countSkeletonPlaceholders } from '../../../src/core/reverse-requirement';

const TEST_DIR = join(process.cwd(), 'tests', '.tmp', 'reverse-skeleton-check');

describe('countSkeletonPlaceholders 骨架完成度自检（v8.3.394+）', () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });
  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('骨架态：UR 与 IR 占位符计数正确', async () => {
    const ep = join(TEST_DIR, 'backend');
    mkdirSync(join(ep, '_ir'), { recursive: true });
    writeFileSync(join(ep, 'REQUIREMENT.md'), '# UR\n\n_AI 填写：一句话摘要_\n\n- **AC-01**：_AI 填写模块id_');
    writeFileSync(join(ep, '_ir', 'backend-auth.md'), '# IR\n\n_AI 填写：模块职责_');
    writeFileSync(join(ep, '_ir', 'backend-order.md'), '# IR\n\n### 模块职责\n\n_AI 填写：职责_');
    writeFileSync(join(ep, '_ir', 'backend-user.md'), '# IR 已填\n\n### 模块职责\n\n用户身份管理。');

    const st = await countSkeletonPlaceholders(ep);
    expect(st.requirement).toBe(2);
    expect(st.irTotal).toBe(3);
    expect(st.irPlaceholders).toBe(2);
    expect(st.irFilled).toBe(1);
  });

  it('成品态：占位符清零', async () => {
    const ep = join(TEST_DIR, 'frontend');
    mkdirSync(join(ep, '_ir'), { recursive: true });
    writeFileSync(join(ep, 'REQUIREMENT.md'), '# UR\n\n## 一、概述\n\n本端解决会议预订问题。');
    writeFileSync(join(ep, '_ir', 'frontend-page.md'), '# IR\n\n### 模块职责\n\n页面渲染与交互。');

    const st = await countSkeletonPlaceholders(ep);
    expect(st.requirement).toBe(0);
    expect(st.irPlaceholders).toBe(0);
    expect(st.irFilled).toBe(1);
  });

  it('无 REQUIREMENT.md 时不报错（requirement=0），无 _ir 目录时 IR 计数为 0', async () => {
    const ep = join(TEST_DIR, 'empty');
    mkdirSync(join(ep, '_ir'), { recursive: true });
    writeFileSync(join(ep, '_ir', 'x.md'), '# IR\n\n_AI 填写_');

    const st = await countSkeletonPlaceholders(ep);
    expect(st.requirement).toBe(0);
    expect(st.irPlaceholders).toBe(1);

    const bare = await countSkeletonPlaceholders(join(TEST_DIR, 'missing'));
    expect(bare.requirement).toBe(0);
    expect(bare.irTotal).toBe(0);
    expect(bare.irPlaceholders).toBe(0);
  });
});
