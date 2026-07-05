import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { WriteStream } from 'fs';

// Logger implementation
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';

export class Logger {
  private logFile?: WriteStream;
  private verbose: boolean;

  constructor(options?: { logFile?: string; verbose?: boolean }) {
    this.verbose = options?.verbose ?? false;
    
    if (options?.logFile) {
      const dir = options.logFile.substring(0, options.logFile.lastIndexOf('/'));
      if (dir && !existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      this.logFile = createWriteStream(options.logFile, { flags: 'a' });
    }
  }

  log(level: LogLevel, message: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    if (this.verbose || level !== 'debug') {
      console.log(this.colorize(level, formatted), ...args);
    }
    
    this.logFile?.write(`${formatted}\n`);
  }

  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log('info', message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log('error', message, ...args);
  }

  success(message: string, ...args: unknown[]): void {
    this.log('success', message, ...args);
  }

  private colorize(level: LogLevel, message: string): string {
    const colors: Record<LogLevel, string> = {
      debug: '\x1b[90m',    // Gray
      info: '\x1b[36m',     // Cyan
      warn: '\x1b[33m',     // Yellow
      error: '\x1b[31m',    // Red
      success: '\x1b[32m'   // Green
    };
    
    const reset = '\x1b[0m';
    return `${colors[level]}${message}${reset}`;
  }

  close(): void {
    this.logFile?.end();
  }
}

// Global logger instance
export const logger = new Logger();

// Progress bar utility
export class ProgressBar {
  private total: number;
  private current: number;
  private width: number;

  constructor(total: number, width = 40) {
    this.total = total;
    this.current = 0;
    this.width = width;
  }

  update(current: number): void {
    this.current = current;
    this.render();
  }

  increment(step = 1): void {
    this.current += step;
    this.render();
  }

  private render(): void {
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

// Spinner utility
export class Spinner {
  private message: string;
  private interval?: NodeJS.Timeout;
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private frameIndex = 0;

  constructor(message: string) {
    this.message = message;
  }

  start(): void {
    this.interval = setInterval(() => {
      const frame = this.frames[this.frameIndex % this.frames.length];
      process.stdout.write(`\r${frame} ${this.message}...`);
      this.frameIndex++;
    }, 80);
  }

  stop(message?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    process.stdout.write(`\r✅ ${message || this.message}\n`);
  }

  fail(message?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    process.stdout.write(`\r❌ ${message || this.message}\n`);
  }
}

// Table formatter
export function formatTable(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((h, i) => {
    const maxContent = Math.max(...rows.map(r => (r[i] || '').length));
    return Math.max(h.length, maxContent);
  });

  const separator = colWidths.map(w => '-'.repeat(w + 2)).join('|');
  
  const formatRow = (cells: string[]) => {
    return cells.map((c, i) => ` ${(c || '').padEnd(colWidths[i])} `).join('|');
  };

  return [
    formatRow(headers),
    separator,
    ...rows.map(formatRow)
  ].join('\n');
}

// JSON output formatter
export function formatJsonOutput(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

// Output file helper
export async function writeOutput(content: string, outputPath?: string): Promise<void> {
  if (outputPath) {
    const { writeFile, ensureDir } = await import('fs-extra');
    const { dirname } = await import('path');
    await ensureDir(dirname(outputPath));
    await writeFile(outputPath, content, 'utf-8');
    logger.success(`Output saved to: ${outputPath}`);
  } else {
    console.log(content);
  }
}
