import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  activeStationRoute,
  activateStationRoute,
  addStationRoute,
  buildStationUrl,
  replaceStationEntryIdentity,
  type StoredStationRegistry,
} from './stationRegistry';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Station registry trust boundary', () => {
  it('keeps Direct and Relay as routes under one Station identity', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(20).mockReturnValueOnce(30);
    const direct = addStationRoute(
      { activeStationPeerId: '', entries: [] },
      {
        identity: {
          stationPeerId: 'station-one',
          url: 'https://station.example',
        },
        stationHostPublicKey: [1, 2, 3],
        route: {
          stationPeerId: 'station-one',
          stationHostPublicKey: [1, 2, 3],
          routeId: 'direct-one',
          routeType: 'direct',
          transport: 'direct_https',
          endpointOrigin: 'https://station.example',
          routeGeneration: 1,
          sourceRef: 'direct-source',
        },
      },
    );
    expect(direct.ok).toBe(true);
    if (!direct.ok) return;

    const relay = addStationRoute(direct.registry, {
      identity: {
        stationPeerId: 'station-one',
        url: 'https://station.example',
      },
      stationHostPublicKey: [1, 2, 3],
      route: {
        stationPeerId: 'station-one',
        stationHostPublicKey: [1, 2, 3],
        routeId: 'relay-one',
        routeType: 'relay',
        transport: 'relay_wss_v1',
        endpointOrigin: 'https://relay.example',
        relayPeerId: 'relay-peer',
        routeGeneration: 7,
        innerTlsSpkiSha256: Array(32).fill(4),
        attestationBytes: [5, 6],
        attestationExpiresAtUnixMs: 2_000_000_000_000,
        sourceRef: 'relay-source',
      },
    });
    expect(relay.ok).toBe(true);
    if (!relay.ok) return;

    const entry = relay.registry.entries[0];
    expect(entry.routes).toHaveLength(2);
    expect(activeStationRoute(entry)?.routeType).toBe('relay');
    expect(entry.routeRevision).toBe(2);
    expect(entry.lifecycleGeneration).toBe(1);

    const switched = activateStationRoute(
      relay.registry,
      'station-one',
      'direct-one',
    );
    const switchedEntry = switched.entries[0];
    expect(activeStationRoute(switchedEntry)?.routeType).toBe('direct');
    expect(switchedEntry.routeRevision).toBe(3);
    expect(switchedEntry.lifecycleGeneration).toBe(1);
  });

  it('rejects a route signed by a different pinned Station host key', () => {
    const first = addStationRoute(
      { activeStationPeerId: '', entries: [] },
      {
        identity: { stationPeerId: 'station-one', url: 'https://station.example' },
        stationHostPublicKey: [1],
        route: {
          stationPeerId: 'station-one',
          stationHostPublicKey: [1],
          routeId: 'direct-one',
          routeType: 'direct',
          transport: 'direct_https',
          endpointOrigin: 'https://station.example',
          routeGeneration: 1,
          sourceRef: 'direct-source',
        },
      },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(addStationRoute(first.registry, {
      identity: { stationPeerId: 'station-one', url: 'https://station.example' },
      stationHostPublicKey: [9],
      route: {
        stationPeerId: 'station-one',
        stationHostPublicKey: [9],
        routeId: 'relay-one',
        routeType: 'relay',
        transport: 'relay_wss_v1',
        endpointOrigin: 'https://relay.example',
        relayPeerId: 'relay-peer',
        routeGeneration: 1,
        sourceRef: 'relay-source',
      },
    })).toEqual({
      ok: false,
      error: 'mobile.launch.stationIdentityMismatch',
    });
  });

  it('accepts only a credential-free root HTTP origin', () => {
    expect(buildStationUrl({
      protocol: 'https',
      address: 'station.example:443',
    })).toBe('https://station.example');
    expect(buildStationUrl({
      protocol: 'http',
      address: '192.168.1.8:18080',
    })).toBe('http://192.168.1.8:18080');

    expect(buildStationUrl({
      protocol: 'https',
      address: 'user:secret@station.example',
    })).toBeNull();
    expect(buildStationUrl({
      protocol: 'https',
      address: 'station.example/path',
    })).toBeNull();
    expect(buildStationUrl({
      protocol: 'https',
      address: 'station.example?redirect=other',
    })).toBeNull();
    expect(buildStationUrl({
      protocol: 'https',
      address: 'station.example#fragment',
    })).toBeNull();
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
});
