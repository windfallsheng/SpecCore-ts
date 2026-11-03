import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractOverviewContext } from '../../../src/core/unit-context-assembler';

describe('extractOverviewContext 单元级黄金需求（v8.3.373）', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `speccore-test-eoc-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('优先读 unit-{unitName}.md（单元级黄金需求全文注入）', async () => {
    const iterDir = tmpDir;
    await mkdir(join(iterDir, '020-specs', 'overview'), { recursive: true });
    await mkdir(join(iterDir, '020-specs', 'requirements'), { recursive: true });

    // 单元级黄金需求（精准澄清产物）
    await writeFile(
      join(iterDir, '020-specs', 'requirements', 'unit-booking-module.md'),
      '# 预订模块澄清需求\n\n- 预订流程支持取消和修改\n- 取消需在入住前24小时\n',
    );

    // overview/REQUIREMENT.md（聚合版，内容更泛化）
    await writeFile(
      join(iterDir, '020-specs', 'overview', 'REQUIREMENT.md'),
      '# 需求规格\n\n## 预订模块\n\n系统提供预订功能。\n\n## 支付模块\n\n系统提供支付功能。\n',
    );

    const ctx = await extractOverviewContext(iterDir, 'booking-module', ['backend-service']);

    // 单元级黄金需求应被全文注入（优先级最高）
    expect(ctx).toContain('unit-booking-module.md');
    expect(ctx).toContain('预订流程支持取消和修改');
    expect(ctx).toContain('取消需在入住前24小时');
  });

  it('无 unit-*.md 时用中文单元名从 overview/REQUIREMENT.md 关键词提取', async () => {
    const iterDir = tmpDir;
    await mkdir(join(iterDir, '020-specs', 'overview'), { recursive: true });

    // 无 requirements/ 目录、无 unit-*.md
    // v8.3.374: 内容必须 >= 100 字才能通过 isSkeletonContent 检测
    await writeFile(
      join(iterDir, '020-specs', 'overview', 'REQUIREMENT.md'),
      '# 需求规格\n\n## 预订模块\n\n系统提供预订功能，支持在线支付和到店支付。用户可以在预订后24小时内免费取消。预订流程包括选择房型、填写入住人信息、确认订单并支付。\n\n## 支付模块\n\n独立支付网关，支持微信支付、支付宝、银联等多种支付渠道。支付成功后生成支付凭证。\n',
    );

    // 使用中文单元名（与真实场景一致，关键词拆分后匹配文档标题）
    const ctx = await extractOverviewContext(iterDir, '预订', ['backend-service']);

    // 回退到 overview 关键词提取——中文「预订」匹配「## 预订模块」
    expect(ctx).toContain('REQUIREMENT.md');
    expect(ctx).toContain('预订功能');
  });

  it('unit-*.md 与 overview/REQUIREMENT.md 同时存在时两者都注入', async () => {
    const iterDir = tmpDir;
    await mkdir(join(iterDir, '020-specs', 'overview'), { recursive: true });
    await mkdir(join(iterDir, '020-specs', 'requirements'), { recursive: true });

    await writeFile(
      join(iterDir, '020-specs', 'requirements', 'unit-支付.md'),
      '# 支付单元精准需求\n\n- 支持微信和支付宝\n- 支付成功后生成电子凭证\n- 支持退款和部分退款\n',
    );
    // v8.3.374: 内容必须 >= 100 字才能通过 isSkeletonContent 检测
    await writeFile(
      join(iterDir, '020-specs', 'overview', 'REQUIREMENT.md'),
      '# 需求规格\n\n## 支付模块\n\n系统提供完整的支付功能，支持微信支付、支付宝、银联等多种支付渠道。用户支付成功后系统自动生成支付凭证，并支持全额退款和部分退款场景。支付流程包括选择支付方式、确认支付金额、完成支付操作。\n',
    );

    // 中文单元名「支付」匹配 REQUIREMENT.md 的「## 支付模块」
    const ctx = await extractOverviewContext(iterDir, '支付', ['backend-service']);

    // 单元级精准注入
    expect(ctx).toContain('支持微信和支付宝');
    // overview 关键词也注入（v8.3.374: 因为 REQUIREMENT.md 不再是骨架）
    expect(ctx).toContain('REQUIREMENT.md');
    expect(ctx).toContain('支付功能');
  });

  it('unit-*.md 不存在时函数不报错，仅返回语义关联结果', async () => {
    const iterDir = tmpDir;
    await mkdir(join(iterDir, '020-specs'), { recursive: true });

    // 无任何需求文档——函数应优雅降级（语义关联可能返回空或源码匹配）
    const ctx = await extractOverviewContext(iterDir, 'nonexistent-xyz-abc', ['backend-service']);
    // 不应抛异常，返回字符串
    expect(typeof ctx).toBe('string');
    // 不应包含单元级黄金需求标记
    expect(ctx).not.toContain('单元级黄金需求');
  });
});
