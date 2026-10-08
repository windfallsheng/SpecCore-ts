/**
 * agent-dispatch 默认值静态断言（v8.3.301+）
 *
 * DEFAULT_CONFIG.settings.agent_dispatch 是 deepMerge 自动补全的依据——
 * 缺默认值会导致老项目升级后 settings.agent_dispatch 恒为 undefined。
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/core/unified-config';

describe('DEFAULT_CONFIG.settings.agent_dispatch', () => {
  it('默认 mode=auto（保持 v8.3.300 前行为：有 token 才走 SDK）', () => {
    expect(DEFAULT_CONFIG.settings.agent_dispatch).toEqual({ mode: 'auto' });
  });
});
