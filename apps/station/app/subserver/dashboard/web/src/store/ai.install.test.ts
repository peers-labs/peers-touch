import { beforeEach, expect, it, vi } from 'vitest';
import { ai, type Install, type Provider } from '../api/ai';
import { setAuthToken } from '../api/client';
import { useAIStore } from './ai';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const missing: Install = { install_state: 'missing', install_supported: true, manual_install_url: '' };
const installing: Install = { ...missing, install_state: 'installing', job_id: 'one', percent: 25 };
beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  setAuthToken(null);
  setAuthToken('admin');
  useAIStore.setState({ providers: [{ id: 'codex', runtime_kind: 'cli', ...missing } as Provider] });
});

it('deduplicates clicks while a pre-install status read completes late', async () => {
  const status = deferred<Install>();
  const started = deferred<Install>();
  vi.spyOn(ai, 'installStatus').mockReturnValueOnce(status.promise).mockResolvedValue(installing);
  const write = vi.spyOn(ai, 'install').mockReturnValue(started.promise);
  const poll = useAIStore.getState().pollInstalls();
  const start = useAIStore.getState().startInstall('codex');
  status.resolve(missing);
  await poll;
  expect(useAIStore.getState().installs.codex.install_state).toBe('installing');
  await useAIStore.getState().startInstall('codex');
  expect(write).toHaveBeenCalledTimes(1);
  started.resolve(installing);
  await start;
  expect(useAIStore.getState().installs.codex.percent).toBe(25);
});

it('keeps a failed install retryable', async () => {
  const write = vi.spyOn(ai, 'install').mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(installing);
  vi.spyOn(ai, 'installStatus').mockResolvedValue(installing);
  await useAIStore.getState().startInstall('codex');
  expect(useAIStore.getState().installs.codex.install_state).toBe('failed');
  await useAIStore.getState().startInstall('codex');
  expect(write).toHaveBeenCalledTimes(2);
  expect(useAIStore.getState().installs.codex.install_state).toBe('installing');
});

it('polls one shared adapter for multiple named profiles', async () => {
  useAIStore.setState({ providers: [
    { id: 'codex', cli_adapter_id: 'codex', runtime_kind: 'cli' },
    { id: 'team-a', cli_adapter_id: 'codex', runtime_kind: 'cli' },
    { id: 'team-b', cli_adapter_id: 'codex', runtime_kind: 'cli' },
  ] as Provider[] });
  const status = vi.spyOn(ai, 'installStatus').mockResolvedValue(missing);
  await useAIStore.getState().pollInstalls();
  expect(status).toHaveBeenCalledExactlyOnceWith('codex');
  expect(Object.keys(useAIStore.getState().installs)).toEqual(['codex']);
});

it('does not publish a completed install into the next administrator session', async () => {
  const started = deferred<Install>();
  vi.spyOn(ai, 'install').mockReturnValue(started.promise);
  const status = vi.spyOn(ai, 'installStatus').mockResolvedValue(installing);
  const start = useAIStore.getState().startInstall('codex');
  setAuthToken('next-admin');
  started.resolve(installing);
  await start;
  expect(useAIStore.getState().installs).toEqual({});
  expect(status).not.toHaveBeenCalled();
});
