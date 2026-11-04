import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join('/tmp', 'speccore-integration-test');
// 使用本地构建产物（反映源码最新行为，含未发布修复），CI 无 dist 时整体跳过
const CLI = join(process.cwd(), 'dist', 'cli.js');

function run(cmd: string): string {
  try {
    return execSync(`cd ${TEST_DIR} && node ${CLI} ${cmd}`, { encoding: 'utf-8', stdio: 'pipe', timeout: 120000 });
  } catch (e: any) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

describe('Integration: Full Workflow', () => {
  beforeAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    execSync(`cd ${TEST_DIR} && git init && git config user.email "test@test.com" && git config user.name "test" && git commit --allow-empty -m init`, { stdio: 'pipe' });
    run('init 2>/dev/null');
  });

  afterAll(() => {
    // rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it.skipIf(!existsSync(CLI))('step1: creates .speccore/config/ask.json', () => {
    expect(existsSync(join(TEST_DIR, '.speccore', 'config', 'ask.json'))).toBe(true);
    expect(existsSync(join(TEST_DIR, '.speccore', 'CONSTITUTION.md'))).toBe(true);
  });

  it.skipIf(!existsSync(CLI))('step2: creates iteration with unique ID', () => {
    run('iteration create --name=IT 2>/dev/null');
    const dirs = execSync(`ls -d ${TEST_DIR}/Iteration-*`, { encoding: 'utf-8' }).trim();
    expect(dirs).toMatch(/Iteration-\d+-it/);
  });

  it.skipIf(!existsSync(CLI))('step3: requirements + analyze artifacts + taskify works', () => {
    const iterDir = execSync(`ls -d ${TEST_DIR}/Iteration-* | head -1`, { encoding: 'utf-8' }).trim();
    const reqDir = join(iterDir, '010-requirements');
    mkdirSync(join(reqDir, 'features', '用户模块'), { recursive: true });
    mkdirSync(join(iterDir, '020-specs', 'overview'), { recursive: true });

    // 需求文档（doc2spec 导入后的形态：原始需求 + features/ 功能单元）
    writeFileSync(join(reqDir, 'REQUIREMENT.md'), '# Q1 需求\n## backend需求\n### 用户模块\n| 方法 | 路径 | 说明 |\n| :--- | :--- | :--- |\n| GET | /api/users | 列表 |');
    writeFileSync(join(reqDir, 'features', '用户模块', 'SOURCE.md'), `# 用户模块

用户列表查询与创建。

## 涉及端
backend

## 接口
| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | /api/users | 列表 |
| POST | /api/users | 创建 |
`);
    // 模拟 analyze 落盘产物（taskify 前置门禁要求非骨架 ANALYSIS.md）
    writeFileSync(join(iterDir, '020-specs', 'overview', 'ANALYSIS.md'), `# 需求分析

> 迭代: 001-it | 状态: 分析完成

## 功能点清单

### F-01 用户模块
- 优先级: P0
- 涉及端: backend
- 接口变更: GET /api/users 用户列表查询、POST /api/users 创建用户
`);

    const iterName = iterDir.replace(TEST_DIR + '/', '').replace('Iteration-', '');
    const out = run(`iteration taskify --iteration=${iterName} 2>/dev/null`);
    expect(out).toContain('模块驱动拆分完成');
  });

  it.skipIf(!existsSync(CLI))('step4: task dirs follow standard platform names (no ghost backend)', () => {
    const taskDir = execSync(`ls -d ${TEST_DIR}/Iteration-*/030-tasks/*/Task-* | head -1`, { encoding: 'utf-8' }).trim();
    // v8.3.386: 端列表无后端端名时不硬编码 backend 幽灵端（端名契约：
    // 端名必须使用 CONSTITUTION.md 标准端名，禁止 api/web/backend 等简写）
    expect(existsSync(join(taskDir, 'backend'))).toBe(false);
    // 任务骨架正常落盘（.meta 元信息存在）
    expect(existsSync(join(taskDir, '.meta'))).toBe(true);
  });

  it.skipIf(!existsSync(CLI))('step5: constitution has tech stack', () => {
    const yml = readFileSync(join(TEST_DIR, '.speccore', 'CONSTITUTION.md'), 'utf-8');
    expect(yml).toContain('技术');
  });

  it.skipIf(!existsSync(CLI))('step6: execute --help shows all parameters', () => {
    const help = run('execute --help');
    expect(help).toContain('--skip');
    expect(help).toContain('--only');
    expect(help).toContain('--batch-size');
  });
});
