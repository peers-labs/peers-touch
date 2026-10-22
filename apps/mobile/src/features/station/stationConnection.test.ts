import { afterEach, describe, expect, it, vi } from 'vitest';

const mobileCommandMocks = vi.hoisted(() => ({
  discoverStationEndpoint: vi.fn(),
  activateStationRouteBinding: vi.fn(),
  fetchActiveStationIdentity: vi.fn(),
  readStationRouteBinding: vi.fn(),
  restoreStationRouteBinding: vi.fn(),
}));

vi.mock('../../services/mobileCommands', () => mobileCommandMocks);

import {
  verifyStationIdentity,
  verifyStationRouteIdentity,
} from './stationConnection';

afterEach(() => {
  vi.clearAllMocks();
});

describe('Station identity handshake', () => {
  it('fails closed when the signed identity endpoint is unavailable', async () => {
    mobileCommandMocks.discoverStationEndpoint.mockRejectedValueOnce(
      new Error('mobile.launch.stationIdentityUnavailable'),
    );

    await expect(
      verifyStationIdentity('https://station.example'),
    ).rejects.toThrow('mobile.launch.stationIdentityUnavailable');
  });

  it('activates the requested route from a multi-route discovery result', async () => {
    const directRoute = {
      stationPeerId: 'station-peer',
      nodePeerId: 'station-node',
      stationRootPublicKey: [1],
      nodeAuthorizationDigest: [2],
      authorizationEpoch: 3,
      routeId: 'route-direct',
      routeType: 'direct' as const,
      transport: 'libp2p_http_v1' as const,
      endpointOrigin: 'https://station.example',
      routeGeneration: 4,
      innerTlsSpkiSha256: new Array(32).fill(3),
      addresses: ['/dns4/station.example/tcp/4001/p2p/station-node'],
      sourceRef: 'station-discovery',
    };
    mobileCommandMocks.discoverStationEndpoint.mockResolvedValueOnce({
      role: 'direct_station',
      endpointPeerId: 'station-node',
      canonicalOrigin: 'https://station.example',
      routes: [
        directRoute,
        {
          ...directRoute,
          routeId: 'route-relay',
          routeType: 'relay',
          transport: 'libp2p_http_v1',
          endpointOrigin: 'https://relay.example',
          relayPeerId: 'relay-peer',
        },
      ],
    });
    mobileCommandMocks.activateStationRouteBinding.mockResolvedValueOnce({
      stationPeerId: 'station-peer',
      routeId: 'route-direct',
      routeType: 'direct',
      endpointOrigin: 'https://station.example',
      routeGeneration: 4,
      routeRevision: 1,
      transportOrigin: 'https://station.example',
    });
    mobileCommandMocks.fetchActiveStationIdentity.mockResolvedValueOnce({
      stationPeerId: 'station-peer',
      nodePeerId: 'station-node',
      authorizationEpoch: 3,
      canonicalOrigin: 'https://station.example',
      capabilities: [],
      verifiedAt: 5,
      routeId: 'route-direct',
      routeType: 'direct',
    });

    await expect(
      verifyStationRouteIdentity('https://station.example', 'direct'),
    ).resolves.toMatchObject({
      routeId: 'route-direct',
      routeType: 'direct',
    });
    expect(mobileCommandMocks.activateStationRouteBinding).toHaveBeenCalledWith({
      stationPeerId: 'station-peer',
      routeId: 'route-direct',
      routeRevision: 1,
    });
  });
});
