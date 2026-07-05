export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success';
export declare class Logger {
    private logFile?;
    private verbose;
    constructor(options?: {
        logFile?: string;
        verbose?: boolean;
    });
    log(level: LogLevel, message: string, ...args: unknown[]): void;
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
    success(message: string, ...args: unknown[]): void;
    private colorize;
    close(): void;
}
export declare const logger: Logger;
export declare class ProgressBar {
    private total;
    private current;
    private width;
    constructor(total: number, width?: number);
    update(current: number): void;
    increment(step?: number): void;
    private render;
}
export declare class Spinner {
    private message;
    private interval?;
    private frames;
    private frameIndex;
    constructor(message: string);
    start(): void;
    stop(message?: string): void;
    fail(message?: string): void;
}
export declare function formatTable(headers: string[], rows: string[][]): string;
export declare function formatJsonOutput(data: unknown): string;
export declare function writeOutput(content: string, outputPath?: string): Promise<void>;
//# sourceMappingURL=logger.d.ts.map