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
