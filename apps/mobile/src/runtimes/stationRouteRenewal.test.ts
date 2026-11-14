// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const refreshStationRouteBinding = vi.fn();
const restoreStationRouteBinding = vi.fn();
const readStationRouteBinding = vi.fn();

vi.mock('../services/mobileCommands', () => ({
  refreshStationRouteBinding: (...args: unknown[]) =>
    refreshStationRouteBinding(...args),
  restoreStationRouteBinding: (...args: unknown[]) =>
    restoreStationRouteBinding(...args),
  readStationRouteBinding: (...args: unknown[]) =>
    readStationRouteBinding(...args),
}));
vi.mock('../features/station/stationConnection', () => ({
  verifyBoundStationRoute: vi.fn(),
}));
vi.mock('../storage/mobileClientStorage', () => ({
  purgeLegacyMobileIdentityStorage: vi.fn(),
  createMobileAppStorageRuntime: () => ({
    repositories: {
      stationRegistry: {
        readValue: vi.fn(async () => null),
        write: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
      },
    },
  }),
}));

import {
  startStationRouteRenewal,
  stopStationRouteRenewal,
  refreshActiveStationRoute,
  replaceStationRegistryProjection,
} from './stationRuntime';

const STATION_PEER = 'station-1';
const ROUTE = 'route-1';

function registryWithRoute(attestationExpiresAtUnixMs?: number) {
  return {
    activeStationPeerId: STATION_PEER,
    entries: [
      {
        stationPeerId: STATION_PEER,
        url: 'https://station-1.example',
        label: 'station-1',
        createdAt: 1,
        lastUsedAt: 1,
        activeRouteId: ROUTE,
        routeRevision: 3,
        routes: [
          {
            nodePeerId: 'node-1',
            nodeAuthorizationDigest: [1],
            authorizationEpoch: 1,
            routeId: ROUTE,
            routeType: 'direct',
            transport: 'libp2p_http_v1',
            endpointOrigin: 'https://station-1.example',
            routeGeneration: 7,
            addresses: [],
            sourceRef: 'station-1-source',
            lastVerifiedAt: 1,
            health: 'available',
            ...(attestationExpiresAtUnixMs === undefined
              ? {}
              : { attestationExpiresAtUnixMs }),
          },
        ],
      },
    ],
  };
}

describe('startStationRouteRenewal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshStationRouteBinding.mockReset();
    restoreStationRouteBinding.mockReset();
    readStationRouteBinding.mockReset();
    stopStationRouteRenewal();
  });

  afterEach(() => {
    stopStationRouteRenewal();
    vi.useRealTimers();
  });

  it('refreshes the active route once its attestation renewal window opens', async () => {
    const now = 1_000_000;
    vi.setSystemTime(now);
    const expiry = now + 120_000; // window opens 60s before expiry
    await replaceStationRegistryProjection(registryWithRoute(expiry));
    readStationRouteBinding.mockResolvedValue({
      stationPeerId: STATION_PEER,
      routeId: ROUTE,
      routeRevision: 3,
    });

    refreshStationRouteBinding.mockResolvedValue({
      binding: {
        stationPeerId: STATION_PEER,
        routeId: ROUTE,
        routeType: 'direct',
        endpointOrigin: 'https://station-1.example',
        routeGeneration: 7,
        routeRevision: 4,
        transportOrigin: 'http://127.0.0.1:9000',
      },
      route: {
        stationPeerId: STATION_PEER,
        nodePeerId: 'node-1',
        stationRootPublicKey: [],
        nodeAuthorizationDigest: [1],
        authorizationEpoch: 1,
        routeId: ROUTE,
        routeType: 'direct',
        transport: 'libp2p_http_v1',
        endpointOrigin: 'https://station-1.example',
        routeGeneration: 7,
        addresses: [],
        attestationExpiresAtUnixMs: expiry + 60_000,
        sourceRef: 'station-1-source',
      },
    });

    startStationRouteRenewal();
    expect(refreshStationRouteBinding).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(70_000);
    expect(refreshStationRouteBinding).toHaveBeenCalledTimes(1);
  });

  it('never schedules a renewal when the route attestation expiry is absent', async () => {
    await replaceStationRegistryProjection(registryWithRoute(undefined));

    startStationRouteRenewal();
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(refreshStationRouteBinding).not.toHaveBeenCalled();
  });
});

describe('refreshActiveStationRoute', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshStationRouteBinding.mockReset();
    restoreStationRouteBinding.mockReset();
    readStationRouteBinding.mockReset();
    stopStationRouteRenewal();
  });

  afterEach(() => {
    stopStationRouteRenewal();
    vi.useRealTimers();
  });

  it('exposes a manual refresh path that drives the real binding command', async () => {
    await replaceStationRegistryProjection(
      registryWithRoute(Date.now() + 120_000),
    );
    readStationRouteBinding.mockResolvedValue({
      stationPeerId: STATION_PEER,
      routeId: ROUTE,
      routeRevision: 3,
    });
    refreshStationRouteBinding.mockResolvedValue({
      binding: {
        stationPeerId: STATION_PEER,
        routeId: ROUTE,
        routeType: 'direct',
        endpointOrigin: 'https://station-1.example',
        routeGeneration: 7,
        routeRevision: 4,
        transportOrigin: 'http://127.0.0.1:9000',
      },
      route: {
        stationPeerId: STATION_PEER,
        nodePeerId: 'node-1',
        stationRootPublicKey: [],
        nodeAuthorizationDigest: [1],
        authorizationEpoch: 1,
        routeId: ROUTE,
        routeType: 'direct',
        transport: 'libp2p_http_v1',
        endpointOrigin: 'https://station-1.example',
        routeGeneration: 7,
        addresses: [],
        attestationExpiresAtUnixMs: Date.now() + 180_000,
        sourceRef: 'station-1-source',
      },
    });

    await refreshActiveStationRoute();
    expect(refreshStationRouteBinding).toHaveBeenCalledTimes(1);
  });
});
