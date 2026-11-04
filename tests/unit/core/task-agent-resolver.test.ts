import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveTaskAgents } from '@/core/agents/task-agent-resolver';
import { resolveAgentsForPhase } from '@/core/agents';

// ── v8.3.389+: 任务角色解析器回归测试 ──
// 覆盖「类型 × 内容 × 意图 → 主角色 + 辅助角色」综合匹配与注册表 task.type 条件维度

describe('resolveTaskAgents — 类型 × 内容 × 意图综合选角', () => {
  describe('任务类型 → 主角色', () => {
    it('feature → code-generator', () => {
      expect(resolveTaskAgents({ taskType: 'feature' }).primary).toBe('code-generator');
    });

    it('bugfix → bug-analyzer', () => {
      expect(resolveTaskAgents({ taskType: 'bugfix' }).primary).toBe('bug-analyzer');
    });

    it('refactor → refactor-architect', () => {
      expect(resolveTaskAgents({ taskType: 'refactor' }).primary).toBe('refactor-architect');
    });

    it('research → research-analyst', () => {
      expect(resolveTaskAgents({ taskType: 'research' }).primary).toBe('research-analyst');
    });

    it('未知类型（v8.3.307+ 开放类型如 doc/script/data）与空类型回退 code-generator', () => {
      expect(resolveTaskAgents({ taskType: 'doc' }).primary).toBe('code-generator');
      expect(resolveTaskAgents({}).primary).toBe('code-generator');
    });
  });

  describe('用户意图优先于任务类型', () => {
    it('intent bugfix 覆盖 feature 类型', () => {
      expect(resolveTaskAgents({ taskType: 'feature', intent: 'bugfix' }).primary).toBe('bug-analyzer');
    });

    it('intent code review → code-reviewer（覆盖类型）', () => {
      expect(resolveTaskAgents({ taskType: 'bugfix', intent: 'code review' }).primary).toBe('code-reviewer');
    });

    it('未知意图回退类型映射', () => {
      expect(resolveTaskAgents({ taskType: 'bugfix', intent: 'unknown-intent' }).primary).toBe('bug-analyzer');
    });
  });

  describe('平台特化后缀', () => {
    it('单端任务拼 {角色}-{端} 后缀（与 execute 既有 code-generator-{端} 口径一致）', () => {
      expect(resolveTaskAgents({ taskType: 'bugfix', platform: 'admin-web' }).primary).toBe('bug-analyzer-admin-web');
      expect(resolveTaskAgents({ taskType: 'feature', platform: 'admin-web' }).primary).toBe('code-generator-admin-web');
    });

    it("platform 'default' 与空值不加后缀", () => {
      expect(resolveTaskAgents({ taskType: 'bugfix', platform: 'default' }).primary).toBe('bug-analyzer');
      expect(resolveTaskAgents({ taskType: 'bugfix' }).primary).toBe('bug-analyzer');
    });
  });

  describe('内容关键词 → 辅助角色（一个或多个）', () => {
    it('安全词命中 security-reviewer', () => {
      const r = resolveTaskAgents({ taskType: 'bugfix', taskName: '修复登录鉴权漏洞' });
      expect(r.assistants).toContain('security-reviewer');
    });

    it('多维度命中多个辅助角色（按词典序保序）', () => {
      const r = resolveTaskAgents({
        taskType: 'bugfix',
        taskName: '支付接口超时优化',
        taskDesc: '数据库查询慢导致超时',
      });
      expect(r.assistants).toEqual([
        'security-reviewer',
        'performance-expert',
        'doc-sync-agent',
        'dependency-analyst',
      ]);
    });

    it('兼容/升级词命中 regression-tester', () => {
      const r = resolveTaskAgents({ taskType: 'feature', taskName: '老版本升级兼容' });
      expect(r.assistants).toContain('regression-tester');
    });

    it('无关键词命中时辅助角色为空', () => {
      const r = resolveTaskAgents({ taskType: 'feature', taskName: '普通功能开发' });
      expect(r.assistants).toEqual([]);
    });

    it('英文关键词大小写不敏感', () => {
      const r = resolveTaskAgents({ taskType: 'bugfix', taskName: 'Fix API timeout' });
      expect(r.assistants).toEqual(['performance-expert', 'doc-sync-agent']);
    });
  });
});

describe('注册表条件维度 task.type（v8.3.389+）', () => {
  let projectRoot: string;

  beforeAll(() => {
    // 空夹具目录：无 .speccore/AGENTS，loadRegistry/loadAllAgents 回退内置 defaults
    projectRoot = mkdtempSync(join(tmpdir(), 'taskagent-'));
  });

  afterAll(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('bugfix 任务质量门禁激活 bug-analyzer', async () => {
    const agents = await resolveAgentsForPhase('execute', 'quality-gate', { task: { type: 'bugfix' } }, projectRoot);
    expect(agents.map((a) => a.name)).toContain('bug-analyzer');
  });

  it('refactor 任务质量门禁激活 refactor-architect', async () => {
    const agents = await resolveAgentsForPhase('execute', 'quality-gate', { task: { type: 'refactor' } }, projectRoot);
    expect(agents.map((a) => a.name)).toContain('refactor-architect');
  });

  it('research 任务质量门禁激活 research-analyst', async () => {
    const agents = await resolveAgentsForPhase('execute', 'quality-gate', { task: { type: 'research' } }, projectRoot);
    expect(agents.map((a) => a.name)).toContain('research-analyst');
  });

  it('feature 任务不激活类型角色（条件不命中）', async () => {
    const agents = await resolveAgentsForPhase('execute', 'quality-gate', { task: { type: 'feature' } }, projectRoot);
    const names = agents.map((a) => a.name);
    expect(names).not.toContain('bug-analyzer');
    expect(names).not.toContain('refactor-architect');
    expect(names).not.toContain('research-analyst');
    // 通用门禁角色不受影响
    expect(names).toContain('compiler');
  });

  it('无 task 上下文时不激活类型角色（向后兼容）', async () => {
    const agents = await resolveAgentsForPhase('execute', 'quality-gate', {}, projectRoot);
    const names = agents.map((a) => a.name);
    expect(names).not.toContain('bug-analyzer');
    expect(names).not.toContain('refactor-architect');
    expect(names).not.toContain('research-analyst');
  });
});
