/**
 * resolveConfigPath 双基准路径解析测试（v8.3.296+）
 *
 * 覆盖部署配置中 script / pm2_config / manifest / values 的路径解析：
 *   端目录（code_path）优先 → 项目根回退 → 都不存在时保持 cwd 基准语义
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveConfigPath } from '../../../src/core/deploy/engine';

// 隔离 findProjectRoot：测试进程 cwd 在 SpecCore 仓库本身，
// 真实实现会找到仓库 .speccore 干扰断言，故 mock 为指向临时项目根。
const mocks = vi.hoisted(() => ({ projectRoot: null as string | null }));

vi.mock('../../../src/utils/task-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/task-utils')>();
  return { ...actual, findProjectRoot: () => mocks.projectRoot };
});

describe('resolveConfigPath 双基准解析', () => {
  let projectRoot: string;
  let codeDir: string;

  beforeEach(() => {
    // 构造临时 SpecCore 项目：projectRoot/.speccore + projectRoot/admin-web
    projectRoot = join(tmpdir(), `speccore-path-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    codeDir = join(projectRoot, 'admin-web');
    mkdirSync(join(projectRoot, '.speccore', 'environments', 'scripts'), { recursive: true });
    mkdirSync(join(codeDir, 'scripts'), { recursive: true });
    mocks.projectRoot = projectRoot;
  });

  afterEach(() => {
    mocks.projectRoot = null;
    if (projectRoot && existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
  });

  it('绝对路径原样返回', async () => {
    const abs = join(codeDir, 'scripts', 'deploy.sh');
    writeFileSync(abs, '#!/bin/bash\n');
    const result = await resolveConfigPath(abs, codeDir);
    expect(result).toBe(abs);
  });

  it('端内相对路径 → 解析到端目录', async () => {
    const rel = './scripts/deploy.sh';
    writeFileSync(join(codeDir, 'scripts', 'deploy.sh'), '#!/bin/bash\n');
    const result = await resolveConfigPath(rel, codeDir);
    expect(result).toBe(join(codeDir, 'scripts', 'deploy.sh'));
  });

  it('项目根相对路径 → 回退解析到项目根（端配了 code_path 也不断链）', async () => {
    const rel = '.speccore/environments/scripts/deploy.sh';
    writeFileSync(join(projectRoot, '.speccore', 'environments', 'scripts', 'deploy.sh'), '#!/bin/bash\n');
    // cwd 在端目录 admin-web 下，端内不存在该路径
    const result = await resolveConfigPath(rel, codeDir);
    expect(result).toBe(join(projectRoot, '.speccore', 'environments', 'scripts', 'deploy.sh'));
  });

  it('端内与项目根同名文件 → 端内优先', async () => {
    const rel = '.speccore/environments/scripts/deploy.sh';
    // 端目录下也放一个同名文件（模拟端内私有覆盖）
    mkdirSync(join(codeDir, '.speccore', 'environments', 'scripts'), { recursive: true });
    writeFileSync(join(codeDir, '.speccore', 'environments', 'scripts', 'deploy.sh'), '#!/bin/bash\necho code\n');
    writeFileSync(join(projectRoot, '.speccore', 'environments', 'scripts', 'deploy.sh'), '#!/bin/bash\necho root\n');
    const result = await resolveConfigPath(rel, codeDir);
    expect(result).toBe(join(codeDir, '.speccore', 'environments', 'scripts', 'deploy.sh'));
  });

  it('都不存在 → 返回 cwd 基准路径（调用方兜底为命令/默认名语义）', async () => {
    const rel = 'k8s-deployment.yaml';
    const result = await resolveConfigPath(rel, codeDir);
    expect(result).toBe(join(codeDir, rel));
  });

  it('无 .speccore 标记时（非 SpecCore 项目）不崩溃，仅 cwd 基准', async () => {
    mocks.projectRoot = null;
    const plainDir = join(tmpdir(), `speccore-plain-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(plainDir, { recursive: true });
    try {
      const result = await resolveConfigPath('deploy.sh', plainDir);
      expect(result).toBe(join(plainDir, 'deploy.sh'));
    } finally {
      rmSync(plainDir, { recursive: true, force: true });
    }
  });
});
