import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join('/tmp', 'speccore-integration-test');

function run(cmd: string): string {
  try {
    return execSync(`cd ${TEST_DIR} && ${cmd}`, { encoding: 'utf-8', stdio: 'pipe' });
  } catch (e: any) {
    return e.stdout + e.stderr;
  }
}

describe('Integration: Full Workflow', () => {
  beforeAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    execSync(`cd ${TEST_DIR} && git init && git config user.email "test@test.com" && git config user.name "test" && git commit --allow-empty -m init`, { stdio: 'pipe' });
    run('speccore init 2>/dev/null');
  });

  afterAll(() => {
    // rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('step1: creates .speccore/config/mode.json', () => {
    expect(existsSync(join(TEST_DIR, '.speccore', 'config', 'mode.json'))).toBe(true);
    expect(existsSync(join(TEST_DIR, '.speccore', 'CONSTITUTION.md'))).toBe(true);
  });

  it('step2: creates iteration with unique ID', () => {
    run('speccore iteration create --name=IT 2>/dev/null');
    const dirs = execSync(`ls -d ${TEST_DIR}/期次-*`, { encoding: 'utf-8' }).trim();
    expect(dirs).toMatch(/期次-\d+-IT/);
  });

  it('step3: doc2spec imports requirement and split works', () => {
    const iterDir = execSync(`ls -d ${TEST_DIR}/期次-* | head -1`, { encoding: 'utf-8' }).trim();
    const reqDir = join(iterDir, '00-需求文档');
    mkdirSync(reqDir, { recursive: true });
    
    writeFileSync(join(reqDir, 'REQUIREMENT.md'), '# Q1 需求\n## backend需求\n### 用户模块\n| 方法 | 路径 | 说明 |\n| :--- | :--- | :--- |\n| GET | /api/users | 列表 |');
    writeFileSync(join(reqDir, 'INDEX.md'), '| 端 | 文件 |\n| :--- | :--- |\n| backend | backend要求.md |');
    
    const iterName = iterDir.replace(TEST_DIR + '/', '').replace('期次-', '');
    const out = run(`speccore iteration split --iteration=${iterName} 2>/dev/null`);
    expect(out).toContain('Created');
  });

  it('step4: generates task dirs with backend/{service} structure', () => {
    const taskDir = execSync(`ls -d ${TEST_DIR}/期次-*/Task-* | head -1`, { encoding: 'utf-8' }).trim();
    // New structure: backend/{service}/ instead of backend/
    expect(existsSync(join(taskDir, 'backend'))).toBe(true);
    const backendFiles = run(`ls "${taskDir}/backend/" 2>/dev/null`);
    expect(backendFiles).toBeTruthy();
  });

  it('step5: constitution has tech stack', () => {
    const yml = run('cat .speccore/CONSTITUTION.md');
    expect(yml).toContain('技术');
  });

  it('step6: execute --help shows all parameters', () => {
    const help = run('speccore execute --help');
    expect(help).toContain('--skip');
    expect(help).toContain('--only');
    expect(help).toContain('--batch-size');
  });
});
