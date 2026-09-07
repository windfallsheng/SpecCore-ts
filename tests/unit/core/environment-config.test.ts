/**
 * environment-config 单元测试
 *
 * 覆盖 .speccore/environments/*.yaml 的解析和加载逻辑。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import {
  loadEnvironmentConfig,
  loadEnvironmentByNameOrPath,
} from '../../../src/core/environment-config';

const TEST_DIR = join(process.cwd(), 'tests', '.tmp', 'env-config');

function setupEnvDir(): string {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(join(TEST_DIR, '.speccore', 'environments'), { recursive: true });
  return TEST_DIR;
}

function writeEnvFile(name: string, content: string) {
  writeFileSync(join(TEST_DIR, '.speccore', 'environments', `${name}.yaml`), content, 'utf-8');
}

describe('environment-config', () => {
  beforeEach(() => {
    setupEnvDir();
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('loadEnvironmentConfig', () => {
    it('should parse basic environment config with branch', async () => {
      writeEnvFile('staging', `env: staging
branch: staging
defaults:
  build_cmd: npm run build:staging
platforms:
  h5:
    build_cmd: npm run build:h5:staging
    deploy:
      type: static
      output_dir: dist
      target: s3://bucket/staging/h5/
tests:
  base_urls:
    h5: https://staging.example.com/h5
  visual_model:
    provider: qwen-vl
    timeout: 60000`);

      const config = await loadEnvironmentConfig(join(TEST_DIR, '.speccore', 'environments', 'staging.yaml'));

      expect(config).not.toBeNull();
      expect(config!.env).toBe('staging');
      expect(config!.branch).toBe('staging');
      expect(config!.defaults?.build_cmd).toBe('npm run build:staging');
      expect(config!.platforms['h5']?.build_cmd).toBe('npm run build:h5:staging');
      expect(config!.platforms['h5']?.deploy?.type).toBe('static');
      expect(config!.tests?.base_urls?.h5).toBe('https://staging.example.com/h5');
      expect(config!.tests?.visual_model?.provider).toBe('qwen-vl');
      expect(config!.tests?.visual_model?.timeout).toBe(60000);
    });

    it('should parse local environment without branch', async () => {
      writeEnvFile('local', `env: local
defaults:
  build_cmd: npm run build:dev
platforms:
  h5:
    build_cmd: npm run build:dev`);

      const config = await loadEnvironmentConfig(join(TEST_DIR, '.speccore', 'environments', 'local.yaml'));

      expect(config).not.toBeNull();
      expect(config!.env).toBe('local');
      expect(config!.branch).toBeUndefined();
    });

    it('should return null for non-existent file', async () => {
      const config = await loadEnvironmentConfig(join(TEST_DIR, '.speccore', 'environments', 'nonexistent.yaml'));
      expect(config).toBeNull();
    });

    it('should parse five-tier environment model', async () => {
      const environments = [
        { name: 'local', branch: undefined },
        { name: 'dev', branch: 'develop' },
        { name: 'test', branch: 'release/test' },
        { name: 'staging', branch: 'staging' },
        { name: 'production', branch: 'main' },
      ];

      for (const env of environments) {
        const branchLine = env.branch ? `branch: ${env.branch}` : '';
        writeEnvFile(env.name, `env: ${env.name}
${branchLine}
defaults:
  build_cmd: npm run build:${env.name === 'local' ? 'dev' : env.name}`);
      }

      for (const env of environments) {
        const config = await loadEnvironmentConfig(join(TEST_DIR, '.speccore', 'environments', `${env.name}.yaml`));
        expect(config).not.toBeNull();
        expect(config!.env).toBe(env.name);
        if (env.branch) {
          expect(config!.branch).toBe(env.branch);
        } else {
          expect(config!.branch).toBeUndefined();
        }
      }
    });
  });

  describe('loadEnvironmentByNameOrPath', () => {
    it('should load by file path', async () => {
      writeEnvFile('custom', `env: custom
branch: feature/custom`);

      const config = await loadEnvironmentByNameOrPath(join(TEST_DIR, '.speccore', 'environments', 'custom.yaml'));

      expect(config).not.toBeNull();
      expect(config!.env).toBe('custom');
    });

    it('should return null for non-existent file path', async () => {
      const config = await loadEnvironmentByNameOrPath(join(TEST_DIR, '.speccore', 'environments', 'nonexistent.yaml'));
      expect(config).toBeNull();
    });

    it('should return null for empty input', async () => {
      const config = await loadEnvironmentByNameOrPath('');
      expect(config).toBeNull();
    });
  });
});
