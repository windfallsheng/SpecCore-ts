/**
 * contract-registry.ts — 契约注册表
 *
 * v8.3.24+: 定义所有 L1/L2/L3 契约规则，映射到现有检查项
 */

import type { Contract } from './contract-types';

const CONTRACTS: Contract[] = [
  // ═══════════════════════════════════════════════════════════
  // L1 机器契约
  // ═══════════════════════════════════════════════════════════
  {
    id: 'L1-compile',
    name: '编译通过',
    level: 'L1',
    description: '代码必须能通过编译，零错误',
    priority: 100,
    status: 'active',
  },
  {
    id: 'L1-test',
    name: '单元测试通过',
    level: 'L1',
    description: '所有单元测试必须通过',
    priority: 90,
    status: 'active',
  },
  {
    id: 'L1-code-exist',
    name: '代码文件存在',
    level: 'L1',
    description: 'src/ 目录下必须有实际代码文件',
    priority: 80,
    status: 'active',
  },

  // ═══════════════════════════════════════════════════════════
  // L2 规范契约
  // ═══════════════════════════════════════════════════════════
  {
    id: 'L2-lint',
    name: 'Lint 合规',
    level: 'L2',
    description: '代码必须符合项目 Lint 规范',
    priority: 70,
    status: 'active',
  },
  {
    id: 'L2-spec-consistency',
    name: 'Spec 一致性',
    level: 'L2',
    description: '代码实现必须与 REQ.md 中的验收标准一致',
    priority: 85,
    status: 'active',
  },
  {
    id: 'L2-api-contract',
    name: 'API 契约合规',
    level: 'L2',
    description: '接口实现必须与 API_CONTRACT.yaml 一致',
    priority: 80,
    status: 'active',
  },
  {
    id: 'L2-schema',
    name: 'Schema 一致性',
    level: 'L2',
    description: '实体字段必须与 SCHEMA.md 一致',
    priority: 75,
    status: 'active',
  },
  {
    id: 'L2-dev-guide',
    name: 'DEV_GUIDE 合规',
    level: 'L2',
    description: '改造范围必须符合 DEV_GUIDE 要求',
    priority: 70,
    status: 'active',
  },
  {
    id: 'L2-test-coverage',
    name: '测试用例覆盖',
    level: 'L2',
    description: '必须有对应测试用例覆盖',
    priority: 65,
    status: 'active',
  },
  {
    id: 'L2-review',
    name: '评审项合规',
    level: 'L2',
    description: '必须满足 REVIEW.md 中的评审项',
    priority: 60,
    status: 'active',
  },
  {
    id: 'L2-error-code',
    name: '错误码一致性',
    level: 'L2',
    description: '错误码必须与 ERROR_CODES.md 一致',
    priority: 55,
    status: 'active',
  },
  {
    id: 'L2-spec-doc-quality',
    name: '规格文档质量',
    level: 'L2',
    description: 'REQ.md/TECH.md 必须有实质内容',
    priority: 50,
    status: 'active',
  },

  // ═══════════════════════════════════════════════════════════
  // L3 架构契约
  // ═══════════════════════════════════════════════════════════
  {
    id: 'L3-security',
    name: '安全合规',
    level: 'L3',
    description: '代码不得存在安全漏洞（SQL注入、XSS等）',
    priority: 95,
    status: 'active',
  },
  {
    id: 'L3-dependency',
    name: '依赖完整性',
    level: 'L3',
    description: '依赖必须完整，无循环依赖',
    priority: 70,
    status: 'active',
  },
  {
    id: 'L3-dep-graph',
    name: '知识图谱依赖一致性',
    level: 'L3',
    description: '上游依赖接口必须已可用',
    priority: 65,
    status: 'active',
  },
  {
    id: 'L3-deploy',
    name: '部署清单检查',
    level: 'L3',
    description: '必须满足 DEPLOY.md 中的部署项',
    priority: 50,
    status: 'active',
  },
];

/** 按 ID 查找契约 */
export function getContractById(id: string): Contract | undefined {
  return CONTRACTS.find((c) => c.id === id);
}

/** 按层级获取契约列表 */
export function getContractsByLevel(level: 'L1' | 'L2' | 'L3'): Contract[] {
  return CONTRACTS.filter((c) => c.level === level && c.status === 'active');
}

/** 获取所有活跃契约 */
export function getAllActiveContracts(): Contract[] {
  return CONTRACTS.filter((c) => c.status === 'active');
}

/** CheckResult.name → Contract.id 映射 */
export function mapCheckNameToContractId(checkName: string): string | undefined {
  const mapping: Record<string, string> = {
    '编译检查': 'L1-compile',
    '单元测试': 'L1-test',
    '代码文件检查': 'L1-code-exist',
    'Lint 检查': 'L2-lint',
    'Spec 一致性': 'L2-spec-consistency',
    'API 契约合规': 'L2-api-contract',
    'Schema 一致性': 'L2-schema',
    'DEV_GUIDE 合规': 'L2-dev-guide',
    '测试用例覆盖': 'L2-test-coverage',
    '评审项合规': 'L2-review',
    '错误码一致性': 'L2-error-code',
    '规格文档质量': 'L2-spec-doc-quality',
    '安全扫描': 'L3-security',
    '依赖检查': 'L3-dependency',
    '依赖一致性': 'L3-dep-graph',
    '部署项检查': 'L3-deploy',
  };
  return mapping[checkName];
}
