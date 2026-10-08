/**
 * agent-dispatch 开关单元测试（v8.3.301+）
 *
 * 覆盖 settings.agent_dispatch.mode 三态对 SDK 派单的拦截语义：
 * - auto（默认）: 预检凭证（probeSdkAuth）通过才走 SDK；预检失败不发起调度
 * - on: 跳过预检，直接尝试 SDK（调度失败才回退标记模式）
 * - off: 即使凭证可用也不走 SDK（永远标记模式）
 * - 非法值/配置缺失兜底 auto
 *
 * 测试接缝：getQoderSdkAdapter 单例——spy probeSdkAuth / dispatchSubagent 类方法，
 * 断言开关拦截发生在调用前（SDK 内部行为由真实运行覆盖，本文件只测门控逻辑）。
 */

import { describe, it, expect, vi } from 'vitest';

// 宿主检测恒为 qoder（否则永远进不了 SDK 分支）；配置读取由各用例控制
vi.mock('../../../src/core/ask-host-ai', () => ({
  detectHostAi: vi.fn(() => 'qoder'),
}));
vi.mock('../../../src/core/unified-config', () => ({
  loadConfig: vi.fn(async () => ({ settings: {} })),
}));

type AgentAdapterModule = typeof import('../../../src/core/agent-adapter');
type ConfigModule = typeof import('../../../src/core/unified-config');

// 每次取全新模块实例，避免单例/缓存跨用例污染
async function freshModules(): Promise<{ adapter: AgentAdapterModule; config: ConfigModule }> {
  vi.resetModules();
  const adapter = await import('../../../src/core/agent-adapter');
  const config = await import('../../../src/core/unified-config');
  return { adapter, config };
}

function agentCtx() {
  return {
    subagent: 'code-generator',
    iteration: 'Iteration-001',
    contextBudget: 6000,
    contextType: 'incremental' as const,
    cwd: process.cwd(),
  };
}

describe('getSdkDispatchMode 三态解析', () => {
  it('配置缺失 / 非法值兜底 auto', async () => {
    const { adapter, config } = await freshModules();
    const mockLoad = vi.mocked(config.loadConfig);

    mockLoad.mockResolvedValue({ settings: {} } as any);
    expect(await adapter.getSdkDispatchMode()).toBe('auto');
    mockLoad.mockResolvedValue({ settings: { agent_dispatch: { mode: 'weird' } } } as any);
    expect(await adapter.getSdkDispatchMode()).toBe('auto');
  });

  it('on / off 直通', async () => {
    const { adapter, config } = await freshModules();
    const mockLoad = vi.mocked(config.loadConfig);

    mockLoad.mockResolvedValue({ settings: { agent_dispatch: { mode: 'on' } } } as any);
    expect(await adapter.getSdkDispatchMode()).toBe('on');
    mockLoad.mockResolvedValue({ settings: { agent_dispatch: { mode: 'off' } } } as any);
    expect(await adapter.getSdkDispatchMode()).toBe('off');
  });
});

describe('dispatchSubagent 开关拦截', () => {
  it('mode=off：不预检、不调度，直接标记模式（null）', async () => {
    const { adapter, config } = await freshModules();
    vi.mocked(config.loadConfig).mockResolvedValue({ settings: { agent_dispatch: { mode: 'off' } } } as any);
    const sdk = adapter.getQoderSdkAdapter();
    const probeSpy = vi.spyOn(sdk, 'probeSdkAuth').mockResolvedValue(true);
    const dispatchSpy = vi.spyOn(sdk, 'dispatchSubagent').mockResolvedValue({ success: true });

    const result = await adapter.dispatchSubagent(agentCtx(), '生成代码');
    expect(result).toBeNull();
    expect(probeSpy).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('mode=auto + 预检有凭证：走 SDK 并返回结果', async () => {
    const { adapter, config } = await freshModules();
    vi.mocked(config.loadConfig).mockResolvedValue({ settings: { agent_dispatch: { mode: 'auto' } } } as any);
    const sdk = adapter.getQoderSdkAdapter();
    const probeSpy = vi.spyOn(sdk, 'probeSdkAuth').mockResolvedValue(true);
    const dispatchSpy = vi.spyOn(sdk, 'dispatchSubagent').mockResolvedValue({ success: true });

    const result = await adapter.dispatchSubagent(agentCtx(), '生成代码');
    expect(result).not.toBeNull();
    expect(result?.success).toBe(true);
    expect(probeSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  it('mode=auto + 预检无凭证：拦截在调度前，不发 SDK 调用（null）', async () => {
    const { adapter, config } = await freshModules();
    vi.mocked(config.loadConfig).mockResolvedValue({ settings: { agent_dispatch: { mode: 'auto' } } } as any);
    const sdk = adapter.getQoderSdkAdapter();
    const probeSpy = vi.spyOn(sdk, 'probeSdkAuth').mockResolvedValue(false);
    const dispatchSpy = vi.spyOn(sdk, 'dispatchSubagent').mockResolvedValue({ success: true });

    const result = await adapter.dispatchSubagent(agentCtx(), '生成代码');
    expect(result).toBeNull();
    expect(probeSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('mode=on：跳过预检，直接尝试 SDK', async () => {
    const { adapter, config } = await freshModules();
    vi.mocked(config.loadConfig).mockResolvedValue({ settings: { agent_dispatch: { mode: 'on' } } } as any);
    const sdk = adapter.getQoderSdkAdapter();
    const probeSpy = vi.spyOn(sdk, 'probeSdkAuth').mockResolvedValue(false);
    const dispatchSpy = vi.spyOn(sdk, 'dispatchSubagent').mockResolvedValue({ success: true });

    const result = await adapter.dispatchSubagent(agentCtx(), '生成代码');
    expect(result).not.toBeNull();
    expect(probeSpy).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  it('mode=on + SDK 调度失败：回退标记模式（null）', async () => {
    const { adapter, config } = await freshModules();
    vi.mocked(config.loadConfig).mockResolvedValue({ settings: { agent_dispatch: { mode: 'on' } } } as any);
    const sdk = adapter.getQoderSdkAdapter();
    vi.spyOn(sdk, 'dispatchSubagent').mockResolvedValue(null);

    const result = await adapter.dispatchSubagent(agentCtx(), '生成代码');
    expect(result).toBeNull();
  });
});
