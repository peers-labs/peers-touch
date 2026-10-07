import { describe, expect, it, vi } from 'vitest';
import { configureAcceptanceStation } from './stationAccess';

describe('configureAcceptanceStation', () => {
  it('pins the signed Station identity before reporting the access gate ready', async () => {
    const calls: string[] = [];
    const stationApi = {
      stationAdd: vi.fn(async (url: string) => {
        calls.push(`add:${url}`);
        return {
          role: 'direct_station' as const,
          endpoint_peer_id: 'station-peer',
          canonical_origin: url,
          entries: [{
            station_peer_id: 'station-peer',
            display_name: 'Station',
            pinned_host_public_key: [1],
            active_route_id: 'route-direct',
            route_revision: 1,
            lifecycle_generation: 1,
            created_at: '2026-10-07T00:00:00Z',
            updated_at: '2026-10-07T00:00:00Z',
            routes: [{
              route_id: 'route-direct',
              route_type: 'direct' as const,
              transport: 'https',
              endpoint_origin: url,
              route_generation: 1,
              last_verified_at: '2026-10-07T00:00:00Z',
              health: 'available' as const,
            }],
          }],
        };
      }),
      stationSetActive: vi.fn(async (stationPeerId: string, routeId?: string) => {
        calls.push(`activate:${stationPeerId}:${routeId}`);
        return {
          active_station_peer_id: stationPeerId,
          active_route_id: routeId,
          binding: {
            phase: 'access_gate' as const,
            station_peer_id: stationPeerId,
            active_route_id: routeId,
            route_revision: 1,
            lifecycle_generation: 1,
          },
        };
      }),
      stationList: vi.fn(async () => {
        calls.push('list');
        return {
          active_station_peer_id: 'station-peer',
          binding: {
            phase: 'access_gate' as const,
            station_peer_id: 'station-peer',
            active_route_id: 'route-direct',
            route_revision: 1,
            lifecycle_generation: 1,
          },
          entries: [{
            station_peer_id: 'station-peer',
            display_name: 'Station',
            pinned_host_public_key: [1],
            active_route_id: 'route-direct',
            route_revision: 1,
            lifecycle_generation: 1,
            created_at: '2026-10-07T00:00:00Z',
            updated_at: '2026-10-07T00:00:00Z',
            routes: [{
              route_id: 'route-direct',
              route_type: 'direct' as const,
              transport: 'https',
              endpoint_origin: 'https://station.invalid',
              route_generation: 1,
              last_verified_at: '2026-10-07T00:00:00Z',
              health: 'available' as const,
            }],
          }],
        };
      }),
    };

    await expect(
      configureAcceptanceStation(stationApi, 'https://station.invalid/'),
    ).resolves.toEqual({
      configured: true,
      activeUrl: 'https://station.invalid',
      boundUrl: 'https://station.invalid',
      bindingPhase: 'access_gate',
      online: true,
      peerIdAvailable: true,
      activeStationPeerId: 'station-peer',
    });
    expect(calls).toEqual([
      'add:https://station.invalid',
      'activate:station-peer:route-direct',
      'list',
    ]);
  });
});
