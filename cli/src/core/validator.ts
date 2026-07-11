import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { YamlParser } from './yaml-parser';

/** 验证结果 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Spec 文件验证器 — 检查 .speccore 目录结构的合规性
 */
export class Validator {
  constructor(private projectRoot: string) {}

  /** 验证项目 Spec 文件完整性 */
  validate(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. 检查必要文件
    this.checkRequiredFile('.speccore/CONSTITUTION.md', '技术宪法缺失', errors);
    this.checkRequiredFile('.speccore/SETTINGS.md', '框架配置缺失', warnings);
    this.checkRequiredFile('.speccore/PROJECT/TEAM.md', '团队信息缺失', warnings);

    // 2. 验证 platforms.yaml
    this.validatePlatforms(errors, warnings);

    // 3. 验证 context.json
    this.validateContext(warnings);

    // 4. 检查 GLOBAL 层
    this.validateGlobalLayer(errors, warnings);

    return { valid: errors.length === 0, errors, warnings };
  }

  private checkRequiredFile(relPath: string, message: string, target: string[]): void {
    if (!existsSync(join(this.projectRoot, relPath))) {
      target.push(`${message}: ${relPath}`);
    }
  }

  private validatePlatforms(errors: string[], warnings: string[]): void {
    const path = join(this.projectRoot, '.speccore', 'config', 'platforms.yaml');
    if (!existsSync(path)) {
      warnings.push('platforms.yaml 不存在，将使用默认平台 (web/h5/miniapp)');
      return;
    }
    try {
      const content = readFileSync(path, 'utf-8');
      const data = YamlParser.parse(content);
      if (!data.platforms) {
        errors.push('platforms.yaml: 缺少 platforms 根节点');
        return;
      }
      if (typeof data.platforms === 'object') {
        const keys = Object.keys(data.platforms as object);
        if (keys.length === 0) {
          warnings.push('platforms.yaml: 未定义任何平台');
        }
      }
    } catch (e) {
      errors.push(`platforms.yaml: 解析失败 — ${(e as Error).message}`);
    }
  }

  private validateContext(warnings: string[]): void {
    const path = join(this.projectRoot, '.speccore', 'local', 'context.json');
    if (!existsSync(path)) {
      warnings.push('context.json 不存在，上下文感知功能受限');
      return;
    }
    try {
      const ctx = JSON.parse(readFileSync(path, 'utf-8'));
      if (!ctx.current_iteration) {
        warnings.push('context.json: 未设置 current_iteration');
      }
    } catch {
      warnings.push('context.json: JSON 格式错误');
    }
  }

  private validateGlobalLayer(errors: string[], warnings: string[]): void {
    const indexPath = join(this.projectRoot, '.speccore', 'GLOBAL', 'INDEX.md');
    if (!existsSync(indexPath)) {
      warnings.push('GLOBAL/INDEX.md 不存在，全量层未初始化');
      return;
    }

    const content = readFileSync(indexPath, 'utf-8');
    const reqIds = content.match(/REQ-\d+/g);
    if (!reqIds || reqIds.length === 0) {
      warnings.push('GLOBAL/INDEX.md: 未找到任何需求条目');
    }

    // 检查重复 ID
    if (reqIds) {
      const duplicates = reqIds.filter((id, i) => reqIds.indexOf(id) !== i);
      if (duplicates.length > 0) {
        errors.push(`GLOBAL/INDEX.md: 发现重复需求 ID — ${[...new Set(duplicates)].join(', ')}`);
      }
    }
  }
}
