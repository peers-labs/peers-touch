// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { describe, expect, it, vi } from 'vitest';

import {
  activateStationEntry,
  updateStationEntryStatus,
  type MobileStationEntry,
  type StoredStationRegistry,
} from '../features/station/stationRegistry';
import {
  createStationRegistryRuntime,
  verifyStationEntryRuntime,
} from './stationRuntime';

const PRIMARY = 'station-primary';
const SECONDARY = 'station-secondary';

describe('stationRuntime', () => {
  it('serializes Station selection and delayed probe updates through one owner', async () => {
    const writes: StoredStationRegistry[] = [];
    const runtime = createStationRegistryRuntime({
      load: async () => registry(SECONDARY),
      persist: async (next) => {
        writes.push(next);
      },
    });

    await runtime.bootstrap();
    const select = runtime.update((current) => (
      activateStationEntry(current, PRIMARY)
    ));
    const delayedProbe = runtime.update((current) => (
      updateStationEntryStatus(current, SECONDARY, {
        checkedAt: 42,
        online: true,
      })
    ));

    await Promise.all([select, delayedProbe]);

    expect(runtime.getSnapshot()).toMatchObject({
      activeStationPeerId: PRIMARY,
      entries: expect.arrayContaining([
        expect.objectContaining({
          stationPeerId: SECONDARY,
          lastCheckedAt: 42,
          online: true,
        }),
      ]),
    });
    expect(writes.map((entry) => entry.activeStationPeerId)).toEqual([
      PRIMARY,
      PRIMARY,
    ]);
  });

  it('hydrates once and publishes only committed snapshots', async () => {
    const loaded = registry(PRIMARY);
    const load = vi.fn(async () => loaded);
    const persist = vi.fn(async () => undefined);
    const runtime = createStationRegistryRuntime({ load, persist });
    const listener = vi.fn();
    runtime.subscribe(listener);

    await Promise.all([runtime.bootstrap(), runtime.read()]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(runtime.getSnapshot()).toBe(loaded);

    await runtime.update((current) => current);
    expect(persist).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('renews the exact persisted route before Station admission', async () => {
    const verifyRoute = vi.fn(async () => ({
      stationPeerId: SECONDARY,
      canonicalOrigin: 'https://station-secondary.example',
      verifiedAt: 42,
      identityVerified: true as const,
      routeId: 'route-secondary',
      routeType: 'direct' as const,
    }));
    const station: MobileStationEntry = {
      stationPeerId: SECONDARY,
      url: 'https://station-secondary.example',
      label: SECONDARY,
      createdAt: 1,
      lastUsedAt: 1,
      activeRouteId: 'route-secondary',
      routeRevision: 3,
      routes: [{
        nodePeerId: 'node-secondary',
        nodeAuthorizationDigest: [1],
        authorizationEpoch: 2,
        routeId: 'route-secondary',
        routeType: 'direct',
        transport: 'libp2p_http_v1',
        endpointOrigin: 'https://station-secondary.example',
        routeGeneration: 4,
        addresses: [],
        sourceRef: 'station-secondary-source',
        lastVerifiedAt: 1,
        health: 'available',
      }],
    };

    await expect(
      verifyStationEntryRuntime(station, verifyRoute),
    ).resolves.toMatchObject({
      stationPeerId: SECONDARY,
      routeId: 'route-secondary',
    });
    expect(verifyRoute).toHaveBeenCalledWith({
      stationPeerId: SECONDARY,
      routeId: 'route-secondary',
      routeGeneration: 4,
      routeRevision: 3,
      sourceRef: 'station-secondary-source',
      endpointOrigin: 'https://station-secondary.example',
    });
  });
});

function registry(activeStationPeerId: string): StoredStationRegistry {
  return {
    activeStationPeerId,
    entries: [PRIMARY, SECONDARY].map((stationPeerId, index) => ({
      stationPeerId,
      url: `https://${stationPeerId}.example`,
      label: stationPeerId,
      createdAt: index + 1,
      lastUsedAt: index + 1,
      identityVerified: true,
    })),
  };
}
