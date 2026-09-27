// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { describe, expect, it, vi } from 'vitest';

import {
  activateStationEntry,
  updateStationEntryStatus,
  type StoredStationRegistry,
} from '../features/station/stationRegistry';
import { createStationRegistryRuntime } from './stationRuntime';

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
