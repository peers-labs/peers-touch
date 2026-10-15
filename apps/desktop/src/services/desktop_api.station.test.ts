import { invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EVENT, eventBus } from '../kernel/events';
import { api } from './desktop_api';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('Desktop Station registry API', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.stubGlobal('window', new EventTarget());
    if (typeof CustomEvent === 'undefined') {
      vi.stubGlobal('CustomEvent', class<T> extends Event {
        detail: T;

        constructor(type: string, init?: CustomEventInit<T>) {
          super(type);
          this.detail = init?.detail as T;
        }
      });
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('publishes the committed logical Station and route after selection', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      ok: true,
      data: {
        command: 'station_set_active',
        status: JSON.stringify({
          active_station_peer_id: 'station-a',
          active_route_id: 'relay-a',
          binding: {
            phase: 'bound',
            station_peer_id: 'station-a',
            active_route_id: 'relay-a',
            route_revision: 2,
            lifecycle_generation: 7,
          },
        }),
      },
    });
    const observed = new Promise<{ stationPeerId: string; routeId: string }>((resolve) => {
      const unsubscribe = eventBus.subscribe(EVENT.STATION_ACTIVE_CHANGED, (payload) => {
        unsubscribe();
        resolve(payload);
      });
    });

    const selected = await api.stationSetActive('station-a', 'relay-a');

    await expect(observed).resolves.toEqual({
      stationPeerId: 'station-a',
      routeId: 'relay-a',
    });
    expect(selected.binding.lifecycle_generation).toBe(7);
  });
});
