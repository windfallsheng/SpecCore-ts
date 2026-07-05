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
exports.readFileSafe = readFileSafe;
exports.writeFileSafe = writeFileSafe;
exports.copyDir = copyDir;
exports.isReadable = isReadable;
exports.getExtension = getExtension;
exports.replaceExtension = replaceExtension;
exports.findFiles = findFiles;
const fs_extra_1 = require("fs-extra");
const path_1 = require("path");
/**
 * Read a file as string, return empty string if not found
 */
async function readFileSafe(filePath) {
    try {
        if (await (0, fs_extra_1.pathExists)(filePath)) {
            return await (0, fs_extra_1.readFile)(filePath, 'utf-8');
        }
    }
    catch (error) {
        // Ignore errors
    }
    return '';
}
/**
 * Write file with auto directory creation
 */
async function writeFileSafe(filePath, content) {
    await (0, fs_extra_1.ensureDir)((0, path_1.dirname)(filePath));
    await (0, fs_extra_1.writeFile)(filePath, content, 'utf-8');
}
/**
 * Copy directory with overwrite support
 */
async function copyDir(src, dest, overwrite = false) {
    if (overwrite) {
        if (await (0, fs_extra_1.pathExists)(dest)) {
            await (0, fs_extra_1.remove)(dest);
        }
    }
    await (0, fs_extra_1.copy)(src, dest);
}
/**
 * Check if file exists and is readable
 */
async function isReadable(filePath) {
    try {
        await (0, fs_extra_1.readFile)(filePath, 'utf-8');
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Get file extension without dot
 */
function getExtension(filePath) {
    return (0, path_1.basename)(filePath).split('.').pop() || '';
}
/**
 * Replace file extension
 */
function replaceExtension(filePath, newExt) {
    const ext = getExtension(filePath);
    if (ext) {
        return filePath.slice(0, -ext.length - 1) + '.' + newExt;
    }
    return filePath + '.' + newExt;
}
/**
 * Find files matching pattern in directory
 */
async function findFiles(dir, pattern) {
    const { readdir } = await Promise.resolve().then(() => __importStar(require('fs-extra')));
    const files = [];
    async function scan(currentDir) {
        const entries = await readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = (0, path_1.join)(currentDir, entry.name);
            if (entry.isDirectory()) {
                await scan(fullPath);
            }
            else if (pattern.test(entry.name)) {
                files.push(fullPath);
            }
        }
    }
    await scan(dir);
    return files;
}
//# sourceMappingURL=file.js.map