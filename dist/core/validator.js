"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateProject = validateProject;
exports.formatValidationResult = formatValidationResult;
exports.autoFix = autoFix;
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
const yaml_parser_1 = require("./yaml-parser");
async function validateProject(iteration, taskId, options) {
    const result = {
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
    }
    else {
        result.passRate = 100;
    }
    return result;
}
async function validateTask(iteration, taskId, options) {
    const result = {
        taskId,
        errors: [],
        warnings: [],
        passRate: 0
    };
    const taskPath = (0, path_1.join)(`期次-${iteration}`, taskId);
    // Check if task directory exists
    if (!(await (0, fs_extra_1.pathExists)(taskPath))) {
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
        const filePath = (0, path_1.join)(taskPath, file);
        if (!(await (0, fs_extra_1.pathExists)(filePath))) {
            if (options?.strict) {
                result.errors.push({
                    file: filePath,
                    issue: `Missing required file: ${file}`,
                    severity: 'error',
                    fixable: true
                });
            }
            else if (file.includes('backend/') || file.includes('frontend/')) {
                // In non-strict mode, only backend OR frontend is required
                const counterpart = file.replace('backend/', 'frontend/').replace('frontend/', 'backend/');
                const counterpartPath = (0, path_1.join)(taskPath, counterpart);
                if (!(await (0, fs_extra_1.pathExists)(counterpartPath))) {
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
    const yamlPath = (0, path_1.join)(taskPath, '_shared', 'API_CONTRACT.yaml');
    if (await (0, fs_extra_1.pathExists)(yamlPath)) {
        const parseResult = await (0, yaml_parser_1.parseYamlFile)(yamlPath);
        if (!parseResult.success) {
            result.errors.push({
                file: yamlPath,
                issue: parseResult.error || 'Invalid YAML',
                severity: 'error',
                fixable: false
            });
        }
        else if (parseResult.data) {
            const yamlErrors = (0, yaml_parser_1.validateApiContract)(parseResult.data);
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
        const filePath = (0, path_1.join)(taskPath, file);
        if (await (0, fs_extra_1.pathExists)(filePath)) {
            const content = await (0, fs_extra_1.readFile)(filePath, 'utf-8');
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
    }
    else {
        result.passRate = 100;
    }
    return result;
}
async function findIterations() {
    const { pathExists, readdir } = await Promise.resolve().then(() => __importStar(require('fs-extra')));
    if (!(await pathExists('.')))
        return [];
    const entries = await readdir('.', { withFileTypes: true });
    return entries
        .filter(e => e.isDirectory() && e.name.startsWith('期次-'))
        .map(e => e.name.replace('期次-', ''));
}
async function findTasks(iteration) {
    const { pathExists, readdir } = await Promise.resolve().then(() => __importStar(require('fs-extra')));
    const { join } = await Promise.resolve().then(() => __importStar(require('path')));
    const iterPath = `期次-${iteration}`;
    if (!(await pathExists(iterPath)))
        return [];
    const entries = await readdir(iterPath, { withFileTypes: true });
    return entries
        .filter(e => e.isDirectory() && e.name.startsWith('Task-'))
        .map(e => e.name);
}
function formatValidationResult(result, format) {
    if (format === 'json') {
        return JSON.stringify(result, null, 2);
    }
    const lines = [];
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
async function autoFix(result) {
    let fixedCount = 0;
    for (const error of result.errors) {
        if (!error.fixable)
            continue;
        // Try to fix missing files by creating them
        if (error.issue.includes('Missing')) {
            const { ensureDir, writeFile } = await Promise.resolve().then(() => __importStar(require('fs-extra')));
            const { dirname } = await Promise.resolve().then(() => __importStar(require('path')));
            await ensureDir(dirname(error.file));
            await writeFile(error.file, `# ${(0, path_1.basename)(error.file)}\n\n> Auto-generated by SpecCore CLI\n`, 'utf-8');
            fixedCount++;
        }
    }
    return fixedCount;
}
//# sourceMappingURL=validator.js.map