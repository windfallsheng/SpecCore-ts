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
exports.loadContext = loadContext;
exports.saveContext = saveContext;
exports.updateContext = updateContext;
exports.recordHistory = recordHistory;
exports.detectActiveIteration = detectActiveIteration;
exports.detectCurrentAssignee = detectCurrentAssignee;
exports.getDefaultIteration = getDefaultIteration;
exports.getDefaultAssignee = getDefaultAssignee;
const fs_extra_1 = require("fs-extra");
const CONTEXT_PATH = '.speccore/local/context.json';
async function loadContext() {
    if (await (0, fs_extra_1.pathExists)(CONTEXT_PATH)) {
        return await (0, fs_extra_1.readJson)(CONTEXT_PATH);
    }
    return {
        currentIteration: '',
        currentTask: '',
        currentAssignee: '',
        lastUpdated: '',
        history: []
    };
}
async function saveContext(context) {
    await (0, fs_extra_1.ensureDir)('.speccore/local');
    context.lastUpdated = new Date().toISOString();
    await (0, fs_extra_1.writeJson)(CONTEXT_PATH, context, { spaces: 2 });
}
async function updateContext(partial) {
    const context = await loadContext();
    Object.assign(context, partial);
    await saveContext(context);
}
async function recordHistory(command, iteration, task) {
    const context = await loadContext();
    context.history.push({
        command,
        timestamp: new Date().toISOString(),
        iteration,
        task
    });
    // Keep only last 100 entries
    if (context.history.length > 100) {
        context.history = context.history.slice(-100);
    }
    await saveContext(context);
}
async function detectActiveIteration() {
    const { pathExists, readFile } = await Promise.resolve().then(() => __importStar(require('fs-extra')));
    const { join } = await Promise.resolve().then(() => __importStar(require('path')));
    // First check context
    const context = await loadContext();
    if (context.currentIteration) {
        return context.currentIteration;
    }
    // Read ITERATIONS/README.md
    const iterationsPath = join('.speccore', 'ITERATIONS', 'README.md');
    if (!(await pathExists(iterationsPath))) {
        return '';
    }
    const content = await readFile(iterationsPath, 'utf-8');
    // Find iteration with 🔄 进行中 status
    const activeMatch = content.match(/\|\s*([^|]+)\s*\|[^|]*🔄/);
    if (activeMatch) {
        return activeMatch[1].trim();
    }
    // Find latest iteration
    const matches = content.matchAll(/\|\s*([^|]+)\s*\|/g);
    const iterations = [];
    for (const match of matches) {
        const name = match[1].trim();
        if (name && name !== '期次名称' && !name.startsWith('---')) {
            iterations.push(name);
        }
    }
    return iterations[iterations.length - 1] || '';
}
async function detectCurrentAssignee() {
    const context = await loadContext();
    if (context.currentAssignee) {
        return context.currentAssignee;
    }
    // Try git config
    try {
        const { execSync } = await Promise.resolve().then(() => __importStar(require('child_process')));
        return execSync('git config user.name', { encoding: 'utf-8' }).trim();
    }
    catch {
        return 'unknown';
    }
}
async function getDefaultIteration(iteration) {
    if (iteration)
        return iteration;
    return await detectActiveIteration();
}
async function getDefaultAssignee(assignee) {
    if (assignee)
        return assignee;
    return await detectCurrentAssignee();
}
//# sourceMappingURL=context.js.map