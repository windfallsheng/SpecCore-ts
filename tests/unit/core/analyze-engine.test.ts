import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateSpecsFromRequirements } from '../../../src/core/analyze-engine';
import { writeFile, mkdir, rm } from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';

describe('generateSpecsFromRequirements - 双层文档架构', () => {
  let tempDir: string;
  let specDir: string;
  let reqDir: string;

  beforeEach(async () => {
    // 创建临时目录
    tempDir = join(tmpdir(), `speccore-test-${Date.now()}`);
    specDir = join(tempDir, '020-specs');
    reqDir = join(tempDir, '010-requirements');
    
    await mkdir(specDir, { recursive: true });
    await mkdir(reqDir, { recursive: true });
    
    // 创建模拟需求文档
    const requirementMd = join(reqDir, 'REQUIREMENT.md');
    await writeFile(requirementMd, `# 会议系统升级需求

## 功能模块清单

| # | 功能模块 | 描述 | 涉及端 |
| :--- | :--- | :--- | :--- |
| 1 | 会议室预订 | 用户可预订会议室 | admin, h5 |
| 2 | 审批流程 | 管理员审批预订请求 | admin |
| 3 | 计费系统 | 按使用时长计费 | backend |

## API 接口

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| POST | /api/bookings | 创建预订 |
| GET | /api/bookings/:id | 查询预订详情 |

## 数据模型

### bookings 表
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | bigint | 主键 |
| user_id | bigint | 用户ID |
`);
  });

  it('应该生成全局文档到根目录', async () => {
    const result = await generateSpecsFromRequirements(
      [join(reqDir, 'REQUIREMENT.md')],
      'test-iteration',
      specDir
    );

    // 验证返回结果
    expect(result.summary.withContent).toBeGreaterThan(0);
    
    // 验证全局文档存在
    const fs = await import('fs-extra');
    expect(await fs.pathExists(join(specDir, 'REQUIREMENT.md'))).toBe(true);
    expect(await fs.pathExists(join(specDir, 'ANALYSIS.md'))).toBe(true);
    expect(await fs.pathExists(join(specDir, 'DEPS.md'))).toBe(true);
    expect(await fs.pathExists(join(specDir, 'RISK.md'))).toBe(true);
  });

  it('应该生成各端专属文档到子目录', async () => {
    const result = await generateSpecsFromRequirements(
      [join(reqDir, 'REQUIREMENT.md')],
      'test-iteration',
      specDir
    );

    const fs = await import('fs-extra');
    
    // 验证各端子目录存在
    expect(await fs.pathExists(join(specDir, 'admin'))).toBe(true);
    expect(await fs.pathExists(join(specDir, 'h5'))).toBe(true);
    expect(await fs.pathExists(join(specDir, 'backend'))).toBe(true);
    
    // 验证各端专属文档存在
    expect(await fs.pathExists(join(specDir, 'admin', 'TECH.md'))).toBe(true);
    expect(await fs.pathExists(join(specDir, 'admin', 'TEST.md'))).toBe(true);
    expect(await fs.pathExists(join(specDir, 'admin', 'UI_SPEC.md'))).toBe(true);
    
    expect(await fs.pathExists(join(specDir, 'h5', 'TECH.md'))).toBe(true);
    expect(await fs.pathExists(join(specDir, 'h5', 'TEST.md'))).toBe(true);
    expect(await fs.pathExists(join(specDir, 'h5', 'UI_SPEC.md'))).toBe(true);
    
    expect(await fs.pathExists(join(specDir, 'backend', 'TECH.md'))).toBe(true);
    expect(await fs.pathExists(join(specDir, 'backend', 'TEST.md'))).toBe(true);
    // 后端没有 UI_SPEC.md
    expect(await fs.pathExists(join(specDir, 'backend', 'UI_SPEC.md'))).toBe(false);
  });

  it('REQUIREMENT.md 应该包含涉及端列', async () => {
    await generateSpecsFromRequirements(
      [join(reqDir, 'REQUIREMENT.md')],
      'test-iteration',
      specDir
    );

    const fs = await import('fs-extra');
    const content = await fs.readFile(join(specDir, 'REQUIREMENT.md'), 'utf-8');
    
    // 验证涉及端列存在
    expect(content).toContain('涉及端');
    expect(content).toContain('_待 AI 标注_');
  });

  it('各端 TECH.md 应该有差异化内容', async () => {
    await generateSpecsFromRequirements(
      [join(reqDir, 'REQUIREMENT.md')],
      'test-iteration',
      specDir
    );

    const fs = await import('fs-extra');
    
    const adminTech = await fs.readFile(join(specDir, 'admin', 'TECH.md'), 'utf-8');
    const h5Tech = await fs.readFile(join(specDir, 'h5', 'TECH.md'), 'utf-8');
    const backendTech = await fs.readFile(join(specDir, 'backend', 'TECH.md'), 'utf-8');
    
    // 前端应该有页面路由、组件设计
    expect(adminTech.toLowerCase()).toMatch(/页面|路由|组件|状态管理/i);
    expect(h5Tech.toLowerCase()).toMatch(/页面|路由|组件|状态管理/i);
    
    // 后端应该有接口设计、数据模型
    expect(backendTech.toLowerCase()).toMatch(/接口|API|数据模型|Schema/i);
  });

  afterEach(async () => {
    // 清理临时目录
    await rm(tempDir, { recursive: true, force: true });
  });
});
