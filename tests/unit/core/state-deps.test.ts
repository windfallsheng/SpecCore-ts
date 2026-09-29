import { describe, it, expect } from 'vitest';
import { parseDepsFromTaskMd } from '../../../src/core/state';

/**
 * v8.3.291: TASK.md「依赖任务」解析回归测试
 * 背景：scanTasks 此前对 dependencies 硬编码空数组，导致 plan 拓扑排期
 * 与 execute 依赖分支合并永远拿不到依赖。
 */
describe('parseDepsFromTaskMd — TASK.md 依赖任务解析', () => {
  it('解析子任务 TASK.md 的「- **依赖任务**: Task-xxx」格式', () => {
    const md = `## 跨端关联
- **共享能力**: 无
- **依赖任务**: Task-002-f1-booking
- **跨端说明**: —`;
    expect(parseDepsFromTaskMd(md)).toEqual(['Task-002-f1-booking']);
  });

  it('解析父任务 TASK.md 的表格「| 依赖任务 | Task-xxx |」格式', () => {
    const md = `| 属性 | 值 |
|:---|:---|
| 共享能力 | 无 |
| 依赖任务 | Task-002-f1-booking |
| 跨端说明 | — |`;
    expect(parseDepsFromTaskMd(md)).toEqual(['Task-002-f1-booking']);
  });

  it('解析逗号/顿号分隔的多依赖', () => {
    const md = `- **依赖任务**: Task-001-user, Task-002-order、Task-003-pay`;
    expect(parseDepsFromTaskMd(md)).toEqual([
      'Task-001-user',
      'Task-002-order',
      'Task-003-pay',
    ]);
  });

  it('「无」依赖返回空数组', () => {
    expect(parseDepsFromTaskMd(`- **依赖任务**: 无`)).toEqual([]);
    expect(parseDepsFromTaskMd(`| 依赖任务 | — |`)).toEqual([]);
    expect(parseDepsFromTaskMd(`| 依赖任务 | - |`)).toEqual([]);
  });

  it('无「依赖任务」字段返回空数组', () => {
    expect(parseDepsFromTaskMd(`# 某任务\n## 实施步骤\n- 步骤一`)).toEqual([]);
  });

  it('过滤非 Task- 前缀的噪声内容', () => {
    const md = `- **依赖任务**: Task-002-f1-booking, 待补充`;
    expect(parseDepsFromTaskMd(md)).toEqual(['Task-002-f1-booking']);
  });

  it('去重：重复依赖只保留一次', () => {
    const md = `| 依赖任务 | Task-002-f1-booking Task-002-f1-booking |`;
    expect(parseDepsFromTaskMd(md)).toEqual(['Task-002-f1-booking']);
  });
});
