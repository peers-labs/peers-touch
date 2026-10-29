import { expect, it, vi } from 'vitest';

const scope = { actorPtid: 'ptid:peer:alice', stationPeerId: 'station-a', sessionEpoch: 1 };
vi.mock('../utils/logger', () => ({ log: { info: vi.fn(), error: vi.fn() } }));
import { registerIdentityHandler, runIdentityPipeline } from './identityPipeline';

it('preserves the outgoing identity and completes teardown when storage cleanup fails', async () => {
  vi.stubGlobal('fetch', undefined);
  const cleanup = vi.fn(async () => { throw new Error('storage unavailable'); });
  const teardown = vi.fn();
  registerIdentityHandler('test-storage', cleanup);
  registerIdentityHandler('test-teardown', teardown);
  const result = await runIdentityPipeline({ reason: 'logout', actorPtid: null, loginMethod: null }, scope);
  expect(cleanup).toHaveBeenCalledWith(expect.objectContaining({ previousScope: scope }));
  expect(teardown).toHaveBeenCalledOnce();
  expect(result).toMatchObject({ ok: false, failures: [{ handlerName: 'test-storage' }] });
  vi.unstubAllGlobals();
});
