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
exports.readProjectGraph = readProjectGraph;
exports.scanTasks = scanTasks;
exports.calculateCompletionRate = calculateCompletionRate;
exports.buildDependencyGraph = buildDependencyGraph;
exports.topologicalSort = topologicalSort;
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
async function readProjectGraph(iteration) {
    const graphPath = (0, path_1.join)(`期次-${iteration}`, '00-期次总览', 'PROJECT_GRAPH.md');
    if (!(await (0, fs_extra_1.pathExists)(graphPath))) {
        return {
            name: iteration,
            status: 'unknown',
            startDate: '',
            endDate: '',
            tasks: [],
            completionRate: 0
        };
    }
    const content = await (0, fs_extra_1.readFile)(graphPath, 'utf-8');
    return parseProjectGraph(content, iteration);
}
function parseProjectGraph(content, iterationName) {
    const state = {
        name: iterationName,
        status: 'unknown',
        startDate: '',
        endDate: '',
        tasks: [],
        completionRate: 0
    };
    // Extract status from markdown
    const statusMatch = content.match(/期次状态[:：]\s*(.+)/);
    if (statusMatch) {
        state.status = statusMatch[1].trim();
    }
    // Extract date range
    const dateMatch = content.match(/时间范围[:：]\s*(\d{4}-\d{2}-\d{2})\s*[~～]\s*(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
        state.startDate = dateMatch[1];
        state.endDate = dateMatch[2];
    }
    // Parse tasks table
    const taskMatches = content.matchAll(/\|\s*(Task-\d+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*(\d+)%?\s*\|\s*(\S+)\s*\|\s*([^|]+)\s*\|/g);
    for (const match of taskMatches) {
        state.tasks.push({
            id: match[1].trim(),
            name: match[2].trim(),
            type: match[3].trim(),
            progress: parseInt(match[4]) || 0,
            status: parseStatus(match[5].trim()),
            assignee: match[6].trim(),
            dependencies: [],
            priority: 'medium'
        });
    }
    // Calculate completion rate
    if (state.tasks.length > 0) {
        const completed = state.tasks.filter(t => t.status === 'completed').length;
        state.completionRate = Math.round((completed / state.tasks.length) * 100);
    }
    return state;
}
function parseStatus(status) {
    if (status.includes('已完成') || status.includes('completed'))
        return 'completed';
    if (status.includes('进行中') || status.includes('in_progress'))
        return 'in_progress';
    if (status.includes('已归档') || status.includes('archived'))
        return 'archived';
    return 'pending';
}
async function scanTasks(iteration) {
    const { pathExists, readdir } = await Promise.resolve().then(() => __importStar(require('fs-extra')));
    const { join } = await Promise.resolve().then(() => __importStar(require('path')));
    const iterationDir = `期次-${iteration}`;
    if (!(await pathExists(iterationDir))) {
        return [];
    }
    const entries = await readdir(iterationDir, { withFileTypes: true });
    const tasks = [];
    for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('Task-')) {
            const taskId = entry.name;
            const taskPath = join(iterationDir, taskId);
            // Try to read task type
            let type = 'feature';
            const typePath = join(taskPath, '.task-type');
            if (await pathExists(typePath)) {
                const typeContent = await (0, fs_extra_1.readFile)(typePath, 'utf-8');
                type = typeContent.trim();
            }
            // Try to read task name from TASK.md
            let name = taskId;
            const taskMdPath = join(taskPath, 'backend', 'TASK.md');
            if (await pathExists(taskMdPath)) {
                const taskMd = await (0, fs_extra_1.readFile)(taskMdPath, 'utf-8');
                const nameMatch = taskMd.match(/#\s+(.+)/);
                if (nameMatch) {
                    name = nameMatch[1].trim();
                }
            }
            tasks.push({
                id: taskId,
                name,
                type,
                status: 'pending',
                assignee: '',
                dependencies: [],
                priority: 'medium',
                progress: 0
            });
        }
    }
    return tasks;
}
function calculateCompletionRate(tasks) {
    if (tasks.length === 0)
        return 0;
    const completed = tasks.filter(t => t.status === 'completed').length;
    return Math.round((completed / tasks.length) * 100);
}
function buildDependencyGraph(tasks) {
    const graph = new Map();
    for (const task of tasks) {
        graph.set(task.id, task.dependencies);
    }
    return graph;
}
function topologicalSort(tasks) {
    const graph = buildDependencyGraph(tasks);
    const visited = new Set();
    const result = [];
    function visit(taskId) {
        if (visited.has(taskId))
            return;
        visited.add(taskId);
        const deps = graph.get(taskId) || [];
        for (const dep of deps) {
            visit(dep);
        }
        const task = tasks.find(t => t.id === taskId);
        if (task) {
            result.push(task);
        }
    }
    for (const task of tasks) {
        visit(task.id);
    }
    return result;
}
//# sourceMappingURL=state.js.map