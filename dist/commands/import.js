"use strict";
/**
 * import - 多项目导入命令
 * 将存量项目导入到全量层（GLOBAL/PROJECTS/），填充全量需求和索引
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.importCommand = importCommand;
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
const logger_1 = require("../utils/logger");
const global_layer_1 = require("../core/global-layer");
const readline_1 = require("readline");
function promptUser(question) {
    const rl = (0, readline_1.createInterface)({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(`${question} `, answer => { rl.close(); resolve(answer.trim()); });
    });
}
async function importCommand(options) {
    const spinner = new logger_1.Spinner('Importing project to global layer');
    spinner.start();
    try {
        // 新逻辑：多项目导入到全量层
        if (options.project) {
            const projectName = options.project;
            const projectPath = options.path || `./${projectName}`;
            const projectType = (options.type || 'backend');
            await importToGlobalLayer(projectName, projectPath, projectType, options);
            spinner.stop('Project imported to global layer');
            return;
        }
        // 兼容旧逻辑
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
/**
 * 多项目导入到全量层
 */
async function importToGlobalLayer(projectName, projectPath, projectType, options) {
    // 1. 检查路径
    if (!(await (0, fs_extra_1.pathExists)(projectPath))) {
        throw new Error(`Project path not found: ${projectPath}`);
    }
    // 2. 检查全局层是否已初始化
    const globalDir = (0, path_1.join)(process.cwd(), '.speccore', 'GLOBAL');
    if (!(await (0, fs_extra_1.pathExists)(globalDir))) {
        throw new Error('Global layer not initialized. Run: speccore init');
    }
    // 检测是否已导入（覆盖/增量判断）
    const existingDir = (0, path_1.join)(globalDir, 'PROJECTS', projectName);
    if (await (0, fs_extra_1.pathExists)(existingDir)) {
        if (options.force) {
            logger_1.logger.info('🔁 强制覆盖模式：已存在项目将被重新扫描替换');
        }
        else if (options.update) {
            logger_1.logger.info('🔄 增量更新模式：追加新 API，保留已有');
        }
        else if (options.interactive) {
            logger_1.logger.info(`⚠️ 项目 ${projectName} 已存在！`);
            const answer = await promptUser('选择 [o]覆盖/[u]增量/[c]取消：');
            if (answer === 'c') {
                logger_1.logger.info('已取消');
                return;
            }
            options.force = answer === 'o';
            options.update = answer === 'u';
        }
        else {
            logger_1.logger.warn(`⚠️ 项目 ${projectName} 已存在，使用 --update 增量或 --force 覆盖`);
            logger_1.logger.info('将跳过已有项目，使用 --update 追加新 API');
            options.update = true;
        }
    }
    // 3. 读取当前全量索引
    const index = await (0, global_layer_1.readGlobalIndex)();
    // 3.5 检测 Excel/CSV 文件 → 直接解析为需求
    let scanResult = { apis: [], models: [], techStack: '', repoUrl: '' };
    let fromFile = false;
    const ext = projectPath.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx' || ext === 'csv') {
        logger_1.logger.info(`📊 从 ${ext.toUpperCase()} 文件导入需求...`);
        try {
            if (ext === 'xlsx') {
                const XLSX = require('xlsx');
                const wb = XLSX.readFile((0, path_1.join)(process.cwd(), projectPath));
                const ws = wb.Sheets[wb.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
                scanResult.apis = rows.slice(1)
                    .filter((r) => r.some((c) => c))
                    .map((r) => ({
                    method: 'REQ',
                    path: String(r[0] || ''),
                    name: String(r[1] || r[0] || ''),
                    description: r.slice(1).filter((c) => c).join(' — '),
                    sourceFile: projectPath,
                }));
            }
            else {
                const content = await (0, fs_extra_1.readFile)((0, path_1.join)(process.cwd(), projectPath), 'utf-8');
                const lines = content.split('\n').filter(l => l.trim());
                scanResult.apis = lines.map(l => {
                    const parts = l.split(',').map(p => p.trim());
                    return {
                        method: 'REQ',
                        path: parts[0] || '',
                        name: parts[1] || parts[0] || '',
                        description: parts.join(' — '),
                        sourceFile: projectPath,
                    };
                });
            }
            fromFile = true;
            logger_1.logger.info(`   解析到 ${scanResult.apis.length} 条需求`);
        }
        catch (e) {
            throw new Error(`文件解析失败: ${e.message}`);
        }
    }
    // 4. 扫描项目代码（非文件模式）
    if (!fromFile) {
        logger_1.logger.info(`🔍 Scanning project: ${projectName} (${projectType})`);
        scanResult = await scanProject(projectPath, projectType, options);
        logger_1.logger.info(`   Found ${scanResult.apis.length} API endpoints, ${scanResult.models.length} data models`);
        // ── Interactive preview: 预览扫描结果 → 用户确认/调整 ──
        if (options.interactive && scanResult.apis.length > 0) {
            logger_1.logger.info('');
            logger_1.logger.info('📋 扫描结果预览:');
            logger_1.logger.info(`   项目: ${projectName} | 类型: ${projectType}`);
            logger_1.logger.info(`   技术栈: ${scanResult.techStack || '未检测到'}`);
            logger_1.logger.info(`   API 端点: ${scanResult.apis.length} 个`);
            logger_1.logger.info('');
            for (const api of scanResult.apis) {
                logger_1.logger.info(`   ${api.method.padEnd(8)} ${api.path.padEnd(30)} → ${api.sourceFile}`);
            }
            logger_1.logger.info('');
            logger_1.logger.info('💡 [y] 确认导入  [a] 新增遗漏  [s] 跳过某个  [q] 取消');
            const answer = await promptUser('确认导入？');
            if (answer?.toLowerCase() === 'q') {
                logger_1.logger.info('已取消');
                return;
            }
            if (answer?.toLowerCase() === 'a') {
                logger_1.logger.info('请在 REQUIREMENT.md 生成后手动补充遗漏的 API 端点');
            }
            if (answer?.toLowerCase() === 's') {
                const resp = await promptUser('请输入要跳过的 API 路径（逗号分隔，留空则全部保留）：');
                if (resp) {
                    const skipPaths = resp.split(',').map(s => s.trim());
                    scanResult.apis = scanResult.apis.filter(a => !skipPaths.includes(a.path));
                    logger_1.logger.info(`已跳过 ${skipPaths.length} 个 API，保留 ${scanResult.apis.length} 个`);
                }
            }
        }
    } // close if (!fromFile)
    // 5. 生成需求条目
    const requirements = [];
    let nextId = parseInt((0, global_layer_1.getNextReqId)(index).replace('REQ-', ''), 10);
    for (const api of scanResult.apis) {
        const reqId = `REQ-${String(nextId++).padStart(3, '0')}`;
        requirements.push({
            id: reqId,
            name: api.name,
            description: `API: ${api.method} ${api.path}${api.sourceFile ? ` (${api.sourceFile})` : ''}\n<!-- AI-ANALYZE: 分析 ${api.path} 的功能职责、输入输出、业务规则 -->\n${api.description || '从代码扫描提取的 API 端点，待 AI 分析补充'}`,
        });
    }
    // 如果没有扫描到 API，生成一个占位需求
    if (requirements.length === 0) {
        const reqId = `REQ-${String(nextId++).padStart(3, '0')}`;
        requirements.push({
            id: reqId,
            name: `${projectName} 项目导入`,
            description: `从 ${projectPath} 导入的项目，类型: ${projectType}`,
        });
    }
    // 6. 创建项目目录和文件
    await (0, global_layer_1.ensureProjectDir)(projectName);
    const entries = await (0, global_layer_1.writeProjectRequirements)(projectName, projectType, requirements, scanResult.techStack);
    await (0, global_layer_1.writeProjectMetadata)(projectName, projectType, scanResult.techStack, scanResult.repoUrl);
    // 7. 更新全量索引
    for (const entry of entries) {
        await (0, global_layer_1.appendReqToIndex)(entry);
    }
    await (0, global_layer_1.upsertProjectInIndex)({
        name: projectName,
        type: projectType,
        reqCount: entries.length,
        implemented: entries.filter((e) => e.status === '📦 已有实现').length,
        inProgress: 0,
        pending: 0,
        lastImport: new Date().toISOString().split('T')[0],
    });
    // 8. 更新版本
    const newVersion = (0, global_layer_1.bumpGlobalVersion)(index.version);
    await (0, global_layer_1.updateIndexVersion)(newVersion);
    // 9. 更新 OVERVIEW.md 和 CHANGELOG.md
    await updateGlobalOverview(projectName, projectType);
    await updateGlobalChangelog(`导入项目 ${projectName}`, newVersion);
    // 10. 检测并建议更新宪法（CONSTITUTION.md）
    await suggestConstitutionUpdate(projectName, projectType, scanResult.techStack);
    // 11. 生成 AI 分析指引（供 Slash Command 使用）
    await generateAnalysisPrompt(projectName, projectType, scanResult, projectPath);
    // 10. 输出报告
    logger_1.logger.info('');
    logger_1.logger.info('✅ 项目导入完成！');
    logger_1.logger.info('');
    logger_1.logger.info('📊 导入摘要:');
    logger_1.logger.info(`   项目名称: ${projectName}`);
    logger_1.logger.info(`   项目类型: ${projectType}`);
    logger_1.logger.info(`   识别接口: ${scanResult.apis.length} 个`);
    logger_1.logger.info(`   数据模型: ${scanResult.models.length} 个`);
    logger_1.logger.info(`   生成需求: ${entries.map((e) => e.id).join(', ')}`);
    logger_1.logger.info('');
    logger_1.logger.info('📁 已创建:');
    logger_1.logger.info(`   GLOBAL/PROJECTS/${projectName}/REQUIREMENT.md`);
    logger_1.logger.info(`   GLOBAL/PROJECTS/${projectName}/METADATA.md`);
    logger_1.logger.info('');
    logger_1.logger.info('📋 已更新:');
    logger_1.logger.info('   GLOBAL/INDEX.md（需求映射 + 项目列表）');
    logger_1.logger.info('   GLOBAL/OVERVIEW.md');
    logger_1.logger.info('');
    logger_1.logger.info('📋 下一步:');
    logger_1.logger.info('   speccore global-status  查看全量层状态');
    logger_1.logger.info('   speccore iteration-from-global  从全量层生成期次');
}
async function scanProject(projectPath, projectType, options) {
    const result = {
        apis: [],
        models: [],
        techStack: '',
        repoUrl: '',
    };
    const absPath = (0, path_1.join)(process.cwd(), projectPath);
    // Handle --scope and --ignore
    const scope = options?.scope || 'all';
    const ignores = (options?.ignore || '').split(',').filter(Boolean).map(s => s.trim());
    if (projectType === 'backend') {
        // 扫描后端项目
        // 尝试读取 pom.xml (Java/Maven)
        const pomPath = (0, path_1.join)(absPath, 'pom.xml');
        if (await (0, fs_extra_1.pathExists)(pomPath)) {
            const pom = await (0, fs_extra_1.readFile)(pomPath, 'utf-8');
            const groupMatch = pom.match(/<groupId>([^<]+)<\/groupId>/);
            const artifactMatch = pom.match(/<artifactId>([^<]+)<\/artifactId>/);
            if (groupMatch && artifactMatch) {
                result.techStack = `Java Maven: ${groupMatch[1]}:${artifactMatch[1]}`;
            }
        }
        // 扫描 package.json (Node.js)
        const pkgPath = (0, path_1.join)(absPath, 'package.json');
        if (await (0, fs_extra_1.pathExists)(pkgPath)) {
            const pkg = JSON.parse(await (0, fs_extra_1.readFile)(pkgPath, 'utf-8'));
            result.techStack = `Node.js: ${pkg.name || 'unnamed'}`;
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            if (deps['@nestjs/core'])
                result.techStack += ' (NestJS)';
            else if (deps['express'])
                result.techStack += ' (Express)';
        }
        // 扫描 src/ 目录寻找 Controller/路由
        const srcDir = (0, path_1.join)(absPath, 'src');
        if (await (0, fs_extra_1.pathExists)(srcDir)) {
            result.apis = await scanApiEndpoints(srcDir, ignores, scope);
        }
    }
    else if (['web', 'h5', 'miniapp'].includes(projectType)) {
        // 扫描前端项目
        const pkgPath = (0, path_1.join)(absPath, 'package.json');
        if (await (0, fs_extra_1.pathExists)(pkgPath)) {
            const pkg = JSON.parse(await (0, fs_extra_1.readFile)(pkgPath, 'utf-8'));
            result.techStack = `${projectType}: ${pkg.name || 'unnamed'}`;
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            if (deps['vue'])
                result.techStack += ' (Vue)';
            else if (deps['react'])
                result.techStack += ' (React)';
            else if (deps['@angular/core'])
                result.techStack += ' (Angular)';
            // 扫描 pages/ 目录
            const pagesDir = (0, path_1.join)(absPath, 'src', 'pages');
            if (await (0, fs_extra_1.pathExists)(pagesDir)) {
                const pages = await (0, fs_extra_1.readdir)(pagesDir, { withFileTypes: true });
                for (const page of pages.filter((p) => p.isDirectory())) {
                    result.apis.push({
                        method: 'PAGE',
                        path: `/${page.name}`,
                        name: `${page.name} 页面`,
                        description: `${projectType} 页面`,
                        sourceFile: `src/pages/${page.name}`,
                    });
                }
            }
        }
    }
    return result;
}
/**
 * 递归扫描 API 端点
 */
async function scanApiEndpoints(srcDir, ignores = [], scope = 'all') {
    const apis = [];
    async function scan(dir) {
        if (!(await (0, fs_extra_1.pathExists)(dir)))
            return;
        const entries = await (0, fs_extra_1.readdir)(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = (0, path_1.join)(dir, entry.name);
            // 跳过忽略的包
            if (ignores.some(ign => fullPath.includes(ign)))
                continue;
            if (entry.isDirectory()) {
                await scan(fullPath);
            }
            else if ([
                '.java', '.ts', '.js', '.go', '.py',
            ].includes((0, path_1.extname)(entry.name))) {
                // scope 过滤
                if (scope === 'core' && !fullPath.includes('controller') && !fullPath.includes('service'))
                    continue;
                if (scope === 'api' && !fullPath.includes('controller') && !fullPath.includes('route'))
                    continue;
                const content = await (0, fs_extra_1.readFile)(fullPath, 'utf-8');
                const relativePath = fullPath.replace(process.cwd() + '/', '');
                // 类级路径前缀 (Spring @RequestMapping, NestJS @Controller)
                let classPrefix = '';
                const classMapping = content.match(/@(?:RequestMapping|Controller)\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/);
                if (classMapping)
                    classPrefix = classMapping[1];
                // Java Spring
                const javaMatches = content.matchAll(/@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*(?:\([^)]*\))?\s*(?:@[^(\n]*\s*)*(?:public\s+\S+\s+)?(\w+)\s*\(/g);
                for (const match of javaMatches) {
                    const annMethod = match[1];
                    const funcName = match[2];
                    const pathMatch = content.substring(match.index || 0, (match.index || 0) + 200).match(/@\w+Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/);
                    let apiPath = pathMatch ? pathMatch[1] : '/';
                    apiPath = classPrefix + apiPath; // 合并类级路径
                    apis.push({
                        method: annMethod.replace('Mapping', '').toUpperCase(),
                        path: apiPath,
                        name: funcName ? funcName.replace(/([A-Z])/g, ' $1').trim() : apiPath,
                        description: `从 ${entry.name} 扫描到的 API 端点`,
                        sourceFile: relativePath,
                    });
                }
                // TypeScript NestJS
                const tsMatches = content.matchAll(/@(Get|Post|Put|Delete|Patch)\s*\(\s*(?:['"]([^'"]*)['"]\s*)?\)/g);
                for (const match of tsMatches) {
                    apis.push({
                        method: match[1],
                        path: classPrefix + (match[2] || '/'),
                        name: match[2] ? match[2].replace(/^\//, '').replace(/\//g, ' ') : 'API',
                        description: `从 ${entry.name} 扫描到的 NestJS 端点`,
                        sourceFile: relativePath,
                    });
                }
                // Express routes
                const expressMatches = content.matchAll(/(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g);
                for (const match of expressMatches) {
                    apis.push({
                        method: match[1].toUpperCase(),
                        path: classPrefix + match[2],
                        name: match[2].replace(/^\//, '').replace(/\//g, ' '),
                        description: `从 ${entry.name} 扫描到的 Express 路由`,
                        sourceFile: relativePath,
                    });
                }
            }
        }
    }
    await scan(srcDir);
    return apis;
}
// ============================================================
// 全局文件更新
// ============================================================
async function updateGlobalOverview(projectName, projectType) {
    const overviewPath = (0, path_1.join)(process.cwd(), '.speccore', 'GLOBAL', 'OVERVIEW.md');
    if (!(await (0, fs_extra_1.pathExists)(overviewPath)))
        return;
    let content = await (0, fs_extra_1.readFile)(overviewPath, 'utf-8');
    const today = new Date().toISOString().split('T')[0];
    const newEntry = `| ${projectName} | ${projectType} | 已导入 | - |`;
    if (content.includes('_待导入_')) {
        content = content.replace('| _待导入_ | - | - | - |', newEntry);
    }
    await (0, fs_extra_1.writeFile)(overviewPath, content);
}
async function updateGlobalChangelog(description, version) {
    const changelogPath = (0, path_1.join)(process.cwd(), '.speccore', 'GLOBAL', 'CHANGELOG.md');
    if (!(await (0, fs_extra_1.pathExists)(changelogPath)))
        return;
    let content = await (0, fs_extra_1.readFile)(changelogPath, 'utf-8');
    const today = new Date().toISOString().split('T')[0];
    const newEntry = `| ${today} | ${version} | 导入 | ${description} | SpecCore |`;
    if (content.includes('_暂无记录_')) {
        content = content.replace('| _暂无记录_ | v1.0 | 创建 | 全量层模板初始化 | - |', newEntry);
    }
    else {
        // 在变更记录表后面追加
        const firstEntry = content.indexOf('|', content.indexOf('## 变更记录'));
        const endOfLine = content.indexOf('\n', firstEntry);
        if (endOfLine > 0) {
            content = content.slice(0, endOfLine + 1) + newEntry + '\n' + content.slice(endOfLine + 1);
        }
    }
    await (0, fs_extra_1.writeFile)(changelogPath, content);
}
// ============================================================
// 旧版兼容函数
// ============================================================
async function importCode(sourcePath) {
    if (!(await (0, fs_extra_1.pathExists)(sourcePath))) {
        throw new Error(`Path not found: ${sourcePath}`);
    }
    const statsObj = await (0, fs_extra_1.stat)(sourcePath);
    if (!statsObj.isDirectory()) {
        throw new Error(`Path must be a directory: ${sourcePath}`);
    }
    const entries = await (0, fs_extra_1.readdir)(sourcePath, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && ['.java', '.ts', '.js', '.py', '.go'].includes((0, path_1.extname)(e.name)));
    logger_1.logger.info(`Legacy mode: Found ${files.length} source files.`);
    logger_1.logger.info('💡 Tip: Use speccore import --project=<name> --path=<path> --type=<type> for global layer import.');
    return `Found ${files.length} source files in ${sourcePath}`;
}
async function importPRD(prdPath) {
    if (!(await (0, fs_extra_1.pathExists)(prdPath))) {
        throw new Error(`PRD file not found: ${prdPath}`);
    }
    const content = await (0, fs_extra_1.readFile)(prdPath, 'utf-8');
    const requirements = extractRequirements(content);
    logger_1.logger.info(`Extracted ${requirements.length} requirements (legacy mode)`);
    return `Imported PRD from ${prdPath}: ${requirements.length} requirements`;
}
function extractRequirements(content) {
    const requirements = [];
    const patterns = [
        /(?:需求|Requirement)\s*[:：]\s*(.+)/g,
        /(?:功能|Feature)\s*[:：]\s*(.+)/g,
        /\d+\.\s+(.+)/g,
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
    logger_1.logger.info('💡 Tip: Use speccore import --project=<name> --path=<path> --type=<type> for global layer import.');
    logger_1.logger.info('Auto-detecting project structure...');
    const results = [];
    if (await (0, fs_extra_1.pathExists)((0, path_1.join)(sourcePath, 'src'))) {
        results.push(await importCode(sourcePath));
    }
    const prdFiles = ['PRD.md', 'README.md', 'docs/PRD.md'];
    for (const prdFile of prdFiles) {
        if (await (0, fs_extra_1.pathExists)((0, path_1.join)(sourcePath, prdFile))) {
            results.push(await importPRD((0, path_1.join)(sourcePath, prdFile)));
            break;
        }
    }
    return results.join('\n');
}
// ============================================================
// 宪法建议更新
// ============================================================
async function suggestConstitutionUpdate(projectName, projectType, techStack) {
    const constPath = (0, path_1.join)(process.cwd(), '.speccore', 'CONSTITUTION.md');
    if (!(await (0, fs_extra_1.pathExists)(constPath)))
        return;
    let content = await (0, fs_extra_1.readFile)(constPath, 'utf-8');
    // 构建建议内容
    const suggestions = [];
    // 检测已存在的技术栈，避免重复
    if (!content.includes(projectName)) {
        suggestions.push(`### ${projectName} (${projectType})`);
        suggestions.push(`- 来源: 自动检测自项目导入`);
        suggestions.push(`- 技术栈: ${techStack}`);
    }
    // 框架检测 → 规则建议
    if (techStack.includes('NestJS') && !content.includes('NestJS')) {
        suggestions.push('- 框架: NestJS → 推荐 JWT + Passport 认证，DTO 校验用 class-validator');
    }
    else if (techStack.includes('Spring') && !content.includes('Spring Boot')) {
        suggestions.push('- 框架: Spring Boot → 推荐统一异常 @ControllerAdvice');
    }
    else if (techStack.includes('Vue') && !content.includes('Vue')) {
        suggestions.push('- 框架: Vue → 推荐 Composition API + Pinia 状态管理');
    }
    else if (techStack.includes('React') && !content.includes('React')) {
        suggestions.push('- 框架: React → 推荐 Hooks + zustand 状态管理');
    }
    if (suggestions.length === 0)
        return;
    // 追加到宪法末尾
    content += `\n\n<!-- 自动检测自 import ${projectName} (${new Date().toISOString().split('T')[0]}) -->\n`;
    content += suggestions.join('\n') + '\n';
    await (0, fs_extra_1.writeFile)(constPath, content);
    logger_1.logger.info('   📋 建议已追加到 CONSTITUTION.md（框架自动检测）');
}
// ============================================================
// AI 分析指引（供 Slash Command 使用）
// ============================================================
async function generateAnalysisPrompt(projectName, projectType, scanResult, projectPath) {
    const projectDir = (0, path_1.join)(process.cwd(), '.speccore', 'GLOBAL', 'PROJECTS', projectName);
    if (!(await (0, fs_extra_1.pathExists)(projectDir)))
        return;
    const apis = scanResult.apis;
    const promptPath = (0, path_1.join)(projectDir, 'ANALYSIS_PROMPT.md');
    // 扫描工程文件树（前 3 层）
    const absSrcPath = (0, path_1.join)(process.cwd(), projectPath, 'src');
    const fileTree = await buildFileTree(absSrcPath);
    const content = `# AI 反工程分析任务: ${projectName}

> 本文档由 \`speccore import\` 自动生成。
> **目标：从源码倒推出完整的需求文档、技术方案、编码规范。**
> 用户触发 \`/spec-import-analyze\`，AI 按此指引完成。

## 项目信息
- 名称: ${projectName}
- 类型: ${projectType}
- 技术栈: ${scanResult.techStack || '未检测到（请检查 package.json/pom.xml）'}
- 源码路径: \`${projectPath}\`

## 工程文件树（src/ 前 3 层）
\`\`\`
${fileTree}
\`\`\`

---
## 第一步：深入源码反推需求

对每个扫描到的 API，**不仅要看 Controller，还要追溯 Service / Repository / Entity**：

${apis.map((api, i) => `\n### API ${i + 1}: ${api.method} ${api.path}
- **入口文件**: \`${api.sourceFile}\`
- **分析方式**:
  1. 读取入口文件的完整代码
  2. 如果 Controller 调用了 Service → 跳转到 Service 实现
  3. 如果 Service 操作了数据库 → 读取 Repository/DAO 和 Entity/Model
  4. 完整还原数据流转: 请求 → 校验 → 业务逻辑 → 持久化 → 响应`).join('\n')}

---
## 第二步：输出目标文件

### 2.1 需求文档 → \`PROJECTS/${projectName}/REQUIREMENT.md\`
${apis.map(api => `- **${api.method} ${api.path}**: 补充功能职责、参数校验、响应结构、业务规则`).join('\n')}

### 2.2 数据模型 → \`PROJECTS/${projectName}/SCHEMA.md\`
- 从 Entity/Model 文件提取所有数据表和字段
- 标注主键、索引、外键关系
- 绘制实体关系图（文字版）

### 2.3 技术方案 → \`PROJECTS/${projectName}/TECH.md\`
- 架构分层（Controller → Service → Repository）
- 关键设计决策（为什么要这么分层）
- 外部依赖（Redis/消息队列/第三方服务）
- 🚀 仅生成骨架，建议后续增强或选择性覆盖

### 2.4 编码规则 → \`RULES/\`
| 文件 | 检测重点 |
| :--- | :--- |
| API_CONVENTIONS.md | URL 前缀、版本号、RESTful 风格、统一响应格式 |
| EXCEPTION_HANDLING.md | 异常基类、@ControllerAdvice、错误码枚举 |
| NAMING.md | 包名规则、类名/方法名模式 |
| AUTH.md | 认证方式（JWT/Session/OAuth）、权限模型 |

### 2.5 宪法更新 → \`CONSTITUTION.md\`
补充全局约束：数据库版本、ORM 框架、缓存策略、日志框架

---
## 第三步：结果验证

分析完成后，在 REQUIREMENT.md 末尾追加：
\`\`\`
✅ AI 反工程分析完成 (${new Date().toISOString().split('T')[0]})
- 分析 API: ${apis.length} 个
- 生成规则: RULES/ 目录下 4 个文件
- 分析模式: 从源码倒推（无原始需求文档）
\`\`\`
`;
    await (0, fs_extra_1.writeFile)(promptPath, content);
    logger_1.logger.info('   📋 生成 AI 分析指引: ANALYSIS_PROMPT.md');
    logger_1.logger.info('   💡 在 AI IDE 中输入 /spec-import-analyze 即可开始 AI 分析');
}
/**
 * 构建工程文件树（前 3 层）
 */
async function buildFileTree(srcDir, depth = 0, maxDepth = 3) {
    if (depth > maxDepth || !(await (0, fs_extra_1.pathExists)(srcDir)))
        return '';
    const lines = [];
    const entries = await (0, fs_extra_1.readdir)(srcDir, { withFileTypes: true });
    for (const entry of entries.slice(0, 20)) { // 限制每层 20 个
        const indent = '  '.repeat(depth);
        if (entry.isDirectory()) {
            lines.push(`${indent}📁 ${entry.name}/`);
            const subtree = await buildFileTree((0, path_1.join)(srcDir, entry.name), depth + 1, maxDepth);
            if (subtree)
                lines.push(subtree);
        }
        else {
            const ext = (0, path_1.extname)(entry.name);
            const emoji = ['.java', '.ts', '.js', '.go', '.py'].includes(ext) ? '📄' : '📎';
            lines.push(`${indent}${emoji} ${entry.name}`);
        }
    }
    if (depth > 0 && lines.length === 0)
        return '';
    return lines.join('\n');
}
//# sourceMappingURL=import.js.map