import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractOverviewContext } from '../../../src/core/unit-context-assembler';

describe('extractOverviewContext CLARIFY.md 切读（v8.3.374）', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `speccore-test-clarify-fallback-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('REQUIREMENT.md 为骨架时，自动切读功能单元 CLARIFY.md', async () => {
    const iterDir = tmpDir;
    await mkdir(join(iterDir, '020-specs', 'overview'), { recursive: true });
    await mkdir(join(iterDir, '020-specs', '预订模块', 'overview'), { recursive: true });

    // 骨架 REQUIREMENT.md（< 100 字）
    await writeFile(
      join(iterDir, '020-specs', 'overview', 'REQUIREMENT.md'),
      '# 需求规格\n\n## 预订模块\n\n待补充\n',
    );

    // 功能单元 CLARIFY.md（真实内容 >= 100 字）
    await writeFile(
      join(iterDir, '020-specs', '预订模块', 'overview', 'CLARIFY.md'),
      `# 预订模块需求澄清

## 背景与目标

本模块实现酒店预订功能，目标是让用户能够在线完成房间预订。
预订流程需要支持多种房型选择、入住日期选择。

## 功能规格

- 用户可搜索可用房间
- 用户可查看房间详情
- 用户可完成预订并支付

## 验收标准

- [ ] 搜索功能正常
- [ ] 预订流程完整
`,
    );

    // 单元名「预订模块」匹配目录名
    const ctx = await extractOverviewContext(iterDir, '预订模块', ['backend-service']);

    // 应包含 CLARIFY.md 内容
    expect(ctx).toContain('CLARIFY.md');
    expect(ctx).toContain('酒店预订功能');
    expect(ctx).toContain('搜索可用房间');
  });

  it('REQUIREMENT.md 为骨架且无功能单元 CLARIFY.md 时，切读全局 CLARIFY.md', async () => {
    const iterDir = tmpDir;
    await mkdir(join(iterDir, '020-specs', 'overview'), { recursive: true });

    // 骨架 REQUIREMENT.md
    await writeFile(
      join(iterDir, '020-specs', 'overview', 'REQUIREMENT.md'),
      '# 需求规格\n\n待补充\n',
    );

    // 全局 CLARIFY.md（跨单元业务规则）
    await writeFile(
      join(iterDir, '020-specs', 'overview', 'CLARIFY.md'),
      `# 全局业务规则澄清

## 术语表

- 预订：用户选择服务并确认的过程
- 取消：用户在服务开始前撤销预订

## 通用业务规则

- 所有预订需支付押金
- 取消预订需在服务开始前24小时
- 押金在服务完成后3个工作日内退还
`,
    );

    const ctx = await extractOverviewContext(iterDir, '预订', ['backend-service']);

    // 应包含全局 CLARIFY.md 内容（关键词匹配「预订」）
    expect(ctx).toContain('CLARIFY.md');
    expect(ctx).toContain('押金');
  });

  it('REQUIREMENT.md 有真实内容时，不切读 CLARIFY.md', async () => {
    const iterDir = tmpDir;
    await mkdir(join(iterDir, '020-specs', 'overview'), { recursive: true });
    await mkdir(join(iterDir, '020-specs', '预订模块', 'overview'), { recursive: true });

    // 有真实内容的 REQUIREMENT.md（>= 100 字）
    await writeFile(
      join(iterDir, '020-specs', 'overview', 'REQUIREMENT.md'),
      `# 需求规格

## 预订模块

系统提供完整的酒店预订功能，支持在线搜索、房型选择、价格比较、预订确认。
用户可以查看房间详情、设施信息、用户评价，并完成在线支付。
预订成功后系统发送确认邮件，支持24小时内免费取消。

## 支付模块

支持微信支付、支付宝、银联等多种支付渠道。
`,
    );

    // 功能单元 CLARIFY.md（不应被读取，因为 REQUIREMENT.md 有真实内容）
    await writeFile(
      join(iterDir, '020-specs', '预订模块', 'overview', 'CLARIFY.md'),
      '# CLARIFY 内容\n\n这个内容不应该出现在上下文中因为 REQUIREMENT.md 已经有真实内容了。\n',
    );

    const ctx = await extractOverviewContext(iterDir, '预订模块', ['backend-service']);

    // 应包含 REQUIREMENT.md 内容
    expect(ctx).toContain('REQUIREMENT.md');
    expect(ctx).toContain('酒店预订功能');
    // 不应包含 CLARIFY.md 内容
    expect(ctx).not.toContain('CLARIFY 内容');
    expect(ctx).not.toContain('不应该出现在上下文中');
  });
});
