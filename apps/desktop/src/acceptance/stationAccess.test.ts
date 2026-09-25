import { describe, expect, it, vi } from 'vitest';
import { configureAcceptanceStation } from './stationAccess';

describe('configureAcceptanceStation', () => {
  it('pins the signed Station identity before reporting the access gate ready', async () => {
    const calls: string[] = [];
    const stationApi = {
      stationAdd: vi.fn(async (url: string) => {
        calls.push(`add:${url}`);
        return {
          url,
          online: true,
          peer_id: 'station-peer',
        };
      }),
      stationSetActive: vi.fn(async (url: string) => {
        calls.push(`activate:${url}`);
        return {
          active_url: url,
          binding: {
            phase: 'access_gate' as const,
            selected_url: url,
            bound_url: url,
            generation: 1,
          },
        };
      }),
      stationList: vi.fn(async () => {
        calls.push('list');
        return {
          active_url: 'https://station.invalid',
          binding: {
            phase: 'access_gate' as const,
            selected_url: 'https://station.invalid',
            bound_url: 'https://station.invalid',
            generation: 1,
          },
          entries: [{
            url: 'https://station.invalid',
            online: true,
            peer_id: 'station-peer',
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
      'activate:https://station.invalid',
      'list',
    ]);
  });
});
