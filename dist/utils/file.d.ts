/**
 * Read a file as string, return empty string if not found
 */
export declare function readFileSafe(filePath: string): Promise<string>;
/**
 * Write file with auto directory creation
 */
export declare function writeFileSafe(filePath: string, content: string): Promise<void>;
/**
 * Copy directory with overwrite support
 */
export declare function copyDir(src: string, dest: string, overwrite?: boolean): Promise<void>;
/**
 * Check if file exists and is readable
 */
export declare function isReadable(filePath: string): Promise<boolean>;
/**
 * Get file extension without dot
 */
export declare function getExtension(filePath: string): string;
/**
 * Replace file extension
 */
export declare function replaceExtension(filePath: string, newExt: string): string;
/**
 * Find files matching pattern in directory
 */
export declare function findFiles(dir: string, pattern: RegExp): Promise<string[]>;
//# sourceMappingURL=file.d.ts.map