import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateSpecsFromRequirements, runAnalysis } from '../../../src/core/analyze-engine';
import { writeFile, mkdir, rm } from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';

describe('generateSpecsFromRequirements - 双层文档架构', () => {
  let tempDir: string;
  let specDir: string;
  let reqDir: string;
  let origCwd: string;

  beforeEach(async () => {
    // 创建临时目录
    tempDir = join(tmpdir(), `speccore-test-${Date.now()}`);
    specDir = join(tempDir, '020-specs');
    reqDir = join(tempDir, '010-requirements');
    
    await mkdir(specDir, { recursive: true });
    await mkdir(reqDir, { recursive: true });
    
    // 创建测试宪法（端列表），供 detectPlatformsFromConstitution 解析
    // v8.3.255+: 端列表由 CONSTITUTION.md「端列表」章节显式声明
    const speccoreDir = join(tempDir, '.speccore');
    await mkdir(speccoreDir, { recursive: true });
    await writeFile(join(speccoreDir, 'CONSTITUTION.md'), `# 技术宪法（测试）

## 端列表

| 工程标识 | 端名 | 说明 |
| :--- | :--- | :--- |
| admin | admin | 管理端 |
| h5 | h5 | 移动端 |
| backend | backend | 后端服务 |
`);
    origCwd = process.cwd();
    process.chdir(tempDir);
    
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

  it('应该生成全局文档到 overview 子目录', async () => {
    const result = await generateSpecsFromRequirements(
      [join(reqDir, 'REQUIREMENT.md')],
      'test-iteration',
      specDir
    );

    // 验证返回结果
    expect(result.summary.withContent).toBeGreaterThan(0);
    
    // 验证全局文档存在（v6.41.0+: 全局文档统一放在 overview/ 子目录）
    const fs = await import('fs-extra');
    expect(await fs.pathExists(join(specDir, 'overview', 'REQUIREMENT.md'))).toBe(true);
    expect(await fs.pathExists(join(specDir, 'overview', 'ANALYSIS.md'))).toBe(true);
    expect(await fs.pathExists(join(specDir, 'overview', 'DEPS.md'))).toBe(true);
    expect(await fs.pathExists(join(specDir, 'overview', 'RISK.md'))).toBe(true);
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
    const content = await fs.readFile(join(specDir, 'overview', 'REQUIREMENT.md'), 'utf-8');
    
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

    // 各端 TECH.md 存在且非空
    expect(adminTech.length).toBeGreaterThan(0);
    expect(h5Tech.length).toBeGreaterThan(0);
    expect(backendTech.length).toBeGreaterThan(0);
    
    // 前端应该有页面路由、组件设计
    expect(adminTech.toLowerCase()).toMatch(/页面|路由|组件|状态管理/i);
    expect(h5Tech.toLowerCase()).toMatch(/页面|路由|组件|状态管理/i);
    
    // 后端应该有接口设计、数据模型
    expect(backendTech.toLowerCase()).toMatch(/接口|API|数据模型|Schema/i);
  });

  afterEach(async () => {
    // 恢复工作目录并清理临时目录
    process.chdir(origCwd);
    await rm(tempDir, { recursive: true, force: true });
  });
});

describe('runAnalysis - 知识库注入与 RAG 召回（v8.3.328）', () => {
  let tempDir: string;
  let origCwd: string;
  let reqPath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `speccore-rag-analyze-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    await mkdir(join(tempDir, '.speccore'), { recursive: true });
    await writeFile(join(tempDir, '.speccore', 'CONSTITUTION.md'), `# 技术宪法（测试）\n\n## 端列表\n\n| 工程标识 | 端名 | 说明 |\n| :--- | :--- | :--- |\n| admin | admin | 管理端 |\n`);
    await mkdir(join(tempDir, '010-requirements'), { recursive: true });
    reqPath = join(tempDir, '010-requirements', 'REQUIREMENT.md');
    await writeFile(reqPath, '# 会议室预订需求\n\n## 功能清单\n\n| # | 模块 | 涉及端 |\n| :--- | :--- | :--- |\n| 1 | 会议室预订 | admin |\n');
    origCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(origCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it('无知识库环境：报告不含知识库/RAG 小节', async () => {
    const result = await runAnalysis({
      sources: [],
      requirements: [reqPath],
      scope: 'iteration',
      iteration: 'test-iter',
      depth: 'normal',
      readSource: false,
    });
    expect(result.report).not.toContain('全局知识库');
    expect(result.report).not.toContain('RAG 召回');
  });

  it('有 RULES + RAG 索引：报告含 L2 注入与召回文档', async () => {
    // L2 注入源：RULES 规则文件（loadGlobalContext 按 priority 注入）
    await mkdir(join(tempDir, '.speccore', 'RULES'), { recursive: true });
    await writeFile(join(tempDir, '.speccore', 'RULES', 'api-design.md'), '# API 设计规范\n\n统一接口格式与错误码体系。\n');
    // 全局索引（indexSummary 注入）
    await mkdir(join(tempDir, '.speccore', 'GLOBAL'), { recursive: true });
    await writeFile(join(tempDir, '.speccore', 'GLOBAL', 'INDEX.md'), '# 全局规范索引\n\n项目全局规范入口。\n');
    // RAG 迭代专属索引（命中「预订」）
    await mkdir(join(tempDir, '.speccore', 'cache'), { recursive: true });
    const ragIndex = {
      version: '1',
      updatedAt: new Date().toISOString(),
      scope: 'test-iter',
      chunks: [{
        id: 'b1',
        filePath: '.speccore/PATTERNS/booking.md',
        fileName: 'booking.md',
        title: '会议室预订模式',
        level: 2,
        content: '预订幂等设计',
        summary: '会议室预订幂等与并发控制',
        keywords: ['预订', '幂等'],
        charCount: 30,
      }],
      fileSummaries: {},
      fileMtimes: {},
    };
    await writeFile(join(tempDir, '.speccore', 'cache', 'rag-index-test-iter.json'), JSON.stringify(ragIndex));

    const result = await runAnalysis({
      sources: [],
      requirements: [reqPath],
      scope: 'iteration',
      iteration: 'test-iter',
      depth: 'normal',
      readSource: false,
    });
    expect(result.report).toContain('全局知识库');
    expect(result.report).toContain('RAG 召回');
    expect(result.report).toContain('会议室预订模式');
  });
});

describe('runAnalysis - 源码阅读清单模式（v8.3.329：不拼原文）', () => {
  let tempDir: string;
  let origCwd: string;
  let reqPath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `speccore-reading-list-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    await mkdir(join(tempDir, '.speccore'), { recursive: true });
    await writeFile(join(tempDir, '.speccore', 'CONSTITUTION.md'), `# 技术宪法（测试）\n\n## 端列表\n\n| 工程标识 | 端名 | 说明 |\n| :--- | :--- | :--- |\n| admin | admin | 管理端 |\n`);
    await mkdir(join(tempDir, '010-requirements'), { recursive: true });
    reqPath = join(tempDir, '010-requirements', 'REQUIREMENT.md');
    await writeFile(reqPath, '# 会议室预订需求\n\n## 功能清单\n\n| # | 模块 | 涉及端 |\n| :--- | :--- | :--- |\n| 1 | 会议室预订 | admin |\n');
    // 模拟源码工程（唯一特征串用于断言「不拼原文」）
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(
      join(tempDir, 'src', 'booking.service.ts'),
      'export class BookingService {\n  private uniqueSecretMarker = "never-paste-me-into-prompt";\n  book() {}\n}\n',
    );
    origCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(origCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it('readSource 开启：报告含阅读清单与深读协议，不含源码原文', async () => {
    const result = await runAnalysis({
      sources: [],
      requirements: [reqPath],
      scope: 'iteration',
      iteration: 'test-iter',
      depth: 'normal',
      readSource: true,
      sourceScope: 'src',
    });
    // 清单存在：导航 + 深读协议
    expect(result.report).toContain('关联代码导航');
    expect(result.report).toContain('CLI 不拼入源码全文');
    // 源码正文绝不出现（文件内的唯一特征串）
    expect(result.report).not.toContain('never-paste-me-into-prompt');
    expect(result.report).not.toContain('uniqueSecretMarker');
  });
});
