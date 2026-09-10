import { pathExists, readdir, readFile } from 'fs-extra';
import { join, basename } from 'path';
import { parseYamlFile, validateApiContract } from './yaml-parser';

export interface ValidationError {
  file: string;
  issue: string;
  severity: 'error' | 'warning';
  fixable?: boolean;
}

export interface ValidationResult {
  errors: ValidationError[];
  warnings: ValidationError[];
  passRate: number;
  totalChecks: number;
  taskResults: Record<string, TaskValidationResult>;
}

export interface TaskValidationResult {
  taskId: string;
  errors: ValidationError[];
  warnings: ValidationError[];
  passRate: number;
}

export async function validateProject(
  iteration?: string,
  taskId?: string,
  options?: { fix?: boolean; strict?: boolean }
): Promise<ValidationResult> {
  const result: ValidationResult = {
    errors: [],
    warnings: [],
    passRate: 0,
    totalChecks: 0,
    taskResults: {}
  };
  
  const iterations = iteration ? [iteration] : await findIterations();
  
  for (const iter of iterations) {
    const tasks = taskId ? [taskId] : await findTasks(iter);
    
    for (const task of tasks) {
      const taskResult = await validateTask(iter, task, options);
      result.errors.push(...taskResult.errors);
      result.warnings.push(...taskResult.warnings);
      result.totalChecks += taskResult.errors.length + taskResult.warnings.length;
      result.taskResults[task] = taskResult;
    }
  }
  
  // Calculate pass rate
  if (result.totalChecks > 0) {
    const passed = result.totalChecks - result.errors.length;
    result.passRate = Math.round((passed / result.totalChecks) * 100);
  } else {
    result.passRate = 100;
  }
  
  return result;
}

async function validateTask(
  iteration: string,
  taskId: string,
  options?: { fix?: boolean; strict?: boolean }
): Promise<TaskValidationResult> {
  const result: TaskValidationResult = {
    taskId,
    errors: [],
    warnings: [],
    passRate: 0
  };
  
  const taskPath = join(`Iteration-${iteration}`, taskId);
  
  // Check if task directory exists
  if (!(await pathExists(taskPath))) {
    result.errors.push({
      file: taskPath,
      issue: 'Task directory does not exist',
      severity: 'error'
    });
    return result;
  }
  
  // Check required files (任务根级)
  const requiredFiles = [
    '.task-type',
    '00-specs/REQ.md',
    '00-specs/TASK.md',
    '00-specs/TECH.md',
  ];

  for (const file of requiredFiles) {
    const filePath = join(taskPath, file);
    if (!(await pathExists(filePath))) {
      result.errors.push({
        file: filePath,
        issue: `Missing required file: ${file}`,
        severity: 'error',
        fixable: true
      });
    }
  }

  // v8.3.121+: 检查端平铺结构 — 至少有一个端目录和子任务
  const EXCLUDE_DIRS = new Set(['00-specs', '_shared', '99-artifacts', '.meta']);
  let hasPlatform = false;
  try {
    const entries = await readdir(taskPath, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || EXCLUDE_DIRS.has(e.name)) continue;
      const platformPath = join(taskPath, e.name);
      const subEntries = await readdir(platformPath, { withFileTypes: true });
      if (subEntries.some(se => se.isDirectory() && !se.name.startsWith('.'))) {
        hasPlatform = true;
        break;
      }
    }
  } catch { /* 跳过 */ }
  if (!hasPlatform) {
    result.warnings.push({
      file: taskPath,
      issue: 'No platform subtasks found — 任务目录下缺少端平铺子任务（如 {端名}/{子任务}/）',
      severity: 'warning',
    });
  }
  
  // Check YAML files
  const yamlPath = join(taskPath, '_shared', 'API_CONTRACT.yaml');
  if (await pathExists(yamlPath)) {
    const parseResult = await parseYamlFile(yamlPath);
    if (!parseResult.success) {
      result.errors.push({
        file: yamlPath,
        issue: parseResult.error || 'Invalid YAML',
        severity: 'error',
        fixable: false
      });
    } else if (parseResult.data) {
      const yamlErrors = validateApiContract(parseResult.data);
      for (const error of yamlErrors) {
        result.errors.push({
          file: yamlPath,
          issue: error,
          severity: 'error',
          fixable: true
        });
      }
    }
  }
  
  // Check markdown files for content
  const mdFiles = ['00-specs/REQ.md', '00-specs/TECH.md'];
  for (const file of mdFiles) {
    const filePath = join(taskPath, file);
    if (await pathExists(filePath)) {
      const content = await readFile(filePath, 'utf-8');
      if (content.length < 100) {
        result.warnings.push({
          file: filePath,
          issue: `Content too short (${content.length} chars), may be incomplete`,
          severity: 'warning'
        });
      }
      if (!content.includes('##') && content.length > 0) {
        result.warnings.push({
          file: filePath,
          issue: 'Missing section headers (##)',
          severity: 'warning'
        });
      }

      // ── 端专业性内容检查 ──
      if (file === '00-specs/TECH.md') {
        const hasApiDef = /\|?\s*(GET|POST|PUT|DELETE)\s+\//i.test(content) || /\/api\//i.test(content);
        const hasDataModel = /(CREATE TABLE|数据表|表结构|字段|entity|schema)/i.test(content);
        if (!hasApiDef && !hasDataModel) {
          result.warnings.push({
            file: filePath,
            issue: 'TECH.md missing API definitions and data model — 技术方案应包含接口定义和数据模型',
            severity: 'warning'
          });
        }
        const hasPageRoute = /(页面|路由|route|path|\/\w+)/i.test(content);
        const hasComponent = /(组件|component|模块|视图)/i.test(content);
        if (!hasPageRoute && !hasComponent) {
          result.warnings.push({
            file: filePath,
            issue: 'TECH.md missing frontend page/component definitions — 技术方案应包含前端页面路由和组件设计',
            severity: 'warning'
          });
        }
      }
    }
  }

  // v8.3.121+: 扫描端平铺结构下的子任务规格文件
  const EXCLUDE_DIRS_V = new Set(['00-specs', '_shared', '99-artifacts', '.meta']);
  try {
    const entries = await readdir(taskPath, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || EXCLUDE_DIRS_V.has(e.name)) continue;
      const platformPath = join(taskPath, e.name);
      const subEntries = await readdir(platformPath, { withFileTypes: true });
      for (const sub of subEntries) {
        if (!sub.isDirectory()) continue;
        const subtaskPath = join(platformPath, sub.name);
        for (const specFile of ['REQ.md', 'TECH.md']) {
          const filePath = join(subtaskPath, specFile);
          if (!(await pathExists(filePath))) continue;
          const content = await readFile(filePath, 'utf-8');
          if (content.length < 100) {
            result.warnings.push({
              file: filePath,
              issue: `Content too short (${content.length} chars), may be incomplete`,
              severity: 'warning'
            });
          }
        }
      }
    }
  } catch { /* 跳过 */ }
  
  // Calculate task pass rate
  const total = result.errors.length + result.warnings.length;
  if (total > 0) {
    result.passRate = Math.round(((total - result.errors.length) / total) * 100);
  } else {
    result.passRate = 100;
  }
  
  return result;
}

async function findIterations(): Promise<string[]> {
  const { pathExists, readdir } = await import('fs-extra');
  
  if (!(await pathExists('.'))) return [];
  
  const entries = await readdir('.', { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory() && e.name.startsWith('Iteration-'))
    .map(e => e.name.replace('Iteration-', ''));
}

async function findTasks(iteration: string): Promise<string[]> {
  const { pathExists, readdir } = await import('fs-extra');
  const { join } = await import('path');
  
  const iterPath = `Iteration-${iteration}`;
  if (!(await pathExists(iterPath))) return [];
  
  const entries = await readdir(iterPath, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory() && e.name.startsWith('Task-'))
    .map(e => e.name);
}

export function formatValidationResult(result: ValidationResult, format: 'text' | 'json'): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }
  
  const lines: string[] = [];
  lines.push('📋 Spec Compliance Validation Result');
  lines.push('');
  lines.push(`Pass Rate: ${result.passRate}%`);
  lines.push(`Total Checks: ${result.totalChecks}`);
  lines.push(`Errors: ${result.errors.length}`);
  lines.push(`Warnings: ${result.warnings.length}`);
  lines.push('');
  
  if (result.errors.length > 0) {
    lines.push('❌ Errors:');
    for (const error of result.errors) {
      lines.push(`  [${error.severity.toUpperCase()}] ${error.file}: ${error.issue}`);
    }
    lines.push('');
  }
  
  if (result.warnings.length > 0) {
    lines.push('⚠️ Warnings:');
    for (const warning of result.warnings) {
      lines.push(`  [${warning.severity.toUpperCase()}] ${warning.file}: ${warning.issue}`);
    }
    lines.push('');
  }
  
  if (result.errors.length === 0 && result.warnings.length === 0) {
    lines.push('✅ All checks passed!');
  }
  
  return lines.join('\n');
}

export async function autoFix(result: ValidationResult): Promise<number> {
  let fixedCount = 0;
  
  for (const error of result.errors) {
    if (!error.fixable) continue;
    
    // Try to fix missing files by creating them
    if (error.issue.includes('Missing')) {
      const { ensureDir, writeFile } = await import('fs-extra');
      const { dirname } = await import('path');
      
      await ensureDir(dirname(error.file));
      await writeFile(error.file, `# ${basename(error.file)}\n\n> Auto-generated by SpecCore\n`, 'utf-8');
      fixedCount++;
    }
  }
  
  return fixedCount;
}
