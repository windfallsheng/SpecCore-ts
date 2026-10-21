import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'fs';
import { readFileSync } from 'fs';
import { collectSkeletonResidues, appendSkeletonTodos, autoFillSkeletonFallback, SKELETON_DOC_NAMES, SKELETON_MARKERS } from '../../../src/core/skeleton-residue';

describe('skeleton-residue — 完成骨架体检', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync('/tmp/speccore-skeleton-test-');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('干净目录（无骨架占位）返回空数组', async () => {
    mkdirSync(join(tmpDir, 'backend', 'Task-001-backend'), { recursive: true });
    writeFileSync(join(tmpDir, 'backend', 'Task-001-backend', 'REQ.md'), '# 本端需求规格\n\n实文内容，无占位。');
    writeFileSync(join(tmpDir, 'backend', 'Task-001-backend', 'TECH.md'), '# 技术方案\n\n实文。');
    expect(await collectSkeletonResidues(tmpDir)).toEqual([]);
  });

  it('组级递归穿透到 {端}/{子任务}/ 层并识别三类标记', async () => {
    mkdirSync(join(tmpDir, 'admin', 'Task-001-admin'), { recursive: true });
    mkdirSync(join(tmpDir, 'backend', 'Task-001-backend'), { recursive: true });
    // 三类标记各一份
    writeFileSync(join(tmpDir, 'admin', 'Task-001-admin', 'REQ.md'), '<!-- SPEC-SKELETON -->\n骨架');
    writeFileSync(join(tmpDir, 'admin', 'Task-001-admin', 'STATE.md'), '# 状态\n<!-- AI-FILL -->');
    writeFileSync(join(tmpDir, 'backend', 'Task-001-backend', 'TECH.md'), '# 技术\n_待AI分析_ 占位');

    const residues = await collectSkeletonResidues(tmpDir);
    expect(residues).toHaveLength(3);
    const byRel = Object.fromEntries(residues.map(r => [r.rel, r.markers]));
    expect(byRel['admin/Task-001-admin/REQ.md']).toEqual(['SPEC-SKELETON']);
    expect(byRel['admin/Task-001-admin/STATE.md']).toEqual(['AI-FILL']);
    expect(byRel['backend/Task-001-backend/TECH.md']).toEqual(['_待AI分析_']);
  });

  it('子任务级目录直接体检（无端中间层）', async () => {
    mkdirSync(join(tmpDir, 'Task-001-h5'), { recursive: true });
    writeFileSync(join(tmpDir, 'Task-001-h5', 'REQ.md'), '<!-- SPEC-SKELETON -->\n骨架');

    const residues = await collectSkeletonResidues(tmpDir);
    expect(residues).toHaveLength(1);
    expect(residues[0].rel).toBe('Task-001-h5/REQ.md');
  });

  it('跳过 00-specs/_shared 等模块级共享文档', async () => {
    mkdirSync(join(tmpDir, '00-specs'), { recursive: true });
    mkdirSync(join(tmpDir, '_shared'), { recursive: true });
    writeFileSync(join(tmpDir, '00-specs', 'REQ.md'), '<!-- SPEC-SKELETON -->\n模块级，不归端级体检');
    writeFileSync(join(tmpDir, '_shared', 'TECH.md'), '_待AI分析_ 模块级');

    expect(await collectSkeletonResidues(tmpDir)).toEqual([]);
  });

  it('多标记同文件只报一次（markers 数组去重且并列）', async () => {
    mkdirSync(join(tmpDir, 'app', 'Task-001-app'), { recursive: true });
    writeFileSync(join(tmpDir, 'app', 'Task-001-app', 'REQ.md'), '<!-- SPEC-SKELETON -->\n<!-- AI-FILL -->\n_待AI分析_');

    const residues = await collectSkeletonResidues(tmpDir);
    expect(residues).toHaveLength(1);
    expect(residues[0].markers).toEqual(['SPEC-SKELETON', '_待AI分析_', 'AI-FILL']);
  });

  it('文档名单覆盖 REQ/TECH + 前端四文档共 6 份', () => {
    expect(SKELETON_DOC_NAMES).toEqual(['REQ.md', 'TECH.md', 'STATE.md', 'ROUTES.md', 'COMPONENT_TREE.md', 'STYLE_GUIDE.md']);
    expect(SKELETON_MARKERS).toEqual(['SPEC-SKELETON', '_待AI分析_', 'AI-FILL']);
  });

  it('appendSkeletonTodos 写双账本（TASK.md 节 + .issues.md 行）', async () => {
    const taskDir = join(tmpDir, 'Task-001-admin');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'TASK.md'), '# 子任务追踪\n\n- **状态**: 已完成\n- [x] 写代码\n');
    writeFileSync(join(taskDir, '.issues.md'), '# 问题追踪\n\n> 执行过程中发现的问题记录于此。\n');

    await appendSkeletonTodos(taskDir, [
      { rel: 'Task-001-admin/REQ.md', markers: ['SPEC-SKELETON'] },
      { rel: 'Task-001-admin/STATE.md', markers: ['AI-FILL'] },
    ]);

    const md = readFileSync(join(taskDir, 'TASK.md'), 'utf-8');
    expect(md).toContain('## ⚠️ 骨架待补清单');
    expect(md).toContain('- [ ] `Task-001-admin/REQ.md`（含 SPEC-SKELETON）');
    expect(md).toContain('- [ ] `Task-001-admin/STATE.md`（含 AI-FILL）');
    expect(md).toContain('- **状态**: 已完成'); // 原内容保留

    const issues = readFileSync(join(taskDir, '.issues.md'), 'utf-8');
    expect(issues).toContain('- [ ] [骨架待补] `Task-001-admin/REQ.md`（含 SPEC-SKELETON）');
    expect(issues).toContain('> 执行过程中发现的问题记录于此。'); // 原头部保留
  });

  it('appendSkeletonTodos 幂等：重复执行不叠旧账', async () => {
    const taskDir = join(tmpDir, 'Task-001-h5');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'TASK.md'), '# 原始内容\n');
    writeFileSync(join(taskDir, '.issues.md'), '# 问题追踪\n\n> 执行过程中发现的问题记录于此。\n');

    const residues = [{ rel: 'Task-001-h5/REQ.md', markers: ['SPEC-SKELETON'] }];
    await appendSkeletonTodos(taskDir, residues);
    await appendSkeletonTodos(taskDir, residues);

    const md = readFileSync(join(taskDir, 'TASK.md'), 'utf-8');
    expect(md.match(/## ⚠️ 骨架待补清单/g)).toHaveLength(1);
    expect(md.match(/Task-001-h5\/REQ\.md/g)).toHaveLength(1);

    const issues = readFileSync(join(taskDir, '.issues.md'), 'utf-8');
    expect(issues.match(/\[骨架待补\]/g)).toHaveLength(1);
  });
});

describe('autoFillSkeletonFallback — CLI 自动降级填充（v8.3.337+）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync('/tmp/speccore-autofill-test-');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('REQ/TECH 骨架从模块级 00-specs 派生端级快照覆盖', async () => {
    // 模块目录（含 00-specs 真实规格）+ 子任务目录（含骨架残留）
    const moduleDir = join(tmpDir, 'admin-web-01-yudingguanli');
    const subtaskDir = join(moduleDir, 'admin', 'Task-admin-web-01-yudingguanli');
    mkdirSync(join(moduleDir, '00-specs'), { recursive: true });
    mkdirSync(subtaskDir, { recursive: true });
    writeFileSync(join(moduleDir, '00-specs', 'REQ.md'), '# 用户管理需求\n\n## 功能描述\n实现用户注册、登录、资料管理，支持邮箱验证与密码重置。\n\n## 验收标准\n- 注册成功后跳转登录页并发送欢迎邮件\n- 登录失败三次后锁定账号 15 分钟\n');
    writeFileSync(join(moduleDir, '00-specs', 'TECH.md'), '# 用户管理技术方案\n\n## 接口定义\nPOST /api/users 注册接口，参数含 name/email/password，响应返回用户 ID。\n\n## 数据模型\nusers 表：id/name/email/password_hash/status/created_at。\n');
    writeFileSync(join(subtaskDir, 'REQ.md'), '<!-- SPEC-SKELETON -->\n# 本端需求\n<!-- AI-FILL -->');
    writeFileSync(join(subtaskDir, 'TECH.md'), '<!-- SPEC-SKELETON -->\n# 本端技术\n');

    const residues = [
      { rel: 'REQ.md', markers: ['SPEC-SKELETON', 'AI-FILL'] },
      { rel: 'TECH.md', markers: ['SPEC-SKELETON'] },
    ];
    const filled = await autoFillSkeletonFallback(subtaskDir, residues);

    expect(filled.size).toBe(2);
    const req = readFileSync(join(subtaskDir, 'REQ.md'), 'utf-8');
    expect(req).toContain('端级快照');
    expect(req).toContain('admin 端');
    expect(req).toContain('实现用户注册、登录、资料管理');
    expect(req).not.toContain('SPEC-SKELETON');
    const tech = readFileSync(join(subtaskDir, 'TECH.md'), 'utf-8');
    expect(tech).toContain('POST /api/users');
    expect(tech).not.toContain('SPEC-SKELETON');
  });

  it('模块级源自身含骨架标记或过短时不降级（返回空集）', async () => {
    const moduleDir = join(tmpDir, 'admin-web-02-dingdanguanli');
    const subtaskDir = join(moduleDir, 'backend', 'Task-admin-web-02-dingdanguanli');
    mkdirSync(join(moduleDir, '00-specs'), { recursive: true });
    mkdirSync(subtaskDir, { recursive: true });
    // 模块级源自身还是骨架
    writeFileSync(join(moduleDir, '00-specs', 'REQ.md'), '<!-- SPEC-SKELETON -->\n骨架残留源');
    writeFileSync(join(subtaskDir, 'REQ.md'), '<!-- SPEC-SKELETON -->\n# 本端需求');

    const residues = [{ rel: 'REQ.md', markers: ['SPEC-SKELETON'] }];
    const filled = await autoFillSkeletonFallback(subtaskDir, residues);

    expect(filled.size).toBe(0);
    // 不拿骨架覆盖骨架
    expect(readFileSync(join(subtaskDir, 'REQ.md'), 'utf-8')).toContain('SPEC-SKELETON');
  });

  it('前端四文档（STATE/ROUTES/COMPONENT_TREE/STYLE_GUIDE）不降级，保持挂待办', async () => {
    const moduleDir = join(tmpDir, 'admin-web-03-yonghuguanli');
    const subtaskDir = join(moduleDir, 'admin', 'Task-admin-web-03-yonghuguanli');
    mkdirSync(join(moduleDir, '00-specs'), { recursive: true });
    mkdirSync(subtaskDir, { recursive: true });
    writeFileSync(join(moduleDir, '00-specs', 'REQ.md'), '# 真实需求规格\n\n## 功能描述\n完整需求内容，包含业务规则、数据模型与验收标准，确保长度足够不会被判定为过短源。\n');
    writeFileSync(join(subtaskDir, 'STATE.md'), '<!-- AI-FILL -->\n# 状态管理');

    const residues = [{ rel: 'STATE.md', markers: ['AI-FILL'] }];
    const filled = await autoFillSkeletonFallback(subtaskDir, residues);

    expect(filled.size).toBe(0);
  });

  it('无模块级 00-specs 时返回空集（不误写）', async () => {
    const subtaskDir = join(tmpDir, 'Task-001-h5');
    mkdirSync(subtaskDir, { recursive: true });
    writeFileSync(join(subtaskDir, 'REQ.md'), '<!-- SPEC-SKELETON -->\n# 本端需求');

    const filled = await autoFillSkeletonFallback(subtaskDir, [{ rel: 'REQ.md', markers: ['SPEC-SKELETON'] }]);
    expect(filled.size).toBe(0);
  });
});
