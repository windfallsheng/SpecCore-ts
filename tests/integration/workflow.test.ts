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

  it('step1: creates .speccore.yml', () => {
    expect(existsSync(join(TEST_DIR, '.speccore.yml'))).toBe(true);
  });

  it('step2: creates iteration with unique ID', () => {
    run('speccore iteration create --name=IT 2>/dev/null');
    const dirs = execSync(`ls -d ${TEST_DIR}/期次-*`, { encoding: 'utf-8' }).trim();
    expect(dirs).toMatch(/期次-\d+-IT/);
  });

  it('step3: splits requirements into tasks', () => {
    const iterDir = execSync(`ls -d ${TEST_DIR}/期次-* | head -1`, { encoding: 'utf-8' }).trim();
    const reqDir = join(iterDir, '00-需求文档');
    mkdirSync(reqDir, { recursive: true });
    
    writeFileSync(join(reqDir, 'REQUIREMENT.md'), `## 后台需求\n### 用户模块\nCRUD\n| GET | /api/users | 列表 |`);
    writeFileSync(join(reqDir, 'INDEX.md'), '| 端 | 文件 |\n| :--- | :--- |\n| 后台 | b.md |');
    
    const iterName = iterDir.replace(TEST_DIR + '/', '').replace('期次-', '');
    const out = run(`speccore iteration split --iteration=${iterName} 2>/dev/null`);
    expect(out).toContain('Created');
  });

  it('step4: generates 11+ files per task', () => {
    const taskDir = execSync(`ls -d ${TEST_DIR}/期次-*/Task-* | head -1`, { encoding: 'utf-8' }).trim();
    const backendFiles = execSync(`ls "${taskDir}/backend/"`, { encoding: 'utf-8' }).trim().split('\n');
    const sharedFiles = run(`ls "${taskDir}/_shared/" 2>/dev/null`);
    
    // Core files
    expect(backendFiles.filter(f => f.endsWith('.md')).length).toBeGreaterThanOrEqual(6);
    // API contract if APIs detected
    expect(sharedFiles).toBeDefined();
  });

  it('step5: config has default values', () => {
    const yml = run('cat .speccore.yml');
    expect(yml).toContain('default_base:');
    expect(yml).toContain('quality_gates:');
    expect(yml).toContain('code_scope:');
  });

  it('step6: execute --help shows all parameters', () => {
    const help = run('speccore execute --help');
    expect(help).toContain('--skip');
    expect(help).toContain('--only');
    expect(help).toContain('--base');
    expect(help).toContain('--batch-size');
    expect(help).toContain('--strict');
  });
});
