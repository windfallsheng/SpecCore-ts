/**
 * 功能单元需求原文切片文件解析（v8.3.226+）
 *
 * 语义命名演进：doc2spec --split 切出的功能单元原文切片，文件名从
 * README.md（语义不清，README 通常指「自述说明」）更名为 SOURCE.md
 * （强调「来源切片」——从 PRD 切出的需求原文）。
 *
 * - 写入端（doc2spec --split / spec-merger 新建单元）：写 SOURCE.md
 * - 读取端：本文件提供的 resolveUnitSourcePath 优先读 SOURCE.md，
 *   兼容旧迭代目录已落盘的 README.md，无需迁移
 */
import { join } from 'path';
import { pathExists } from 'fs-extra';

/** 新语义文件名 */
export const UNIT_SOURCE_FILE = 'SOURCE.md';
/** 旧文件名（v8.3.226 之前落盘的数据，读取兼容用） */
export const UNIT_SOURCE_FILE_LEGACY = 'README.md';

/**
 * 解析功能单元目录下的需求原文切片文件路径
 * 优先 SOURCE.md，旧数据 fallback README.md，两者都不存在时返回 SOURCE.md 路径（写入端使用）
 */
export async function resolveUnitSourcePath(featureDir: string): Promise<string> {
  const sourcePath = join(featureDir, UNIT_SOURCE_FILE);
  if (await pathExists(sourcePath)) return sourcePath;
  const legacyPath = join(featureDir, UNIT_SOURCE_FILE_LEGACY);
  if (await pathExists(legacyPath)) return legacyPath;
  return sourcePath;
}

/** 同 resolveUnitSourcePath 的同步变体（fileExistsSync 场景） */
export function resolveUnitSourcePathSync(featureDir: string): string {
  try {
    const { existsSync } = require('fs');
    const sourcePath = join(featureDir, UNIT_SOURCE_FILE);
    if (existsSync(sourcePath)) return sourcePath;
    const legacyPath = join(featureDir, UNIT_SOURCE_FILE_LEGACY);
    if (existsSync(legacyPath)) return legacyPath;
    return sourcePath;
  } catch {
    return join(featureDir, UNIT_SOURCE_FILE);
  }
}
