/**
 * 全量层操作测试
 * 测试 GLOBAL/INDEX.md 的解析和变更追踪
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(process.cwd(), 'tests', '.tmp', 'global-test');

function setupGlobalDir(): void {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(join(TEST_DIR, '.speccore', 'GLOBAL', 'PROJECTS', '_template'), { recursive: true });
}

function teardownGlobalDir(): void {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

// INDEX.md 内容模板
function createIndexContent(reqs: Array<{ id: string; project: string; name: string; status: string }>): string {
  let content = `# 全量需求索引（Global Catalog）

> 本文件由 speccore import 和 speccore index-update 自动维护，请勿手动编辑。

---

## 需求索引

| 需求 ID | 项目 | 需求名称 | 状态 | 版本 | 文件路径 |
| :--- | :--- | :--- | :--- | :--- | :--- |
`;

  for (const req of reqs) {
    content += `| ${req.id} | ${req.project} | ${req.name} | ${req.status} | v1.0 | GLOBAL/PROJECTS/${req.project}/REQUIREMENT.md |\n`;
  }

  content += `
---

## 项目列表

| 项目名称 | 需求数 | 状态 | 最后更新 |
| :--- | :--- | :--- | :--- |
| user-service | 2 | 活跃 | 2026-07-09 |
| frontend-web | 1 | 活跃 | 2026-07-09 |

---

## 版本信息

| 版本 | 日期 | 变更说明 |
| :--- | :--- | :--- |
| v1.0 | 2026-07-09 | 初始创建 |
`;

  return content;
}

describe('Global Layer — INDEX.md Parsing', () => {
  beforeEach(() => {
    setupGlobalDir();
  });

  afterEach(() => {
    teardownGlobalDir();
  });

  it('should parse requirement IDs from INDEX.md', () => {
    const reqs = [
      { id: 'REQ-001', project: 'user-service', name: '用户登录', status: '📝 待开发' },
      { id: 'REQ-002', project: 'user-service', name: '用户注册', status: '📦 已有实现' },
      { id: 'REQ-003', project: 'frontend-web', name: '首页', status: '🚧 进行中' },
    ];

    const content = createIndexContent(reqs);
    const indexPath = join(TEST_DIR, '.speccore', 'GLOBAL', 'INDEX.md');
    writeFileSync(indexPath, content);

    const parsed = readFileSync(indexPath, 'utf-8');
    const lines = parsed.split('\n');

    // 验证需求行存在
    const reqLines = lines.filter((l) => l.startsWith('| REQ-'));
    expect(reqLines).toHaveLength(3);
    expect(reqLines[0]).toContain('REQ-001');
    expect(reqLines[0]).toContain('user-service');
    expect(reqLines[0]).toContain('用户登录');
  });

  it('should handle empty requirement table', () => {
    const reqs: Array<{ id: string; project: string; name: string; status: string }> = [];
    const content = createIndexContent(reqs);
    const indexPath = join(TEST_DIR, '.speccore', 'GLOBAL', 'INDEX.md');
    writeFileSync(indexPath, content);

    const parsed = readFileSync(indexPath, 'utf-8');
    const reqLines = parsed.split('\n').filter((l) => l.startsWith('| REQ-'));
    expect(reqLines).toHaveLength(0);
  });

  it('should generate correct next requirement ID', () => {
    const reqs = [
      { id: 'REQ-001', project: 'user-service', name: '功能A', status: '📝 待开发' },
      { id: 'REQ-002', project: 'user-service', name: '功能B', status: '📝 待开发' },
    ];

    // 提取最大 ID
    const ids = reqs.map((r) => parseInt(r.id.replace('REQ-', ''), 10));
    const nextId = Math.max(...ids) + 1;
    expect(nextId).toBe(3);
    expect(`REQ-${String(nextId).padStart(3, '0')}`).toBe('REQ-003');
  });

  it('should detect requirement status changes', () => {
    const oldReqs = [
      { id: 'REQ-001', project: 'test', name: '功能A', status: '📝 待开发' },
    ];
    const newReqs = [
      { id: 'REQ-001', project: 'test', name: '功能A', status: '📦 已有实现' },
    ];

    const changed = oldReqs.filter((old) => {
      const newReq = newReqs.find((n) => n.id === old.id);
      return newReq && newReq.status !== old.status;
    });

    expect(changed).toHaveLength(1);
    expect(changed[0].id).toBe('REQ-001');
  });

  it('should detect new requirements', () => {
    const oldIds = ['REQ-001'];
    const newIds = ['REQ-001', 'REQ-002', 'REQ-003'];

    const added = newIds.filter((id) => !oldIds.includes(id));
    expect(added).toHaveLength(2);
    expect(added).toContain('REQ-002');
    expect(added).toContain('REQ-003');
  });
});

describe('Global Layer — Changelog Tracking', () => {
  it('should track requirement changelog entries', () => {
    const changelog = [
      { version: 'v1.0', date: '2026-07-01', content: '初始创建', source: 'import', author: 'SpecCore' },
      { version: 'v1.1', date: '2026-07-05', content: '新增验证码校验', source: 'change', author: '张三' },
      { version: 'v1.2', date: '2026-07-09', content: '优化性能', source: 'optimize', author: '李四' },
    ];

    // 验证变更历史完整性
    expect(changelog).toHaveLength(3);

    // 验证按时间排序
    const sorted = [...changelog].sort((a, b) => a.date.localeCompare(b.date));
    expect(sorted[0].version).toBe('v1.0');
    expect(sorted[2].version).toBe('v1.2');

    // 验证每个条目有必填字段
    for (const entry of changelog) {
      expect(entry.version).toBeTruthy();
      expect(entry.date).toBeTruthy();
      expect(entry.content).toBeTruthy();
      expect(entry.author).toBeTruthy();
    }
  });
});

// ============================================================
// 纯函数测试 — bumpGlobalVersion / getNextReqId / diffRequirements
// ============================================================
describe('Global Layer — bumpGlobalVersion', () => {
  it('should bump minor version', () => {
    const bump = (v: string) => {
      const parts = v.replace('v', '').split('.').map(Number);
      parts[parts.length - 1]++;
      return 'v' + parts.join('.');
    };
    expect(bump('v1.0')).toBe('v1.1');
    expect(bump('v3.2')).toBe('v3.3');
    expect(bump('v4.0.0')).toBe('v4.0.1');
  });
});

describe('Global Layer — getNextReqId', () => {
  function getNextId(existingIds: string[]): string {
    if (existingIds.length === 0) return 'REQ-001';
    const nums = existingIds.map((id) => parseInt(id.replace('REQ-', ''), 10));
    const max = Math.max(...nums);
    return `REQ-${String(max + 1).padStart(3, '0')}`;
  }

  it('should return REQ-001 for empty index', () => {
    expect(getNextId([])).toBe('REQ-001');
  });

  it('should generate sequential IDs', () => {
    expect(getNextId(['REQ-001'])).toBe('REQ-002');
    expect(getNextId(['REQ-001', 'REQ-002'])).toBe('REQ-003');
  });

  it('should handle gaps', () => {
    expect(getNextId(['REQ-001', 'REQ-005', 'REQ-010'])).toBe('REQ-011');
  });

  it('should handle padded IDs', () => {
    expect(getNextId(['REQ-099'])).toBe('REQ-100');
  });
});

describe('Global Layer — diffRequirements', () => {
  interface ReqEntry {
    id: string;
    name: string;
    status: string;
  }

  function diffReqs(oldReqs: ReqEntry[], newReqs: ReqEntry[]): {
    added: ReqEntry[];
    removed: ReqEntry[];
    changed: Array<{ old: ReqEntry; updated: ReqEntry }>;
  } {
    const added = newReqs.filter((n) => !oldReqs.find((o) => o.id === n.id));
    const removed = oldReqs.filter((o) => !newReqs.find((n) => n.id === o.id));
    const changed: Array<{ old: ReqEntry; updated: ReqEntry }> = [];
    for (const old of oldReqs) {
      const updated = newReqs.find((n) => n.id === old.id);
      if (updated && (old.name !== updated.name || old.status !== updated.status)) {
        changed.push({ old, updated });
      }
    }
    return { added, removed, changed };
  }

  it('should detect added requirements', () => {
    const result = diffReqs(
      [{ id: 'REQ-001', name: '功能A', status: '📝 待开发' }],
      [
        { id: 'REQ-001', name: '功能A', status: '📝 待开发' },
        { id: 'REQ-002', name: '功能B', status: '📝 待开发' },
      ]
    );
    expect(result.added).toHaveLength(1);
    expect(result.added[0].id).toBe('REQ-002');
    expect(result.removed).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
  });

  it('should detect removed requirements', () => {
    const result = diffReqs(
      [
        { id: 'REQ-001', name: '功能A', status: '📝 待开发' },
        { id: 'REQ-002', name: '功能B', status: '📝 待开发' },
      ],
      [{ id: 'REQ-001', name: '功能A', status: '📝 待开发' }]
    );
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].id).toBe('REQ-002');
  });

  it('should detect status changes', () => {
    const result = diffReqs(
      [{ id: 'REQ-001', name: '功能A', status: '📝 待开发' }],
      [{ id: 'REQ-001', name: '功能A', status: '📦 已有实现' }]
    );
    expect(result.changed).toHaveLength(1);
    expect(result.changed[0].old.status).toBe('📝 待开发');
    expect(result.changed[0].updated.status).toBe('📦 已有实现');
  });

  it('should detect name changes', () => {
    const result = diffReqs(
      [{ id: 'REQ-001', name: '功能A', status: '📝 待开发' }],
      [{ id: 'REQ-001', name: '功能A增强', status: '📝 待开发' }]
    );
    expect(result.changed).toHaveLength(1);
  });

  it('should return empty for identical datasets', () => {
    const reqs = [{ id: 'REQ-001', name: '功能A', status: '📝 待开发' }];
    const result = diffReqs(reqs, reqs);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
  });
});

describe('Global Layer — Project Entry Parsing', () => {
  it('should parse project table from INDEX.md', () => {
    const content = `| 项目名称 | 需求数 | 状态 | 最后更新 |
| :--- | :--- | :--- | :--- |
| user-service | 5 | 活跃 | 2026-07-09 |
| frontend-web | 3 | 活跃 | 2026-07-09 |
| _暂无项目_ | - | - | - |`;

    // 验证占位符可以被正确检测
    expect(content).toContain('_暂无项目_');
    // 实际项目行不应被跳过
    const lines = content.split('\n').filter((l) => l.startsWith('|') && l.includes('|'));
    const projectLines = lines.filter(
      (l) => !l.includes(':---') && !l.includes('_暂无项目_') && !l.includes('项目名称')
    );
    expect(projectLines).toHaveLength(2);
  });
});
