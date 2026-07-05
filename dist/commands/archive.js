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
exports.archiveCommand = archiveCommand;
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
const logger_1 = require("../utils/logger");
const context_1 = require("../core/context");
async function archiveCommand(options) {
    const spinner = new logger_1.Spinner('Archiving tasks');
    spinner.start();
    try {
        if (options.list) {
            await listArchived();
            spinner.stop('Archived tasks listed');
            return;
        }
        if (options.restore) {
            await restoreTask(options.restore, options.iteration);
            spinner.stop(`Task restored: ${options.restore}`);
            return;
        }
        const iteration = await (0, context_1.getDefaultIteration)(options.iteration);
        if (!iteration) {
            spinner.fail('No active iteration found. Please specify --iteration or create one first.');
            return;
        }
        const iterationDir = `期次-${iteration}`;
        const archiveDir = (0, path_1.join)(iterationDir, 'archived');
        await (0, fs_extra_1.ensureDir)(archiveDir);
        if (options.all) {
            // Archive all completed tasks
            const { readdir } = await Promise.resolve().then(() => __importStar(require('fs-extra')));
            const entries = await readdir(iterationDir, { withFileTypes: true });
            const tasks = entries
                .filter(e => e.isDirectory() && e.name.startsWith('Task-'))
                .map(e => e.name);
            for (const task of tasks) {
                await archiveTask(iterationDir, task, archiveDir);
            }
            spinner.stop(`Archived ${tasks.length} tasks`);
        }
        else if (options.task) {
            await archiveTask(iterationDir, options.task, archiveDir);
            spinner.stop(`Archived: ${options.task}`);
        }
        else {
            spinner.fail('Please specify --task or --all');
        }
        // Update context
        await (0, context_1.updateContext)({ lastUpdated: new Date().toISOString() });
    }
    catch (error) {
        spinner.fail(`Archive failed: ${error}`);
        throw error;
    }
}
async function archiveTask(iterationDir, taskId, archiveDir) {
    const taskPath = (0, path_1.join)(iterationDir, taskId);
    const targetPath = (0, path_1.join)(archiveDir, taskId);
    if (!(await (0, fs_extra_1.pathExists)(taskPath))) {
        logger_1.logger.warn(`Task not found: ${taskId}`);
        return;
    }
    if (await (0, fs_extra_1.pathExists)(targetPath)) {
        logger_1.logger.warn(`Task already archived: ${taskId}`);
        return;
    }
    await (0, fs_extra_1.move)(taskPath, targetPath);
    logger_1.logger.info(`  Archived: ${taskId}`);
}
async function restoreTask(taskId, iteration) {
    const iter = await (0, context_1.getDefaultIteration)(iteration);
    if (!iter) {
        throw new Error('No iteration specified');
    }
    const iterationDir = `期次-${iter}`;
    const archiveDir = (0, path_1.join)(iterationDir, 'archived');
    const archivedPath = (0, path_1.join)(archiveDir, taskId);
    const targetPath = (0, path_1.join)(iterationDir, taskId);
    if (!(await (0, fs_extra_1.pathExists)(archivedPath))) {
        throw new Error(`Archived task not found: ${taskId}`);
    }
    await (0, fs_extra_1.move)(archivedPath, targetPath);
    logger_1.logger.info(`Restored: ${taskId}`);
}
async function listArchived() {
    const { readdir } = await Promise.resolve().then(() => __importStar(require('fs-extra')));
    const entries = await readdir('.', { withFileTypes: true });
    const iterations = entries
        .filter(e => e.isDirectory() && e.name.startsWith('期次-'))
        .map(e => e.name);
    for (const iteration of iterations) {
        const archiveDir = (0, path_1.join)(iteration, 'archived');
        if (await (0, fs_extra_1.pathExists)(archiveDir)) {
            const tasks = await readdir(archiveDir);
            if (tasks.length > 0) {
                logger_1.logger.info(`${iteration}:`);
                for (const task of tasks) {
                    logger_1.logger.info(`  ${task}`);
                }
            }
        }
    }
}
//# sourceMappingURL=archive.js.map