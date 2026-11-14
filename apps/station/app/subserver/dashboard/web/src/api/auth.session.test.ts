import { beforeEach, describe, expect, it, vi } from 'vitest';
import client, { controlPlanePost, getAuthToken, setAuthToken } from './client';
import { changePassword, logout } from './auth';
import { useAuthStore } from '../store/auth';
import { useAIStore } from '../store/ai';
import type { AxiosAdapter, AxiosResponse } from 'axios';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('Dashboard account isolation', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
    vi.stubGlobal('window', { location: { hash: '' } });
    setAuthToken(null);
  });

  it('rejects a queued management write before transport after an account switch', async () => {
    const adapter = vi.fn<AxiosAdapter>();
    client.defaults.adapter = adapter;
    setAuthToken('old-token');
    const pending = controlPlanePost('/ai/providers/update', { id: 'ark' });
    setAuthToken('new-token');
    await expect(pending).rejects.toThrow('Dashboard account changed');
    expect(adapter).not.toHaveBeenCalled();
  });

  it.each([
    ['logout', () => logout()],
    ['password change', () => changePassword('old', 'new')],
  ])('does not clear a new session after an old %s completes', async (_, action) => {
    const response = deferred<AxiosResponse>();
    const dispatched = deferred<void>();
    client.defaults.adapter = (config) => {
      expect(config.headers.Authorization).toBe('Bearer old-token');
      dispatched.resolve();
      return response.promise;
    };
    setAuthToken('old-token');
    const pending = action();
    await dispatched.promise;
    setAuthToken('new-token');
    response.resolve({ data: {}, status: 200 } as AxiosResponse);
    await expect(pending).rejects.toThrow('Dashboard account changed');
    expect(getAuthToken()).toBe('new-token');
  });

  it('ignores a late unauthorized response from a previous administrator', async () => {
    const response = deferred<AxiosResponse>();
    const dispatched = deferred<void>();
    let config: unknown;
    client.defaults.adapter = (request) => {
      config = request;
      dispatched.resolve();
      return response.promise;
    };
    setAuthToken('old-token');
    const pending = client.get('/auth/me').catch(() => undefined);
    await dispatched.promise;
    setAuthToken('new-token');
    response.reject(Object.assign(new Error('unauthorized'), { config, response: { status: 401 } }));
    await pending;
    expect(getAuthToken()).toBe('new-token');
    expect(window.location.hash).toBe('');
  });

  it('keeps the newer login loading when an older login fails', async () => {
    const first = deferred<AxiosResponse>();
    const second = deferred<AxiosResponse>();
    let calls = 0;
    client.defaults.adapter = () => (++calls === 1 ? first.promise : second.promise);
    const oldLogin = useAuthStore.getState().login('old-admin', 'password');
    await Promise.resolve();
    const newLogin = useAuthStore.getState().login('new-admin', 'password');
    await Promise.resolve();
    first.reject(new Error('invalid credentials'));
    expect(await oldLogin).toBe(false);
    expect(useAuthStore.getState().loading).toBe(true);
    expect(useAuthStore.getState().error).toBeNull();
    second.resolve({ data: { token: 'new-token', admin: { username: 'new-admin' } }, status: 200 } as AxiosResponse);
    expect(await newLogin).toBe(true);
    expect(useAuthStore.getState().admin?.username).toBe('new-admin');
  });

  it('immediately clears shared management projections when authentication changes', () => {
    useAIStore.setState({ selected: 'ark', installs: { ark: { install_state: 'installing' } as never } });
    setAuthToken('new-token');
    expect(useAIStore.getState().selected).toBe('');
    expect(useAIStore.getState().installs).toEqual({});
  });
});
