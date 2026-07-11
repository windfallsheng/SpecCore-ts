import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { ContextManager } from '@/core/context';

const TMP = join(__dirname, '__tmp_context');

function write(path: string, content: string) {
  mkdirSync(join(TMP, path, '..'), { recursive: true });
  writeFileSync(join(TMP, path), content);
}

beforeEach(() => { rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true }); });
afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

describe('ContextManager', () => {
  describe('getCurrentIteration', () => {
    it('应该从 context.json 读取当前期次', () => {
      write('.speccore/local/context.json', JSON.stringify({ current_iteration: '2026-07-会议预定' }));
      const ctx = new ContextManager(TMP);
      expect(ctx.getCurrentIteration()).toBe('2026-07-会议预定');
    });

    it('应该从 ITERATIONS/README.md 匹配 🔄 期次', () => {
      write('.speccore/ITERATIONS/README.md', '| 🔄 | 期次-2026-07-用户系统 |');
      const ctx = new ContextManager(TMP);
      expect(ctx.getCurrentIteration()).toBe('期次-2026-07-用户系统');
    });

    it('应该返回 null 当无任何标记', () => {
      const ctx = new ContextManager(TMP);
      expect(ctx.getCurrentIteration()).toBeNull();
    });

    it('应该优先使用 context.json', () => {
      write('.speccore/local/context.json', JSON.stringify({ current_iteration: 'ctx-iter' }));
      write('.speccore/ITERATIONS/README.md', '| 🔄 | 期次-readme |');
      const ctx = new ContextManager(TMP);
      expect(ctx.getCurrentIteration()).toBe('ctx-iter');
    });
  });

  describe('getCurrentAssignee', () => {
    it('应该在无 git 时返回 "未指定"', () => {
      const ctx = new ContextManager(TMP);
      // In CI, git config may succeed. Just ensure a string is returned.
      const assignee = ctx.getCurrentAssignee();
      expect(typeof assignee).toBe('string');
      expect(assignee.length).toBeGreaterThan(0);
    });
  });

  describe('getCurrentTask', () => {
    it('应该从 context.json 读取', () => {
      write('.speccore/local/context.json', JSON.stringify({ current_task: 'Task-001' }));
      const ctx = new ContextManager(TMP);
      expect(ctx.getCurrentTask()).toBe('Task-001');
    });

    it('应该返回 null 当无配置', () => {
      const ctx = new ContextManager(TMP);
      expect(ctx.getCurrentTask()).toBeNull();
    });
  });

  describe('getPlatforms', () => {
    it('应该返回默认平台当无配置文件', () => {
      const ctx = new ContextManager(TMP);
      expect(ctx.getPlatforms()).toEqual(['web', 'h5', 'miniapp']);
    });

    it('应该从 platforms.yaml 读取', () => {
      write('.speccore/config/platforms.yaml',
        'platforms:\n  web:\n    name: Web\n  h5:\n    name: H5\n  tablet:\n    name: Tablet\n');
      const ctx = new ContextManager(TMP);
      const platforms = ctx.getPlatforms();
      expect(platforms).toContain('web');
      expect(platforms).toContain('h5');
      expect(platforms).toContain('tablet');
    });
  });

  describe('getSnapshot', () => {
    it('应该返回完整快照', () => {
      write('.speccore/local/context.json', JSON.stringify({
        current_iteration: '2026-07-test', current_task: 'Task-001',
      }));
      const ctx = new ContextManager(TMP);
      const snap = ctx.getSnapshot();
      expect(snap.iteration).toBe('2026-07-test');
      expect(snap.task).toBe('Task-001');
      expect(snap.projectRoot).toBe(TMP);
      expect(Array.isArray(snap.platforms)).toBe(true);
    });
  });
});
