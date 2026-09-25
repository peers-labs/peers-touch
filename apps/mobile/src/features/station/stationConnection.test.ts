import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/mobileCommands', () => ({
  verifyStationIdentityProof: vi.fn(),
}));

import { verifyStationIdentity } from './stationConnection';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Station identity handshake', () => {
  it('fails closed when the signed identity endpoint is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {
      status: 404,
    })));

    await expect(
      verifyStationIdentity('https://station.example'),
    ).rejects.toThrow('mobile.launch.stationIdentityUnavailable');
  });
});
