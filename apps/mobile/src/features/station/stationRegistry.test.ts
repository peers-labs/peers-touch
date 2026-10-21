import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NativeStationRouteCandidate } from '../../services/mobileCommands';
import {
  addStationRoute,
  buildStationUrl,
  emptyStationRegistry,
  replaceStationEntryIdentity,
  type StoredStationRegistry,
} from './stationRegistry';

afterEach(() => {
  vi.restoreAllMocks();
});

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
      {
        stationPeerId: 'station-new',
        url: 'https://station.example/',
      },
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
      {
        stationPeerId: 'station-new',
        url: 'https://other.example',
      },
    )).toEqual({
      ok: false,
      error: 'mobile.launch.stationIdentityInvalid',
    });
  });

  it('accepts the unified libp2p transport for a verified Direct route', () => {
    vi.spyOn(Date, 'now').mockReturnValue(30);
    const route: NativeStationRouteCandidate = {
      stationPeerId: 'station-a',
      nodePeerId: 'node-a',
      stationRootPublicKey: [1, 2, 3],
      nodeAuthorizationDigest: Array(32).fill(4),
      authorizationEpoch: 1,
      routeId: 'direct-node-a',
      routeType: 'direct',
      transport: 'libp2p_http_v1',
      endpointOrigin: 'http://10.37.94.156:18080',
      routeGeneration: 1,
      innerTlsSpkiSha256: Array(32).fill(5),
      addresses: ['/ip4/10.37.94.156/tcp/4001/p2p/node-a'],
      attestationBytes: [6],
      attestationExpiresAtUnixMs: 60,
      sourceRef: 'a'.repeat(64),
    };

    const result = addStationRoute(
      emptyStationRegistry(),
      {
        identity: {
          stationPeerId: route.stationPeerId,
          url: route.endpointOrigin,
        },
        stationRootPublicKey: route.stationRootPublicKey,
        route,
      },
      {
        checkedAt: 29,
        online: true,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registry.entries[0]?.routes?.[0]).toMatchObject({
      routeId: route.routeId,
      routeType: 'direct',
      transport: 'libp2p_http_v1',
      innerTlsSpkiSha256: route.innerTlsSpkiSha256,
    });
  });

  it('rejects the removed direct HTTPS transport', () => {
    const route = {
      stationPeerId: 'station-a',
      nodePeerId: 'node-a',
      stationRootPublicKey: [1, 2, 3],
      nodeAuthorizationDigest: Array(32).fill(4),
      authorizationEpoch: 1,
      routeId: 'legacy-direct-node-a',
      routeType: 'direct',
      transport: 'direct_https',
      endpointOrigin: 'https://station.example',
      routeGeneration: 1,
      innerTlsSpkiSha256: Array(32).fill(5),
      addresses: ['https://station.example'],
      sourceRef: 'b'.repeat(64),
    } as unknown as NativeStationRouteCandidate;

    expect(addStationRoute(
      emptyStationRegistry(),
      {
        identity: {
          stationPeerId: route.stationPeerId,
          url: route.endpointOrigin,
        },
        stationRootPublicKey: route.stationRootPublicKey,
        route,
      },
    )).toEqual({
      ok: false,
      error: 'mobile.launch.stationIdentityInvalid',
    });
  });
});
