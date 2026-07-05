import { readFile, writeFile, ensureDir, pathExists, copy, remove } from 'fs-extra';
import { join, dirname, basename } from 'path';

/**
 * Read a file as string, return empty string if not found
 */
export async function readFileSafe(filePath: string): Promise<string> {
  try {
    if (await pathExists(filePath)) {
      return await readFile(filePath, 'utf-8');
    }
  } catch (error) {
    // Ignore errors
  }
  return '';
}

/**
 * Write file with auto directory creation
 */
export async function writeFileSafe(filePath: string, content: string): Promise<void> {
  await ensureDir(dirname(filePath));
  await writeFile(filePath, content, 'utf-8');
}

/**
 * Copy directory with overwrite support
 */
export async function copyDir(src: string, dest: string, overwrite = false): Promise<void> {
  if (overwrite) {
    if (await pathExists(dest)) {
      await remove(dest);
    }
  }
  await copy(src, dest);
}

/**
 * Check if file exists and is readable
 */
export async function isReadable(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file extension without dot
 */
export function getExtension(filePath: string): string {
  return basename(filePath).split('.').pop() || '';
}

/**
 * Replace file extension
 */
export function replaceExtension(filePath: string, newExt: string): string {
  const ext = getExtension(filePath);
  if (ext) {
    return filePath.slice(0, -ext.length - 1) + '.' + newExt;
  }
  return filePath + '.' + newExt;
}

/**
 * Find files matching pattern in directory
 */
export async function findFiles(dir: string, pattern: RegExp): Promise<string[]> {
  const { readdir } = await import('fs-extra');
  const files: string[] = [];
  
  async function scan(currentDir: string) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await scan(fullPath);
      } else if (pattern.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }
  
  await scan(dir);
  return files;
}
