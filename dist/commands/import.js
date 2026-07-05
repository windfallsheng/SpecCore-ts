"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importCommand = importCommand;
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
const logger_1 = require("../utils/logger");
async function importCommand(options) {
    const spinner = new logger_1.Spinner('Importing project');
    spinner.start();
    try {
        const sources = (options.source || 'all').split(',');
        const results = [];
        for (const source of sources) {
            switch (source.trim()) {
                case 'code':
                    results.push(await importCode(options.path || './'));
                    break;
                case 'prd':
                    results.push(await importPRD(options.path || './PRD.md'));
                    break;
                case 'prototype':
                    results.push(await importPrototype(options.url || ''));
                    break;
                case 'all':
                    results.push(await autoDetectImport(options.path || './'));
                    break;
                default:
                    logger_1.logger.warn(`Unknown source type: ${source}`);
            }
        }
        spinner.stop('Import completed');
        for (const result of results) {
            logger_1.logger.info(result);
        }
    }
    catch (error) {
        spinner.fail(`Import failed: ${error}`);
        throw error;
    }
}
async function importCode(sourcePath) {
    if (!(await (0, fs_extra_1.pathExists)(sourcePath))) {
        throw new Error(`Path not found: ${sourcePath}`);
    }
    const stats = await (0, fs_extra_1.stat)(sourcePath);
    if (!stats.isDirectory()) {
        throw new Error(`Path must be a directory: ${sourcePath}`);
    }
    // Scan for API files
    const entries = await (0, fs_extra_1.readdir)(sourcePath, { withFileTypes: true });
    const files = entries.filter(e => e.isFile() &&
        ['.java', '.ts', '.js', '.py', '.go'].includes((0, path_1.extname)(e.name)));
    const summary = `Found ${files.length} source files in ${sourcePath}`;
    logger_1.logger.info(summary);
    // Generate API contracts from source code
    for (const file of files) {
        const content = await (0, fs_extra_1.readFile)((0, path_1.join)(sourcePath, file.name), 'utf-8');
        // Detect API endpoints (simple regex matching)
        const endpointMatches = content.matchAll(/@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*["']([^"']+)/g);
        for (const match of endpointMatches) {
            logger_1.logger.info(`  Detected endpoint: ${match[2]} (${match[1]})`);
        }
    }
    return summary;
}
async function importPRD(prdPath) {
    if (!(await (0, fs_extra_1.pathExists)(prdPath))) {
        throw new Error(`PRD file not found: ${prdPath}`);
    }
    const content = await (0, fs_extra_1.readFile)(prdPath, 'utf-8');
    // Extract requirements
    const requirements = extractRequirements(content);
    logger_1.logger.info(`Extracted ${requirements.length} requirements`);
    return `Imported PRD from ${prdPath}: ${requirements.length} requirements extracted`;
}
function extractRequirements(content) {
    const requirements = [];
    // Match common requirement patterns
    const patterns = [
        /(?:需求|Requirement)\s*[:：]\s*(.+)/g,
        /(?:功能|Feature)\s*[:：]\s*(.+)/g,
        /\d+\.\s+(.+)/g
    ];
    for (const pattern of patterns) {
        const matches = content.matchAll(pattern);
        for (const match of matches) {
            requirements.push(match[1].trim());
        }
    }
    return requirements;
}
async function importPrototype(url) {
    if (!url) {
        throw new Error('Prototype URL is required');
    }
    logger_1.logger.info(`Importing prototype from ${url}`);
    return `Prototype imported from ${url}`;
}
async function autoDetectImport(sourcePath) {
    logger_1.logger.info('Auto-detecting project structure...');
    const results = [];
    // Check for code
    if (await (0, fs_extra_1.pathExists)((0, path_1.join)(sourcePath, 'src'))) {
        results.push(await importCode(sourcePath));
    }
    // Check for PRD
    const prdFiles = ['PRD.md', 'README.md', 'docs/PRD.md'];
    for (const prdFile of prdFiles) {
        if (await (0, fs_extra_1.pathExists)((0, path_1.join)(sourcePath, prdFile))) {
            results.push(await importPRD((0, path_1.join)(sourcePath, prdFile)));
            break;
        }
    }
    return results.join('\n');
}
//# sourceMappingURL=import.js.map