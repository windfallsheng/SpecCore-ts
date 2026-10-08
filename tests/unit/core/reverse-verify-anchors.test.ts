/**
 * v8.3.301+: 验证环（verifyReverseAnchors）单元测试
 *
 * 覆盖：
 *   - 有效锚点通过、悬空锚点（引用不存在的模块）检出
 *   - 占位锚点（_AI 填写模块id）不计数
 *   - 带/不带方括号两种锚点写法均可提取
 *   - VERIFY_REPORT.md 落盘
 *   - REQUIREMENT.md 缺失时明确报错
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, pathExists, readFile } from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';
import { verifyReverseAnchors } from '../../../src/core/reverse-requirement';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sc-verify-'));
  await mkdir(join(dir, '_ir'));
  await writeFile(join(dir, '_ir', 'booking-service-order-service.md'), '# IR: order-service');
  await writeFile(join(dir, '_ir', 'admin-web-login.md'), '# IR: login');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function seedRequirement(content: string): Promise<string> {
  const p = join(dir, 'REQUIREMENT.md');
  await writeFile(p, content);
  return p;
}

describe('verifyReverseAnchors 验证环', () => {
  it('有效锚点通过、悬空锚点检出、占位锚点不计数', async () => {
    await seedRequirement([
      '## 功能单元清单',
      '| 用户认证 | order-service | backend | `booking-service/order-service` |',
      '## 验收标准',
      '- **AC-01**：当用户提交订单时，系统应创建订单。[溯源: `booking-service/order-service`]',
      '- **AC-02**：如果库存不足，则系统应拒绝下单。[溯源: `fake/hallucinated`]',
      '- **AC-03**：系统应记录日志。溯源: `_AI 填写模块id`',
    ].join('\n'));

    const r = await verifyReverseAnchors(dir);
    expect(r.total).toBe(2);                       // 占位锚点不计入
    expect(r.valid).toBe(1);
    expect(r.dangling).toEqual(['fake/hallucinated']);
    expect(r.reportPath).toBe(join(dir, 'VERIFY_REPORT.md'));
    expect(await pathExists(r.reportPath)).toBe(true);
    const report = await readFile(r.reportPath, 'utf-8');
    expect(report).toContain('悬空锚点: 1');
    expect(report).toContain('fake/hallucinated');
  });

  it('无方括号写法 溯源: `x` 同样提取', async () => {
    await seedRequirement([
      '- **AC-01**：系统应 X。溯源: `admin-web/login`',
      '- **AC-02**：系统应 Y。溯源: `ghost/module`',
    ].join('\n'));

    const r = await verifyReverseAnchors(dir);
    expect(r.total).toBe(2);
    expect(r.valid).toBe(1);
    expect(r.dangling).toEqual(['ghost/module']);
  });

  it('锚点全部有效时 dangling 为空、结论通过', async () => {
    await seedRequirement([
      '- **AC-01**：系统应 X。[溯源: `booking-service/order-service`]',
      '- **AC-02**：系统应 Y。[溯源: `admin-web/login`]',
    ].join('\n'));

    const r = await verifyReverseAnchors(dir);
    expect(r.total).toBe(2);
    expect(r.valid).toBe(2);
    expect(r.dangling).toEqual([]);
    const report = await readFile(r.reportPath, 'utf-8');
    expect(report).toContain('全部锚点通过校验');
  });

  it('锚点含端名连字符时 sanitize 归一化正确（booking-service/order-service ↔ 文件名）', async () => {
    // IR 文件名 booking-service-order-service.md 由 sanitize('booking-service/order-service') 生成
    await seedRequirement('- **AC-01**：系统应 X。[溯源: `booking-service/order-service`]');
    const r = await verifyReverseAnchors(dir);
    expect(r.dangling).toEqual([]);
    expect(r.valid).toBe(1);
  });

  it('REQUIREMENT.md 缺失时抛出明确错误', async () => {
    await expect(verifyReverseAnchors(dir)).rejects.toThrow(/未找到 .*REQUIREMENT\.md/);
  });
});
