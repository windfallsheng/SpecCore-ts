/**
 * 语义门禁单元测试（v8.3.386+）
 * 覆盖：架构决策检测 / API 清单列非空 / 代码证据引用 / ADR 三段式门禁
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  checkSemanticQuality,
  extractDecisionBlocks,
  parseMarkdownTables,
  countCodeEvidence,
  checkAdrGate,
  checkDocumentQuality,
  QualityReport,
} from '../../../src/core/doc-quality-gate';

const TMP = join(process.cwd(), 'tests', '.tmp', 'doc-quality-gate-semantic');

function setup(): void {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, 'overview'), { recursive: true });
  mkdirSync(join(TMP, 'requirements'), { recursive: true });
  mkdirSync(join(TMP, 'platforms'), { recursive: true });
}

function teardown(): void {
  rmSync(TMP, { recursive: true, force: true });
}

// ── 合格的 ARCHITECTURE.md 片段 ──
function goodArchitecture(): string {
  return `# 全局架构

## 服务拓扑

\`\`\`mermaid
graph TB
  A[前端] --> B[网关]
\`\`\`

## 架构决策

### 决策 1：采用微服务拆分
- 理由：预订与房间管理职责隔离，独立扩容，权衡了单体开发的简单性
- 证据：src/booking-service/main.ts、src/room-service/main.ts

### 决策 2：网关统一鉴权
- 原因：避免各服务重复实现 JWT 校验，考虑过在服务内鉴权但维护成本高
- 证据：src/gateway/middleware/auth.ts:45

### 决策 3：Redis 做缓存
- 背景：查询热点集中在会议室列表，权衡内存成本后选择 Redis
- 证据：src/booking-service/cache/redis.ts
`;
}

function goodApiInventory(): string {
  return `# API 清单

| 路径 | 方法 | 鉴权 | 幂等 | 版本 |
| :--- | :--- | :--- | :--- | :--- |
| /api/rooms | GET | 无 | 是 | v1 |
| /api/rooms | POST | JWT | 是 | v1 |
| /api/bookings | POST | JWT | 否 | v2 |
`;
}

describe('extractDecisionBlocks', () => {
  it('识别「### 决策 N」标题形式', () => {
    const blocks = extractDecisionBlocks(goodArchitecture());
    expect(blocks.length).toBe(3);
    expect(blocks.every(b => b.hasReason)).toBe(true);
    expect(blocks.every(b => b.evidence.length > 0)).toBe(true);
  });

  it('识别「- **决策 N**：」列表形式', () => {
    const content = `- **决策 1**：选 A 方案\n  理由：简单\n  证据：src/a.ts\n- **决策 2**：选 B 方案\n  原因：稳定\n  证据：src/b.ts\n- **决策 3**：选 C 方案\n  权衡：成本\n  证据：src/c.ts\n`;
    const blocks = extractDecisionBlocks(content);
    expect(blocks.length).toBe(3);
  });

  it('不把「决策引擎」等普通词误判为决策', () => {
    const blocks = extractDecisionBlocks('## 系统包含一个决策引擎模块\n\n决策引擎负责审批流转。');
    expect(blocks.length).toBe(0);
  });
});

describe('parseMarkdownTables', () => {
  it('解析表头与数据行', () => {
    const tables = parseMarkdownTables(goodApiInventory());
    expect(tables.length).toBe(1);
    expect(tables[0].header).toEqual(['路径', '方法', '鉴权', '幂等', '版本']);
    expect(tables[0].rows.length).toBe(3);
  });

  it('忽略非表格文本', () => {
    const tables = parseMarkdownTables('# 标题\n\n普通段落\n\n| 表头A | 表头B |\n| :--- | :--- |\n| 数据1 | 数据2 |\n');
    expect(tables.length).toBe(1);
  });
});

describe('countCodeEvidence', () => {
  it('统计源码路径引用并去重', () => {
    const refs = countCodeEvidence('见 src/service/order.ts:45，另见 src/service/order.ts 与 src/utils/helper.go');
    expect(refs).toContain('src/service/order.ts');
    expect(refs).toContain('src/utils/helper.go');
  });

  it('过滤 node_modules 与 .md 文件', () => {
    const refs = countCodeEvidence('node_modules/lodash/index.js 与 docs/README.md 不是证据');
    expect(refs.length).toBe(0);
  });
});

describe('checkSemanticQuality — 架构决策', () => {
  it('合格 ARCHITECTURE.md 无 issue', () => {
    const issues = checkSemanticQuality('x/ARCHITECTURE.md', 'ARCHITECTURE.md', goodArchitecture());
    expect(issues).toHaveLength(0);
  });

  it('决策不足报 missing-decision', () => {
    const content = '# 架构\n\n## 服务拓扑\n\n\`\`\`mermaid\ngraph TB\n  A --> B\n\`\`\`\n\n### 决策 1：单体\n- 理由：简单\n- 证据：src/app.ts\n';
    const issues = checkSemanticQuality('x/ARCHITECTURE.md', 'ARCHITECTURE.md', content);
    const errs = issues.filter(i => i.type === 'missing-decision');
    expect(errs.length).toBeGreaterThan(0);
    expect(issues.some(i => i.severity === 'error')).toBe(true);
  });

  it('决策缺理由报 error', () => {
    const content = '### 决策 1：网关\n\n仅描述方案内容。\n\n### 决策 2：缓存\n\n仅描述方案内容。\n\n### 决策 3：队列\n\n仅描述方案内容。\n';
    const issues = checkSemanticQuality('x/ARCHITECTURE.md', 'ARCHITECTURE.md', content);
    expect(issues.some(i => i.message.includes('缺少理由'))).toBe(true);
  });

  it('决策缺代码证据报 missing-evidence', () => {
    const content = '### 决策 1：网关\n- 理由：统一\n\n### 决策 2：缓存\n- 理由：快\n\n### 决策 3：队列\n- 理由：解耦\n';
    const issues = checkSemanticQuality('x/ARCHITECTURE.md', 'ARCHITECTURE.md', content);
    expect(issues.some(i => i.type === 'missing-evidence')).toBe(true);
  });
});

describe('checkSemanticQuality — API 清单列非空', () => {
  it('合格 API_INVENTORY.md 无 issue', () => {
    const issues = checkSemanticQuality('x/API_INVENTORY.md', 'API_INVENTORY.md', goodApiInventory());
    expect(issues).toHaveLength(0);
  });

  it('缺鉴权列报 empty-column', () => {
    const content = '| 路径 | 方法 | 幂等 | 版本 |\n| :--- | :--- | :--- | :--- |\n| /a | GET | 是 | v1 |\n';
    const issues = checkSemanticQuality('x/API_INVENTORY.md', 'API_INVENTORY.md', content);
    expect(issues.some(i => i.type === 'empty-column' && i.message.includes('鉴权'))).toBe(true);
  });

  it('鉴权列有空值报 error', () => {
    const content = '| 路径 | 鉴权 | 幂等 | 版本 |\n| :--- | :--- | :--- | :--- |\n| /a | JWT | 是 | v1 |\n| /b | - | 否 | v1 |\n';
    const issues = checkSemanticQuality('x/API_INVENTORY.md', 'API_INVENTORY.md', content);
    expect(issues.some(i => i.type === 'empty-column' && i.message.includes('1 行数据为空'))).toBe(true);
  });

  it('「无」对鉴权列是合法值不报错', () => {
    const issues = checkSemanticQuality('x/API_INVENTORY.md', 'API_INVENTORY.md', goodApiInventory());
    expect(issues).toHaveLength(0);
  });
});

describe('checkSemanticQuality — 代码证据引用', () => {
  it('证据不足报 missing-evidence', () => {
    const content = '# 数据流\n\n数据从 A 到 B 再到 C。\n';
    const issues = checkSemanticQuality('x/DATA_FLOW.md', 'DATA_FLOW.md', content);
    expect(issues.some(i => i.type === 'missing-evidence')).toBe(true);
  });

  it('证据充足无 issue', () => {
    const content = '# 数据流\n\n数据经 src/api/gateway.ts 进入 src/service/order.ts 处理，写入 src/repo/db.ts。\n';
    const issues = checkSemanticQuality('x/DATA_FLOW.md', 'DATA_FLOW.md', content);
    expect(issues).toHaveLength(0);
  });

  it('非技术文档不检查证据', () => {
    const issues = checkSemanticQuality('x/REQUIREMENT.md', 'REQUIREMENT.md', '# 需求\n\n用户故事。');
    expect(issues.some(i => i.type === 'missing-evidence')).toBe(false);
  });
});

describe('checkAdrGate', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('无架构决策时无 ADR 义务', async () => {
    writeFileSync(join(TMP, 'overview', 'ARCHITECTURE.md'), '# 架构\n\n## 服务拓扑\n');
    const reports: QualityReport[] = [];
    await checkAdrGate(TMP, reports);
    expect(reports).toHaveLength(0);
  });

  it('有决策但 decisions/ 目录缺失报 missing-adr', async () => {
    writeFileSync(join(TMP, 'overview', 'ARCHITECTURE.md'), goodArchitecture());
    const reports: QualityReport[] = [];
    await checkAdrGate(TMP, reports);
    expect(reports.some(r => r.issues.some(i => i.type === 'missing-adr' && i.message.includes('目录不存在')))).toBe(true);
  });

  it('decisions/ 为空报 error', async () => {
    writeFileSync(join(TMP, 'overview', 'ARCHITECTURE.md'), goodArchitecture());
    mkdirSync(join(TMP, 'overview', 'decisions'), { recursive: true });
    const reports: QualityReport[] = [];
    await checkAdrGate(TMP, reports);
    expect(reports.some(r => r.issues.some(i => i.type === 'missing-adr' && i.message.includes('目录为空')))).toBe(true);
  });

  it('ADR 缺「后果」段报 error', async () => {
    writeFileSync(join(TMP, 'overview', 'ARCHITECTURE.md'), goodArchitecture());
    mkdirSync(join(TMP, 'overview', 'decisions'), { recursive: true });
    writeFileSync(join(TMP, 'overview', 'decisions', 'ADR-001.md'), '# ADR-001\n\n## 上下文\n背景\n\n## 决策\n方案\n');
    const reports: QualityReport[] = [];
    await checkAdrGate(TMP, reports);
    expect(reports.some(r => r.issues.some(i => i.type === 'missing-adr' && i.message.includes('后果')))).toBe(true);
  });

  it('三段完整 ADR 通过门禁', async () => {
    writeFileSync(join(TMP, 'overview', 'ARCHITECTURE.md'), goodArchitecture());
    mkdirSync(join(TMP, 'overview', 'decisions'), { recursive: true });
    writeFileSync(
      join(TMP, 'overview', 'decisions', 'ADR-001.md'),
      '# ADR-001: 微服务拆分\n\n## 上下文\n问题背景\n\n## 决策\n选定方案\n\n## 后果\n影响说明\n',
    );
    const reports: QualityReport[] = [];
    await checkAdrGate(TMP, reports);
    expect(reports.some(r => r.issues.some(i => i.type === 'missing-adr'))).toBe(false);
  });

  it('checkDocumentQuality 对 decisions 下 ADR 不触发 ARCHITECTURE 规则', async () => {
    mkdirSync(join(TMP, 'overview', 'decisions'), { recursive: true });
    writeFileSync(
      join(TMP, 'overview', 'decisions', 'ADR-001.md'),
      '# ADR-001\n\n## 上下文\n背景\n\n## 决策\n方案\n\n## 后果\n影响\n',
    );
    const report = await checkDocumentQuality(join(TMP, 'overview', 'decisions', 'ADR-001.md'));
    expect(report).not.toBeNull();
    expect(report!.issues.some(i => i.type === 'missing-decision')).toBe(false);
  });
});
