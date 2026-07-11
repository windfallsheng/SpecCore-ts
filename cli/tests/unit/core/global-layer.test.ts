import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { GlobalLayer, RequirementEntry } from '@/core/global-layer';

const TMP = join(__dirname, '__tmp_global');

function write(path: string, content: string) {
  mkdirSync(join(TMP, path, '..'), { recursive: true });
  writeFileSync(join(TMP, path), content);
}

beforeEach(() => { rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true }); });
afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

describe('GlobalLayer', () => {
  describe('exists', () => {
    it('应该在文件不存在时返回 false', () => {
      const gl = new GlobalLayer(TMP);
      expect(gl.exists()).toBe(false);
    });

    it('应该在文件存在时返回 true', () => {
      write('.speccore/GLOBAL/INDEX.md', '# Index');
      const gl = new GlobalLayer(TMP);
      expect(gl.exists()).toBe(true);
    });
  });

  describe('parseRequirements', () => {
    it('应该解析有效的 INDEX.md', () => {
      write('.speccore/GLOBAL/INDEX.md', `
# 全局需求索引

## 需求索引

| ID | 版本 | 状态 | 项目 | 最后修改 | 关联期次 |
| :--- | :--- | :--- | :--- | :--- | :--- |
### REQ-001: 用户登录
| v1.2 | 已实现 | user-service | 2026-07-05 | 2026-07-会议预定 |
### REQ-002: 会议室管理
| v1.0 | 待开发 | meeting-service | 2026-07-01 | - |
`);
      const gl = new GlobalLayer(TMP);
      const entries = gl.parseRequirements();
      expect(entries.length).toBe(2);
      expect(entries[0].id).toBe('REQ-001');
      expect(entries[0].title).toBe('用户登录');
      expect(entries[0].version).toBe('v1.2');
      expect(entries[1].id).toBe('REQ-002');
    });

    it('应该在 INDEX.md 不存在时返回空数组', () => {
      const gl = new GlobalLayer(TMP);
      expect(gl.parseRequirements()).toEqual([]);
    });
  });

  describe('rebuildIndex', () => {
    it('应该创建有效的 INDEX.md', () => {
      const gl = new GlobalLayer(TMP);
      const entries: RequirementEntry[] = [{
        id: 'REQ-001', title: '登录',
        version: 'v1.0', status: '待开发',
        project: 'user-service', lastModified: '2026-07-01',
        relatedIteration: '-',
      }];
      gl.rebuildIndex(entries, ['user-service']);
      const raw = gl.readRaw();
      expect(raw).toContain('REQ-001');
      expect(raw).toContain('user-service');
      expect(raw).toContain('v1.0');
    });
  });

  describe('countByProject', () => {
    it('应该按项目统计需求数', () => {
      write('.speccore/GLOBAL/INDEX.md', `
| ID | 版本 | 状态 | 项目 | 最后修改 | 关联期次 |
| :--- | :--- | :--- | :--- | :--- | :--- |
### REQ-001: A
| v1.0 | done | proj-a | 2026-07-01 | - |
### REQ-002: B
| v1.0 | todo | proj-a | 2026-07-01 | - |
### REQ-003: C
| v1.0 | todo | proj-b | 2026-07-01 | - |
`);
      const gl = new GlobalLayer(TMP);
      const counts = gl.countByProject();
      expect(counts['proj-a']).toBe(2);
      expect(counts['proj-b']).toBe(1);
    });
  });
});
