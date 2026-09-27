import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildStationUrl,
  replaceStationEntryIdentity,
  type StoredStationRegistry,
} from './stationRegistry';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Station registry trust boundary', () => {
  it('accepts only a credential-free root HTTP origin', () => {
    expect(buildStationUrl({
      protocol: 'https',
      address: 'station.example:443',
    })).toBe('https://station.example');
    expect(buildStationUrl({
      protocol: 'http',
      address: '192.0.2.8:18080',
    })).toBe('http://192.0.2.8:18080');

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
