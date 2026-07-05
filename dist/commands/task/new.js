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
exports.taskNewCommand = taskNewCommand;
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
const logger_1 = require("../../utils/logger");
const context_1 = require("../../core/context");
async function taskNewCommand(options) {
    if (!options.name) {
        logger_1.logger.error('Task name is required. Use --name <name>');
        return;
    }
    const spinner = new logger_1.Spinner(`Creating task: ${options.name}`);
    spinner.start();
    try {
        const iteration = await (0, context_1.getDefaultIteration)(options.iteration);
        if (!iteration) {
            spinner.fail('No active iteration found. Please specify --iteration or create one first.');
            return;
        }
        const iterationDir = `期次-${iteration}`;
        // Determine task ID
        const taskId = options.id || await findNextTaskId(iterationDir);
        const taskDir = (0, path_1.join)(iterationDir, `Task-${taskId}`);
        if (await (0, fs_extra_1.pathExists)(taskDir)) {
            spinner.fail(`Task already exists: Task-${taskId}`);
            return;
        }
        // Create directories
        if (!options.frontendOnly) {
            await (0, fs_extra_1.ensureDir)((0, path_1.join)(taskDir, 'backend'));
        }
        if (!options.backendOnly) {
            await (0, fs_extra_1.ensureDir)((0, path_1.join)(taskDir, 'frontend'));
        }
        await (0, fs_extra_1.ensureDir)((0, path_1.join)(taskDir, '_shared'));
        // Write task type
        await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, '.task-type'), options.type || 'feature');
        // Generate task content
        const taskContent = await generateTaskContent(options);
        // Write backend files
        if (!options.frontendOnly) {
            await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', 'REQ.md'), taskContent.req);
            await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', 'TECH.md'), taskContent.tech);
            await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'backend', 'TASK.md'), taskContent.task);
        }
        // Write frontend files
        if (!options.backendOnly) {
            await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'frontend', 'REQ.md'), taskContent.req);
            await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'frontend', 'TECH.md'), taskContent.tech);
            await (0, fs_extra_1.writeFile)((0, path_1.join)(taskDir, 'frontend', 'TASK.md'), taskContent.task);
        }
        // Update context
        await (0, context_1.updateContext)({
            currentTask: `Task-${taskId}`,
            currentIteration: iteration,
            lastUpdated: new Date().toISOString()
        });
        spinner.stop(`Task created: Task-${taskId} - ${options.name}`);
    }
    catch (error) {
        spinner.fail(`Failed to create task: ${error}`);
        throw error;
    }
}
async function findNextTaskId(iterationDir) {
    const { readdir } = await Promise.resolve().then(() => __importStar(require('fs-extra')));
    const entries = await readdir(iterationDir, { withFileTypes: true });
    const taskDirs = entries
        .filter(e => e.isDirectory() && e.name.startsWith('Task-'))
        .map(e => parseInt(e.name.replace('Task-', '')))
        .filter(n => !isNaN(n));
    const maxId = Math.max(0, ...taskDirs);
    return String(maxId + 1).padStart(3, '0');
}
async function generateTaskContent(options) {
    const name = options.name || 'New Task';
    const desc = options.desc || '';
    const type = options.type || 'feature';
    const req = `# ${name}

## 需求描述

${desc}

## 验收标准

- [ ] AC-1: 
- [ ] AC-2: 
- [ ] AC-3: 

## 输入/输出

### 输入

### 输出

## 业务规则

## 错误处理
`;
    const tech = `# ${name} - 技术方案

## 1. 方案概述

## 2. 接口设计

### 2.1 API 定义

### 2.2 请求/响应格式

## 3. 数据模型

## 4. 核心逻辑

### 4.1 流程图

### 4.2 伪代码

## 5. 测试策略

### 5.1 单元测试

### 5.2 集成测试

## 6. 风险与应对
`;
    const task = `# ${name}

## 任务信息
- 类型: ${type}
- 状态: 🔲 待开发
- 优先级: medium
- 预计耗时: 2h
- 创建时间: ${new Date().toISOString().split('T')[0]}

## 变更履历
| 时间 | 变更内容 | 变更人 |
| :--- | :--- | :--- |
| ${new Date().toISOString().split('T')[0]} | 创建任务 | CLI |

## 产出物
| 产出物 | 状态 | 路径 |
| :--- | :--- | :--- |
| REQ.md | ✅ | ./REQ.md |
| TECH.md | ✅ | ./TECH.md |
| TASK.md | ✅ | ./TASK.md |
| API_CONTRACT.yaml | ⏳ | ./_shared/API_CONTRACT.yaml |

## 依赖关系
| 依赖任务 | 依赖原因 | 状态 |
| :--- | :--- | :--- |
| | | |

## 阻塞关系
| 被阻塞任务 | 阻塞原因 | 状态 |
| :--- | :--- | :--- |
| | | |
`;
    return { req, tech, task };
}
//# sourceMappingURL=new.js.map