import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'path';
import { mkdirSync, writeFileSync, existsSync, rmSync, mkdtempSync } from 'fs';
import { readFile } from 'fs-extra';
import { analyzeCommand } from '../../../src/commands/analyze';

describe('analyze — Requirement Analysis', () => {
  let tmpDir: string;
  let iterDir: string;
  let reqDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync('/tmp/speccore-analyze-test-');
    iterDir = join(tmpDir, '期次-Q3');
    reqDir = join(iterDir, '00-需求文档');
    mkdirSync(reqDir, { recursive: true });
    
    // Set up .speccore context
    const speccoreDir = join(tmpDir, '.speccore');
    mkdirSync(join(speccoreDir, 'GLOBAL'), { recursive: true });
    mkdirSync(join(speccoreDir, 'local'), { recursive: true });
    writeFileSync(join(speccoreDir, 'local', 'context.json'), JSON.stringify({ defaultIteration: 'Q3' }));
    
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir('/tmp');
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should detect missing interface fields', async () => {
    writeFileSync(join(reqDir, 'REQUIREMENT.md'), `# Test Requirements
## 后台管理端需求
### 用户管理

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| | | |
| GET | /api/users | |
`);

    await analyzeCommand({ iteration: 'Q3', auto: true });

    const report = await readFile(join(reqDir, 'ANALYSIS.md'), 'utf-8');
    expect(report).toContain('接口行缺少必填字段');
    expect(report).toContain('🔴');
  });

  it('should detect complete interfaces as clean', async () => {
    writeFileSync(join(reqDir, 'REQUIREMENT.md'), `# Test Requirements
## 后台端需求
### 用户管理

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | /api/users | 获取用户列表 |
| POST | /api/users | 创建用户 |
`);

    await analyzeCommand({ iteration: 'Q3', auto: true });

    const report = await readFile(join(reqDir, 'ANALYSIS.md'), 'utf-8');
    expect(report).not.toContain('接口行缺少必填字段');
  });

  it('should detect empty sections', async () => {
    writeFileSync(join(reqDir, 'REQUIREMENT.md'), `# Test Requirements
## 后台端需求
### 空章节介绍

### 有内容章节
这个章节有足够的内容描述，包含具体的功能需求说明和实现细节说明。
`);

    await analyzeCommand({ iteration: 'Q3', auto: true });

    const report = await readFile(join(reqDir, 'ANALYSIS.md'), 'utf-8');
    expect(report).toContain('空章节');
  });

  it('should generate complete report structure', async () => {
    writeFileSync(join(reqDir, 'REQUIREMENT.md'), `# Test Requirements
## Web端需求

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | /web/home | Home page |

## 后台端需求

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| POST | /api/orders | Create order |
`);

    await analyzeCommand({ iteration: 'Q3', auto: true });

    const report = await readFile(join(reqDir, 'ANALYSIS.md'), 'utf-8');
    expect(report).toContain('## 1. 需求完整性检查');
    expect(report).toContain('## 2. 源码对标');
    expect(report).toContain('## 3. 架构影响');
    expect(report).toContain('## 4. 待确认清单');
    expect(report).toContain('## 5. 技术方案');
  });

  it('should detect new dependencies from content', async () => {
    writeFileSync(join(reqDir, 'REQUIREMENT.md'), `# Test
## 后台端需求
### Payment service

需要使用消息队列 Kafka 处理订单，同时用 Redis 缓存用户信息。

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| POST | /api/pay | Process payment |
`);

    await analyzeCommand({ iteration: 'Q3', auto: true });

    const report = await readFile(join(reqDir, 'ANALYSIS.md'), 'utf-8');
    expect(report).toContain('消息队列');
    expect(report).toContain('缓存服务');
  });

  it('should detect batch operation risks', async () => {
    writeFileSync(join(reqDir, 'REQUIREMENT.md'), `# Test
## 后台端需求
### 批量删除用户

支持批量删除用户和批量导出报表。

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| POST | /api/users/batch-delete | 批量删除 |
| GET | /api/reports/export | 导出报表 |
`);

    await analyzeCommand({ iteration: 'Q3', auto: true });

    const report = await readFile(join(reqDir, 'ANALYSIS.md'), 'utf-8');
    expect(report).toContain('批量操作');
    expect(report).toContain('导出/报表');
  });
});
