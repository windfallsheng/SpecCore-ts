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
  
  const taskPath = join(`期次-${iteration}`, taskId);
  
  // Check if task directory exists
  if (!(await pathExists(taskPath))) {
    result.errors.push({
      file: taskPath,
      issue: 'Task directory does not exist',
      severity: 'error'
    });
    return result;
  }
  
  // Check required files
  const requiredFiles = [
    '.task-type',
    'backend/REQ.md',
    'backend/TASK.md',
    'backend/TECH.md',
    'frontend/REQ.md',
    'frontend/TASK.md',
    'frontend/TECH.md'
  ];
  
  for (const file of requiredFiles) {
    const filePath = join(taskPath, file);
    if (!(await pathExists(filePath))) {
      if (options?.strict) {
        result.errors.push({
          file: filePath,
          issue: `Missing required file: ${file}`,
          severity: 'error',
          fixable: true
        });
      } else if (file.includes('backend/') || file.includes('frontend/')) {
        // In non-strict mode, only backend OR frontend is required
        const counterpart = file.replace('backend/', 'frontend/').replace('frontend/', 'backend/');
        const counterpartPath = join(taskPath, counterpart);
        if (!(await pathExists(counterpartPath))) {
          result.errors.push({
            file: filePath,
            issue: `Missing required file: ${file} (and ${counterpart})`,
            severity: 'error'
          });
        }
      }
    }
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
  const mdFiles = ['backend/REQ.md', 'backend/TECH.md', 'frontend/REQ.md', 'frontend/TECH.md'];
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
    }
  }
  
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
    .filter(e => e.isDirectory() && e.name.startsWith('期次-'))
    .map(e => e.name.replace('期次-', ''));
}

async function findTasks(iteration: string): Promise<string[]> {
  const { pathExists, readdir } = await import('fs-extra');
  const { join } = await import('path');
  
  const iterPath = `期次-${iteration}`;
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
