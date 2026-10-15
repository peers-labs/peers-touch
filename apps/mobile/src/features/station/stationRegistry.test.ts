import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildStationUrl,
  replaceStationEntryIdentity,
  type StoredStationRegistry,
} from './stationRegistry';

afterEach(() => {
  vi.restoreAllMocks();
});

function verifiedRoute(stationPeerId: string, endpointOrigin: string) {
  return {
    identity: {
      stationPeerId,
      url: endpointOrigin,
    },
    stationRootPublicKey: [1, 2, 3],
    route: {
      stationPeerId,
      stationRootPublicKey: [1, 2, 3],
      nodePeerId: `${stationPeerId}-node`,
      nodeAuthorizationDigest: Array(32).fill(4),
      authorizationEpoch: 1,
      routeId: `${stationPeerId}-direct`,
      routeType: 'direct' as const,
      transport: 'direct_https' as const,
      endpointOrigin,
      routeGeneration: 1,
      addresses: ['/dns4/station.example/tcp/443/tls/http'],
      sourceRef: 'station-registry-test',
    },
  };
}

describe('Station registry trust boundary', () => {
  it('accepts only a complete credential-free root HTTP origin', () => {
    expect(buildStationUrl('https://station.example/')).toBe('https://station.example');
    expect(buildStationUrl('http://192.168.1.8:18080/')).toBe('http://192.168.1.8:18080');

    expect(buildStationUrl('https://user:secret@station.example')).toBeNull();
    expect(buildStationUrl('https://station.example/path')).toBeNull();
    expect(buildStationUrl('https://station.example?redirect=other')).toBeNull();
    expect(buildStationUrl('https://station.example#fragment')).toBeNull();
    expect(buildStationUrl('station.example:443')).toBeNull();
  });

  it('replaces only the explicitly confirmed Station identity at that origin', () => {
    vi.spyOn(Date, 'now').mockReturnValue(30);
    const registry: StoredStationRegistry = {
      activeStationPeerId: 'station-old',
      entries: [
        {
          stationPeerId: 'station-old',
          url: 'https://station.example',
          label: 'Old Station',
          createdAt: 10,
          lastUsedAt: 20,
          online: true,
          identityVerified: true,
        },
        {
          stationPeerId: 'station-other',
          url: 'https://other.example',
          label: 'Other Station',
          createdAt: 5,
          lastUsedAt: 5,
          online: true,
          identityVerified: true,
        },
      ],
    };

    const result = replaceStationEntryIdentity(
      registry,
      'station-old',
      verifiedRoute('station-new', 'https://station.example/'),
      {
        checkedAt: 29,
        label: 'Replacement Station',
        online: true,
      },
    );

    expect(result).toEqual({
      ok: true,
      registry: {
        activeStationPeerId: 'station-new',
        entries: [
          {
            stationPeerId: 'station-new',
            url: 'https://station.example',
            label: 'Replacement Station',
            createdAt: 30,
            lastUsedAt: 30,
            lastCheckedAt: 29,
            online: true,
            identityVerified: true,
            pinnedStationRootPublicKey: [1, 2, 3],
            routes: [{
              nodePeerId: 'station-new-node',
              nodeAuthorizationDigest: Array(32).fill(4),
              authorizationEpoch: 1,
              routeId: 'station-new-direct',
              routeType: 'direct',
              transport: 'direct_https',
              endpointOrigin: 'https://station.example',
              routeGeneration: 1,
              addresses: ['/dns4/station.example/tcp/443/tls/http'],
              sourceRef: 'station-registry-test',
              lastVerifiedAt: 30,
              health: 'available',
            }],
            activeRouteId: 'station-new-direct',
            routeRevision: 1,
            lifecycleGeneration: 1,
          },
          registry.entries[1],
        ],
      },
    });
  });

  it('rejects replacement when the confirmed entry and origin do not match', () => {
    const registry: StoredStationRegistry = {
      activeStationPeerId: 'station-old',
      entries: [{
        stationPeerId: 'station-old',
        url: 'https://station.example',
        label: 'Old Station',
        createdAt: 10,
        lastUsedAt: 20,
      }],
    };

    expect(replaceStationEntryIdentity(
      registry,
      'station-old',
      verifiedRoute('station-new', 'https://other.example'),
    )).toEqual({
      ok: false,
      error: 'mobile.launch.stationIdentityInvalid',
    });
  });
});
