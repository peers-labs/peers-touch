import { beforeEach, describe, expect, it, vi } from 'vitest';

const nativeMocks = vi.hoisted(() => ({
  readXConfigProjection: vi.fn(),
  refreshXConfigProjection: vi.fn(),
  discoverXConfigSuggestion: vi.fn(),
}));

vi.mock('../../services/mobileCommands', () => nativeMocks);

import {
  discoverXConfigSuggestion,
  getXConfigProjection,
  loadXConfigProjection,
  refreshXConfigProjection,
  resetXConfigProjectionForTests,
  subscribeXConfigProjection,
} from './xConfig';

describe('Mobile X Config projection', () => {
  beforeEach(() => {
    resetXConfigProjectionForTests();
    vi.clearAllMocks();
  });

  it('projects local signed state before remote refresh', async () => {
    nativeMocks.readXConfigProjection.mockResolvedValue({
      channel: 'stable',
      sequence: 2,
      freshness: 'embedded',
      suggestions: [],
      refreshing: false,
    });
    nativeMocks.refreshXConfigProjection.mockResolvedValue({
      channel: 'stable',
      sequence: 3,
      freshness: 'current',
      suggestions: [{
        seedId: 'relay-home',
        kind: 'relay',
        displayName: 'Home Relay',
        canonicalOrigin: 'https://relay.example',
        regions: ['global'],
        freshness: 'current',
        actionable: true,
        sourceSequence: 3,
      }],
      refreshing: false,
    });
    const listener = vi.fn();
    const unsubscribe = subscribeXConfigProjection(listener);

    await loadXConfigProjection();
    expect(getXConfigProjection().freshness).toBe('embedded');
    await refreshXConfigProjection();
    expect(getXConfigProjection().sequence).toBe(3);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('deduplicates refreshes and never converts a suggestion into a registry entry', async () => {
    let resolveRefresh!: (value: unknown) => void;
    nativeMocks.refreshXConfigProjection.mockReturnValue(new Promise((resolve) => {
      resolveRefresh = resolve;
    }));
    const first = refreshXConfigProjection();
    const second = refreshXConfigProjection();
    expect(nativeMocks.refreshXConfigProjection).toHaveBeenCalledOnce();
    resolveRefresh({
      channel: 'stable',
      freshness: 'unavailable',
      suggestions: [],
      refreshing: false,
    });
    await Promise.all([first, second]);

    nativeMocks.discoverXConfigSuggestion.mockResolvedValue({
      role: 'relay',
      endpointPeerId: 'relay-peer',
      canonicalOrigin: 'https://relay.example',
      routes: [],
    });
    await discoverXConfigSuggestion('relay-home');
    expect(nativeMocks.discoverXConfigSuggestion).toHaveBeenCalledWith('relay-home');
  });
});
