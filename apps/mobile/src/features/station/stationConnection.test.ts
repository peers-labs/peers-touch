import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/mobileCommands', () => ({
  discoverStationEndpoint: vi.fn(async () => {
    throw new Error('mobile.launch.stationIdentityUnavailable');
  }),
  activateStationRouteBinding: vi.fn(),
  fetchActiveStationIdentity: vi.fn(),
  readStationRouteBinding: vi.fn(),
  restoreStationRouteBinding: vi.fn(),
}));

import { verifyStationIdentity } from './stationConnection';

afterEach(() => {
  vi.clearAllMocks();
});

describe('Station identity handshake', () => {
  it('fails closed when the signed identity endpoint is unavailable', async () => {
    await expect(
      verifyStationIdentity('https://station.example'),
    ).rejects.toThrow('mobile.launch.stationIdentityUnavailable');
  });
});
