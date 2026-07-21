# Code Review Checklist

> SpecCore 项目自身的代码审查规则

## 提交前自检

- [ ] `npx tsc` 零错误
- [ ] `npx vitest run` 全部通过（或已知跳过的标明原因）
- [ ] 新增/修改命令有对应的 vitest 测试
- [ ] 新增 CLI 命令在 docs/命令参考.md 有文档

## 审查要点

| 检查项 | 标准 |
| :--- | :--- |
| 类型安全 | 零 `any` 类型，接口完整 |
| 错误处理 | try/catch 覆盖所有异步 IO 操作 |
| 命令参数 | CLI option 与命令实现一致（alias、描述、默认值） |
| 日志输出 | 使用 `logger.info/warn/error`，不用 `console.log` |
| 文件操作 | 使用 `fs-extra`，不用原生 `fs` |
| 路径处理 | 使用 `join()` 不用字符串拼接 |
| 边界情况 | 空文件、缺失文件、中文路径、特殊字符 |
| 向后兼容 | 不修改现有命令的默认行为 |

## 测试覆盖要求

| 模块 | 最低覆盖 |
| :--- | :--- |
| core/context、core/state | 80% |
| 命令处理函数 | 主要路径 + 错误路径 |
| intent-recognition | 36 种意图各一条测试 |
| schema 校验 | 非法输入 + 合法输入 |

## 项目级规范

- `CONSTITUTION.md` 变更需要团队 Review
- 版本号在 `package.json` 中手动维护
- 发布前运行 `npm run build && npm test`
