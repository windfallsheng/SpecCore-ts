/**
 * asset-stamp — 内置资产版本戳工具单元测试
 *
 * 背景：升级时区分「新版 CLI 生成 / 旧版 CLI 生成 / 用户自定义」三类文件，
 * 版本戳把「每次升级枚举旧特征」变成「对齐版本戳」。本测试锁住四个函数的契约。
 */

import { describe, it, expect } from 'vitest';
import { stampContent, readAssetStamp, decideStampedSync, stripAssetStamp } from '@/core/asset-stamp';

describe('asset-stamp — stampContent 注入', () => {
  it('无戳内容应注入当前版本戳（置于开头）', () => {
    const out = stampContent('## 项目结构\n\n内容');
    expect(out).toMatch(/^<!-- speccore-asset-version: [\w.-]+ -->\n## 项目结构/);
  });

  it('有 frontmatter 时应注入到 frontmatter 之后（保持 YAML 在最顶）', () => {
    const out = stampContent('---\nname: code-reviewer\ntitle: 审查员\n---\n\n正文');
    expect(out.indexOf('---\nname: code-reviewer')).toBe(0);
    const fmEnd = out.indexOf('---\n\n');
    expect(out.slice(fmEnd + 5, fmEnd + 60)).toContain('speccore-asset-version');
  });

  it('已有戳应替换为新戳（幂等）', () => {
    const once = stampContent('正文');
    const twice = stampContent(once);
    expect(twice).toBe(once);
    expect((twice.match(/speccore-asset-version:/g) || []).length).toBe(1);
  });
});

describe('asset-stamp — readAssetStamp', () => {
  it('有戳返回版本号，无戳返回 null', () => {
    expect(readAssetStamp(stampContent('x'))).toMatch(/^[\w.-]+$/);
    expect(readAssetStamp('普通内容')).toBe(null);
  });
});

describe('asset-stamp — decideStampedSync 统一决策表', () => {
  const isLegacy = (c: string) => /旧版特征/.test(c);

  it('内容完全相同时 skip（幂等，不产生备份噪音）', () => {
    const stamped = stampContent('内容');
    expect(decideStampedSync(stamped, stamped, isLegacy)).toBe('skip');
  });

  it('剥戳后与内置一致 → restamp（8.3.314 及以前无戳同内容文件补戳，零备份）', () => {
    const builtin = stampContent('## 项目结构\n\n内容');
    expect(decideStampedSync('## 项目结构\n\n内容', builtin, isLegacy)).toBe('restamp');
  });

  it('旧版本戳 → refresh（新版 CLI 内容迁移，不再依赖特征枚举）', () => {
    const oldStamped = '<!-- speccore-asset-version: 8.3.100 -->\n旧内容（无任何旧版特征词）';
    expect(decideStampedSync(oldStamped, stampContent('新内容'), isLegacy)).toBe('refresh');
  });

  it('同版本戳但内容不同 → skip（用户改过当前版生成物，保留）', () => {
    const stamped = stampContent('CLI 原始内容');
    const userEdited = stamped.replace('CLI 原始内容', '用户微调');
    expect(decideStampedSync(userEdited, stamped, isLegacy)).toBe('skip');
  });

  it('无戳且命中旧版特征 → refresh（老项目首升级兜底）', () => {
    expect(decideStampedSync('旧版特征内容', stampContent('新内容'), isLegacy)).toBe('refresh');
  });

  it('无戳且无旧版特征 → skip（用户自定义保留）', () => {
    expect(decideStampedSync('用户自定义内容', stampContent('新内容'), isLegacy)).toBe('skip');
  });
});

describe('asset-stamp — stripAssetStamp 剥戳', () => {
  it('应剥掉行首版本戳且不伤正文', () => {
    const stamped = stampContent('## 项目结构\n\n正文');
    const stripped = stripAssetStamp(stamped);
    expect(stripped).not.toContain('speccore-asset-version');
    expect(stripped).toBe('## 项目结构\n\n正文');
  });

  it('无戳内容原样返回（消费点通用安全）', () => {
    expect(stripAssetStamp('普通内容')).toBe('普通内容');
  });
});
