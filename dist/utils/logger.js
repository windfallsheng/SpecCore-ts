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
exports.Spinner = exports.ProgressBar = exports.logger = exports.Logger = void 0;
exports.formatTable = formatTable;
exports.formatJsonOutput = formatJsonOutput;
exports.writeOutput = writeOutput;
const fs_1 = require("fs");
class Logger {
    constructor(options) {
        this.verbose = options?.verbose ?? false;
        if (options?.logFile) {
            const dir = options.logFile.substring(0, options.logFile.lastIndexOf('/'));
            if (dir && !(0, fs_1.existsSync)(dir)) {
                (0, fs_1.mkdirSync)(dir, { recursive: true });
            }
            this.logFile = (0, fs_1.createWriteStream)(options.logFile, { flags: 'a' });
        }
    }
    log(level, message, ...args) {
        const timestamp = new Date().toISOString();
        const formatted = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        if (this.verbose || level !== 'debug') {
            console.log(this.colorize(level, formatted), ...args);
        }
        this.logFile?.write(`${formatted}\n`);
    }
    debug(message, ...args) {
        this.log('debug', message, ...args);
    }
    info(message, ...args) {
        this.log('info', message, ...args);
    }
    warn(message, ...args) {
        this.log('warn', message, ...args);
    }
    error(message, ...args) {
        this.log('error', message, ...args);
    }
    success(message, ...args) {
        this.log('success', message, ...args);
    }
    colorize(level, message) {
        const colors = {
            debug: '\x1b[90m', // Gray
            info: '\x1b[36m', // Cyan
            warn: '\x1b[33m', // Yellow
            error: '\x1b[31m', // Red
            success: '\x1b[32m' // Green
        };
        const reset = '\x1b[0m';
        return `${colors[level]}${message}${reset}`;
    }
    close() {
        this.logFile?.end();
    }
}
exports.Logger = Logger;
// Global logger instance
exports.logger = new Logger();
// Progress bar utility
class ProgressBar {
    constructor(total, width = 40) {
        this.total = total;
        this.current = 0;
        this.width = width;
    }
    update(current) {
        this.current = current;
        this.render();
    }
    increment(step = 1) {
        this.current += step;
        this.render();
    }
    render() {
        const progress = Math.min(this.current / this.total, 1);
        const filled = Math.round(this.width * progress);
        const empty = this.width - filled;
        const bar = '█'.repeat(filled) + '░'.repeat(empty);
        const percentage = Math.round(progress * 100);
        process.stdout.write(`\r[${bar}] ${percentage}% (${this.current}/${this.total})`);
        if (this.current >= this.total) {
            process.stdout.write('\n');
        }
    }
}
exports.ProgressBar = ProgressBar;
// Spinner utility
class Spinner {
    constructor(message) {
        this.frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        this.frameIndex = 0;
        this.message = message;
    }
    start() {
        this.interval = setInterval(() => {
            const frame = this.frames[this.frameIndex % this.frames.length];
            process.stdout.write(`\r${frame} ${this.message}...`);
            this.frameIndex++;
        }, 80);
    }
    stop(message) {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = undefined;
        }
        process.stdout.write(`\r✅ ${message || this.message}\n`);
    }
    fail(message) {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = undefined;
        }
        process.stdout.write(`\r❌ ${message || this.message}\n`);
    }
}
exports.Spinner = Spinner;
// Table formatter
function formatTable(headers, rows) {
    const colWidths = headers.map((h, i) => {
        const maxContent = Math.max(...rows.map(r => (r[i] || '').length));
        return Math.max(h.length, maxContent);
    });
    const separator = colWidths.map(w => '-'.repeat(w + 2)).join('|');
    const formatRow = (cells) => {
        return cells.map((c, i) => ` ${(c || '').padEnd(colWidths[i])} `).join('|');
    };
    return [
        formatRow(headers),
        separator,
        ...rows.map(formatRow)
    ].join('\n');
}
// JSON output formatter
function formatJsonOutput(data) {
    return JSON.stringify(data, null, 2);
}
// Output file helper
async function writeOutput(content, outputPath) {
    if (outputPath) {
        const { writeFile, ensureDir } = await Promise.resolve().then(() => __importStar(require('fs-extra')));
        const { dirname } = await Promise.resolve().then(() => __importStar(require('path')));
        await ensureDir(dirname(outputPath));
        await writeFile(outputPath, content, 'utf-8');
        exports.logger.success(`Output saved to: ${outputPath}`);
    }
    else {
        console.log(content);
    }
}
//# sourceMappingURL=logger.js.map