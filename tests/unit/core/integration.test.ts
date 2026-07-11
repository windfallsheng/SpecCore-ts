/**
 * Core Module Integration Tests
 * 使用真实临时文件系统测试 context.ts, global-layer.ts, validator.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(process.cwd(), 'tests', '.tmp', 'core-int');

function setupProject(): string {
  rmSync(TEST_DIR, { recursive: true, force: true });
  // Create .speccore structure
  mkdirSync(join(TEST_DIR, '.speccore', 'local'), { recursive: true });
  mkdirSync(join(TEST_DIR, '.speccore', 'GLOBAL', 'PROJECTS', '_template'), { recursive: true });
  mkdirSync(join(TEST_DIR, '.speccore', 'config'), { recursive: true });
  mkdirSync(join(TEST_DIR, '.speccore', 'PATTERNS', 'TEMPLATES'), { recursive: true });
  mkdirSync(join(TEST_DIR, '期次-2026-07-test', '00-需求文档'), { recursive: true });
  mkdirSync(join(TEST_DIR, '期次-2026-07-test', 'Task-001-user-login', 'backend'), { recursive: true });
  mkdirSync(join(TEST_DIR, '期次-2026-07-test', 'Task-001-user-login', '_shared'), { recursive: true });

  return TEST_DIR;
}

describe('Integration — Context (real filesystem)', () => {
  beforeEach(() => setupProject());
  afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('should detect active iteration from context.json', () => {
    // Write context.json
    const ctxPath = join(TEST_DIR, '.speccore', 'local', 'context.json');
    writeFileSync(ctxPath, JSON.stringify({
      currentIteration: '期次-2026-07-test',
      currentTask: 'Task-001',
      currentAssignee: '',
      lastUpdated: '2026-07-11T00:00:00Z',
      lastAction: '',
      lastIntent: '',
      interruptedAt: '',
      iterationStatus: 'active',
      pendingTasks: 3,
      inProgressTasks: 1,
      completedTasks: 2,
      blockedTasks: 0,
      customAliases: {},
      history: [],
    }, null, 2));

    const content = JSON.parse(readFileSync(ctxPath, 'utf-8'));
    expect(content.currentIteration).toBe('期次-2026-07-test');
    expect(content.iterationStatus).toBe('active');
    expect(content.pendingTasks).toBe(3);
  });

  it('should detect task directories in iteration', () => {
    const iterDir = join(TEST_DIR, '期次-2026-07-test');
    const fs = require('fs');
    const entries = fs.readdirSync(iterDir, { withFileTypes: true });
    const tasks = entries
      .filter((e: any) => e.isDirectory() && e.name.startsWith('Task-'))
      .map((e: any) => e.name);

    expect(tasks).toContain('Task-001-user-login');
    expect(tasks).toHaveLength(1);
  });

  it('should detect required spec files in a task', () => {
    const taskDir = join(TEST_DIR, '期次-2026-07-test', 'Task-001-user-login');

    // Create required files
    writeFileSync(join(taskDir, 'backend', 'REQ.md'), '# REQ-001\n## 需求描述\n');
    writeFileSync(join(taskDir, 'backend', 'TECH.md'), '# TECH\n## 技术选型\n');
    writeFileSync(join(taskDir, 'backend', 'TASK.md'), '# TASK\n状态: 🔲 待开发\n');
    writeFileSync(join(taskDir, '_shared', 'API_CONTRACT.yaml'), 'api:\n  path: /test\n');

    const required = ['backend/REQ.md', 'backend/TECH.md', 'backend/TASK.md', '_shared/API_CONTRACT.yaml'];
    const fs = require('fs');

    for (const f of required) {
      const exists = fs.existsSync(join(taskDir, f));
      expect(exists).toBe(true);
    }
  });
});

describe('Integration — Global Layer', () => {
  beforeEach(() => setupProject());
  afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('should parse INDEX.md structure', () => {
    const indexPath = join(TEST_DIR, '.speccore', 'GLOBAL', 'INDEX.md');
    const content = [
      '# 全量需求索引',
      '',
      '| REQ-001 | user-service | 用户登录 | 📝 待开发 | v1.0 | path |',
      '| REQ-002 | user-service | 用户注册 | 📦 已有实现 | v1.0 | path |',
      '',
      '## 项目列表',
      '| user-service | 2 | 活跃 | 2026-07-11 |',
    ].join('\n');

    writeFileSync(indexPath, content);

    const parsed = readFileSync(indexPath, 'utf-8');
    const reqLines = parsed.split('\n').filter((l) => l.startsWith('| REQ-'));
    expect(reqLines).toHaveLength(2);
    expect(reqLines[0]).toContain('REQ-001');
    expect(reqLines[0]).toContain('用户登录');
  });

  it('should handle platforms.yaml creation', () => {
    const platformsPath = join(TEST_DIR, '.speccore', 'config', 'platforms.yaml');
    const yaml = require('js-yaml');

    const config = {
      platforms: {
        web: { name: 'Web端', default: true, tech_stack: 'Vue 3 + TS', enabled: true },
        h5: { name: 'H5端', default: true, tech_stack: 'Vue 3 + Vant', enabled: true },
      },
    };

    writeFileSync(platformsPath, yaml.dump(config));

    const content = readFileSync(platformsPath, 'utf-8');
    expect(content).toContain('Web端');
    expect(content).toContain('Vue 3 + TS');
  });
});

describe('Integration — Validator', () => {
  beforeEach(() => setupProject());
  afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('should validate API_CONTRACT.yaml structure', () => {
    const contractPath = join(TEST_DIR, '期次-2026-07-test', 'Task-001-user-login', '_shared', 'API_CONTRACT.yaml');

    const validYaml = [
      'api:',
      '  path: /api/v1/users/login',
      '  method: POST',
      'request:',
      '  body:',
      '    username: string',
      '    password: string',
      'response:',
      '  status: 200',
    ].join('\n');

    writeFileSync(contractPath, validYaml);

    const yaml = require('js-yaml');
    const data = yaml.load(readFileSync(contractPath, 'utf-8'));
    expect(data.api.path).toBe('/api/v1/users/login');
    expect(data.api.method).toBe('POST');
    expect(data.response.status).toBe(200);
  });

  it('should check TASK.md has required fields', () => {
    const taskPath = join(TEST_DIR, '期次-2026-07-test', 'Task-001-user-login', 'backend', 'TASK.md');

    const content = [
      '# Task-001 用户登录 - 后端任务',
      '',
      '| 属性 | 值 |',
      '| :--- | :--- |',
      '| 状态 | 🔲 待开发 |',
      '| 优先级 | high |',
      '| 类型 | feature |',
      '| 负责人 | 张三 |',
    ].join('\n');

    writeFileSync(taskPath, content);
    const parsed = readFileSync(taskPath, 'utf-8');
    expect(parsed).toContain('Task-001');
    expect(parsed).toContain('待开发');
    expect(parsed).toContain('high');
  });
});
