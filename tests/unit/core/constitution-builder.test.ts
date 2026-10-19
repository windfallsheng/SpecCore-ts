/**
 * constitution-builder.test.ts — 自动检测与决策式技术栈表完善（v8.3.325）
 *
 * 覆盖：
 * 1. detectStack 各依赖清单分支（pom.xml / package.json / go.mod / requirements.txt）
 * 2. typescript 显式依赖才判 TS（避免纯 JS 项目误判）
 * 3. enhanceConstitutionTechStack 的三种语义：
 *    - freshTemplate（init）：示例行整体替换为检测行
 *    - 存量已填（update）：不动、返回 false
 *    - 存量未填（update）：补填检测行
 * 4. 旧菜单格式 / 文件不存在：不破坏、返回 false
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  detectStack,
  enhanceConstitutionTechStack,
} from '../../../src/core/constitution-builder';

const SAMPLE_CONSTITUTION = `# 技术宪法

## 技术栈

> 填写规则：**每端一行，只写「已选定」的技术与版本**（决策式声明，不是选项菜单）。

| 端 | 语言 | 框架 | 数据存储 | 依据（依赖清单文件） |
| :--- | :--- | :--- | :--- | :--- |
| backend-api | Java 17 | Spring Boot 3.x | MySQL 8 | pom.xml |
| admin-web | TypeScript | Vue 3 | — | package.json |

## 命名规范
`;

const UNFILLED_CONSTITUTION = `# 技术宪法

## 技术栈

> 填写规则：**每端一行，只写「已选定」的技术与版本**。

| 端 | 语言 | 框架 | 数据存储 | 依据（依赖清单文件） |
| :--- | :--- | :--- | :--- | :--- |
| 待填写 | 待填写 | 待填写 | — | — |

## 命名规范
`;

const FILLED_CONSTITUTION = `# 技术宪法

## 技术栈

| 端 | 语言 | 框架 | 数据存储 | 依据（依赖清单文件） |
| :--- | :--- | :--- | :--- | :--- |
| order-service | Java 17 | Spring Boot 3.x | MySQL 8 | pom.xml |

## 命名规范
`;

const LEGACY_CONSTITUTION = `# 技术宪法

## 技术栈

### 后端
- 语言：Java
- 框架：Spring Boot

## 命名规范
`;

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'constitution-builder-'));
});

afterEach(() => {
  if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
});

function writeConstitution(content: string): void {
  const speccoreDir = join(tempDir, '.speccore');
  mkdirSync(speccoreDir, { recursive: true });
  writeFileSync(join(speccoreDir, 'CONSTITUTION.md'), content);
}

describe('detectStack', () => {
  it('pom.xml + spring-boot → Java / Spring Boot', async () => {
    writeFileSync(
      join(tempDir, 'pom.xml'),
      '<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent></project>',
    );
    const stack = await detectStack(tempDir);
    expect(stack.language).toBe('Java');
    expect(stack.backend).toBe('Spring Boot');
    expect(stack.backendSource).toBe('pom.xml');
  });

  it('package.json + vue + typescript → Vue / TypeScript', async () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({
        dependencies: { vue: '^3.4.0' },
        devDependencies: { typescript: '^5.4.0' },
      }),
    );
    const stack = await detectStack(tempDir);
    expect(stack.frontend).toBe('Vue');
    expect(stack.language).toBe('TypeScript');
  });

  it('package.json 无 typescript 依赖 → 不判 TS（纯 JS 项目）', async () => {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ dependencies: { express: '^4.19.0' } }),
    );
    const stack = await detectStack(tempDir);
    expect(stack.backend).toBe('Node.js');
    expect(stack.language).toBeUndefined();
  });

  it('go.mod → Go', async () => {
    writeFileSync(join(tempDir, 'go.mod'), 'module example.com/app\n\ngo 1.22\n');
    const stack = await detectStack(tempDir);
    expect(stack.language).toBe('Go');
    expect(stack.backend).toBe('Go');
  });

  it('requirements.txt → Python', async () => {
    writeFileSync(join(tempDir, 'requirements.txt'), 'fastapi==0.110.0\n');
    const stack = await detectStack(tempDir);
    expect(stack.language).toBe('Python');
    expect(stack.backend).toBe('Python');
  });
});

describe('enhanceConstitutionTechStack', () => {
  it('freshTemplate（init）：示例行整体替换为检测行，端名用 platformName', async () => {
    writeConstitution(SAMPLE_CONSTITUTION);
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({
        dependencies: { vue: '^3.4.0' },
        devDependencies: { typescript: '^5.4.0' },
      }),
    );

    const ok = await enhanceConstitutionTechStack(tempDir, {
      platformName: 'my-app',
      freshTemplate: true,
    });
    expect(ok).toBe(true);

    const content = readFileSync(join(tempDir, '.speccore', 'CONSTITUTION.md'), 'utf-8');
    expect(content).toContain('| my-app | TypeScript | Vue | — | package.json |');
    expect(content).not.toContain('| backend-api | Java 17 |');
    // 多行示例 → 仅保留一行检测结果（不产生重复行）
    const detectedRows = content
      .split('\n')
      .filter((l) => l.startsWith('| my-app '));
    expect(detectedRows).toHaveLength(1);
    // 其余章节不受影响
    expect(content).toContain('## 命名规范');
  });

  it('存量已填（update）：不动、返回 false', async () => {
    writeConstitution(FILLED_CONSTITUTION);
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ dependencies: { vue: '^3.4.0' } }),
    );

    const ok = await enhanceConstitutionTechStack(tempDir, { freshTemplate: false });
    expect(ok).toBe(false);

    const content = readFileSync(join(tempDir, '.speccore', 'CONSTITUTION.md'), 'utf-8');
    expect(content).toContain('| order-service | Java 17 | Spring Boot 3.x |');
    expect(content).not.toContain('Vue');
  });

  it('存量未填（update）：补填检测行', async () => {
    writeConstitution(UNFILLED_CONSTITUTION);
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ dependencies: { vue: '^3.4.0' } }),
    );

    const ok = await enhanceConstitutionTechStack(tempDir, { freshTemplate: false });
    expect(ok).toBe(true);

    const content = readFileSync(join(tempDir, '.speccore', 'CONSTITUTION.md'), 'utf-8');
    expect(content).toContain('| 待填写 |');
    expect(content).toContain('| Vue |');
  });

  it('旧菜单格式：不破坏、返回 false', async () => {
    writeConstitution(LEGACY_CONSTITUTION);
    writeFileSync(join(tempDir, 'pom.xml'), '<project></project>');

    const ok = await enhanceConstitutionTechStack(tempDir, { freshTemplate: false });
    expect(ok).toBe(false);

    const content = readFileSync(join(tempDir, '.speccore', 'CONSTITUTION.md'), 'utf-8');
    expect(content).toBe(LEGACY_CONSTITUTION);
  });

  it('CONSTITUTION.md 不存在：返回 false', async () => {
    const ok = await enhanceConstitutionTechStack(tempDir, { freshTemplate: true });
    expect(ok).toBe(false);
  });

  it('无任何依赖清单：检测不到 → 保留现状、返回 false', async () => {
    writeConstitution(UNFILLED_CONSTITUTION);
    const ok = await enhanceConstitutionTechStack(tempDir, { freshTemplate: false });
    expect(ok).toBe(false);
    const content = readFileSync(join(tempDir, '.speccore', 'CONSTITUTION.md'), 'utf-8');
    expect(content).toBe(UNFILLED_CONSTITUTION);
  });
});
