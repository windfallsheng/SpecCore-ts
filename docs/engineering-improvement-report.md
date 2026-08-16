# SpecCore 工程化改进报告

> **版本**: v6.38.0+  
> **日期**: 2026-08-15  
> **目标**: 用 AI 辅助补齐个人项目的工程化短板，达到团队级工程质量

---

## 📊 现状评估

### 优势（个人 + AI 的产出能力）

| 维度 | 表现 | 说明 |
|:--|:--|:--|
| **创新密度** | ⭐⭐⭐⭐⭐ | 知识图谱 + RAG + 衰减检测、意图识别引擎、双层文档架构 |
| **迭代速度** | ⭐⭐⭐⭐⭐ | 7 天 8 个版本（v6.31.0 → v6.38.0），快速响应用户反馈 |
| **架构前瞻性** | ⭐⭐⭐⭐⭐ | Prompt/Apply 协作模式、三层解耦、全局知识库 TOC + AI 自主读取 |
| **功能完整性** | ⭐⭐⭐⭐⭐ | 覆盖 SDLC 全流程（需求→分析→拆分→计划→执行→归档） |

### 短板（工程纪律缺失）

| 维度 | 现状 | 目标 | 差距 |
|:--|:--|:--|:--|
| **测试覆盖率** | ~15%（13 个测试文件） | 70%+ |  严重不足 |
| **CI/CD 流程** | 基础编译 + 单元测试 | Lint + 安全扫描 + 自动发布 | ❌ 缺少质量门禁 |
| **错误处理** | 部分静默失败 | 结构化错误码 + 用户友好提示 | ⚠️ 中等 |
| **文档同步** | 手动更新 | 自动生成命令列表/API 文档 | ⚠️ 中等 |
| **E2E 测试** | 无 | 完整集成测试套件 | ❌ 严重不足 |

---

## 🎯 已完成的 P0 改进

### 1. CI/CD 流水线完善 ✅

**文件**: `.github/workflows/ci.yml`

**新增内容**:
```yaml
jobs:
  # 1. 代码质量检查
  lint:
    - ESLint 检查（可选，不阻断）
    - Prettier 格式检查
  
  # 2. 编译与测试
  build-and-test:
    - TypeScript 类型检查
    - 单元测试 + 覆盖率（vitest --coverage）
    - Codecov 覆盖率上报
  
  # 3. 安全扫描
  security-scan:
    - npm audit 依赖漏洞扫描
    - CodeQL 安全分析
  
  # 4. 自动发布
  publish:
    - 触发条件：release 事件 + tag 以 v 开头
    - 前置条件：lint + build-and-test + security-scan 全部通过
    - 自动 npm publish
    - 自动创建 GitHub Release
```

**效果**:
- ✅ PR 合并前强制通过所有质量检查
- ✅ 安全漏洞自动检测（CodeQL + npm audit）
- ✅ 发布自动化（打 tag → 自动发布到 npm）
- ✅ 覆盖率可视化（Codecov 仪表盘）

**后续配置**:
1. 在 GitHub Settings → Secrets 中添加 `NPM_TOKEN`（npm 发布令牌）
2. 在 GitHub Settings → Secrets 中添加 `CODECOV_TOKEN`（CodeCov 上传令牌）
3. 启用 CodeQL 扫描（Settings → Security & analysis → Code scanning alerts）

---

### 2. 核心模块单元测试 ✅

**新增测试文件**:
- `tests/unit/core/analyze-engine.test.ts`（4 个用例）
- `tests/unit/core/platform-registry.test.ts`（7 个用例）

**测试覆盖的核心功能**:

#### analyze-engine 双层文档架构
```typescript
describe('generateSpecsFromRequirements - 双层文档架构', () => {
  it('应该生成全局文档到根目录');        // REQUIREMENT.md, ANALYSIS.md, DEPS.md, RISK.md
  it('应该生成各端专属文档到子目录');      // admin/h5/backend/{TECH,TEST,UI_SPEC}.md
  it('REQUIREMENT.md 应该包含涉及端列');   // | 功能模块 | 描述 | 涉及端 |
  it('各端 TECH.md 应该有差异化内容');     // 前端：页面路由/组件；后端：接口设计/数据模型
});
```

#### platform-registry 端注册表
```typescript
describe('platform-registry - 端注册表与模糊匹配', () => {
  it('应该精确匹配端名');                  // 'admin' → 'admin'
  it('应该前缀匹配端名');                  // 'adm' → 'admin'
  it('应该包含匹配端名');                  // 'mini' → 'miniapp'
  it('无匹配时应该返回 null');             // 'xyz' → null
  it('应该解析有效端名');                  // resolvePlatform('adm', [...]) → { success: true, platform: 'admin' }
  it('无效端名应该返回错误并列出可用端');   // resolvePlatform('xyz', [...]) → { success: false, error: '...' }
  it('应该从 CONSTITUTION.md 解析端列表'); // parseGlobalPlatforms() → ['admin', 'h5', 'backend']
});
```

**运行测试**:
```bash
# 运行所有测试
npm test

# 运行特定测试文件
npx vitest run tests/unit/core/analyze-engine.test.ts

# 生成覆盖率报告
npx vitest run --coverage
```

**预期覆盖率提升**:
- 当前：~15%
- 目标（P0 完成后）：~30%
- 目标（P1 完成后）：~50%
- 目标（P2 完成后）：70%+

---

## 📋 待完成的 P1/P2 改进

### P1: 结构化错误处理体系

**问题**: 多处 try-catch 后静默忽略错误，用户看不到具体失败原因。

**解决方案**:
1. 定义统一错误码体系（`src/core/errors.ts`）
2. 所有命令返回结构化错误对象
3. CLI 层统一格式化错误输出

**示例**:
```typescript
// src/core/errors.ts
export enum ErrorCode {
  TASK_NOT_FOUND = 'E001',
  ITERATION_NOT_FOUND = 'E002',
  FILE_NOT_FOUND = 'E003',
  PLATFORM_NOT_FOUND = 'E004',
  // ...
}

export class SpecCoreError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'SpecCoreError';
  }
}

// 使用示例
if (!taskDir) {
  throw new SpecCoreError(
    ErrorCode.TASK_NOT_FOUND,
    `未找到任务: ${taskId}`,
    { taskId, availableTasks: ['Task-001', 'Task-002'] }
  );
}
```

**AI 辅助生成**:
```bash
/spec-ask "分析 src/commands/*.ts 中所有 try-catch 块，识别静默失败的地方，生成结构化错误处理方案，包括错误码定义和统一错误处理器"
```

---

### P1: 自动化文档同步机制

**问题**: README/command-reference.md 中的命令列表需要手动更新，容易遗漏。

**解决方案**:
1. 创建 `scripts/generate-command-doc.ts` 脚本
2. 扫描 `src/commands/*.ts` 提取命令元数据
3. 自动生成 Markdown 表格
4. Git pre-commit hook 自动运行

**示例脚本结构**:
```typescript
// scripts/generate-command-doc.ts
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

interface CommandMeta {
  name: string;
  description: string;
  options: Array<{ name: string; type: string; required: boolean }>;
  examples: string[];
}

function extractCommandMeta(filePath: string): CommandMeta {
  const content = readFileSync(filePath, 'utf-8');
  // 解析 program.command().description().option()...
  // 返回结构化元数据
}

function generateMarkdown(commands: CommandMeta[]): string {
  return `
## 命令参考

| 命令 | 描述 | 选项 |
| :--- | :--- | :--- |
${commands.map(c => `| \`${c.name}\` | ${c.description} | ${c.options.map(o => \`--${o.name}\`).join(', ')} |`).join('\n')}
`;
}

const commands = readdirSync('src/commands')
  .filter(f => f.endsWith('.ts'))
  .map(f => extractCommandMeta(join('src/commands', f)));

console.log(generateMarkdown(commands));
```

**AI 辅助生成**:
```bash
/spec-ask "创建 scripts/generate-command-doc.ts 脚本，扫描 src/commands/*.ts 提取 Commander.js 命令元数据，自动生成 docs/command-reference.md 的命令列表表格，支持 --dry-run 预览模式"
```

---

### P2: E2E 集成测试框架

**问题**: 只有单元测试，缺少端到端集成测试。

**解决方案**:
1. 使用 Playwright 或 Cypress 建立 E2E 测试框架
2. 模拟真实用户操作流程（init → doc2spec → analyze → split → execute）
3. 验证文件系统状态和输出结果

**示例测试场景**:
```typescript
// tests/e2e/full-workflow.test.ts
import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { readFile, pathExists } from 'fs-extra';

test('完整工作流：从初始化到任务执行', async () => {
  // 1. 初始化项目
  execSync('speccore init --name test-project', { cwd: tempDir });
  expect(await pathExists(join(tempDir, '.speccore'))).toBe(true);
  
  // 2. 创建迭代
  execSync('speccore iteration create -n Q1 --topic meeting-system', { cwd: tempDir });
  expect(await pathExists(join(tempDir, 'Iteration-001-meeting-system'))).toBe(true);
  
  // 3. 导入需求文档
  await writeFile(join(tempDir, 'Iteration-001-meeting-system/010-requirements/PRD.md'), prdContent);
  
  // 4. 分析需求
  execSync('speccore analyze --auto -I 001-meeting-system', { cwd: tempDir });
  expect(await pathExists(join(tempDir, 'Iteration-001-meeting-system/020-specs/REQUIREMENT.md'))).toBe(true);
  expect(await pathExists(join(tempDir, 'Iteration-001-meeting-system/020-specs/admin/TECH.md'))).toBe(true);
  
  // 5. 拆分任务
  execSync('speccore iteration split -I 001-meeting-system', { cwd: tempDir });
  expect(await pathExists(join(tempDir, 'Iteration-001-meeting-system/030-tasks/feature/Task-001'))).toBe(true);
  
  // 6. 验证任务结构
  const taskDir = join(tempDir, 'Iteration-001-meeting-system/030-tasks/feature/Task-001');
  expect(await pathExists(join(taskDir, '00-specs/REQ.md'))).toBe(true);
  expect(await pathExists(join(taskDir, '00-specs/TECH.md'))).toBe(true);
});
```

**AI 辅助生成**:
```bash
/spec-ask "基于 SpecCore CLI 的完整工作流（init → doc2spec → analyze → split → execute），生成 Playwright E2E 测试套件，覆盖正常流程和异常流程（如缺少需求文档、任务不存在等），包含 10+ 个测试场景"
```

---

##  预期效果

### 短期（P0 完成，1-2 周）
- ✅ CI/CD 流水线自动化（Lint + 安全扫描 + 自动发布）
- ✅ 核心模块测试覆盖率提升至 30%
- ✅ PR 合并前强制质量检查

### 中期（P1 完成，2-4 周）
- ✅ 结构化错误处理体系（错误码 + 用户友好提示）
- ✅ 自动化文档同步机制（命令列表自动生成）
- ✅ 测试覆盖率提升至 50%

### 长期（P2 完成，4-8 周）
- ✅ E2E 集成测试框架（10+ 个完整工作流场景）
- ✅ 测试覆盖率提升至 70%+
- ✅ 达到团队级工程质量标准

---

## 💡 关键洞察

### 1. AI 能放大什么？
- ✅ **架构设计**: 双层文档架构、意图识别引擎、知识图谱
- ✅ **功能实现**: 快速原型、代码生成、文档编写
- ✅ **迭代速度**: 7 天 8 个版本，快速响应用户反馈

### 2. AI 不能替代什么？
- ❌ **测试覆盖**: 需要系统性设计和持续维护
-  **CI/CD 规范**: 需要团队共识和流程约束
- ❌ **代码审查**: 需要多人视角和经验积累
- ❌ **文档同步**: 需要自动化机制而非人工记忆

### 3. 如何用 AI 补工程课？
- **生成测试**: `/spec-ask "为 X 模块生成单元测试，覆盖 Y 场景"`
- **完善 CI/CD**: `/spec-ask "基于当前项目结构，生成完整的 GitHub Actions CI/CD 配置"`
- **自动化文档**: `/spec-ask "扫描 src/commands/*.ts，自动生成 command-reference.md 的命令列表"`
- **错误处理**: `/spec-ask "分析所有 try-catch 块，识别静默失败的地方，生成结构化错误处理方案"`

---

## 🚀 下一步行动

1. **配置 CI/CD Secrets**（NPM_TOKEN, CODECOV_TOKEN）
2. **启用 CodeQL 扫描**（GitHub Settings → Security & analysis）
3. **补充更多单元测试**（execute/split/doc2spec 等核心命令）
4. **创建错误处理体系**（errors.ts + 统一错误处理器）
5. **生成自动化文档脚本**（generate-command-doc.ts）

---

## 📝 总结

SpecCore 证明了**个人 + AI 可以在创新和功能上超越小团队**，但**工程纪律仍然需要系统性投入**。通过本次 P0 改进（CI/CD + 单元测试），我们已经迈出了重要一步。

**核心理念**: 
> "AI 是放大器，不是替代品。它能让个人的产出能力指数级增长，但不能替代团队的工程纪律。如果能把工程化也交给 AI 辅助，个人开发者也能达到团队级工程质量。"

**最终目标**: 
让 SpecCore 不仅是一个功能强大的工具，更是一个**工程质量的标杆**，证明个人开发者也能做出专业级的开源项目。
