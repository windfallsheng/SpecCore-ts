import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';
import { searchRagIndex, saveRagIndex } from '../../../src/core/rag-engine';
import type { RagIndex } from '../../../src/core/rag-engine';

/** 构造测试索引（c1/c3 同文件同标题，用于验证去重） */
function makeIndex(): RagIndex {
  return {
    version: '1',
    updatedAt: new Date().toISOString(),
    scope: 'test-iteration',
    chunks: [
      {
        id: 'c1',
        filePath: '.speccore/RULES/api-design.md',
        fileName: 'api-design.md',
        title: 'API 设计规范',
        level: 2,
        content: '统一接口格式与错误码体系',
        summary: '统一接口格式、错误码体系、鉴权方式',
        keywords: ['api', '接口', '错误码'],
        charCount: 100,
      },
      {
        id: 'c2',
        filePath: '.speccore/RULES/database.md',
        fileName: 'database.md',
        title: '数据库设计规范',
        level: 2,
        content: '表设计与索引规范',
        summary: '表结构设计、索引策略、命名规范',
        keywords: ['database', '数据库', '索引'],
        charCount: 80,
      },
      {
        id: 'c3',
        filePath: '.speccore/RULES/api-design.md',
        fileName: 'api-design.md',
        title: 'API 设计规范',
        level: 3,
        content: '错误码子章节',
        summary: '错误码分段定义',
        keywords: ['api', '错误码'],
        charCount: 40,
      },
    ],
    fileSummaries: {},
    fileMtimes: {},
  };
}

describe('searchRagIndex - 语义召回（v8.3.328）', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'speccore-rag-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('中文查询：双字组命中 keywords，按加权分排序', async () => {
    await saveRagIndex(tempDir, makeIndex());
    const hits = await searchRagIndex(tempDir, '设计 API 接口与错误码');
    expect(hits.length).toBeGreaterThan(0);
    // api-design（keywords 命中 api/接口/错误码 ×3 + title 命中设计/接口 ×2）应排第一
    expect(hits[0].filePath).toContain('api-design');
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('英文查询：单词命中 title/keywords', async () => {
    await saveRagIndex(tempDir, makeIndex());
    const hits = await searchRagIndex(tempDir, 'database schema index');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].filePath).toContain('database');
  });

  it('同文件同标题去重，只留最高分', async () => {
    await saveRagIndex(tempDir, makeIndex());
    const hits = await searchRagIndex(tempDir, 'api 错误码 接口');
    const apiHits = hits.filter((h) => h.filePath.includes('api-design'));
    expect(apiHits.length).toBe(1);
  });

  it('迭代专属索引优先于全局索引', async () => {
    await saveRagIndex(tempDir, makeIndex()); // 全局
    const iterIndex = makeIndex();
    iterIndex.chunks = [
      {
        id: 'i1',
        filePath: '.speccore/PATTERNS/booking.md',
        fileName: 'booking.md',
        title: '预订流程模式',
        level: 2,
        content: '预订幂等设计',
        summary: '会议室预订幂等与锁',
        keywords: ['预订', '幂等'],
        charCount: 60,
      },
    ];
    await saveRagIndex(tempDir, iterIndex, 'rag-index-iter-001.json');
    const hits = await searchRagIndex(tempDir, '会议室预订 幂等', {
      iteration: 'iter-001',
    });
    expect(hits.length).toBe(1);
    expect(hits[0].filePath).toContain('booking');
  });

  it('索引不存在返回空数组', async () => {
    const hits = await searchRagIndex(tempDir, '任意查询');
    expect(hits).toEqual([]);
  });

  it('limit 截断结果数', async () => {
    const index = makeIndex();
    // 10 个不同 chunk，全部命中同一词
    index.chunks = Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`,
      filePath: `.speccore/RULES/rule-${i}.md`,
      fileName: `rule-${i}.md`,
      title: `规范 ${i}`,
      level: 2,
      content: 'x',
      summary: '共通规范',
      keywords: ['共通'],
      charCount: 10,
    }));
    await saveRagIndex(tempDir, index);
    const hits = await searchRagIndex(tempDir, '共通', { limit: 3 });
    expect(hits.length).toBe(3);
  });
});
