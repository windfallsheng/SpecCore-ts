"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGitUser = getGitUser;
exports.getGitEmail = getGitEmail;
exports.getCurrentBranch = getCurrentBranch;
exports.getLastCommit = getLastCommit;
exports.isGitRepo = isGitRepo;
exports.getRepoRoot = getRepoRoot;
const child_process_1 = require("child_process");
/**
 * Get current Git user name
 */
function getGitUser() {
    try {
        return (0, child_process_1.execSync)('git config user.name', { encoding: 'utf-8' }).trim();
    }
    catch {
        return 'unknown';
    }
}
/**
 * Get current Git user email
 */
function getGitEmail() {
    try {
        return (0, child_process_1.execSync)('git config user.email', { encoding: 'utf-8' }).trim();
    }
    catch {
        return 'unknown';
    }
}
/**
 * Get current branch name
 */
function getCurrentBranch() {
    try {
        return (0, child_process_1.execSync)('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    }
    catch {
        return 'unknown';
    }
}
/**
 * Get last commit hash (short)
 */
function getLastCommit() {
    try {
        return (0, child_process_1.execSync)('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    }
    catch {
        return 'unknown';
    }
}
/**
 * Check if current directory is a git repository
 */
function isGitRepo() {
    try {
        (0, child_process_1.execSync)('git rev-parse --git-dir', { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Get repository root path
 */
function getRepoRoot() {
    try {
        return (0, child_process_1.execSync)('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
    }
    catch {
        return process.cwd();
    }
}
//# sourceMappingURL=git.js.map