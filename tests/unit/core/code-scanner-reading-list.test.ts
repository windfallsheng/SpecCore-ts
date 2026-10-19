import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdirp, remove } from 'fs-extra';
import { tmpdir } from 'os';
import { join } from 'path';
import { formatSourceReadingList } from '../../../src/core/code-scanner';
import { loadCodeGraph } from '../../../src/core/code-graph';
import * as taskUtils from '../../../src/utils/task-utils';

// ═══════════════════════════════════════════════════════════
// 源码阅读清单（v8.3.329）：CLI 导航 + 宿主 AI 按需深读
// 核心断言：任何 AI 上下文都不拼源码原文——
// 交付「路径 + 优先级 + 匹配原因 + 符号线索」，全文由宿主 AI 按需获取。
// ═══════════════════════════════════════════════════════════
describe('formatSourceReadingList - 源码阅读清单（v8.3.329）', () => {
  const matches = [
    { file: 'src/services/booking.service.ts', exports: ['BookingService'], apis: ['POST /api/booking'], score: 52 },
    { file: 'src/models/room.entity.ts', exports: ['Room'], apis: [], score: 41 },
    { file: 'src/utils/date.ts', exports: [], apis: [], score: 27 },
    { file: 'src/legacy/helper.ts', exports: [], apis: [], score: 10 },
  ];

  it('产出优先级与匹配原因：@spec 关联 P0、知识图谱 P0、技术关键词 P1、关键词 P2', async () => {
    const list = await formatSourceReadingList(matches, { withSymbolLines: false });
    expect(list).toContain('| P0 | `src/services/booking.service.ts`');
    expect(list).toContain('@spec 注释直接关联');
    expect(list).toContain('知识图谱 source-file 实体关联');
    expect(list).toContain('| P1 | `src/utils/date.ts`');
    expect(list).toContain('Spec 技术关键词匹配');
    expect(list).toContain('| P2 | `src/legacy/helper.ts`');
    expect(list).toContain('关键词匹配');
  });

  it('代码线索给符号而非正文：导出符号与 API 路径', async () => {
    const list = await formatSourceReadingList(matches, { withSymbolLines: false });
    expect(list).toContain('导出 `BookingService`');
    expect(list).toContain('API `POST /api/booking`');
    // 绝不含源码正文片段（无代码围栏、无分号语句）
    expect(list).not.toContain('```');
    expect(list).not.toMatch(/function\s+\w+\s*\(/);
  });

  it('附深读协议：Read / Grep / LSP 按需深读，禁止要求拼全文', async () => {
    const list = await formatSourceReadingList(matches, { withSymbolLines: false });
    expect(list).toContain('CLI 不拼入源码全文');
    expect(list).toContain('深读协议');
    expect(list).toContain('Read / Grep / LSP');
  });

  it('空匹配返回空字符串（不产出空清单）', async () => {
    const list = await formatSourceReadingList([], { withSymbolLines: false });
    expect(list).toBe('');
  });

  it('maxEntries 限制条目数', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      file: `src/f${i}.ts`,
      exports: [],
      apis: [],
      score: 10 + i,
    }));
    const list = await formatSourceReadingList(many, { maxEntries: 5, withSymbolLines: false });
    const rows = list.split('\n').filter((l) => l.startsWith('| P'));
    expect(rows.length).toBe(5);
  });

  it('withSymbolLines 默认开启：code-graph 缺失时静默降级不阻断', async () => {
    // 测试环境下 code-graph 通常不存在——验证加载失败不抛错、清单照常产出
    const list = await formatSourceReadingList(matches, { maxEntries: 3 });
    expect(list).toContain('| P0 | `src/services/booking.service.ts`');
    expect(list).toContain('深读协议');
  });
});

// ═══════════════════════════════════════════════════════════
// v8.3.330 回归：GRAPH_DIR 曾为绝对路径，path.join(root, GRAPH_DIR)
// 会拼接出「root + 绝对路径」双份路径，导致 loadCodeGraph 永远返回 null。
// 修复后 GRAPH_DIR 为相对常量，join 拼接自然正确。
// ═══════════════════════════════════════════════════════════
describe('code-graph 双重 join 回归（v8.3.330）', () => {
  const tmpDirs: string[] = [];

  async function makeGraphWith(relPath: string, nodes: unknown[]) {
    const dir = await mkdtemp(join(tmpdir(), 'spec-graph-'));
    tmpDirs.push(dir);
    const graphDir = join(dir, '.speccore', 'code-graph');
    await mkdirp(graphDir);
    await writeFile(
      join(graphDir, 'graph.json'),
      JSON.stringify({ nodes, edges: [], communities: [], godNodes: [] }),
    );
    return dir;
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tmpDirs.splice(0).map((d) => remove(d)));
  });

  it('loadCodeGraph 传入绝对 projectRoot 能读到 graph.json', async () => {
    const dir = await makeGraphWith('src/a.ts', [
      { id: 'a', name: 'BookingService', type: 'class', filePath: 'src/a.ts', line: 42, column: 1, snippet: '' },
    ]);
    const g = await loadCodeGraph(dir);
    expect(g).not.toBeNull();
    expect(g!.nodes).toHaveLength(1);
    expect(g!.nodes[0].name).toBe('BookingService');
  });

  it('行号锚点优先导出符号：import 变量行号不抢占', async () => {
    const dir = await makeGraphWith('src/services/booking.service.ts', [
      { id: 'm', name: 'booking.service.ts', type: 'module', filePath: 'src/services/booking.service.ts', line: 1, column: 1, snippet: '' },
      { id: 'i', name: 'readFile', type: 'variable', filePath: 'src/services/booking.service.ts', line: 11, column: 1, snippet: '' },
      { id: 'c', name: 'BookingService', type: 'class', filePath: 'src/services/booking.service.ts', line: 42, column: 1, snippet: '' },
    ]);
    vi.spyOn(taskUtils, 'getProjectRoot').mockReturnValue(dir);
    const list = await formatSourceReadingList(
      [{ file: 'src/services/booking.service.ts', exports: ['BookingService'], apis: [], score: 52 }],
      { maxEntries: 3 },
    );
    expect(list).toContain('BookingService:L42');
    expect(list).not.toContain('readFile:L11');
  });
});
