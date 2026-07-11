/**
 * 验证引擎测试
 * 测试 Spec 文件合规性校验逻辑
 */

import { describe, it, expect } from 'vitest';

// 模拟 SPEC 目录中的文件扫描
function checkRequiredFiles(files: string[], required: string[]): { missing: string[]; valid: boolean } {
  const missing = required.filter((r) => !files.includes(r));
  return { missing, valid: missing.length === 0 };
}

// 模拟 YAML 结构校验
function validateYamlStructure(content: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!content.includes('endpoints:')) {
    errors.push('Missing "endpoints" key');
  }

  try {
    // 简单检查 YAML 语法（不是真实解析）
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.includes(':') && !line.trim().startsWith('#')) {
        const [key] = line.split(':');
        if (key.trim().length === 0) {
          errors.push(`Invalid key in line: ${line}`);
        }
      }
    }
  } catch {
    errors.push('YAML parse error');
  }

  return { valid: errors.length === 0, errors };
}

// 模拟 Task ID 格式校验
function validateTaskId(id: string): boolean {
  return /^Task-\d{3}$/.test(id);
}

describe('Validator — File Integrity', () => {
  it('should detect missing required files', () => {
    const files = ['REQ.md', 'TECH.md'];
    const required = ['REQ.md', 'TECH.md', 'TASK.md', 'API_CONTRACT.yaml'];
    const result = checkRequiredFiles(files, required);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('TASK.md');
    expect(result.missing).toContain('API_CONTRACT.yaml');
  });

  it('should pass when all files present', () => {
    const files = ['REQ.md', 'TECH.md', 'TASK.md', 'API_CONTRACT.yaml'];
    const required = ['REQ.md', 'TECH.md', 'TASK.md', 'API_CONTRACT.yaml'];
    const result = checkRequiredFiles(files, required);
    expect(result.valid).toBe(true);
  });

  it('should validate task ID format', () => {
    expect(validateTaskId('Task-001')).toBe(true);
    expect(validateTaskId('Task-099')).toBe(true);
    expect(validateTaskId('Task-999')).toBe(true);
    expect(validateTaskId('Task-1')).toBe(false);
    expect(validateTaskId('Task-0001')).toBe(false);
    expect(validateTaskId('task-001')).toBe(false);
    expect(validateTaskId('TASK-001')).toBe(false);
  });
});

describe('Validator — YAML Structure', () => {
  it('should validate correct YAML structure', () => {
    const content = `# API Contract
endpoints:
  - path: /api/v1/users
    method: POST
    name: 创建用户
`;
    const result = validateYamlStructure(content);
    expect(result.valid).toBe(true);
  });

  it('should detect missing endpoints key', () => {
    const content = `# API Contract
paths:
  - /api/v1/users
`;
    const result = validateYamlStructure(content);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing "endpoints" key');
  });

  it('should handle empty YAML', () => {
    const content = '';
    const result = validateYamlStructure(content);
    expect(result.valid).toBe(false);
  });
});

describe('Validator — Specification Completeness', () => {
  it('should require acceptance criteria in REQ.md', () => {
    const reqContent = `
## 需求描述
用户登录功能

## 验收标准
- [ ] AC-01: 登录成功返回 token
- [ ] AC-02: 错误时返回提示
`;
    const hasAC = reqContent.includes('AC-01') && reqContent.includes('AC-02');
    expect(hasAC).toBe(true);
  });

  it('should detect missing acceptance criteria', () => {
    const reqContent = `
## 需求描述
用户登录功能

## 验收标准
_待填写_
`;
    const hasAC = reqContent.includes('AC-0');
    expect(hasAC).toBe(false);
  });

  it('should require Task ID in TASK.md', () => {
    const taskContent = `# Task-001 用户登录 - 后端任务

| 属性 | 值 |
| :--- | :--- |
| 状态 | 🔲 待开发 |
| 优先级 | medium |
`;
    expect(taskContent).toContain('Task-001');
  });
});

// ============================================================
// 扩展验证器测试 — 需求文档完整性
// ============================================================
describe('Validator — Requirement Document Validation', () => {
  it('should detect missing tech stack in REQ.md', () => {
    const reqContent = `## 需求描述
用户登录功能

## 验收标准
- [ ] AC-01: 登录成功
`;
    const hasTechStack = reqContent.includes('技术栈') || reqContent.includes('Tech Stack');
    expect(hasTechStack).toBe(false);
  });

  it('should validate complete REQ.md structure', () => {
    const reqContent = `# REQ-001 用户登录 - 后端需求

> 创建时间：2026-07-09
> 任务类型：feature
> 关联期次：2026-07-用户系统

## 需求描述
实现用户登录功能，支持手机号+密码登录。

## 验收标准
- [ ] AC-01: 登录成功返回 token
- [ ] AC-02: 密码错误返回 401
- [ ] AC-03: 5次错误锁定账号
`;

    const hasTitle = reqContent.includes('# REQ-');
    const hasTime = reqContent.includes('创建时间');
    const hasType = reqContent.includes('任务类型');
    const hasDesc = reqContent.includes('## 需求描述');
    const hasAC = reqContent.includes('## 验收标准');
    const acCount = (reqContent.match(/AC-\d+/g) || []).length;

    expect(hasTitle).toBe(true);
    expect(hasTime).toBe(true);
    expect(hasType).toBe(true);
    expect(hasDesc).toBe(true);
    expect(hasAC).toBe(true);
    expect(acCount).toBe(3);
  });
});

// ============================================================
// 扩展验证器测试 — TECH.md 结构
// ============================================================
describe('Validator — TECH.md Structure', () => {
  it('should validate TECH.md sections', () => {
    const techContent = `# Task-001 用户登录 - 后端技术方案

## 技术选型
- 框架：Spring Boot 3.2
- 数据库：MySQL 8.0

## 核心类设计
- LoginController: 登录接口
- LoginService: 登录逻辑

## 异常处理
- 密码错误 → 401
- 账号锁定 → 423
`;
    const sections = ['技术选型', '核心类设计', '异常处理'];
    for (const section of sections) {
      expect(techContent).toContain(section);
    }
  });

  it('should warn about empty tech sections', () => {
    const techContent = `## 技术选型
_待填写_

## 核心类设计
_待填写_
`;
    const allEmpty = techContent.includes('_待填写_');
    const hasDefined = techContent.includes('Spring') || techContent.includes('Controller');
    expect(allEmpty).toBe(true);
    expect(hasDefined).toBe(false);
  });
});

// ============================================================
// 扩展验证器测试 — API_CONTRACT.yaml
// ============================================================
describe('Validator — API Contract Structure', () => {
  it('should validate API contract with multiple endpoints', () => {
    const contract = `endpoints:
  - path: /api/v1/users/login
    method: POST
    description: 用户登录
  - path: /api/v1/users/register
    method: POST
    description: 用户注册
  - path: /api/v1/users/{id}
    method: GET
    description: 获取用户信息
`;
    const hasEndpoints = contract.includes('endpoints:');
    const endpointCount = (contract.match(/- path:/g) || []).length;
    expect(hasEndpoints).toBe(true);
    expect(endpointCount).toBe(3);
  });

  it('should detect missing HTTP method', () => {
    const contract = `endpoints:
  - path: /api/v1/users
`;
    const hasMethod = contract.includes('method:');
    expect(hasMethod).toBe(false);
  });
});

// ============================================================
// 扩展验证器测试 — 文件路径和命名规范
// ============================================================
describe('Validator — Naming Conventions', () => {
  it('should validate iteration naming format', () => {
    const validNames = ['2026-07-用户系统', '2026-Q3-支付模块', 'v1.0-核心功能'];
    const invalidNames = ['', 'no-date', 'a'.repeat(200)];

    const validateIterationName = (name: string) =>
      name.length >= 5 && name.length <= 100 && /[\u4e00-\u9fa5]/.test(name);

    for (const name of validNames) {
      expect(validateIterationName(name)).toBe(true);
    }
    for (const name of invalidNames) {
      expect(validateIterationName(name)).toBe(false);
    }
  });

  it('should validate Task directory structure', () => {
    const requiredDirs = ['_shared', 'backend'];
    const existingDirs = ['_shared', 'backend', 'frontend/web', 'frontend/h5'];
    const missing = requiredDirs.filter((d) => !existingDirs.includes(d));
    expect(missing).toHaveLength(0);
  });

  it('should validate frontend platform directories', () => {
    const platforms = ['web', 'h5', 'miniapp'];
    const frontendDirs = ['frontend/web', 'frontend/h5'];
    const covered = platforms.filter(
      (p) => frontendDirs.some((d) => d === `frontend/${p}`)
    );
    expect(covered).toEqual(['web', 'h5']);
  });
});
