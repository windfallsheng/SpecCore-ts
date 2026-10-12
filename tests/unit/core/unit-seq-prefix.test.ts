/**
 * 功能单元目录名前缀剥离回归基线（v8.3.309+）
 *
 * stripUnitSeqPrefix 将功能单元目录名 {文档}-{序号}-{slug} 剥离为语义尾段，
 * 供 taskify 生成任务目录 topic（Task-NNN-{语义段}），保证任务目录与切分单元一一对应。
 * 修复历史：Task-033-21 残片（AI 未回填英文名时 slugify 章节名「2.1 用户管理」→「21」）。
 */

import { describe, it, expect } from 'vitest';
import { stripUnitSeqPrefix } from '../../../src/commands/iteration/taskify';

describe('stripUnitSeqPrefix', () => {
  it('标准单元目录名：剥离 {文档}-{序号}- 前缀取语义尾段', () => {
    expect(stripUnitSeqPrefix('new-feature-notification-01-inbox-notification')).toBe('inbox-notification');
    expect(stripUnitSeqPrefix('admin-web-03-yudingguanli')).toBe('yudingguanli');
    expect(stripUnitSeqPrefix('single-01-meeting-room-rules')).toBe('meeting-room-rules');
  });

  it('多段语义尾段完整保留（文档名含连字符）', () => {
    expect(stripUnitSeqPrefix('order-notification-02-order-status-push')).toBe('order-status-push');
  });

  it('自创英文名（无序号段）：原样返回', () => {
    expect(stripUnitSeqPrefix('user-auth')).toBe('user-auth');
    expect(stripUnitSeqPrefix('login-flow')).toBe('login-flow');
  });

  it('文档名含 4 位数字（年份）：不误剥（回溯到真正的 2 位序号）', () => {
    // meeting-2024-01-yuding：序号是 01，docSlug 是 meeting-2024
    expect(stripUnitSeqPrefix('meeting-2024-01-yuding')).toBe('yuding');
  });

  it('中文名：无序号段，原样返回（调用方另有拼音兜底）', () => {
    expect(stripUnitSeqPrefix('用户管理')).toBe('用户管理');
  });

  it('语义尾段含数字词：仅剥离最左 {前缀}-{2位序号}- 结构', () => {
    // docSlug=app，序号=02，尾段=5g-network-booking
    expect(stripUnitSeqPrefix('app-02-5g-network-booking')).toBe('5g-network-booking');
  });
});
