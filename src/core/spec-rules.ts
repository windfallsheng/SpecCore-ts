/**
 * spec-rules — CONSTITUTION.md spec-rule 解析器
 * 从全局配置中提取机器可执行的代码生成规则
 */
import { readFile, pathExists } from 'fs-extra';
import { join } from 'path';

export interface SpecRules {
  exceptionHandler: 'BusinessException' | 'none';
  responseFormat: 'Result' | 'ResponseEntity';
  orm: 'JPA' | 'MyBatis-Plus';
  // 命名约定
  naming: {
    controller: string;   // 'XxxController'
    service: string;      // 'XxxService'
    repository: string;   // 'XxxRepository'
    dto: string;          // 'CreateXxxDTO'
  };
  validation: boolean;
}

const DEFAULT_RULES: SpecRules = {
  exceptionHandler: 'none',
  responseFormat: 'ResponseEntity',
  orm: 'JPA',
  naming: {
    controller: 'XxxController',
    service: 'XxxService',
    repository: 'XxxRepository',
    dto: 'XxxDTO',
  },
  validation: false,
};

/** 从 CONSTITUTION.md 加载 Spec 规则 */
export async function loadSpecRules(): Promise<SpecRules> {
  const constitutionPath = join(process.cwd(), '.speccore', 'CONSTITUTION.md');
  if (!(await pathExists(constitutionPath))) {
    return { ...DEFAULT_RULES };
  }

  const content = await readFile(constitutionPath, 'utf-8');
  const rules = { ...DEFAULT_RULES };

  // 解析 <!-- spec-rule: xxx --> ... <!-- /spec-rule --> 区块
  const ruleRegex = /<!--\s*spec-rule:\s*(\S+)\s*-->\s*([\s\S]*?)<!--\s*\/spec-rule\s*-->/g;
  let match;
  while ((match = ruleRegex.exec(content)) !== null) {
    const name = match[1];
    const body = match[2];

    switch (name) {
      case 'exception-handler':
        rules.exceptionHandler = body.includes('BusinessException') ? 'BusinessException' : 'none';
        break;
      case 'response-format':
        rules.responseFormat = body.includes('Result<') ? 'Result' : 'ResponseEntity';
        break;
      case 'orm':
        rules.orm = body.includes('MyBatis-Plus') ? 'MyBatis-Plus' : 'JPA';
        break;
      case 'naming':
        parseNaming(body, rules.naming);
        break;
      case 'validation':
        rules.validation = body.includes('@Valid') || body.includes('JSR-303');
        break;
    }
  }

  return rules;
}

function parseNaming(body: string, naming: SpecRules['naming']): void {
  const ctrl = body.match(/Controller\s*[:：]\s*(\S+)/);
  if (ctrl) naming.controller = ctrl[1];
  const svc = body.match(/Service\s*[:：]\s*(\S+)/);
  if (svc) naming.service = svc[1];
  const repo = body.match(/Repository\s*[:：]\s*(\S+)/);
  if (repo) naming.repository = repo[1];
  const dto = body.match(/DTO\s*[:：]\s*(\S+)/);
  if (dto) naming.dto = dto[1];
}

/** 根据规则生成 Controller 的 import 语句 */
export function generateImports(rules: SpecRules, className: string): string {
  const lines: string[] = [];
  lines.push('import org.springframework.web.bind.annotation.*;');
  lines.push('import org.springframework.beans.factory.annotation.Autowired;');

  if (rules.responseFormat === 'Result') {
    lines.push('import com.example.common.Result;');
  }
  if (rules.exceptionHandler === 'BusinessException') {
    lines.push('import com.example.common.BusinessException;');
  }
  if (rules.validation) {
    lines.push('import javax.validation.Valid;');
    lines.push('import javax.validation.constraints.*;');
  }

  lines.push(`import com.example.${className.toLowerCase()}.service.${className}Service;`);
  return lines.join('\n');
}

/** 根据规则确定方法返回类型 */
export function getReturnType(rules: SpecRules, dtoName: string): string {
  if (rules.responseFormat === 'Result') {
    return `Result<${dtoName}>`;
  }
  return `ResponseEntity<${dtoName}>`;
}

/** 根据规则确定 TODO 实现提示 */
export function getTodoHint(rules: SpecRules): string {
  const hints: string[] = [];
  if (rules.exceptionHandler === 'BusinessException') {
    hints.push('throw new BusinessException("Not implemented")');
  } else {
    hints.push('return ResponseEntity.ok().build()');
  }
  return '// TODO: Implement — see TASK.md\n        ' + hints[0] + ';';
}

// ============================================
// Tech Stack 解析
// ============================================

export type SupportedLanguage = 'java' | 'typescript' | 'go' | 'python' | 'unknown';

export interface TechStack {
  language: SupportedLanguage;
  backendFramework: string;
  orm: string;
  frontendFramework: string;
}

const DEFAULT_TECH_STACK: TechStack = {
  language: 'java',
  backendFramework: 'Spring Boot',
  orm: 'JPA',
  frontendFramework: 'Vue',
};

/** 从 TECH_STACK.md 加载技术栈配置 */
export async function loadTechStack(): Promise<TechStack> {
  const techPath = join(process.cwd(), '.speccore', 'GLOBAL', 'TECH_STACK.md');
  if (!(await pathExists(techPath))) {
    return { ...DEFAULT_TECH_STACK };
  }

  const content = await readFile(techPath, 'utf-8');
  const stack = { ...DEFAULT_TECH_STACK };

  // 解析 <!-- tech-stack: backend --> 区块
  const backendMatch = content.match(/<!--\s*tech-stack:\s*backend\s*-->([\s\S]*?)<!--\s*\/tech-stack\s*-->/);
  if (backendMatch) {
    const body = backendMatch[1];
    if (body.includes('Java')) stack.language = 'java';
    else if (body.includes('TypeScript') || body.includes('Node')) stack.language = 'typescript';
    else if (body.includes('Go') || body.includes('Golang')) stack.language = 'go';
    else if (body.includes('Python')) stack.language = 'python';

    const fwMatch = body.match(/框架[:：]\s*(\S+)/);
    if (fwMatch) stack.backendFramework = fwMatch[1];
    const ormMatch = body.match(/ORM[:：]\s*(\S+)/);
    if (ormMatch) stack.orm = ormMatch[1];
  }

  // 解析 <!-- tech-stack: frontend --> 区块
  const frontendMatch = content.match(/<!--\s*tech-stack:\s*frontend\s*-->([\s\S]*?)<!--\s*\/tech-stack\s*-->/);
  if (frontendMatch) {
    const body = frontendMatch[1];
    const fwMatch = body.match(/框架[:：]\s*(\S+)/);
    if (fwMatch) stack.frontendFramework = fwMatch[1];
  }

  return stack;
}
