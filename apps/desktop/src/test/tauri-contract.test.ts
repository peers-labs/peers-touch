import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { AuthCommandException, api } from '../services/api';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('TS ↔ Rust command contract', () => {
  const invokeMock = vi.mocked(invoke);

  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('调用 auth_login 并透传 input', async () => {
    invokeMock.mockResolvedValue({
      ok: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'auth_login is not implemented',
      },
    });

    let rejectedError: unknown;
    let resolvedValue: unknown;
    try {
      resolvedValue = await api.authLogin({
        account: 'demo',
        password: 'pwd',
        base_url: 'http://localhost:8420',
      });
    } catch (error) {
      rejectedError = error;
    }

    expect(invokeMock).toHaveBeenCalledWith('auth_login', {
      input: {
        account: 'demo',
        password: 'pwd',
        base_url: 'http://localhost:8420',
      },
    });
    if (rejectedError) {
      expect(rejectedError).toBeInstanceOf(AuthCommandException);
      return;
    }
    expect(resolvedValue).toMatchObject({
      ok: false,
      error: {
        code: 'NOT_IMPLEMENTED',
      },
    });
  });

  it('调用 chat_list_messages 并透传分页参数', async () => {
    invokeMock.mockResolvedValue({
      ok: true,
      data: {
        command: 'chat_list_messages',
        status: 'stub',
      },
    });

    const result = await api.chatListMessages({
      conversation_id: 'c-1',
      cursor: 'next-1',
      limit: 20,
    });

    expect(invokeMock).toHaveBeenCalledWith('chat_list_messages', {
      input: {
        conversation_id: 'c-1',
        cursor: 'next-1',
        limit: 20,
      },
    });
    expect(result.ok).toBe(true);
    expect(result.data?.command).toBe('chat_list_messages');
  });

  it('调用 settings_set 并返回统一结构', async () => {
    invokeMock.mockResolvedValue({
      ok: true,
      data: {
        command: 'settings_set',
        status: 'stub',
      },
    });

    const result = await api.settingsSet({
      key: 'settings.currentAgent',
      value: 'assistant',
    });

    expect(invokeMock).toHaveBeenCalledWith('settings_set', {
      input: {
        key: 'settings.currentAgent',
        value: 'assistant',
      },
    });
    expect(result).toEqual({
      ok: true,
      data: {
        command: 'settings_set',
        status: 'stub',
      },
    });
  });

  it('无 input 的命令不传入参数对象', async () => {
    invokeMock.mockResolvedValue({
      ok: true,
      data: {
        command: 'admin_health',
        status: 'stub',
      },
    });

    const result = await api.adminHealth();

    expect(invokeMock).toHaveBeenCalledWith('admin_health', undefined);
    expect(result.ok).toBe(true);
  });

  it('invoke 异常时映射为统一错误码', async () => {
    invokeMock.mockRejectedValue(new Error('bridge failure'));

    const result = await api.timelineList({ limit: 10 });

    expect(invokeMock).toHaveBeenCalledWith('timeline_list', {
      input: { limit: 10 },
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INTERNAL_ERROR');
    expect(result.error?.message).toContain('bridge failure');
  });
});
